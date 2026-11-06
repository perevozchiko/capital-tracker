package httpapi

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"golang.org/x/crypto/bcrypt"
)

func totpTestAuth(t *testing.T) (*Auth, func(string) *Auth) {
	t.Helper()
	hash, err := bcrypt.GenerateFromPassword([]byte(sessionTestPassword), bcrypt.DefaultCost)
	if err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(t.TempDir(), "sessions.json")
	restart := func(secret string) *Auth {
		t.Helper()
		a, err := NewAuthWithTOTP("tester", string(hash), "", path, secret)
		if err != nil {
			t.Fatal(err)
		}
		return a
	}
	return restart(testTOTPSecret), restart
}

func totpLogin(a *Auth, code string, trust bool, cookies ...*http.Cookie) *httptest.ResponseRecorder {
	body, _ := json.Marshal(map[string]any{"username": "tester", "password": sessionTestPassword, "code": code, "trust_device": trust, "remember": true})
	r := httptest.NewRequest("POST", "http://127.0.0.1:8765/api/auth/login", bytes.NewReader(body))
	r.Header.Set("Content-Type", "application/json")
	r.Header.Set("X-Capital-Tracker", "1")
	for _, cookie := range cookies {
		r.AddCookie(cookie)
	}
	w := httptest.NewRecorder()
	(&Server{Auth: a}).Handler().ServeHTTP(w, r)
	return w
}

func responseCookie(t *testing.T, w *httptest.ResponseRecorder, name string) *http.Cookie {
	t.Helper()
	for _, cookie := range w.Result().Cookies() {
		if cookie.Name == name {
			return cookie
		}
	}
	t.Fatalf("missing cookie %s: %d %s", name, w.Code, w.Body.String())
	return nil
}

func expectAuthError(t *testing.T, w *httptest.ResponseRecorder, status int, code string) {
	t.Helper()
	if w.Code != status || !strings.Contains(w.Body.String(), `"code":"`+code+`"`) || len(w.Result().Cookies()) != 0 {
		t.Fatalf("want %d %s without cookies, got %d %s", status, code, w.Code, w.Body.String())
	}
}

func TestTOTPTrustSurvivesLogoutAndRestartAndRequiresPassword(t *testing.T) {
	a, restart := totpTestAuth(t)
	now := time.Now().UTC().Truncate(30 * time.Second).Add(time.Minute)
	a.now = func() time.Time { return now }
	expectAuthError(t, sessionRequest(a, "POST", "/api/auth/login", `{"username":"tester","password":"wrong","code":"123456"}`, nil), 401, "invalid_credentials")
	expectAuthError(t, totpLogin(a, "", true), 401, "two_factor_required")
	expectAuthError(t, totpLogin(a, "abcdef", true), 401, "invalid_two_factor_code")
	assertSessionStatus(t, a, nil, false)
	code := totpCode(a.totpSecret, now.Unix()/30)
	w := totpLogin(a, code, true)
	if w.Code != 204 {
		t.Fatalf("TOTP sign-in: %d %s", w.Code, w.Body.String())
	}
	session := responseCookie(t, w, sessionCookie)
	device := responseCookie(t, w, trustedDeviceCookie)
	if device.Value == session.Value || !device.HttpOnly || device.SameSite != http.SameSiteStrictMode || device.Path != "/" || device.MaxAge != int(trustedDeviceLifetime.Seconds()) {
		t.Fatal("invalid trusted device cookie")
	}
	assertSessionStatus(t, a, session, true)
	assertSessionStatus(t, a, device, false)
	data, err := os.ReadFile(a.sessionPath)
	if err != nil {
		t.Fatal(err)
	}
	for _, secret := range []string{testTOTPSecret, string(a.totpSecret), sessionTestPassword, session.Value, device.Value} {
		if bytes.Contains(data, []byte(secret)) {
			t.Fatal("auth file contains a raw credential or token")
		}
	}
	w = sessionRequest(a, "POST", "/api/auth/logout", `{}`, session)
	if w.Code != 204 {
		t.Fatalf("logout: %d", w.Code)
	}
	a = restart(testTOTPSecret)
	a.now = func() time.Time { return now }
	assertSessionStatus(t, a, session, false)
	expectAuthError(t, sessionRequest(a, "POST", "/api/auth/login", `{"username":"tester","password":"wrong"}`, device), 401, "invalid_credentials")
	expectAuthError(t, totpLogin(a, code, true), 401, "invalid_two_factor_code")
	tampered := *device
	tampered.Value = strings.Repeat("0", 64)
	expectAuthError(t, totpLogin(a, "", true, &tampered), 401, "two_factor_required")
	w = totpLogin(a, "", true, device)
	if w.Code != 204 {
		t.Fatalf("trusted login after restart: %d %s", w.Code, w.Body.String())
	}
	rotated := responseCookie(t, w, trustedDeviceCookie)
	if rotated.Value == device.Value {
		t.Fatal("trusted token was not rotated")
	}
	expectAuthError(t, totpLogin(a, "", true, device), 401, "two_factor_required")
	expectAuthError(t, totpLogin(a, "", true), 401, "two_factor_required")
	// The second device gets its own trust without invalidating the first session.
	firstSession := responseCookie(t, w, sessionCookie)
	now = now.Add(time.Minute)
	w = totpLogin(a, totpCode(a.totpSecret, now.Unix()/30), true)
	if w.Code != 204 {
		t.Fatalf("second device: %d %s", w.Code, w.Body.String())
	}
	assertSessionStatus(t, a, firstSession, true)
	assertSessionStatus(t, a, responseCookie(t, w, sessionCookie), true)
}

