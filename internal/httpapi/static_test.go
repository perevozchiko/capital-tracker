package httpapi

import (
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/perevozchiko/capital-tracker/web"
)

// FileServer redirects /index.html to ./, so handing it the index route
// directly causes an infinite redirect loop.
func TestApplicationPageDoesNotRedirect(t *testing.T) {
	server := httptest.NewServer((&Server{Version: "test", Assets: web.Assets}).Handler())
	defer server.Close()
	client := server.Client()
	client.CheckRedirect = func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }

	for _, path := range []string{"/", "/index.html"} {
		for _, method := range []string{http.MethodGet, http.MethodHead} {
			req, err := http.NewRequest(method, server.URL+path, nil)
			if err != nil {
				t.Fatal(err)
			}
			resp, err := client.Do(req)
			if err != nil {
				t.Fatal(err)
			}
			body, err := io.ReadAll(resp.Body)
			resp.Body.Close()
			if err != nil {
				t.Fatal(err)
			}
			if resp.StatusCode != http.StatusOK {
				t.Fatalf("%s %s: got %d, redirect=%q", method, path, resp.StatusCode, resp.Header.Get("Location"))
			}
			if loc := resp.Header.Get("Location"); loc != "" {
				t.Fatalf("%s %s redirects to %s", method, path, loc)
			}
			if !strings.HasPrefix(resp.Header.Get("Content-Type"), "text/html") {
				t.Fatalf("%s %s: wrong content type %q", method, path, resp.Header.Get("Content-Type"))
			}
			if method == http.MethodGet && !strings.Contains(string(body), "<html") {
				t.Fatalf("%s: application HTML is missing", path)
			}
			if method == http.MethodHead && len(body) != 0 {
				t.Fatalf("HEAD %s returned a body", path)
			}
		}
	}
	for _, asset := range []string{"/css/app.css", "/js/app.js", "/manifest.webmanifest"} {
		resp, err := client.Get(server.URL + asset)
		if err != nil {
			t.Fatal(err)
		}
		resp.Body.Close()
		if resp.StatusCode != http.StatusOK {
			t.Fatalf("asset %s: got %d", asset, resp.StatusCode)
		}
	}
}
