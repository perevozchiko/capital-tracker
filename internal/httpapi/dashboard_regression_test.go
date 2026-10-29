package httpapi

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"reflect"
	"testing"

	"github.com/perevozchiko/capital-tracker/internal/storage"
)

// Exercise real request decoding, routing and JSON serialization on an isolated DB.
func regressionCall(t *testing.T, handler http.Handler, method, path string, payload any, wantStatus int) map[string]any {
	t.Helper()
	var body []byte
	if payload != nil {
		var err error
		body, err = json.Marshal(payload)
		if err != nil {
			t.Fatal(err)
		}
	}
	req := httptest.NewRequest(method, "http://127.0.0.1:8765"+path, bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Capital-Tracker", "1")
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Code != wantStatus {
		t.Fatalf("%s %s: status %d, want %d: %s", method, path, rec.Code, wantStatus, rec.Body.String())
	}
	var out map[string]any
	if rec.Body.Len() > 0 {
		if err := json.Unmarshal(rec.Body.Bytes(), &out); err != nil {
			t.Fatal(err)
		}
	}
	return out
}

func TestDashboardJSONMonthlyChangeContract(t *testing.T) {
	s, err := storage.Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	h := (&Server{Store: s, Version: "test"}).Handler()
	call := func(method, path string, payload any, code int) map[string]any {
		t.Helper()
		return regressionCall(t, h, method, path, payload, code)
	}
	a := call("POST", "/api/accounts", map[string]any{"name": "EUR", "currency": "EUR", "start_month": "2026-10"}, 201)
	save := func(month, amount string) {
		t.Helper()
		call("PUT", "/api/months/"+month, map[string]any{"balances": []any{map[string]any{"account_id": a["id"], "amount_minor": amount}}, "rates": []any{}}, 200)
	}
	save("2026-10", "62100")
	save("2026-11", "5000000")
	save("2026-12", "5122180")
	check := func(delta, percent any) {
		t.Helper()
		for _, columns := range []string{"1", "12", "120"} {
			d := call("GET", "/api/dashboard?month=2026-12&columns="+columns, nil, 200)
			for key, want := range map[string]any{"change_minor": delta, "change_percent_bp": percent} {
				got, exists := d[key]
				if !exists || !reflect.DeepEqual(got, want) {
					t.Fatalf("%s: got %#v, want %#v", key, got, want)
				}
			}
			if d["previous"].(map[string]any)["month"] != "2026-11" {
				t.Fatalf("wrong previous: %v", d["previous"])
			}
		}
	}
	check("122180", "244")
	save("2026-10", "1")
	check("122180", "244")
	save("2026-11", "62100")
	check("5060080", "814828")
	save("2026-11", "0")
	check("5122180", nil)
	save("2026-11", "-100")
	check("5122280", "512228000")
	call("PUT", "/api/months/2026-11", map[string]any{"balances": []any{}, "rates": []any{}}, 200)
	check(nil, nil)
	call("DELETE", "/api/months/2026-11", map[string]any{"confirm": true}, 204)
	check(nil, nil)
	save("2026-11", "5000000")
	check("122180", "244")
	save("2026-11", "1")
	save("2026-12", "9000000000000000")
	check("8999999999999999", "89999999999999990000")
	call("PUT", "/api/months/2026-12", map[string]any{"balances": []any{}, "rates": []any{}}, 200)
	check(nil, nil)
}
