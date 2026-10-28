package httpapi

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/perevozchiko/capital-tracker/internal/storage"
)

func TestClearAllDataEndpointRequiresExplicitAuthorization(t *testing.T) {
	s, err := storage.Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	a, err := s.CreateAccount("Savings", "EUR", "2026-01")
	if err != nil {
		t.Fatal(err)
	}
	if err := s.PutMonth("2026-01", storage.MonthInput{
		Balances: []storage.BalanceInput{{AccountID: a.ID, AmountMinor: "12345"}},
	}); err != nil {
		t.Fatal(err)
	}
	handler := (&Server{Store: s, Version: "test"}).Handler()
	run := func(method, body string, csrf, explicit bool) *httptest.ResponseRecorder {
		t.Helper()
		req := httptest.NewRequest(method, "http://127.0.0.1:8765/api/data/clear", strings.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		if csrf {
			req.Header.Set("X-Capital-Tracker", "1")
		}
		if explicit {
			req.Header.Set("X-Capital-Tracker-Clear", "DELETE")
		}
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, req)
		return w
	}
	for _, tc := range []struct {
		name, method, body string
		csrf, explicit     bool
		status             int
	}{
		{"wrong method", "GET", "", false, false, http.StatusMethodNotAllowed},
		{"no csrf", "POST", `{"confirm":"DELETE"}`, false, true, http.StatusForbidden},
		{"no separate header", "POST", `{"confirm":"DELETE"}`, true, false, http.StatusUnprocessableEntity},
		{"wrong phrase", "POST", `{"confirm":"NO"}`, true, true, http.StatusUnprocessableEntity},
		{"missing body", "POST", "", true, true, http.StatusBadRequest},
		{"unknown json field", "POST", `{"confirm":"DELETE","oops":true}`, true, true, http.StatusBadRequest},
	} {
		t.Run(tc.name, func(t *testing.T) {
			w := run(tc.method, tc.body, tc.csrf, tc.explicit)
			if w.Code != tc.status {
				t.Fatalf("got %d want %d, body=%s", w.Code, tc.status, w.Body.String())
			}
			data, err := s.Month("2026-01")
			if err != nil || !data.Complete {
				t.Fatalf("failed request deleted data: %+v %v", data, err)
			}
		})
	}
	success := run("POST", `{"confirm":"DELETE"}`, true, true)
	if success.Code != http.StatusOK {
		t.Fatalf("clear failed: %d %s", success.Code, success.Body.String())
	}
	accounts, err := s.Accounts()
	if err != nil || len(accounts) != 0 {
		t.Fatalf("records survived clear: %+v %v", accounts, err)
	}
	months, err := s.Months()
	if err != nil || len(months) != 0 {
		t.Fatalf("months survived clear: %+v %v", months, err)
	}
	// Subsequent clearing is safe/idempotent.
	if w := run("POST", `{"confirm":"DELETE"}`, true, true); w.Code != http.StatusOK {
		t.Fatalf("second clear: %d", w.Code)
	}
}
