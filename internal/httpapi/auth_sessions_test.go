package httpapi

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"

	"golang.org/x/crypto/bcrypt"
)

const sessionTestPassword = "persistent test password"
const sessionTestLogin = `{"username":"tester","password":"persistent test password"}`

func sessionRequest(a *Auth, method, path, body string, cookie *http.Cookie) *httptest.ResponseRecorder {
	r := httptest.NewRequest(method, "http://127.0.0.1:8765"+path, strings.NewReader(body))
	r.Header.Set("Content-Type", "application/json")
	r.Header.Set("X-Capital-Tracker", "1")
	if cookie != nil {
		r.AddCookie(cookie)
	}
	w := httptest.NewRecorder()
	(&Server{Auth: a}).Handler().ServeHTTP(w, r)
	return w
}

func assertSessionStatus(t *testing.T, a *Auth, cookie *http.Cookie, want bool) {
	t.Helper()
	w := sessionRequest(a, "GET", "/api/auth/status", "", cookie)
	var status struct{ Enabled, Authenticated bool }
	if err := json.Unmarshal(w.Body.Bytes(), &status); err != nil || w.Code != 200 || !status.Enabled || status.Authenticated != want {
		t.Fatalf("want authenticated=%v, got %d %s (%v)", want, w.Code, w.Body.String(), err)
	}
	if want {
		cookies := w.Result().Cookies()
		if len(cookies) != 1 || cookies[0].Value != cookie.Value || cookies[0].MaxAge != int(sessionCookieLifetime.Seconds()) {
			t.Fatalf("session cookie was not renewed: %v", cookies)
		}
	} else if len(w.Result().Cookies()) != 0 {
		t.Fatal("unauthenticated cookie was renewed")
	}
}

func TestPersistentSessionsSurviveRestartAndLogout(t *testing.T) {
	hash, err := bcrypt.GenerateFromPassword([]byte(sessionTestPassword), bcrypt.DefaultCost)
	if err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(t.TempDir(), "auth-sessions.json")
	restart := func(username, passwordHash string) *Auth {
		t.Helper()
		a, err := NewAuth(username, passwordHash, "", path)
		if err != nil {
			t.Fatal(err)
		}
		return a
	}
	a := restart("tester", string(hash))
	login := func(cookie *http.Cookie) *http.Cookie {
		t.Helper()
		w := sessionRequest(a, "POST", "/api/auth/login", sessionTestLogin, cookie)
		if w.Code != 204 || len(w.Result().Cookies()) != 1 {
			t.Fatalf("login: %d %s", w.Code, w.Body.String())
		}
		return w.Result().Cookies()[0]
	}
	first := login(nil)
	second := login(nil)
	if first.MaxAge <= int((365 * 24 * time.Hour).Seconds()) {
		t.Fatalf("cookie is not persistent: %+v", first)
	}
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	for _, secret := range []string{first.Value, second.Value, sessionTestPassword, string(hash)} {
		if bytes.Contains(data, []byte(secret)) {
			t.Fatal("session file contains a raw token or credential")
		}
	}
	if runtime.GOOS != "windows" {
		info, err := os.Stat(path)
		if err != nil || info.Mode().Perm() != 0600 {
			t.Fatalf("session file must be private: %v %v", info, err)
		}
	}
	a = restart("tester", string(hash))
	assertSessionStatus(t, a, first, true)
	assertSessionStatus(t, a, second, true)
	// A fresh login rotates this browser's token without revoking other devices.
	rotated := login(first)
	a = restart("tester", string(hash))
	assertSessionStatus(t, a, first, false)
	assertSessionStatus(t, a, rotated, true)
	assertSessionStatus(t, a, second, true)
	w := sessionRequest(a, "POST", "/api/auth/logout", `{}`, rotated)
	if w.Code != 204 || w.Result().Cookies()[0].MaxAge != -1 {
		t.Fatalf("logout: %d %s", w.Code, w.Body.String())
	}
	a = restart("tester", string(hash))
	assertSessionStatus(t, a, rotated, false)
	assertSessionStatus(t, a, second, true)
	// Both username and password changes revoke saved sessions, even if reverted.
	a = restart("renamed", string(hash))
	assertSessionStatus(t, a, second, false)
	a = restart("tester", string(hash))
	assertSessionStatus(t, a, second, false)
	third := login(nil)
	changedHash, err := bcrypt.GenerateFromPassword([]byte("changed password"), bcrypt.DefaultCost)
	if err != nil {
		t.Fatal(err)
	}
	a = restart("tester", string(changedHash))
	assertSessionStatus(t, a, third, false)
	a = restart("tester", string(hash))
	assertSessionStatus(t, a, third, false)
}

