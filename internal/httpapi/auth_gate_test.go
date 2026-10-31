package httpapi

import (
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"

	"github.com/perevozchiko/capital-tracker/web"
	"golang.org/x/crypto/bcrypt"
)

func TestAuthGateServesOnlySignInBeforeAuthentication(t *testing.T) {
	hash, err := bcrypt.GenerateFromPassword([]byte(sessionTestPassword), bcrypt.DefaultCost)
	if err != nil {
		t.Fatal(err)
	}
	auth, err := NewAuth("tester", string(hash), "", filepath.Join(t.TempDir(), "sessions.json"))
	if err != nil {
		t.Fatal(err)
	}
	h := (&Server{Auth: auth, Assets: web.Assets}).Handler()
	call := func(method, path string, cookie *http.Cookie) *httptest.ResponseRecorder {
		t.Helper()
		r := httptest.NewRequest(method, "http://127.0.0.1:8765"+path, nil)
		if cookie != nil {
			r.AddCookie(cookie)
		}
		w := httptest.NewRecorder()
		h.ServeHTTP(w, r)
		return w
	}
	assertLogin := func(path string, cookie *http.Cookie) {
		t.Helper()
		for _, method := range []string{"GET", "HEAD"} {
			w := call(method, path, cookie)
			if w.Code != 200 || w.Header().Get("Cache-Control") != "no-store" || !strings.HasPrefix(w.Header().Get("Content-Type"), "text/html") {
				t.Fatalf("sign-in %s %s: %d %v", method, path, w.Code, w.Header())
			}
			if method == "HEAD" {
				if w.Body.Len() != 0 {
					t.Fatal("HEAD returned a body")
				}
				continue
			}
			if !strings.Contains(w.Body.String(), `id="loginForm"`) {
				t.Fatal("sign-in form missing from server response")
			}
			for _, private := range []string{`id="sidebar"`, `id="pageHeading"`, `/js/app.js`, `/css/app.css`} {
				if strings.Contains(w.Body.String(), private) {
					t.Fatalf("sign-in response contains application markup: %s", private)
				}
			}
		}
	}
	for _, path := range []string{"/", "/index.html", "/login.html"} {
		assertLogin(path, nil)
	}
	for _, path := range []string{"/js/app.js", "/js/auth.js", "/js/accounts.js", "/js/boot.js", "/css/app.css", "/manifest.webmanifest", "/icons/icon-192.png", "/api/data/export", "/api/settings", "/api/accounts"} {
		for _, method := range []string{"GET", "HEAD"} {
			w := call(method, path, nil)
			if w.Code != 401 || w.Header().Get("Cache-Control") != "no-store" {
				t.Fatalf("unprotected %s %s: %d", method, path, w.Code)
			}
		}
	}
	for _, path := range []string{"/css/login.css", "/js/login.js", "/icons/favicon.svg", "/sw.js", "/api/meta"} {
		w := call("GET", path, nil)
		if w.Code != 200 || w.Header().Get("Cache-Control") != "no-store" {
			t.Fatalf("public asset %s: %d %v", path, w.Code, w.Header())
		}
	}
	worker := call("GET", "/sw.js", nil)
	if !strings.Contains(worker.Body.String(), "caches.delete") || strings.Contains(worker.Body.String(), "addAll") || !strings.HasPrefix(worker.Header().Get("Content-Type"), "text/javascript") {
		t.Fatal("authenticated deployment must replace the static-cache worker")
	}
	login := sessionRequest(auth, "POST", "/api/auth/login", sessionTestLogin, nil)
	if login.Code != 204 {
		t.Fatalf("login: %d", login.Code)
	}
	cookie := login.Result().Cookies()[0]
	for _, path := range []string{"/", "/index.html", "/js/app.js", "/css/app.css", "/manifest.webmanifest"} {
		w := call("GET", path, cookie)
		if w.Code != 200 || w.Header().Get("Cache-Control") != "no-store" {
			t.Fatalf("authenticated %s: %d %v", path, w.Code, w.Header())
		}
		if path == "/" && (!strings.Contains(w.Body.String(), `id="pageHeading"`) || strings.Contains(w.Body.String(), `id="loginForm"`)) {
			t.Fatal("remembered browser was not served the application directly")
		}
	}
	if w := call("GET", "/login.html", cookie); w.Code != 303 || w.Header().Get("Location") != "/" {
		t.Fatal("signed-in browser was shown the sign-in page")
	}
	if logout := sessionRequest(auth, "POST", "/api/auth/logout", `{}`, cookie); logout.Code != 204 {
		t.Fatalf("logout: %d", logout.Code)
	}
	assertLogin("/", cookie)
	if w := call("GET", "/js/app.js", cookie); w.Code != 401 {
		t.Fatal("signed-out browser still has access to application assets")
	}
}
