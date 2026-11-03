package httpapi

import (
	"net/http"
)

func registerUpdates(mux *http.ServeMux, s *Server) {
	for _, action := range []string{"status", "check", "start"} {
		mux.HandleFunc("/api/update/"+action, func(w http.ResponseWriter, r *http.Request) {
			method := "POST"
			if action == "status" {
				method = "GET"
			}
			if r.Method != method {
				fail(w, 405, "method_not_allowed", "")
				return
			}
			if s.Updater == nil {
				if action == "status" {
					writeJSON(w, 200, map[string]any{"enabled": false, "current_version": s.Version})
					return
				}
				fail(w, 503, "update_unavailable", "")
				return
			}
			var payload any
			if action != "status" {
				var p struct {
					TargetVersion string `json:"target_version,omitempty"`
					RequestID     string `json:"request_id,omitempty"`
				}
				r.Body = http.MaxBytesReader(w, r.Body, 4096)
				if !readJSON(w, r, &p) {
					return
				}
				if action == "check" && (p.TargetVersion != "" || p.RequestID != "") {
					fail(w, 400, "invalid_json", "")
					return
				}
				payload = map[string]string{"current_version": s.Version}
				if action == "start" {
					payload = map[string]string{"current_version": s.Version, "target_version": p.TargetVersion, "request_id": p.RequestID}
				}
			}
			data, status, err := s.Updater.Call(r.Context(), action, payload)
			if err != nil {
				fail(w, 503, "update_unavailable", "")
				return
			}
			w.Header().Set("Content-Type", "application/json; charset=utf-8")
			w.Header().Set("Cache-Control", "no-store")
			w.WriteHeader(status)
			_, _ = w.Write(data)
		})
	}
}