func TestSessionWriteFailuresDoNotReportSuccessfulLoginOrLogout(t *testing.T) {
	hash, err := bcrypt.GenerateFromPassword([]byte(sessionTestPassword), bcrypt.DefaultCost)
	if err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(t.TempDir(), "auth-sessions.json")
	a, err := NewAuth("tester", string(hash), "", path)
	if err != nil {
		t.Fatal(err)
	}
	w := sessionRequest(a, "POST", "/api/auth/login", sessionTestLogin, nil)
	if w.Code != 204 {
		t.Fatalf("login: %d %s", w.Code, w.Body.String())
	}
	cookie := w.Result().Cookies()[0]
	// Deterministically fail persistence on every OS, even when tests run as root.
	a.sessionPath = filepath.Join(t.TempDir(), "missing", "sessions.json")
	for _, endpoint := range []string{"/api/auth/login", "/api/auth/logout"} {
		w = sessionRequest(a, "POST", endpoint, sessionTestLogin, cookie)
		if w.Code != 500 || len(w.Result().Cookies()) != 0 || len(a.sessions) != 1 {
			t.Fatalf("failed persistence on %s: %d %s", endpoint, w.Code, w.Body.String())
		}
		assertSessionStatus(t, a, cookie, true)
	}
	restarted, err := NewAuth("tester", string(hash), "", path)
	if err != nil {
		t.Fatal(err)
	}
	assertSessionStatus(t, restarted, cookie, true)
}

func TestSessionsAreNotEvictedByOtherDevicesAndCorruptFilesFailClosed(t *testing.T) {
	hash, err := bcrypt.GenerateFromPassword([]byte(sessionTestPassword), bcrypt.DefaultCost)
	if err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(t.TempDir(), "auth-sessions.json")
	a, err := NewAuth("tester", string(hash), "", path)
	if err != nil {
		t.Fatal(err)
	}
	// Load more sessions than the former 32-device cap, then sign in again.
	saved := savedSessions{Credentials: a.credentials}
	for i := 0; i < 40; i++ {
		saved.Sessions = append(saved.Sessions, sessionKey(fmt.Sprintf("%064d", i)))
	}
	data, err := json.Marshal(saved)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, data, 0600); err != nil {
		t.Fatal(err)
	}
	a, err = NewAuth("tester", string(hash), "", path)
	if err != nil {
		t.Fatal(err)
	}
	w := sessionRequest(a, "POST", "/api/auth/login", sessionTestLogin, nil)
	if w.Code != 204 {
		t.Fatalf("login: %d %s", w.Code, w.Body.String())
	}
	a, err = NewAuth("tester", string(hash), "", path)
	if err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 40; i++ {
		assertSessionStatus(t, a, &http.Cookie{Name: sessionCookie, Value: fmt.Sprintf("%064d", i)}, true)
	}
	for _, corrupt := range []string{`{`, fmt.Sprintf(`{"credentials":%q,"sessions":["invalid"]}`, a.credentials)} {
		if err := os.WriteFile(path, []byte(corrupt), 0600); err != nil {
			t.Fatal(err)
		}
		if _, err := NewAuth("tester", string(hash), "", path); err == nil {
			t.Fatal("corrupt session file accepted")
		}
	}
}
