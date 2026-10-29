package httpapi

import (
	"fmt"
	"reflect"
	"strings"
	"testing"

	"github.com/perevozchiko/capital-tracker/internal/storage"
)

func TestAccountGroupCRUDValidationAndHistorySafety(t *testing.T) {
	dir := t.TempDir()
	s, err := storage.Open(dir)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { s.Close() })
	h := (&Server{Store: s, Version: "test"}).Handler()
	call := func(method, path string, payload any, code int) map[string]any {
		t.Helper()
		return regressionCall(t, h, method, path, payload, code)
	}
	group := call("POST", "/api/groups", map[string]any{"name": "  Savings  "}, 201)
	if group["name"] != "Savings" {
		t.Fatal(group)
	}
	gid := int64(group["id"].(float64))
	gp := fmt.Sprintf("/api/groups/%d", gid)
	other := call("POST", "/api/groups", map[string]any{"name": "Other"}, 201)
	ogid := int64(other["id"].(float64))
	account := call("POST", "/api/accounts", map[string]any{"name": " Bank ", "currency": "EUR", "start_month": "2026-10", "group_id": gid}, 201)
	aid := int64(account["id"].(float64))
	ap := fmt.Sprintf("/api/accounts/%d", aid)
	if account["name"] != "Bank" {
		t.Fatal(account)
	}
	// Snapshot all stored data to ensure a rejected mutation is fully atomic.
	snapshot := func() storage.TransferDocument {
		t.Helper()
		d, err := s.ExportData()
		if err != nil {
			t.Fatal(err)
		}
		d.ExportedAt = ""
		return d
	}
	reject := func(method, path string, payload any, code int) {
		t.Helper()
		before := snapshot()
		call(method, path, payload, code)
		if after := snapshot(); !reflect.DeepEqual(before, after) {
			t.Fatalf("rejected %s %s modified data", method, path)
		}
	}
	for _, name := range []string{"", "   ", strings.Repeat("я", 101)} {
		reject("POST", "/api/groups", map[string]any{"name": name}, 422)
		reject("PATCH", gp, map[string]any{"name": name}, 422)
		reject("POST", "/api/accounts", map[string]any{"name": name, "currency": "EUR", "start_month": "2026-10"}, 422)
		reject("PATCH", ap, map[string]any{"name": name}, 422)
	}
	reject("POST", "/api/groups", map[string]any{"name": "sAvInGs"}, 409)
	reject("PATCH", gp, map[string]any{"name": "other"}, 409)
	reject("PATCH", ap, map[string]any{}, 422)
	reject("PATCH", ap, map[string]any{"name": "Must roll back", "currency": "INVALID"}, 422)
	for _, payload := range []map[string]any{
		{"name": "Bad", "currency": "JPY", "start_month": "2026-10"},
		{"name": "Bad", "currency": "EUR", "start_month": "2026-13"},
		{"name": "Bad", "currency": "EUR", "start_month": "2026-10", "group_id": 99999},
	} {
		reject("POST", "/api/accounts", payload, 422)
	}
	for _, path := range []string{"/api/accounts/99999", "/api/groups/99999"} {
		reject("PATCH", path, map[string]any{"name": "Missing"}, 404)
		reject("DELETE", path, nil, 404)
	}
	// A 100-character Unicode name is supported; renaming preserves identity.
	longName := strings.Repeat("я", 100)
	renamed := call("PATCH", ap, map[string]any{"name": longName, "currency": "USD"}, 200)
	if renamed["name"] != longName || renamed["currency"] != "USD" || renamed["id"] != account["id"] {
		t.Fatal(renamed)
	}
	call("PATCH", ap, map[string]any{"name": "Renamed", "currency": "EUR"}, 200)
	call("PATCH", gp, map[string]any{"name": "  Emergency  "}, 200)
	groups, err := s.Groups()
	if err != nil || groups[0].Name != "Emergency" {
		t.Fatalf("rename: %+v %v", groups, err)
	}
	// Invalid second entries must roll back updates performed for the first entry.
	second := call("POST", "/api/accounts", map[string]any{"name": "Second", "currency": "EUR", "start_month": "2026-10"}, 201)
	bid := int64(second["id"].(float64))
	for _, ids := range [][]int64{{gid}, {ogid, ogid}, {ogid, 99999}} {
		reject("PUT", "/api/groups/reorder", map[string]any{"ids": ids}, 422)
	}
	for _, items := range [][]storage.AccountAssignment{
		{{ID: bid, GroupID: &ogid}},
		{{ID: bid, GroupID: &ogid}, {ID: bid, GroupID: &gid}},
		{{ID: bid, GroupID: &ogid}, {ID: 99999}},
		{{ID: bid, GroupID: &ogid}, {ID: aid, GroupID: ptrInt64(99999)}},
	} {
		reject("PUT", "/api/accounts/assignments", map[string]any{"accounts": items}, 422)
	}
	call("DELETE", fmt.Sprintf("/api/accounts/%d", bid), nil, 204)
	// Deleting an unused account must remove its activity period, too.
	d := snapshot()
	for _, p := range d.AccountPeriods {
		if p.AccountID == bid {
			t.Fatal("orphan account period")
		}
	}
	for _, month := range []string{"2026-10", "2026-11"} {
		amount := "10000"
		if month == "2026-11" {
			amount = "15000"
		}
		call("PUT", "/api/months/"+month, map[string]any{"balances": []any{map[string]any{"account_id": aid, "amount_minor": amount}}, "rates": []any{}}, 200)
	}
	reject("PATCH", ap, map[string]any{"name": "Must roll back", "currency": "USD"}, 409)
	reject("DELETE", ap, nil, 409)
	reject("POST", "/api/accounts", map[string]any{"name": "Backdated", "currency": "EUR", "start_month": "2026-11"}, 409)
	// Names and organizational groups can change without changing saved finances.
	call("PATCH", ap, map[string]any{"name": "Historical bank"}, 200)
	call("PATCH", gp, map[string]any{"name": "Historical savings"}, 200)
	call("DELETE", gp, nil, 204)
	accounts, err := s.Accounts()
	if err != nil || len(accounts) != 1 || accounts[0].ID != aid || accounts[0].GroupID != nil || accounts[0].Name != "Historical bank" {
		t.Fatalf("group deletion damaged account: %+v %v", accounts, err)
	}
	summary := call("GET", "/api/dashboard?month=2026-11", nil, 200)
	if summary["change_minor"] != "5000" || summary["change_percent_bp"] != "5000" || summary["month"].(map[string]any)["total_eur_minor"] != "15000" {
		t.Fatalf("CRUD changed history: %v", summary)
	}
	reject("DELETE", gp, nil, 404)
	beforeRestart := snapshot()
	if err := s.Close(); err != nil {
		t.Fatal(err)
	}
	s, err = storage.Open(dir)
	if err != nil {
		t.Fatal(err)
	}
	h = (&Server{Store: s, Version: "test"}).Handler()
	if afterRestart := snapshot(); !reflect.DeepEqual(beforeRestart, afterRestart) {
		t.Fatal("account/group edits or financial history changed across restart")
	}
	summary = call("GET", "/api/dashboard?month=2026-11", nil, 200)
	if summary["change_minor"] != "5000" || summary["change_percent_bp"] != "5000" {
		t.Fatalf("monthly change changed across restart: %v", summary)
	}
}

func ptrInt64(v int64) *int64 { return &v }
