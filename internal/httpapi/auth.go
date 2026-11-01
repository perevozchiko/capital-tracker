package httpapi

import (
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"errors"
	"io/fs"
	"net/http"
	"net/url"
	"strconv"
	"sync"
	"time"

	"golang.org/x/crypto/bcrypt"
)

const sessionCookie = "capital_tracker_session"

type Auth struct {
	username     string
	passwordHash []byte
	Origin       string
	mu           sync.Mutex
	sessions     map[string]sessionState
	sessionPath  string
	credentials  string
	loginLimits  map[string]loginWindow
	loginSlots   chan struct{}
	now          func() time.Time
}

// Credentials are deployment configuration, never part of financial backups.
func NewAuth(username, hash, origin, sessionPath string) (*Auth, error) {
	if username == "" || len(username) > 100 {
		return nil, errors.New("auth username is required (max 100 bytes)")
	}
	cost, err := bcrypt.Cost([]byte(hash))
	if err != nil || cost < bcrypt.DefaultCost || cost > 16 {
		return nil, errors.New("password hash must be bcrypt with cost 10..16")
	}
	if origin != "" {
		u, err := url.Parse(origin)
		if err != nil || u.Scheme != "https" || u.Hostname() == "" || u.User != nil || u.Path != "" || u.RawQuery != "" || u.Fragment != "" {
			return nil, errors.New("public origin must be an HTTPS origin, e.g. https://fin.anasko.net (no trailing slash)")
		}
	}
	a := &Auth{username: username, passwordHash: []byte(hash), Origin: origin, sessionPath: sessionPath,
		loginLimits: make(map[string]loginWindow), loginSlots: make(chan struct{}, 2), now: time.Now}
	fingerprint := sha256.Sum256([]byte(username + "\x00" + hash))
	a.credentials = hex.EncodeToString(fingerprint[:])
	if err := a.loadSessions(); err != nil {
		return nil, err
	}
	return a, nil
}

func (a *Auth) authenticated(w http.ResponseWriter, r *http.Request) bool {
	cookie, err := r.Cookie(sessionCookie)
	if err != nil || len(cookie.Value) != 64 {
		return false
	}
	a.mu.Lock()
	defer a.mu.Unlock()
	key := sessionKey(cookie.Value)
	session, ok := a.sessions[key]
	now := a.now()
	if !ok || !session.valid(now) {
		delete(a.sessions, key)
		return false
	}
	// Persist activity at most once per hour, rather than fsync on every asset.
	// A crash can shorten the idle window, never extend the absolute lifetime.
	if now.Sub(session.LastSeen) >= sessionActivityInterval {
		updated := session
		updated.LastSeen = now
		a.sessions[key] = updated
		if err := a.saveSessions(); err != nil {
			a.sessions[key] = session
			return false
		}
	}
	http.SetCookie(w, a.cookie(cookie.Value, session.maxAge(now)))
	return true
}

func (a *Auth) cookie(value string, maxAge int) *http.Cookie {
	return &http.Cookie{Name: sessionCookie, Value: value, Path: "/", HttpOnly: true, Secure: a.Origin != "", SameSite: http.SameSiteStrictMode, MaxAge: maxAge}
}

func (a *Auth) protect(next http.Handler, assets fs.FS) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-store")
		switch r.URL.Path {
		case "/api/auth/status":
			if r.Method != "GET" {
				fail(w, 405, "method_not_allowed", "")
				return
			}
			writeJSON(w, 200, map[string]bool{"enabled": true, "authenticated": a.authenticated(w, r)})
			return
		case "/api/auth/login":
			a.login(w, r)
			return
		case "/api/auth/logout":
			if r.Method != "POST" {
				fail(w, 405, "method_not_allowed", "")
				return
			}
			if cookie, err := r.Cookie(sessionCookie); err == nil {
				a.mu.Lock()
				key := sessionKey(cookie.Value)
				session, existed := a.sessions[key]
				delete(a.sessions, key)
				if existed {
					if err := a.saveSessions(); err != nil {
						a.sessions[key] = session
						a.mu.Unlock()
						fail(w, 500, "internal_error", "")
						return
					}
				}
				a.mu.Unlock()
			}
			http.SetCookie(w, a.cookie("", -1))
			w.WriteHeader(http.StatusNoContent)
			return
		// Only the sign-in page's assets and the cache-cleanup worker are public.
		// Metadata is also used by the launcher to detect a running instance.
		case "/css/login.css", "/js/login.js", "/icons/favicon.svg", "/sw.js", "/api/meta":
			next.ServeHTTP(w, r)
			return
		}
		if a.authenticated(w, r) {
			if r.URL.Path == "/login.html" {
				http.Redirect(w, r, "/", http.StatusSeeOther)
				return
			}
			next.ServeHTTP(w, r)
			return
		}
		switch r.URL.Path {
		case "/", "/index.html", "/login.html":
			servePage(w, r, assets, "login.html")
		default:
			fail(w, 401, "unauthorized", "")
		}
	})
}

func (a *Auth) login(w http.ResponseWriter, r *http.Request) {
	if r.Method != "POST" {
		fail(w, 405, "method_not_allowed", "")
		return
	}
	var input struct {
		Username string `json:"username"`
		Password string `json:"password"`
	}
	r.Body = http.MaxBytesReader(w, r.Body, 4096)
	if !readJSON(w, r, &input) {
		return
	}
	client, ok := a.loginClient(r)
	if !ok {
		fail(w, 503, "login_proxy_configuration", "")
		return
	}
	if retry := a.reserveLogin(client, a.now()); retry > 0 {
		w.Header().Set("Retry-After", strconv.Itoa(retry))
		fail(w, 429, "login_rate_limited", "")
		return
	}
	// Bound bcrypt work without holding the mutex used by authenticated traffic.
	select {
	case a.loginSlots <- struct{}{}:
		defer func() { <-a.loginSlots }()
	default:
		w.Header().Set("Retry-After", "1")
		fail(w, 429, "login_rate_limited", "")
		return
	}
	// Verify the password even for a wrong username to avoid a timing oracle.
	err := bcrypt.CompareHashAndPassword(a.passwordHash, []byte(input.Password))
	if err != nil || subtle.ConstantTimeCompare([]byte(input.Username), []byte(a.username)) != 1 {
		fail(w, 401, "invalid_credentials", "")
		return
	}
	var random [32]byte
	if _, err := rand.Read(random[:]); err != nil {
		fail(w, 500, "internal_error", "")
		return
	}
	token := hex.EncodeToString(random[:])
	a.mu.Lock()
	defer a.mu.Unlock()
	// Rotate only this browser's session; other devices stay signed in.
	var oldKey string
	var hadOld bool
	var oldSession sessionState
	if old, err := r.Cookie(sessionCookie); err == nil {
		oldKey = sessionKey(old.Value)
		oldSession, hadOld = a.sessions[oldKey]
		delete(a.sessions, oldKey)
	}
	key := sessionKey(token)
	now := a.now()
	session := sessionState{ExpiresAt: now.Add(sessionCookieLifetime), LastSeen: now}
	a.sessions[key] = session
	if err := a.saveSessions(); err != nil {
		delete(a.sessions, key)
		if hadOld {
			a.sessions[oldKey] = oldSession
		}
		fail(w, 500, "internal_error", "")
		return
	}
	http.SetCookie(w, a.cookie(token, session.maxAge(now)))
	w.WriteHeader(http.StatusNoContent)
}
