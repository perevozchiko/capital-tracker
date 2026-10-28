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

func TestGroupAPICreateAssignReorderAndDelete(t *testing.T) {
	store, err := storage.Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	server := httptest.NewServer((&Server{Store: store, Version: "test"}).Handler())
	defer server.Close()

	call := func(method, path string, payload any, csrf bool) (int, map[string]any) {
		t.Helper()
		var body []byte
		if payload != nil {
			body, _ = json.Marshal(payload)
		}
		req, err := http.NewRequest(method, server.URL+path, bytes.NewReader(body))
		if err != nil {
			t.Fatal(err)
		}
		req.Host = "127.0.0.1:8765"
		if payload != nil {
			req.Header.Set("Content-Type", "application/json")
		}
		if csrf {
			req.Header.Set("X-Capital-Tracker", "1")
		}
		resp, err := server.Client().Do(req)
		if err != nil {
			t.Fatal(err)
		}
		defer resp.Body.Close()
		var result map[string]any
		_ = json.NewDecoder(resp.Body).Decode(&result)
		return resp.StatusCode, result
	}
	if code, _ := call("POST", "/api/groups", map[string]string{"name": "Savings"}, false); code != 403 {
		t.Fatalf("group creation without CSRF accepted: %d", code)
	}
	code, group := call("POST", "/api/groups", map[string]string{"name": "Savings"}, true)
	if code != 201 {
		t.Fatalf("create group: %d %+v", code, group)
	}
	gid := int64(group["id"].(float64))
	if code, _ = call("POST", "/api/groups", map[string]string{"name": "savings"}, true); code != 409 {
		t.Fatalf("duplicate group accepted: %d", code)
	}
	code, account := call("POST", "/api/accounts", map[string]any{"name": "Bank", "currency": "EUR", "start_month": "2026-01", "group_id": gid}, true)
	if code != 201 || int64(account["group_id"].(float64)) != gid {
		t.Fatalf("account creation with group: %d %+v", code, account)
	}
	id := int64(account["id"].(float64))
	code, summary := call("GET", "/api/groups?month=2026-01", nil, false)
	if code != 200 || len(summary["groups"].([]any)) != 1 {
		t.Fatalf("group listing: %d %+v", code, summary)
	}
	if code, _ = call("PUT", "/api/accounts/assignments", map[string]any{"accounts": []any{map[string]any{"id": id, "group_id": nil}}}, true); code != 200 {
		t.Fatalf("un-grouping account: %d", code)
	}
	if code, _ = call("PUT", "/api/groups/reorder", map[string]any{"ids": []int64{gid}}, true); code != 200 {
		t.Fatalf("reordering groups: %d", code)
	}
	if code, _ = call("DELETE", "/api/groups/"+strconv.FormatInt(gid, 10), nil, true); code != 204 {
		t.Fatalf("delete group: %d", code)
	}
	accounts, err := store.Accounts()
	if err != nil || len(accounts) != 1 || accounts[0].GroupID != nil {
		t.Fatalf("account should survive deletion, ungrouped: %+v %v", accounts, err)
	}
}
