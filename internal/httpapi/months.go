package httpapi

import (
	"net/http"
	"strings"

	"github.com/perevozchiko/capital-tracker/internal/finance"
	"github.com/perevozchiko/capital-tracker/internal/storage"
)

func registerMonths(mux *http.ServeMux, s *Server) {
	mux.HandleFunc("/api/months", func(w http.ResponseWriter, r *http.Request) {
		switch r.Method {
		case "GET":
			months, e := s.Store.Months()
			if e != nil {
				handleError(w, e)
				return
			}
			writeJSON(w, 200, months)
		case "POST":
			var p struct {
				Month string `json:"month"`
			}
			if !readJSON(w, r, &p) {
				return
			}
			if e := s.Store.CreateMonth(p.Month); e != nil {
				handleError(w, e)
				return
			}
			writeJSON(w, 201, map[string]string{"month": p.Month})
		default:
			fail(w, 405, "method_not_allowed", "")
		}
	})
	mux.HandleFunc("/api/months/", func(w http.ResponseWriter, r *http.Request) {
		month := strings.TrimPrefix(r.URL.Path, "/api/months/")
		if !finance.ValidMonth(month) {
			fail(w, 422, "validation_error", "month")
			return
		}
		switch r.Method {
		case "GET":
			d, e := s.Store.Month(month)
			if e != nil {
				handleError(w, e)
				return
			}
			writeJSON(w, 200, d)
		case "DELETE":
			var p struct {
				Confirm bool `json:"confirm"`
			}
			if !readJSON(w, r, &p) {
				return
			}
			if !p.Confirm {
				fail(w, 422, "validation_error", "confirm")
				return
			}
			if err := s.Store.DeleteMonth(month); err != nil {
				handleError(w, err)
				return
			}
			w.WriteHeader(http.StatusNoContent)
		case "PUT":
			var p storage.MonthInput
			if !readJSON(w, r, &p) {
				return
			}
			if e := s.Store.PutMonth(month, p); e != nil {
				handleError(w, e)
				return
			}
			d, e := s.Store.Month(month)
			if e != nil {
				handleError(w, e)
				return
			}
			writeJSON(w, 200, d)
		default:
			fail(w, 405, "method_not_allowed", "")
		}
	})
}
