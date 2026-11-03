package httpapi

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/perevozchiko/capital-tracker/internal/updateagent"
	"github.com/perevozchiko/capital-tracker/web"
	"golang.org/x/crypto/bcrypt"
)

func TestUpdateRoutesAuthCSRFAndNarrowProxy(t *testing.T) {
	key := strings.Repeat("b", 64)
	calls := 0
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		data, _ := io.ReadAll(r.Body)
		if r.URL.Path == "/v1/start" && string(data) != `{"current_version":"0.3.2","request_id":"123","target_version":"0.4.0"}` {
			t.Errorf("unexpected forwarded body: %s", data)
		}
		raw := `{"enabled":true,"operation":null}`
		mac := hmac.New(sha256.New, []byte(key))
		fmt.Fprintf(mac, "%s\n200\n%s", r.Header.Get("X-Update-Nonce"), raw)
		w.Header().Set("X-Update-Signature", hex.EncodeToString(mac.Sum(nil)))
		w.Write([]byte(raw))
	}))
	defer upstream.Close()
	keyFile := filepath.Join(t.TempDir(), "key")
	os.WriteFile(keyFile, []byte(key), 0600)
	updater, err := updateagent.New(upstream.URL, keyFile)
	if err != nil {
		t.Fatal(err)
	}
	hash, err := bcrypt.GenerateFromPassword([]byte(sessionTestPassword), bcrypt.DefaultCost)
	if err != nil {
		t.Fatal(err)
	}
	auth, err := NewAuth("tester", string(hash), "", filepath.Join(t.TempDir(), "sessions.json"))
	if err != nil {
		t.Fatal(err)
	}
	handler := (&Server{Auth: auth, Assets: web.Assets, Version: "0.3.2", Updater: updater}).Handler()
	login := sessionRequest(auth, "POST", "/api/auth/login", sessionTestLogin, nil)
	cookie := login.Result().Cookies()[0]
	call := func(method, path, body, origin, csrf string, authenticated bool) int {
		r := httptest.NewRequest(method, "http://127.0.0.1:8765"+path, strings.NewReader(body))
		r.Header.Set("Content-Type", "application/json")
		r.Header.Set("Origin", origin)
		r.Header.Set("X-Capital-Tracker", csrf)
		if authenticated {
			r.AddCookie(cookie)
		}
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, r)
		if w.Code == 200 && w.Header().Get("Cache-Control") != "no-store" {
			t.Error("cacheable status")
		}
		return w.Code
	}
	for _, tc := range []struct {
		method, path, body, origin, csrf string
		auth                             bool
		want                             int
	}{
		{"GET", "/api/update/status", "", "", "", false, 401},
		{"POST", "/api/update/check", "{}", "", "1", false, 401},
		{"POST", "/api/update/start", "{}", "", "1", false, 401},
		{"POST", "/api/update/start", "{}", "", "", true, 403},
		{"POST", "/api/update/start", "{}", "https://evil.test", "1", true, 403},
		{"POST", "/api/update/start", `{"command":"whoami"}`, "", "1", true, 400},
		{"POST", "/api/update/check", `{"target_version":"0.4.0"}`, "", "1", true, 400},
		{"GET", "/api/update/start", "", "", "", true, 405},
		{"GET", "/api/update/status", "", "", "", true, 200},
		{"POST", "/api/update/check", "{}", "http://127.0.0.1:8765", "1", true, 200},
		{"POST", "/api/update/start", `{"target_version":"0.4.0","request_id":"123"}`, "", "1", true, 200},
	} {
		if got := call(tc.method, tc.path, tc.body, tc.origin, tc.csrf, tc.auth); got != tc.want {
			t.Fatalf("%s %s: %d want %d", tc.method, tc.path, got, tc.want)
		}
	}
	if calls != 3 {
		t.Fatalf("unauthorized calls reached agent: %d", calls)
	}
}

func TestUpdateDisabledDoesNotBreakOrdinaryApp(t *testing.T) {
	handler := (&Server{Version: "0.3.2", Assets: web.Assets}).Handler()
	for _, path := range []string{"/api/meta", "/api/update/status", "/"} {
		r := httptest.NewRequest("GET", "http://127.0.0.1:8765"+path, nil)
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, r)
		if w.Code != 200 {
			t.Fatalf("%s: %d", path, w.Code)
		}
		if path == "/api/update/status" && !strings.Contains(w.Body.String(), `"enabled":false`) {
			t.Fatal("updater enabled")
		}
	}
}

func TestConfiguredUnavailableAgentKeepsAppAvailable(t *testing.T) {
	upstream := httptest.NewServer(http.NotFoundHandler())
	endpoint := upstream.URL
	upstream.Close()
	keyFile := filepath.Join(t.TempDir(), "key")
	if err := os.WriteFile(keyFile, []byte(strings.Repeat("a", 64)), 0600); err != nil {
		t.Fatal(err)
	}
	updater, err := updateagent.New(endpoint, keyFile)
	if err != nil {
		t.Fatal(err)
	}
	handler := (&Server{Version: "0.3.2", Assets: web.Assets, Updater: updater}).Handler()
	for _, tc := range []struct {
		path string
		want int
	}{{"/api/update/status", 503}, {"/api/meta", 200}, {"/", 200}} {
		r := httptest.NewRequest("GET", "http://127.0.0.1:8765"+tc.path, nil)
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, r)
		if w.Code != tc.want {
			t.Fatalf("%s: %d", tc.path, w.Code)
		}
	}
}