func TestTOTPTrustOptOutAndExpiry(t *testing.T) {
	for _, trust := range []bool{false, true} {
		t.Run(fmt.Sprint(trust), func(t *testing.T) {
			a, restart := totpTestAuth(t)
			now := time.Now().UTC().Truncate(30 * time.Second).Add(time.Minute)
			a.now = func() time.Time { return now }
			w := totpLogin(a, totpCode(a.totpSecret, now.Unix()/30), trust)
			if w.Code != 204 {
				t.Fatalf("login: %d %s", w.Code, w.Body.String())
			}
			device := responseCookie(t, w, trustedDeviceCookie)
			if !trust {
				if device.MaxAge != -1 || len(a.devices) != 0 {
					t.Fatal("opted-out device was remembered")
				}
				a = restart(testTOTPSecret)
				expectAuthError(t, totpLogin(a, "", false), 401, "two_factor_required")
				return
			}
			// Trust alone never opens financial APIs, and expires at its deadline.
			a = restart(testTOTPSecret)
			a.now = func() time.Time { return now }
			now = now.Add(trustedDeviceLifetime)
			expectAuthError(t, totpLogin(a, "", true, device), 401, "two_factor_required")
			// A fresh code can confirm the device again; opting out removes trust.
			w = totpLogin(a, totpCode(a.totpSecret, now.Unix()/30), true, device)
			if w.Code != 204 {
				t.Fatalf("expired device confirmation: %d", w.Code)
			}
			device = responseCookie(t, w, trustedDeviceCookie)
			w = totpLogin(a, "", false, device)
			if w.Code != 204 || responseCookie(t, w, trustedDeviceCookie).MaxAge != -1 || len(a.devices) != 0 {
				t.Fatal("opt-out did not revoke existing trust")
			}
			expectAuthError(t, totpLogin(a, "", true, device), 401, "two_factor_required")
		})
	}
}

