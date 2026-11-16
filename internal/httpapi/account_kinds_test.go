package httpapi

import (
	"fmt"
	"testing"

	"github.com/perevozchiko/capital-tracker/internal/storage"
)

func TestAccountKindAPIContract(t *testing.T) {
	s, err := storage.Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { s.Close() })
	h := (&Server{Store: s, Version: "test"}).Handler()
	create := func(name, kind string, status int) map[string]any {
		t.Helper()
		body := map[string]string{"name": name, "currency": "EUR", "start_month": "2026-01"}
		if kind != "" {
			body["kind"] = kind
		}
		return regressionCall(t, h, "POST", "/api/accounts", body, status)
	}
	bank := create("Bank", "", 201)
	if bank["kind"] != "asset" {
		t.Fatalf("default kind: %+v", bank)
	}
	loan := create("Loan", "liability", 201)
	if loan["kind"] != "liability" {
		t.Fatalf("liability kind: %+v", loan)
	}
	create("Bad", "equity", 422)

	bankID, loanID := int64(bank["id"].(float64)), int64(loan["id"].(float64))
	month := regressionCall(t, h, "PUT", "/api/months/2026-01", storage.MonthInput{Balances: []storage.BalanceInput{
		{AccountID: bankID, AmountMinor: "100000"}, {AccountID: loanID, AmountMinor: "-40000"},
	}}, 200)
	for field, want := range map[string]string{
		"total_eur_minor": "60000", "assets_eur_minor": "100000", "liabilities_eur_minor": "40000",
		"receivables_eur_minor": "0", "debt_ratio_bp": "4000",
	} {
		if month[field] != want {
			t.Fatalf("%s = %v, want %s", field, month[field], want)
		}
	}

	path := fmt.Sprintf("/api/accounts/%d", bankID)
	patched := regressionCall(t, h, "PATCH", path, map[string]string{"kind": "receivable"}, 200)
	if patched["kind"] != "receivable" || patched["name"] != "Bank" {
		t.Fatalf("patched account: %+v", patched)
	}
	regressionCall(t, h, "PATCH", path, map[string]string{"kind": "equity"}, 422)
	month = regressionCall(t, h, "GET", "/api/months/2026-01", nil, 200)
	if month["total_eur_minor"] != "60000" || month["receivables_eur_minor"] != "100000" {
		t.Fatalf("reclassifying changed the total or missed the breakdown: %+v", month)
	}
}
