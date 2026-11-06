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
	totpSecret   []byte
	lastTOTPStep int64
	totpLimits   loginWindow
	devices      map[string]time.Time
	now          func() time.Time
}

// Credentials are deployment configuration, never part of financial backups.
func NewAuth(username, hash, origin, sessionPath string) (*Auth, error) {
	return NewAuthWithTOTP(username, hash, origin, sessionPath, "")
}

// NewAuthWithTOTP optionally requires a code when signing in on a new browser.
func NewAuthWithTOTP(username, hash, origin, sessionPath, secret string) (*Auth, error) {
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
	credentials := username + "\x00" + hash
	if secret != "" {
		a.totpSecret, err = decodeTOTPSecret(secret)
		if err != nil {
			return nil, err
		}
		credentials += "\x00totp\x00" + hex.EncodeToString(a.totpSecret)
	}
	fingerprint := sha256.Sum256([]byte(credentials))
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
	// Remembered devices get a sliding lifetime; regular sessions keep their
	// original absolute deadline. Only acknowledge a renewal after saving it.
	if now.Sub(session.LastSeen) >= sessionActivityInterval {
		updated := session
		updated.LastSeen = now
		if session.Remember {
			updated.ExpiresAt = now.Add(rememberedLifetime)
		}
		a.sessions[key] = updated
		if err := a.saveSessions(); err != nil {
			a.sessions[key] = session
			return false
		}
		session = updated
	}
	http.SetCookie(w, a.cookie(cookie.Value, session.maxAge(now)))
	return true
}

func (a *Auth) cookie(value string, maxAge int) *http.Cookie {
	expires := a.now().Add(time.Duration(maxAge) * time.Second)
	if maxAge < 0 {
		expires = time.Unix(1, 0)
	}
	return &http.Cookie{Name: sessionCookie, Value: value, Path: "/", HttpOnly: true, Secure: a.Origin != "", SameSite: http.SameSiteStrictMode, MaxAge: maxAge, Expires: expires}
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
		Remember bool   `json:"remember"`
		Code     string `json:"code"`
		Trust    bool   `json:"trust_device"`
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
	now := a.now()
	deviceKey := ""
	var deviceExpiry time.Time
	if device, err := r.Cookie(trustedDeviceCookie); err == nil && len(device.Value) == 64 {
		deviceKey = sessionKey(device.Value)
		deviceExpiry = a.devices[deviceKey]
	}
	step := a.lastTOTPStep
	if len(a.totpSecret) > 0 && !now.Before(deviceExpiry) {
		if input.Code == "" {
			fail(w, 401, "two_factor_required", "code")
			return
		}
		// Only callers who know the password can consume the account-wide OTP
		// budget. Changing source IP cannot bypass this limit.
		if now.Sub(a.totpLimits.Started) >= time.Minute {
			a.totpLimits = loginWindow{Started: now}
		}
		if a.totpLimits.Attempts >= 10 {
			w.Header().Set("Retry-After", strconv.Itoa(int((time.Minute-now.Sub(a.totpLimits.Started)+time.Second-1)/time.Second)))
			fail(w, 429, "login_rate_limited", "")
			return
		}
		a.totpLimits.Attempts++
		var valid bool
		step, valid = verifyTOTP(a.totpSecret, input.Code, now, a.lastTOTPStep)
		if !valid {
			fail(w, 401, "invalid_two_factor_code", "code")
			return
		}
	}
	var deviceToken string
	if len(a.totpSecret) > 0 && input.Trust {
		var random [32]byte
		if _, err := rand.Read(random[:]); err != nil {
			fail(w, 500, "internal_error", "")
			return
		}
		deviceToken = hex.EncodeToString(random[:])
	}
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
	session := sessionState{ExpiresAt: now.Add(sessionCookieLifetime), LastSeen: now}
	if input.Remember {
		session.Remember = true
		session.ExpiresAt = now.Add(rememberedLifetime)
	}
	a.sessions[key] = session
	previousStep := a.lastTOTPStep
	a.lastTOTPStep = step
	delete(a.devices, deviceKey)
	if deviceToken != "" {
		a.devices[sessionKey(deviceToken)] = now.Add(trustedDeviceLifetime)
	}
	if err := a.saveSessions(); err != nil {
		delete(a.sessions, key)
		a.lastTOTPStep = previousStep
		delete(a.devices, sessionKey(deviceToken))
		if !deviceExpiry.IsZero() {
			a.devices[deviceKey] = deviceExpiry
		}
		if hadOld {
			a.sessions[oldKey] = oldSession
		}
		fail(w, 500, "internal_error", "")
		return
	}
	http.SetCookie(w, a.cookie(token, session.maxAge(now)))
	if len(a.totpSecret) > 0 {
		maxAge := -1
		if deviceToken != "" {
			maxAge = int(trustedDeviceLifetime.Seconds())
		}
		cookie := a.cookie(deviceToken, maxAge)
		cookie.Name = trustedDeviceCookie
		http.SetCookie(w, cookie)
	}
	w.WriteHeader(http.StatusNoContent)
}
