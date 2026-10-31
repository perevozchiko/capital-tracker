package httpapi

import (
	"bytes"
	"github.com/perevozchiko/capital-tracker/internal/storage"
	"net/http/httptest"
	"reflect"
	"strings"
	"testing"
)

func TestRecurringExpenseAPI(t *testing.T) {
	s, err := storage.Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	handler := (&Server{Store: s}).Handler()
	call := func(method, path, body string, csrf bool, want int) string {
		t.Helper()
		req := httptest.NewRequest(method, "http://127.0.0.1:8765/api"+path, bytes.NewBufferString(body))
		if body != "" {
			req.Header.Set("Content-Type", "application/json")
		}
		if csrf {
			req.Header.Set("X-Capital-Tracker", "1")
		}
		out := httptest.NewRecorder()
		handler.ServeHTTP(out, req)
		if out.Code != want {
			t.Fatalf("%s %s: %d %s", method, path, out.Code, out.Body.String())
		}
		return out.Body.String()
	}
	payload := `{"entries":[{"month":"2026-01","name":"Car","currency":"USD","amount_minor":"11000","rate":"1.1"}]}`
	call("GET", "/recurring-expenses", "", false, 200)
	call("PUT", "/recurring-expenses/2026-01", payload, false, 403)
	call("PUT", "/recurring-expenses/2026-01", payload, true, 204)
	got := call("GET", "/recurring-expenses", "", false, 200)
	if !strings.Contains(got, `"total_eur_minor":"10000"`) {
		t.Fatal(got)
	}
	inherited := call("GET", "/recurring-expenses/2026-02", "", false, 200)
	if !strings.Contains(inherited, `"inherited_from":"2026-01"`) || !strings.Contains(inherited, `"month":"2026-02"`) {
		t.Fatal(inherited)
	}
	call("GET", "/recurring-expenses/2026-13", "", false, 422)
	call("PUT", "/recurring-expenses/2026-01", `{"entries":null}`, true, 422)
	call("PUT", "/recurring-expenses/2026-13", `{"entries":[]}`, true, 422)
	call("PUT", "/recurring-expenses/2026-01", `{"entries":[`, true, 400)
	call("POST", "/recurring-expenses", `{}`, true, 405)
	call("DELETE", "/recurring-expenses/2026-01", `{}`, true, 405)
	call("PUT", "/recurring-expenses/2026-01", `{"entries":[]}`, true, 204)
	if got := call("GET", "/recurring-expenses", "", false, 200); !strings.Contains(got, `"entries":[]`) {
		t.Fatal(got)
	}
}

func TestRecurringExpenseAPIRejectsInvalidWritesAtomically(t *testing.T) {
	s, err := storage.Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	if err := s.PutRecurringExpense("2026-01", []storage.Expense{{Month: "2026-01", Currency: "EUR", AmountMinor: "100", Rate: "1", Name: "Rent"}}); err != nil {
		t.Fatal(err)
	}
	before, err := s.RecurringExpenses()
	if err != nil {
		t.Fatal(err)
	}
	handler := (&Server{Store: s}).Handler()
	cases := []struct {
		name, body string
		status     int
	}{
		{"missing entries", `{}`, 422},
		{"null entries", `{"entries":null}`, 422},
		{"wrong type", `{"entries":{}}`, 400},
		{"unknown property", `{"entries":[],"extra":true}`, 400},
		{"trailing JSON", `{"entries":[]} {}`, 400},
		{"unknown entry field", `{"entries":[{"month":"2026-01","currency":"EUR","amount_minor":"1","rate":"1","name":"Rent","extra":1}]}`, 400},
		{"wrong entry month", `{"entries":[{"month":"2026-02","currency":"EUR","amount_minor":"1","rate":"1","name":"Rent"}]}`, 422},
		{"invalid rate", `{"entries":[{"month":"2026-01","currency":"USD","amount_minor":"1","rate":"0","name":"Rent"}]}`, 422},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			req := httptest.NewRequest("PUT", "http://127.0.0.1:8765/api/recurring-expenses/2026-01", strings.NewReader(tc.body))
			req.Header.Set("Content-Type", "application/json")
			req.Header.Set("X-Capital-Tracker", "1")
			out := httptest.NewRecorder()
			handler.ServeHTTP(out, req)
			if out.Code != tc.status {
				t.Fatalf("status %d: %s", out.Code, out.Body.String())
			}
			after, err := s.RecurringExpenses()
			if err != nil || !reflect.DeepEqual(before, after) {
				t.Fatalf("invalid request modified data: %+v %v", after, err)
			}
		})
	}
}
