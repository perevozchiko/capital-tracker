package httpapi

import (
	"bytes"
	"github.com/perevozchiko/capital-tracker/internal/storage"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestExpenseAPI(t *testing.T) {
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
	call("GET", "/expenses", "", false, 200)
	call("PUT", "/expenses/2026-01", payload, false, 403)
	call("PUT", "/expenses/2026-01", payload, true, 204)
	got := call("GET", "/expenses", "", false, 200)
	if !strings.Contains(got, `"total_eur_minor":"10000"`) {
		t.Fatal(got)
	}
	grouped := `{"entries":[{"month":"2026-01","name":"Car","currency":"EUR","amount_minor":"100","rate":"1"},{"month":"2026-01","name":"Sofa","currency":"EUR","amount_minor":"250","rate":"1"}],"groups":[{"name":"Home","entry_positions":[1]}]}`
	call("PUT", "/expenses/2026-01", grouped, true, 204)
	got = call("GET", "/expenses", "", false, 200)
	if !strings.Contains(got, `"groups":[{"name":"Home","entry_positions":[1],"total_eur_minor":"250"}]`) || !strings.Contains(got, `"ungrouped_total_eur_minor":"100"`) || !strings.Contains(got, `"total_eur_minor":"350"`) {
		t.Fatal(got)
	}
	call("PUT", "/expenses/2026-01", strings.Replace(grouped, `[1]`, `[2]`, 1), true, 422)
	if got := call("GET", "/expenses", "", false, 200); !strings.Contains(got, `"name":"Home"`) {
		t.Fatalf("rejected groups changed the month: %s", got)
	}
	call("PUT", "/expenses/2026-01", `{"entries":null}`, true, 422)
	call("PUT", "/expenses/2026-13", `{"entries":[]}`, true, 422)
	call("PUT", "/expenses/2026-01", `{"entries":[`, true, 400)
	call("POST", "/expenses", `{}`, true, 405)
	call("DELETE", "/expenses/2026-01", `{}`, false, 403)
	call("PUT", "/expenses/2026-01", `{"entries":[]}`, true, 204)
	if got := call("GET", "/expenses", "", false, 200); !strings.Contains(got, `"total_eur_minor":"0"`) {
		t.Fatal(got)
	}
	call("DELETE", "/expenses/2026-01", "", true, 204)
	if got := call("GET", "/expenses", "", false, 200); strings.TrimSpace(got) != "[]" {
		t.Fatal(got)
	}
}