func TestTOTPConfigurationChangesRevokeSessionsAndDevices(t *testing.T) {
	a, restart := totpTestAuth(t)
	w := totpLogin(a, totpCode(a.totpSecret, a.now().Unix()/30), true)
	if w.Code != 204 {
		t.Fatalf("login: %d", w.Code)
	}
	session := responseCookie(t, w, sessionCookie)
	device := responseCookie(t, w, trustedDeviceCookie)
	// Canonical forms preserve devices; actual secret changes revoke them.
	a = restart(strings.ToLower(testTOTPSecret) + "=")
	assertSessionStatus(t, a, session, true)
	secret, _, err := NewTOTPEnrollment("tester")
	if err != nil {
		t.Fatal(err)
	}
	a = restart(secret)
	assertSessionStatus(t, a, session, false)
	expectAuthError(t, totpLogin(a, "", true, device), 401, "two_factor_required")
	a = restart(testTOTPSecret)
	expectAuthError(t, totpLogin(a, "", true, device), 401, "two_factor_required")
	// Enabling TOTP also revokes sessions created with only a password.
	a = restart("")
	w = totpLogin(a, "", false)
	if w.Code != 204 {
		t.Fatalf("password-only login: %d", w.Code)
	}
	a = restart(testTOTPSecret)
	assertSessionStatus(t, a, responseCookie(t, w, sessionCookie), false)
	if _, err := NewAuthWithTOTP(a.username, string(a.passwordHash), "", a.sessionPath, "bad secret"); err == nil {
		t.Fatal("invalid TOTP configuration accepted")
	}
}

func TestTOTPWriteFailureRollsBackReplayAndTrust(t *testing.T) {
	a, restart := totpTestAuth(t)
	path := a.sessionPath
	code := totpCode(a.totpSecret, a.now().Unix()/30)
	a.sessionPath = filepath.Join(t.TempDir(), "missing", "sessions.json")
	expectAuthError(t, totpLogin(a, code, true), 500, "internal_error")
	if len(a.devices) != 0 || len(a.sessions) != 0 || a.lastTOTPStep != 0 {
		t.Fatal("failed save left authentication state in memory")
	}
	a.sessionPath = path
	w := totpLogin(a, code, true)
	if w.Code != 204 {
		t.Fatalf("retry after write failure: %d %s", w.Code, w.Body.String())
	}
	device := responseCookie(t, w, trustedDeviceCookie)
	session := responseCookie(t, w, sessionCookie)
	a.sessionPath = filepath.Join(t.TempDir(), "missing", "sessions.json")
	expectAuthError(t, totpLogin(a, "", true, device, session), 500, "internal_error")
	assertSessionStatus(t, a, session, true)
	if len(a.devices) != 1 || a.devices[sessionKey(device.Value)].IsZero() {
		t.Fatal("failed rotation lost trusted device")
	}
	a = restart(testTOTPSecret)
	w = totpLogin(a, "", true, device)
	if w.Code != 204 {
		t.Fatalf("trust lost after failed write and restart: %d", w.Code)
	}
}

func TestTOTPConcurrentReplayAndAccountThrottling(t *testing.T) {
	a, _ := totpTestAuth(t)
	code := totpCode(a.totpSecret, a.now().Unix()/30)
	var wg sync.WaitGroup
	results := make(chan *httptest.ResponseRecorder, 2)
	for i := 0; i < 2; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			results <- totpLogin(a, code, false)
		}()
	}
	wg.Wait()
	close(results)
	accepted := 0
	for w := range results {
		if w.Code == 204 {
			accepted++
		} else {
			expectAuthError(t, w, 401, "invalid_two_factor_code")
		}
	}
	if accepted != 1 {
		t.Fatalf("same code accepted %d times", accepted)
	}
	// Change source IP on each attempt to exercise the account-wide OTP limit.
	for i := 0; i < 9; i++ {
		r := httptest.NewRequest("POST", "http://127.0.0.1:8765/api/auth/login", strings.NewReader(fmt.Sprintf(`{"username":"tester","password":%q,"code":"invalid"}`, sessionTestPassword)))
		r.RemoteAddr = fmt.Sprintf("192.0.2.%d:1234", i+1)
		r.Header.Set("Content-Type", "application/json")
		r.Header.Set("X-Capital-Tracker", "1")
		w := httptest.NewRecorder()
		(&Server{Auth: a}).Handler().ServeHTTP(w, r)
		status, code := 401, "invalid_two_factor_code"
		if i == 8 {
			status, code = 429, "login_rate_limited"
			if w.Header().Get("Retry-After") == "" {
				t.Fatal("missing retry delay")
			}
		}
		expectAuthError(t, w, status, code)
	}
}
