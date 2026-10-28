package httpapi

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strconv"
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

// Test the user-facing API contract across five currencies, edits, restart,
// appearance preferences, and non-destructive archival of history.
func TestAcceptanceWorkflowAcrossRestart(t *testing.T) {
	dir := t.TempDir()
	s, err := storage.Open(dir)
	if err != nil {
		t.Fatal(err)
	}
	handler := (&Server{Store: s, Version: "integration-test"}).Handler()
	call := func(method, path string, body any) (int, map[string]any) {
		t.Helper()
		var data []byte
		if body != nil {
			var marshalErr error
			data, marshalErr = json.Marshal(body)
			if marshalErr != nil {
				t.Fatal(marshalErr)
			}
		}
		req := httptest.NewRequest(method, "http://127.0.0.1:8765"+path, bytes.NewReader(data))
		if body != nil {
			req.Header.Set("Content-Type", "application/json")
		}
		if method != "GET" {
			req.Header.Set("X-Capital-Tracker", "1")
		}
		result := httptest.NewRecorder()
		handler.ServeHTTP(result, req)
		decoded := map[string]any{}
		if result.Body.Len() > 0 {
			if err := json.Unmarshal(result.Body.Bytes(), &decoded); err != nil {
				t.Fatalf("decode %s: %v", path, err)
			}
		}
		return result.Code, decoded
	}
	currencies := []string{"EUR", "USD", "RSD", "RUB", "TRY"}
	accounts := make([]int, 0, 5)
	for _, c := range currencies {
		status, result := call("POST", "/api/accounts", map[string]any{"name": "Account " + c, "currency": c, "start_month": "2026-09"})
		if status != 201 {
			t.Fatalf("create %s: %d %v", c, status, result)
		}
		accounts = append(accounts, int(result["id"].(float64)))
	}
	balances := func(eur string) []map[string]any {
		return []map[string]any{
			{"account_id": accounts[0], "amount_minor": eur},
			{"account_id": accounts[1], "amount_minor": "108000"},
			{"account_id": accounts[2], "amount_minor": "11720000"},
			{"account_id": accounts[3], "amount_minor": "0"},
			{"account_id": accounts[4], "amount_minor": "0"},
		}
	}
	rates := []map[string]string{{"currency": "USD", "rate": "1.08"}, {"currency": "RSD", "rate": "117.2"}, {"currency": "RUB", "rate": "95.5"}, {"currency": "TRY", "rate": "48.5"}}
	save := func(month, eur string) {
		t.Helper()
		status, result := call("PUT", "/api/months/"+month, map[string]any{"balances": balances(eur), "rates": rates})
		if status != 200 || result["complete"] != true {
			t.Fatalf("save %s: %d %v", month, status, result)
		}
	}
	save("2026-09", "500000")
	save("2026-10", "580000")
	status, summary := call("GET", "/api/dashboard?month=2026-10", nil)
	if status != 200 || summary["change_minor"] != "80000" || summary["change_percent_bp"] != "1143" {
		t.Fatalf("dashboard: %d %v", status, summary)
	}
	status, history := call("GET", "/api/capital/history", nil)
	if status != 200 || len(history["points"].([]any)) != 2 {
		t.Fatalf("history: %v", history)
	}
	save("2026-09", "510000")
	_, summary = call("GET", "/api/dashboard?month=2026-10", nil)
	if summary["change_minor"] != "70000" {
		t.Fatalf("recalculation: %v", summary)
	}
	status, settings := call("PATCH", "/api/settings", map[string]any{"language": "ru", "theme": "dark"})
	if status != 200 || settings["language"] != "ru" || settings["theme"] != "dark" {
		t.Fatalf("settings: %v", settings)
	}
	status, _ = call("POST", "/api/accounts/"+strconv.Itoa(accounts[4])+"/archive", map[string]string{"month": "2026-11"})
	if status != 200 {
		t.Fatalf("archive status %d", status)
	}
	if err = s.Close(); err != nil {
		t.Fatal(err)
	}
	s, err = storage.Open(dir)
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	handler = (&Server{Store: s, Version: "integration-test"}).Handler()
	_, settings = call("GET", "/api/settings", nil)
	if settings["language"] != "ru" || settings["theme"] != "dark" {
		t.Fatalf("settings not persisted: %v", settings)
	}
	_, summary = call("GET", "/api/dashboard?month=2026-10", nil)
	if summary["change_minor"] != "70000" {
		t.Fatalf("financial history not persisted: %v", summary)
	}
	_, history = call("GET", "/api/capital/history", nil)
	if len(history["points"].([]any)) != 2 {
		t.Fatalf("history changed by archive: %v", history)
	}
}
