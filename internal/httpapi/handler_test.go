package httpapi

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/perevozchiko/capital-tracker/internal/storage"
)

func TestHTTPMonthlyFlowAndCSRF(t *testing.T) {
	s, e := storage.Open(t.TempDir())
	if e != nil {
		t.Fatal(e)
	}
	defer s.Close()
	server := httptest.NewServer((&Server{Store: s, Version: "test"}).Handler())
	defer server.Close()
	client := server.Client()
	call := func(method, path string, body any, header bool) (int, map[string]any) {
		t.Helper()
		var buf []byte
		if body != nil {
			buf, _ = json.Marshal(body)
		}
		req, e := http.NewRequest(method, server.URL+path, bytes.NewReader(buf))
		if e != nil {
			t.Fatal(e)
		}
		req.Host = "127.0.0.1:8765"
		if body != nil {
			req.Header.Set("Content-Type", "application/json")
		}
		if header {
			req.Header.Set("X-Capital-Tracker", "1")
		}
		r, e := client.Do(req)
		if e != nil {
			t.Fatal(e)
		}
		defer r.Body.Close()
		out := map[string]any{}
		json.NewDecoder(r.Body).Decode(&out)
		return r.StatusCode, out
	}
	if status, _ := call("POST", "/api/accounts", map[string]any{"name": "A", "currency": "EUR", "start_month": "2026-09"}, false); status != 403 {
		t.Fatalf("CSRF: %d", status)
	}
	status, account := call("POST", "/api/accounts", map[string]any{"name": "A", "currency": "EUR", "start_month": "2026-09"}, true)
	if status != 201 {
		t.Fatalf("create: %d %+v", status, account)
	}
	id := account["id"]
	status, month := call("PUT", "/api/months/2026-09", map[string]any{"balances": []any{map[string]any{"account_id": id, "amount_minor": "12345"}}, "rates": []any{}}, true)
	if status != 200 || month["complete"] != true || month["total_eur_minor"] != "12345" {
		t.Fatalf("month: %d %+v", status, month)
	}
	status, errData := call("PUT", "/api/months/2026-09", map[string]any{"balances": []any{map[string]any{"account_id": id, "amount_minor": "NaN"}}, "rates": []any{}}, true)
	if status != 422 || errData["error"] == nil {
		t.Fatalf("bad input: %d %+v", status, errData)
	}
	status, month = call("GET", "/api/months/2026-09", nil, false)
	if status != 200 || month["total_eur_minor"] != "12345" {
		t.Fatalf("rollback: %+v", month)
	}
}
