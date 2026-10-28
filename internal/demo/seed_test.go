package demo

import (
	"encoding/json"
	"testing"

	"github.com/perevozchiko/capital-tracker/internal/storage"
)

func TestFixtureIsValidPortableJSON(t *testing.T) {
	raw, err := fixtures.ReadFile("sample-2025-2026.json")
	if err != nil {
		t.Fatal(err)
	}
	var d storage.TransferDocument
	if err := json.Unmarshal(raw, &d); err != nil {
		t.Fatal(err)
	}
	if err := storage.ValidateTransfer(d); err != nil {
		t.Fatalf("invalid demo fixture: %v", err)
	}
	if got := len(d.Accounts); got != 6 {
		t.Fatalf("accounts = %d, want 6", got)
	}
	if len(d.Months) != 12 || len(d.Balances) != 72 || len(d.Rates) != 12 {
		t.Fatalf("unexpected demo record counts: months=%d balances=%d rates=%d",
			len(d.Months), len(d.Balances), len(d.Rates))
	}
}

func TestSeedAndPreserveEditedDemo(t *testing.T) {
	s, err := storage.Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()

	if err := Seed(s); err != nil {
		t.Fatal(err)
	}
	accounts, err := s.Accounts()
	if err != nil {
		t.Fatal(err)
	}
	if len(accounts) != 6 {
		t.Fatalf("seed accounts: got %d", len(accounts))
	}
	months, err := s.Months()
	if err != nil {
		t.Fatal(err)
	}
	if len(months) != 12 || months[0].Month != "2025-10" || months[11].Month != "2026-09" {
		t.Fatalf("unexpected demo months: %+v", months)
	}
	for _, m := range months {
		d, err := s.Month(m.Month)
		if err != nil {
			t.Fatal(err)
		}
		if !d.Complete || d.TotalEURMinor == nil || len(d.Balances) != 6 || len(d.Rates) != 1 {
			t.Fatalf("month %s not complete: %+v", m.Month, d)
		}
	}

	// An incomplete edit must survive a second demo launch.
	if err := s.PutMonth("2026-09", storage.MonthInput{
		Balances: []storage.BalanceInput{{AccountID: accounts[0].ID, AmountMinor: "12345"}},
	}); err != nil {
		t.Fatal(err)
	}
	if err := Seed(s); err != nil {
		t.Fatal(err)
	}
	edited, err := s.Month("2026-09")
	if err != nil {
		t.Fatal(err)
	}
	if edited.Complete || len(edited.Balances) != 1 || edited.Balances[0].AmountMinor != "12345" {
		t.Fatalf("seed overwritten edited demo month: %+v", edited)
	}
}

func TestSeedDoesNotReplaceExistingDatabase(t *testing.T) {
	s, err := storage.Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()

	if _, err := s.CreateAccount("Personal account", "EUR", "2025-10"); err != nil {
		t.Fatal(err)
	}
	if err := Seed(s); err != nil {
		t.Fatal(err)
	}
	accounts, err := s.Accounts()
	if err != nil {
		t.Fatal(err)
	}
	if len(accounts) != 1 || accounts[0].Name != "Personal account" {
		t.Fatalf("existing account replaced: %+v", accounts)
	}
}
