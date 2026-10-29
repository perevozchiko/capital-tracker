package httpapi

import (
	"net/http"
	"strconv"
	"time"
)

func registerDashboard(mux *http.ServeMux, s *Server) {
	mux.HandleFunc("/api/capital/history", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != "GET" {
			fail(w, 405, "method_not_allowed", "")
			return
		}
		p, e := s.Store.History()
		if e != nil {
			handleError(w, e)
			return
		}
		writeJSON(w, 200, map[string]any{"points": p})
	})
	mux.HandleFunc("/api/dashboard", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != "GET" {
			fail(w, 405, "method_not_allowed", "")
			return
		}
		month := r.URL.Query().Get("month")
		if month == "" {
			month = time.Now().Format("2006-01")
		}
		columns := 12
		if q := r.URL.Query().Get("columns"); q != "" {
			n, err := strconv.Atoi(q)
			if err != nil || n < 1 || n > 120 {
				fail(w, 422, "validation_error", "columns")
				return
			}
			columns = n
		}
		d, e := s.Store.DashboardColumns(month, columns)
		if e != nil {
			handleError(w, e)
			return
		}
		writeJSON(w, 200, d)
	})
}
