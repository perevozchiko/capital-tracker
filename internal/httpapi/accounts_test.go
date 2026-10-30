package httpapi

import (
	"fmt"
	"testing"

	"github.com/perevozchiko/capital-tracker/internal/storage"
)

func TestArchiveAccountZeroBalanceContract(t *testing.T) {
	s, err := storage.Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { s.Close() })
	h := (&Server{Store: s, Version: "test"}).Handler()
	account := regressionCall(t, h, "POST", "/api/accounts", map[string]string{
		"name": "Cash", "currency": "EUR", "start_month": "2026-01",
	}, 201)
	id := int64(account["id"].(float64))
	path := fmt.Sprintf("/api/accounts/%d/archive", id)
	payload := map[string]string{"month": "2026-03"}
	for _, value := range []string{"", "1", "-1", "0"} {
		input := storage.MonthInput{}
		if value != "" {
			input.Balances = []storage.BalanceInput{{AccountID: id, AmountMinor: value}}
		}
		regressionCall(t, h, "PUT", "/api/months/2026-02", input, 200)
		if value == "0" {
			regressionCall(t, h, "POST", path, payload, 200)
		} else {
			out := regressionCall(t, h, "POST", path, payload, 409)
			detail := out["error"].(map[string]any)
			if detail["code"] != "conflict" || detail["reason"] != "archive_requires_zero_balance" {
				t.Fatalf("unexpected archive error: %+v", out)
			}
		}
	}
}
