package httpapi

import (
	"net/http"
	"strings"

	"github.com/perevozchiko/capital-tracker/internal/storage"
)

func registerRecurringExpenses(mux *http.ServeMux, s *Server) {
	mux.HandleFunc("/api/recurring-expenses", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != "GET" {
			fail(w, 405, "method_not_allowed", "")
			return
		}
		months, err := s.Store.RecurringExpenses()
		if err != nil {
			handleError(w, err)
			return
		}
		writeJSON(w, 200, months)
	})
	mux.HandleFunc("/api/recurring-expenses/", func(w http.ResponseWriter, r *http.Request) {
		if r.Method == "GET" {
			month, err := s.Store.RecurringExpense(strings.TrimPrefix(r.URL.Path, "/api/recurring-expenses/"))
			if err != nil {
				handleError(w, err)
				return
			}
			writeJSON(w, 200, month)
			return
		}
		if r.Method != "PUT" {
			fail(w, 405, "method_not_allowed", "")
			return
		}
		var input struct {
			Entries []storage.Expense `json:"entries"`
		}
		if !readJSON(w, r, &input) {
			return
		}
		if input.Entries == nil {
			fail(w, 422, "validation_error", "entries")
			return
		}
		if err := s.Store.PutRecurringExpense(strings.TrimPrefix(r.URL.Path, "/api/recurring-expenses/"), input.Entries); err != nil {
			handleError(w, err)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	})
}
