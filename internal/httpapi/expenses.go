package httpapi

import (
	"net/http"
	"strings"

	"github.com/perevozchiko/capital-tracker/internal/storage"
)

func registerExpenses(mux *http.ServeMux, s *Server) {
	mux.HandleFunc("/api/expenses", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != "GET" {
			fail(w, 405, "method_not_allowed", "")
			return
		}
		months, err := s.Store.Expenses()
		if err != nil {
			handleError(w, err)
			return
		}
		writeJSON(w, 200, months)
	})
	mux.HandleFunc("/api/expenses/", func(w http.ResponseWriter, r *http.Request) {
		if r.Method == "DELETE" {
			if err := s.Store.DeleteFlowMonth("expenses", strings.TrimPrefix(r.URL.Path, "/api/expenses/")); err != nil {
				handleError(w, err)
				return
			}
			w.WriteHeader(http.StatusNoContent)
			return
		}
		if r.Method != "PUT" {
			fail(w, 405, "method_not_allowed", "")
			return
		}
		var input struct {
			Entries []storage.Expense               `json:"entries"`
			Groups  []storage.RecurringExpenseGroup `json:"groups"`
		}
		if !readJSON(w, r, &input) {
			return
		}
		if input.Entries == nil {
			fail(w, 422, "validation_error", "entries")
			return
		}
		if err := s.Store.PutExpenseGroups(strings.TrimPrefix(r.URL.Path, "/api/expenses/"), input.Entries, input.Groups); err != nil {
			handleError(w, err)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	})
}
