package httpapi

import (
	"net/http/httptest"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"

	"golang.org/x/crypto/bcrypt"
)

func TestLoginLimitsIsolateClientsBehindProxy(t *testing.T) {
	hash, err := bcrypt.GenerateFromPassword([]byte(sessionTestPassword), bcrypt.DefaultCost)
	if err != nil {
		t.Fatal(err)
	}
	a, err := NewAuth("tester", string(hash), "https://finance.example", filepath.Join(t.TempDir(), "sessions.json"))
	if err != nil {
		t.Fatal(err)
	}
	now := time.Now()
	a.now = func() time.Time { return now }
	h := (&Server{Auth: a}).Handler()
	login := func(client, body string) *httptest.ResponseRecorder {
		r := httptest.NewRequest("POST", "https://finance.example/api/auth/login", strings.NewReader(body))
		r.RemoteAddr = "127.0.0.1:12345"
		r.Header.Set("X-Capital-Tracker-Client-IP", client)
		r.Header.Set("X-Capital-Tracker", "1")
		r.Header.Set("Content-Type", "application/json")
		w := httptest.NewRecorder()
		h.ServeHTTP(w, r)
		return w
	}
	for i := 0; i < 10; i++ {
		if w := login("192.0.2.1", `{"username":"unknown","password":"wrong"}`); w.Code != 401 {
			t.Fatalf("bad credentials: %d", w.Code)
		}
	}
	if w := login("192.0.2.1", sessionTestLogin); w.Code != 429 {
		t.Fatalf("attacking source was not limited: %d", w.Code)
	}
	w := login("198.51.100.2", sessionTestLogin)
	if w.Code != 204 {
		t.Fatalf("attacker blocked owner on another IP: %d", w.Code)
	}
	cookie := w.Result().Cookies()[0]
	// Exhaust bcrypt capacity: existing sessions still work without that lock.
	a.loginSlots <- struct{}{}
	a.loginSlots <- struct{}{}
	if w := login("198.51.100.3", sessionTestLogin); w.Code != 429 {
		t.Fatalf("unbounded bcrypt work: %d", w.Code)
	}
	assertSessionStatus(t, a, cookie, true)
	<-a.loginSlots
	<-a.loginSlots
	now = now.Add(time.Minute)
	if w := login("192.0.2.1", sessionTestLogin); w.Code != 204 {
		t.Fatalf("expired limit was not reset: %d", w.Code)
	}
	for _, value := range []string{"", "invalid", "192.0.2.1, 198.51.100.2"} {
		if w := login(value, sessionTestLogin); w.Code != 503 {
			t.Fatalf("unsafe proxy configuration %q: %d", value, w.Code)
		}
	}
}

func TestLoginClientRejectsUntrustedForwardingAndNormalizesIPs(t *testing.T) {
	for _, tc := range []struct{ origin, peer, forwarded, want string }{
		{"", "127.0.0.1:1234", "192.0.2.1", "127.0.0.1"},
		{"https://finance.example", "192.0.2.2:1234", "192.0.2.1", "192.0.2.2"},
		{"https://finance.example", "127.0.0.1:1234", "::ffff:192.0.2.1", "192.0.2.1"},
		{"https://finance.example", "127.0.0.1:1234", "2001:db8:abcd:1234::123", "2001:db8:abcd:1234::/64"},
	} {
		r := httptest.NewRequest("POST", "https://finance.example/api/auth/login", nil)
		r.RemoteAddr = tc.peer
		r.Header.Set("X-Capital-Tracker-Client-IP", tc.forwarded)
		r.Header.Set("X-Forwarded-For", "203.0.113.1")
		a := &Auth{Origin: tc.origin}
		if got, ok := a.loginClient(r); !ok || got != tc.want {
			t.Fatalf("origin=%q peer=%q: got %q, %v; want %q", tc.origin, tc.peer, got, ok, tc.want)
		}
	}
	r := httptest.NewRequest("POST", "https://finance.example/api/auth/login", nil)
	r.RemoteAddr = "127.0.0.1:1234"
	r.Header.Add("X-Capital-Tracker-Client-IP", "192.0.2.1")
	r.Header.Add("X-Capital-Tracker-Client-IP", "198.51.100.2")
	if _, ok := (&Auth{Origin: "https://finance.example"}).loginClient(r); ok {
		t.Fatal("ambiguous proxy addresses accepted")
	}
}

func TestLoginLimitMemoryIsBoundedAndExpiredSourcesAreReclaimed(t *testing.T) {
	a := &Auth{loginLimits: make(map[string]loginWindow)}
	now := time.Now()
	for i := 0; i < maxLoginClients; i++ {
		if retry := a.reserveLogin(strconv.Itoa(i), now); retry != 0 {
			t.Fatalf("source %d unexpectedly limited", i)
		}
	}
	if retry := a.reserveLogin("new source", now); retry == 0 || len(a.loginLimits) != maxLoginClients {
		t.Fatal("source limit did not bound memory")
	}
	if retry := a.reserveLogin("new source", now.Add(time.Minute)); retry != 0 || len(a.loginLimits) != 1 {
		t.Fatal("expired sources were not reclaimed")
	}
}
