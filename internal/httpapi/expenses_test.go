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
	call("PUT", "/expenses/2026-01", `{"entries":null}`, true, 422)
	call("PUT", "/expenses/2026-13", `{"entries":[]}`, true, 422)
	call("PUT", "/expenses/2026-01", `{"entries":[`, true, 400)
	call("POST", "/expenses", `{}`, true, 405)
	call("DELETE", "/expenses/2026-01", `{}`, true, 405)
	call("PUT", "/expenses/2026-01", `{"entries":[]}`, true, 204)
	if got := call("GET", "/expenses", "", false, 200); strings.TrimSpace(got) != "[]" {
		t.Fatal(got)
	}
}
