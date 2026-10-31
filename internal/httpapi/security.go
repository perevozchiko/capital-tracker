package httpapi

import (
	"net"
	"net/http"
	"net/url"
	"strings"
)

func secureLocalRequests(next http.Handler) http.Handler { return secureRequests(next, "") }
func secureRequests(next http.Handler, publicOrigin string) http.Handler {
	publicURL, _ := url.Parse(publicOrigin)
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// A loopback listener alone does not defeat DNS rebinding; reject unexpected Host.
		host, _, e := net.SplitHostPort(r.Host)
		if e != nil {
			host = r.Host
		}
		if !(publicOrigin != "" && strings.EqualFold(r.Host, publicURL.Host)) && host != "127.0.0.1" && host != "localhost" && host != "[::1]" && host != "::1" {
			fail(w, 403, "invalid_host", "")
			return
		}
		if strings.HasPrefix(r.URL.Path, "/api/") && r.Method != "GET" && r.Method != "HEAD" {
			if r.Header.Get("X-Capital-Tracker") != "1" {
				fail(w, 403, "csrf_header_required", "")
				return
			}
			if origin := r.Header.Get("Origin"); origin != "" {
				u, e := url.Parse(origin)
				expectedScheme := "http"
				if publicOrigin != "" && strings.EqualFold(r.Host, publicURL.Host) {
					expectedScheme = "https"
				}
				if e != nil || u.Scheme != expectedScheme || !strings.EqualFold(u.Host, r.Host) || u.User != nil || u.Path != "" || u.RawQuery != "" || u.Fragment != "" {
					fail(w, 403, "invalid_origin", "")
					return
				}
			}
			if site := r.Header.Get("Sec-Fetch-Site"); site == "cross-site" {
				fail(w, 403, "cross_site_request", "")
				return
			}
		}
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("X-Frame-Options", "DENY")
		w.Header().Set("Referrer-Policy", "no-referrer")
		w.Header().Set("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'")
		next.ServeHTTP(w, r)
	})
}
