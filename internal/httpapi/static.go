package httpapi

import (
	"bytes"
	"io/fs"
	"net/http"
	"strings"
	"time"
)

func registerStatic(mux *http.ServeMux, s *Server) {
	static := http.FileServer(http.FS(s.Assets))
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != "GET" && r.Method != "HEAD" {
			fail(w, 405, "method_not_allowed", "")
			return
		}
		path := r.URL.Path
		if path == "/" || path == "/index.html" {
			// FileServer intentionally redirects /index.html to ./.
			// Passing the root request through it causes an infinite loop.
			index, err := fs.ReadFile(s.Assets, "index.html")
			if err != nil {
				http.Error(w, "application page unavailable", http.StatusInternalServerError)
				return
			}
			w.Header().Set("Cache-Control", "no-cache, must-revalidate")
			w.Header().Set("Content-Type", "text/html; charset=utf-8")
			http.ServeContent(w, r, "index.html", time.Time{}, bytes.NewReader(index))
			return
		}
		if strings.HasPrefix(path, "/css/") || strings.HasPrefix(path, "/js/") || strings.HasPrefix(path, "/icons/") || path == "/sw.js" || path == "/manifest.webmanifest" {
			w.Header().Set("Cache-Control", "no-cache, must-revalidate")
			static.ServeHTTP(w, r)
			return
		}
		http.NotFound(w, r)
	})
}
