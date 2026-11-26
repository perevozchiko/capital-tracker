package httpapi

import (
	"net/http"
	"strings"
)

func registerAccounts(mux *http.ServeMux, s *Server) {
	mux.HandleFunc("/api/accounts", func(w http.ResponseWriter, r *http.Request) {
		switch r.Method {
		case "GET":
			a, e := s.Store.Accounts()
			if e != nil {
				handleError(w, e)
				return
			}
			writeJSON(w, 200, a)
		case "POST":
			var p struct {
				Name       string `json:"name"`
				Currency   string `json:"currency"`
				StartMonth string `json:"start_month"`
				GroupID    *int64 `json:"group_id"`
			}
			if !readJSON(w, r, &p) {
				return
			}
			a, e := s.Store.CreateAccountInGroup(p.Name, p.Currency, p.StartMonth, p.GroupID)
			if e != nil {
				handleError(w, e)
				return
			}
			writeJSON(w, 201, a)
		default:
			fail(w, 405, "method_not_allowed", "")
		}
	})
	mux.HandleFunc("/api/accounts/reorder", func(w http.ResponseWriter, r *http.Request) {
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
		if e := s.Store.Reorder(p.IDs); e != nil {
			handleError(w, e)
			return
		}
		writeJSON(w, 200, map[string]bool{"ok": true})
	})
	mux.HandleFunc("/api/accounts/", func(w http.ResponseWriter, r *http.Request) {
		path := strings.TrimPrefix(r.URL.Path, "/api/accounts/")
		parts := strings.Split(path, "/")
		id, ok := pathID(parts[0])
		if !ok || len(parts) > 2 {
			fail(w, 404, "not_found", "")
			return
		}
		if len(parts) == 2 {
			switch parts[1] {
			case "archive":
				if r.Method != "POST" {
					break
				}
				var p struct {
					Month string `json:"month"`
				}
				if !readJSON(w, r, &p) {
					return
				}
				e := s.Store.ArchiveAccount(id, p.Month)
				if e != nil {
					handleError(w, e)
					return
				}
				writeJSON(w, 200, map[string]bool{"ok": true})
				return
			case "restore":
				if r.Method != "POST" {
					break
				}
				var p struct {
					StartMonth string `json:"start_month"`
				}
				if !readJSON(w, r, &p) {
					return
				}
				e := s.Store.RestoreAccount(id, p.StartMonth)
				if e != nil {
					handleError(w, e)
					return
				}
				writeJSON(w, 200, map[string]bool{"ok": true})
				return
			}
			fail(w, 405, "method_not_allowed", "")
			return
		}
		switch r.Method {
		case "PATCH":
			var p struct {
				Name     *string `json:"name"`
				Currency *string `json:"currency"`
			}
			if !readJSON(w, r, &p) {
				return
			}
			a, e := s.Store.UpdateAccount(id, p.Name, p.Currency)
			if e != nil {
				handleError(w, e)
				return
			}
			writeJSON(w, 200, a)
		case "DELETE":
			if e := s.Store.DeleteAccount(id); e != nil {
				handleError(w, e)
				return
			}
			w.WriteHeader(204)
		default:
			fail(w, 405, "method_not_allowed", "")
		}
	})
}
