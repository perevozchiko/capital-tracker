package httpapi

import (
	"net/http"
	"strings"
	"time"

	"github.com/perevozchiko/capital-tracker/internal/storage"
)

// Group operations stay local and use the same host/origin/CSRF protection
// as the other API endpoints.
func registerGroups(mux *http.ServeMux, s *Server) {
	mux.HandleFunc("/api/groups", func(w http.ResponseWriter, r *http.Request) {
		switch r.Method {
		case "GET":
			month := r.URL.Query().Get("month")
			if month == "" {
				month = time.Now().Format("2006-01")
			}
			summary, err := s.Store.GroupsAt(month)
			if err != nil {
				handleError(w, err)
				return
			}
			writeJSON(w, 200, summary)
		case "POST":
			var p struct {
				Name string `json:"name"`
			}
			if !readJSON(w, r, &p) {
				return
			}
			group, err := s.Store.CreateGroup(p.Name)
			if err != nil {
				handleError(w, err)
				return
			}
			writeJSON(w, 201, group)
		default:
			fail(w, 405, "method_not_allowed", "")
		}
	})
	mux.HandleFunc("/api/groups/reorder", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != "PUT" {
			fail(w, 405, "method_not_allowed", "")
			return
		}
		var p struct {
			IDs []int64 `json:"ids"`
		}
		if !readJSON(w, r, &p) {
			return
		}
		if err := s.Store.ReorderGroups(p.IDs); err != nil {
			handleError(w, err)
			return
		}
		writeJSON(w, 200, map[string]bool{"ok": true})
	})
	mux.HandleFunc("/api/groups/", func(w http.ResponseWriter, r *http.Request) {
		id, ok := pathID(strings.TrimPrefix(r.URL.Path, "/api/groups/"))
		if !ok {
			fail(w, 404, "not_found", "")
			return
		}
		switch r.Method {
		case "PATCH":
			var p struct {
				Name string `json:"name"`
			}
			if !readJSON(w, r, &p) {
				return
			}
			if err := s.Store.RenameGroup(id, p.Name); err != nil {
				handleError(w, err)
				return
			}
			writeJSON(w, 200, map[string]bool{"ok": true})
		case "DELETE":
			if err := s.Store.DeleteGroup(id); err != nil {
				handleError(w, err)
				return
			}
			w.WriteHeader(http.StatusNoContent)
		default:
			fail(w, 405, "method_not_allowed", "")
		}
	})
	mux.HandleFunc("/api/accounts/assignments", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != "PUT" {
			fail(w, 405, "method_not_allowed", "")
			return
		}
		var p struct {
			Accounts []storage.AccountAssignment `json:"accounts"`
		}
		if !readJSON(w, r, &p) {
			return
		}
		if err := s.Store.AssignAccounts(p.Accounts); err != nil {
			handleError(w, err)
			return
		}
		writeJSON(w, 200, map[string]bool{"ok": true})
	})
}
