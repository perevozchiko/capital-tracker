package httpapi

import (
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"errors"
	"net/http"
	"net/url"
	"sync"
	"time"

	"golang.org/x/crypto/bcrypt"
)

const sessionCookie = "capital_tracker_session"
const sessionLifetime = 7 * 24 * time.Hour

type Auth struct {
	username     string
	passwordHash []byte
	Origin       string
	mu           sync.Mutex
	sessions     map[[32]byte]time.Time
	attempts     int
	window       time.Time
}

// Credentials are deployment configuration, never part of financial backups.
func NewAuth(username, hash, origin string) (*Auth, error) {
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
	return &Auth{username: username, passwordHash: []byte(hash), Origin: origin, sessions: make(map[[32]byte]time.Time)}, nil
}

func (a *Auth) authenticated(r *http.Request) bool {
	cookie, err := r.Cookie(sessionCookie)
	if err != nil || len(cookie.Value) != 64 {
		return false
	}
	key := sha256.Sum256([]byte(cookie.Value))
	a.mu.Lock()
	defer a.mu.Unlock()
	expires, ok := a.sessions[key]
	if ok && !time.Now().Before(expires) {
		delete(a.sessions, key)
		return false
	}
	return ok
}

func (a *Auth) cookie(value string, maxAge int) *http.Cookie {
	return &http.Cookie{Name: sessionCookie, Value: value, Path: "/", HttpOnly: true, Secure: a.Origin != "", SameSite: http.SameSiteStrictMode, MaxAge: maxAge}
}

func (a *Auth) protect(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-store")
		switch r.URL.Path {
		case "/api/auth/status":
			if r.Method != "GET" {
				fail(w, 405, "method_not_allowed", "")
				return
			}
			writeJSON(w, 200, map[string]bool{"enabled": true, "authenticated": a.authenticated(r)})
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
				delete(a.sessions, sha256.Sum256([]byte(cookie.Value)))
				a.mu.Unlock()
			}
			http.SetCookie(w, a.cookie("", -1))
			w.WriteHeader(http.StatusNoContent)
			return
		}
		if len(r.URL.Path) >= 5 && r.URL.Path[:5] == "/api/" && r.URL.Path != "/api/meta" && !a.authenticated(r) {
			fail(w, 401, "unauthorized", "")
			return
		}
		next.ServeHTTP(w, r)
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
	a.mu.Lock()
	defer a.mu.Unlock()
	now := time.Now()
	if now.Sub(a.window) >= time.Minute {
		a.window = now
		a.attempts = 0
	}
	if a.attempts >= 10 {
		w.Header().Set("Retry-After", "60")
		fail(w, 429, "login_rate_limited", "")
		return
	}
	a.attempts++
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
	for key, expires := range a.sessions {
		if !now.Before(expires) {
			delete(a.sessions, key)
		}
	}
	// Rotate the current browser session and bound memory across repeated logins.
	if old, err := r.Cookie(sessionCookie); err == nil {
		delete(a.sessions, sha256.Sum256([]byte(old.Value)))
	}
	if len(a.sessions) >= 32 {
		var oldest [32]byte
		var expiry time.Time
		for key, expires := range a.sessions {
			if expiry.IsZero() || expires.Before(expiry) {
				oldest = key
				expiry = expires
			}
		}
		delete(a.sessions, oldest)
	}
	a.sessions[sha256.Sum256([]byte(token))] = now.Add(sessionLifetime)
	http.SetCookie(w, a.cookie(token, int(sessionLifetime.Seconds())))
	w.WriteHeader(http.StatusNoContent)
}
