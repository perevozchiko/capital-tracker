package httpapi

import (
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"testing"
	"time"

	"golang.org/x/crypto/bcrypt"
)

func TestSessionIdleAndAbsoluteExpirySurviveRestart(t *testing.T) {
	hash, err := bcrypt.GenerateFromPassword([]byte(sessionTestPassword), bcrypt.DefaultCost)
	if err != nil {
		t.Fatal(err)
	}
	for _, active := range []bool{false, true} {
		t.Run(map[bool]string{false: "idle", true: "active"}[active], func(t *testing.T) {
			path := filepath.Join(t.TempDir(), "sessions.json")
			a, err := NewAuth("tester", string(hash), "", path)
			if err != nil {
				t.Fatal(err)
			}
			start := time.Now().UTC()
			now := start
			a.now = func() time.Time { return now }
			login := sessionRequest(a, "POST", "/api/auth/login", sessionTestLogin, nil)
			if login.Code != 204 {
				t.Fatalf("login: %d", login.Code)
			}
			cookie := login.Result().Cookies()[0]
			limit := sessionIdleTimeout
			if active {
				limit = sessionCookieLifetime
				for now = start.Add(24 * time.Hour); now.Before(start.Add(limit)); now = now.Add(24 * time.Hour) {
					assertSessionStatus(t, a, cookie, true)
					w := sessionRequest(a, "GET", "/api/auth/status", "", cookie)
					if got := w.Result().Cookies()[0].MaxAge; got != int(start.Add(limit).Sub(now).Seconds()) {
						t.Fatalf("activity extended absolute cookie lifetime: %d", got)
					}
				}
			}
			// Exercise both the live map and its persisted copy at the deadline.
			now = start.Add(limit)
			assertSessionStatus(t, a, cookie, false)
			restarted, err := NewAuth("tester", string(hash), "", path)
			if err != nil {
				t.Fatal(err)
			}
			restarted.now = a.now
			assertSessionStatus(t, restarted, cookie, false)
		})
	}
}

func TestLegacySessionsAreRevokedOnceOnUpgrade(t *testing.T) {
	hash, err := bcrypt.GenerateFromPassword([]byte(sessionTestPassword), bcrypt.DefaultCost)
	if err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(t.TempDir(), "sessions.json")
	a, err := NewAuth("tester", string(hash), "", path)
	if err != nil {
		t.Fatal(err)
	}
	token := "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
	legacy, err := json.Marshal(map[string]any{"credentials": a.credentials, "sessions": []string{sessionKey(token)}})
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, legacy, 0600); err != nil {
		t.Fatal(err)
	}
	a, err = NewAuth("tester", string(hash), "", path)
	if err != nil {
		t.Fatal(err)
	}
	assertSessionStatus(t, a, &http.Cookie{Name: sessionCookie, Value: token}, false)
	login := sessionRequest(a, "POST", "/api/auth/login", sessionTestLogin, nil)
	if login.Code != 204 {
		t.Fatalf("login after upgrade: %d", login.Code)
	}
	a, err = NewAuth("tester", string(hash), "", path)
	if err != nil {
		t.Fatal(err)
	}
	assertSessionStatus(t, a, login.Result().Cookies()[0], true)
}
