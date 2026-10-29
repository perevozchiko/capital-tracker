package httpapi

import (
	"net/http"
)

func registerSettings(mux *http.ServeMux, s *Server) {
	mux.HandleFunc("/api/settings", func(w http.ResponseWriter, r *http.Request) {
		switch r.Method {
		case "GET":
			settings, e := s.Store.Settings(s.Version)
			if e != nil {
				handleError(w, e)
				return
			}
			writeJSON(w, 200, settings)
		case "PATCH":
			var p struct {
				Language string `json:"language"`
				Theme    string `json:"theme"`
			}
			if !readJSON(w, r, &p) {
				return
			}
			if e := s.Store.UpdateSettings(p.Language, p.Theme); e != nil {
				handleError(w, e)
				return
			}
			settings, e := s.Store.Settings(s.Version)
			if e != nil {
				handleError(w, e)
				return
			}
			writeJSON(w, 200, settings)
		default:
			fail(w, 405, "method_not_allowed", "")
		}
	})
}
