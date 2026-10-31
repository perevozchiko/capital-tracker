package httpapi

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"

	"golang.org/x/crypto/bcrypt"
)

func TestAuthenticationProtectsDataAndRevokesSessions(t *testing.T) {
	hash, err := bcrypt.GenerateFromPassword([]byte("correct test password"), bcrypt.DefaultCost)
	if err != nil {
		t.Fatal(err)
	}
	auth, err := NewAuth("andrei", string(hash), "https://fin.anasko.net", filepath.Join(t.TempDir(), "sessions.json"))
	if err != nil {
		t.Fatal(err)
	}
	h := (&Server{Auth: auth}).Handler()
	call := func(method, path, body string, cookie *http.Cookie, origin string) *httptest.ResponseRecorder {
		t.Helper()
		req := httptest.NewRequest(method, "https://fin.anasko.net"+path, strings.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("X-Capital-Tracker", "1")
		if origin != "" {
			req.Header.Set("Origin", origin)
		}
		if cookie != nil {
			req.AddCookie(cookie)
		}
		out := httptest.NewRecorder()
		h.ServeHTTP(out, req)
		return out
	}
	for _, path := range []string{"/api/accounts", "/api/data/export", "/api/months", "/api/settings", "/api/recurring-expenses"} {
		if out := call("GET", path, "", nil, ""); out.Code != 401 {
			t.Fatalf("unprotected %s: %d", path, out.Code)
		}
	}
	if out := call("POST", "/api/data/clear", `{"confirm":true}`, nil, "https://fin.anasko.net"); out.Code != 401 {
		t.Fatalf("unprotected mutation: %d", out.Code)
	}
	for _, body := range []string{`{"username":"andrei","password":"wrong"}`, `{"username":"wrong","password":"correct test password"}`} {
		if out := call("POST", "/api/auth/login", body, nil, "https://fin.anasko.net"); out.Code != 401 {
			t.Fatalf("bad credentials: %d", out.Code)
		}
	}
	payload := `{"username":"andrei","password":"correct test password"}`
	for _, origin := range []string{"http://fin.anasko.net", "https://evil.example", "https://fin.anasko.net:9000"} {
		if out := call("POST", "/api/auth/login", payload, nil, origin); out.Code != 403 {
			t.Fatalf("accepted origin %s: %d", origin, out.Code)
		}
	}
	out := call("POST", "/api/auth/login", payload, nil, "https://fin.anasko.net")
	if out.Code != 204 {
		t.Fatalf("login: %d %s", out.Code, out.Body.String())
	}
	cookies := out.Result().Cookies()
	if len(cookies) != 1 {
		t.Fatalf("cookies: %v", cookies)
	}
	cookie := cookies[0]
	if !cookie.Secure || !cookie.HttpOnly || cookie.SameSite != http.SameSiteStrictMode || cookie.Path != "/" || cookie.MaxAge != int(sessionCookieLifetime.Seconds()) {
		t.Fatalf("insecure cookie: %+v", cookie)
	}
	status := call("GET", "/api/auth/status", "", cookie, "")
	var data struct{ Enabled, Authenticated bool }
	if err := json.Unmarshal(status.Body.Bytes(), &data); err != nil || !data.Enabled || !data.Authenticated {
		t.Fatalf("status: %s %v", status.Body.String(), err)
	}
	tampered := *cookie
	tampered.Value = strings.Repeat("0", 64)
	if out := call("GET", "/api/accounts", "", &tampered, ""); out.Code != 401 {
		t.Fatal("tampered session accepted")
	}
	if out := call("POST", "/api/auth/logout", `{}`, cookie, "https://fin.anasko.net"); out.Code != 204 || out.Result().Cookies()[0].MaxAge != -1 {
		t.Fatalf("logout: %d", out.Code)
	}
	if out := call("GET", "/api/accounts", "", cookie, ""); out.Code != 401 {
		t.Fatal("logged-out session accepted")
	}
	// A forged proxy header must never bypass Host validation.
	req := httptest.NewRequest("GET", "http://evil.example/api/auth/status", nil)
	req.Header.Set("X-Forwarded-Host", "fin.anasko.net")
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != 403 {
		t.Fatal("forwarded Host bypassed validation")
	}
}

func TestAuthConfigAndLoginThrottling(t *testing.T) {
	hash, err := bcrypt.GenerateFromPassword([]byte("correct test password"), bcrypt.DefaultCost)
	if err != nil {
		t.Fatal(err)
	}
	for _, origin := range []string{"http://fin.anasko.net", "https://fin.anasko.net/", "https://user:pass@fin.anasko.net", "https://fin.anasko.net?x=1"} {
		if _, err := NewAuth("andrei", string(hash), origin, filepath.Join(t.TempDir(), "sessions.json")); err == nil {
			t.Fatalf("accepted origin %s", origin)
		}
	}
	if _, err := NewAuth("", string(hash), "", filepath.Join(t.TempDir(), "sessions.json")); err == nil {
		t.Fatal("empty username accepted")
	}
	if _, err := NewAuth("andrei", "placeholder", "", filepath.Join(t.TempDir(), "sessions.json")); err == nil {
		t.Fatal("bad hash accepted")
	}
	auth, err := NewAuth("andrei", string(hash), "", filepath.Join(t.TempDir(), "sessions.json"))
	if err != nil {
		t.Fatal(err)
	}
	h := (&Server{Auth: auth}).Handler()
	for i := 0; i < 11; i++ {
		req := httptest.NewRequest("POST", "http://127.0.0.1:8765/api/auth/login", strings.NewReader(`{"username":"andrei","password":"wrong"}`))
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("X-Capital-Tracker", "1")
		out := httptest.NewRecorder()
		h.ServeHTTP(out, req)
		want := 401
		if i == 10 {
			want = 429
		}
		if out.Code != want {
			t.Fatalf("attempt %d: %d", i, out.Code)
		}
		if i == 10 && out.Header().Get("Retry-After") == "" {
			t.Fatal("missing retry delay")
		}
	}
}
