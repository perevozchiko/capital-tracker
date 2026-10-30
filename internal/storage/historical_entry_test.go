package storage

import (
	"errors"
	"testing"
)

func TestBackfillBeforeAccountStartAndEditSavedBalance(t *testing.T) {
	s := openTest(t)
	a, err := s.CreateAccount("USD savings", "USD", "2026-10")
	if err != nil {
		t.Fatal(err)
	}
	future, err := s.CreateAccount("Future account", "EUR", "2026-12")
	if err != nil {
		t.Fatal(err)
	}
	if err = s.PutMonth("2026-10", MonthInput{Balances: []BalanceInput{{a.ID, "22000"}}, Rates: []RateInput{{"USD", "1.1"}}}); err != nil {
		t.Fatal(err)
	}
	d, err := s.Month("2025-09")
	if err != nil || len(d.EditableAccounts) != 2 || len(d.Accounts) != 0 {
		t.Fatalf("historical editor: %+v %v", d, err)
	}
	if err = s.PutMonth("2025-09", MonthInput{Balances: []BalanceInput{{a.ID, "11000"}}, Rates: []RateInput{{"USD", "1.1"}}}); err != nil {
		t.Fatal(err)
	}
	if err = s.PutMonth("2025-09", MonthInput{Balances: []BalanceInput{{a.ID, "16500"}}}); err != nil {
		t.Fatal(err)
	}
	d, err = s.Month("2025-09")
	if err != nil || !d.Complete || *d.TotalEURMinor != "15000" || len(d.Accounts) != 1 {
		t.Fatalf("historical edit: %+v %v", d, err)
	}
	updated, err := s.account(a.ID)
	if err != nil || updated.StartMonth != "2025-09" {
		t.Fatalf("start not extended: %+v %v", updated, err)
	}
	untouched, err := s.account(future.ID)
	if err != nil || untouched.StartMonth != "2026-12" {
		t.Fatalf("unfilled account changed: %+v %v", untouched, err)
	}
	d, err = s.Month("2026-10")
	if err != nil || !d.Complete || *d.TotalEURMinor != "20000" {
		t.Fatalf("later snapshot changed: %+v %v", d, err)
	}
	exported, err := s.ExportData()
	if err != nil {
		t.Fatal(err)
	}
	if err = s.ImportData(exported); err != nil {
		t.Fatalf("backfilled history cannot round-trip: %v", err)
	}
}

func TestSavedRatesCannotBeReplacedOrRemoved(t *testing.T) {
	s := openTest(t)
	a, err := s.CreateAccount("USD", "USD", "2026-10")
	if err != nil {
		t.Fatal(err)
	}
	initial := MonthInput{Balances: []BalanceInput{{a.ID, "11000"}}, Rates: []RateInput{{"USD", "1.1"}}}
	if err = s.PutMonth("2026-10", initial); err != nil {
		t.Fatal(err)
	}
	for _, rates := range [][]RateInput{nil, {}, {{"USD", "1.10000000"}}} {
		if err = s.PutMonth("2026-10", MonthInput{Balances: []BalanceInput{{a.ID, "22000"}}, Rates: rates}); err != nil {
			t.Fatal(err)
		}
	}
	initial.Rates[0].Rate = "2.2"
	if err = s.PutMonth("2026-10", initial); !errors.Is(err, ErrConflict) {
		t.Fatalf("rate replacement accepted: %v", err)
	}
	d, err := s.Month("2026-10")
	if err != nil || !d.Complete || *d.TotalEURMinor != "20000" || d.Rates[0].Rate != "1.1" {
		t.Fatalf("snapshot changed: %+v %v", d, err)
	}
}

func TestBackfillDoesNotReopenArchivedGap(t *testing.T) {
	s := openTest(t)
	a, err := s.CreateAccount("EUR", "EUR", "2026-01")
	if err != nil {
		t.Fatal(err)
	}
	if err = s.ArchiveAccount(a.ID, "2026-03"); err != nil {
		t.Fatal(err)
	}
	if err = s.RestoreAccount(a.ID, "2026-06"); err != nil {
		t.Fatal(err)
	}
	d, err := s.Month("2026-04")
	if err != nil || len(d.EditableAccounts) != 0 {
		t.Fatalf("archived gap editable: %+v %v", d, err)
	}
	if err = s.PutMonth("2026-04", MonthInput{Balances: []BalanceInput{{a.ID, "100"}}}); !errors.Is(err, ErrValidation) {
		t.Fatalf("gap backfilled: %v", err)
	}
	if err = s.PutMonth("2025-09", MonthInput{Balances: []BalanceInput{{a.ID, "100"}}}); err != nil {
		t.Fatal(err)
	}
	d, err = s.Month("2026-04")
	if err != nil || len(d.Accounts) != 0 {
		t.Fatalf("archive period changed: %+v %v", d, err)
	}
}

func TestExistingBalanceRemainsVisibleOutsideActivityPeriod(t *testing.T) {
	s := openTest(t)
	a, err := s.CreateAccount("Existing savings", "EUR", "2026-10")
	if err != nil {
		t.Fatal(err)
	}
	if err = s.CreateMonth("2025-09"); err != nil {
		t.Fatal(err)
	}
	// Reproduce a stored balance whose account's first activity month is later.
	if _, err = s.DB.Exec("INSERT INTO monthly_balances(account_id,month,amount_minor,updated_at) VALUES(?,?,?,?)", a.ID, "2025-09", 12345, now()); err != nil {
		t.Fatal(err)
	}
	d, err := s.Month("2025-09")
	if err != nil || len(d.Accounts) != 1 || !d.Complete || *d.TotalEURMinor != "12345" {
		t.Fatalf("saved balance hidden: %+v %v", d, err)
	}
	if err = s.DeleteAccount(a.ID); !errors.Is(err, ErrConflict) {
		t.Fatalf("saved history deletable: %v", err)
	}
	currency := "USD"
	if _, err = s.UpdateAccount(a.ID, nil, &currency); !errors.Is(err, ErrConflict) {
		t.Fatalf("saved history currency editable: %v", err)
	}
	if err = s.PutMonth("2025-09", MonthInput{Balances: []BalanceInput{{a.ID, "23456"}}}); err != nil {
		t.Fatal(err)
	}
	groups, err := s.GroupsAt("2025-09")
	if err != nil || !groups.Ungrouped.Complete || *groups.Ungrouped.TotalEURMinor != "23456" {
		t.Fatalf("group lost old balance: %+v %v", groups, err)
	}
}

func TestInvalidBackfillDoesNotExtendAccountStart(t *testing.T) {
	s := openTest(t)
	a, err := s.CreateAccount("USD", "USD", "2026-10")
	if err != nil {
		t.Fatal(err)
	}
	err = s.PutMonth("2025-09", MonthInput{Balances: []BalanceInput{{a.ID, "9000000000000000"}}, Rates: []RateInput{{"USD", "0.00000001"}}})
	if !errors.Is(err, ErrValidation) {
		t.Fatalf("overflow accepted: %v", err)
	}
	updated, err := s.account(a.ID)
	if err != nil || updated.StartMonth != "2026-10" {
		t.Fatalf("invalid backfill moved start: %+v %v", updated, err)
	}
	d, err := s.Month("2025-09")
	if err != nil || d.Exists {
		t.Fatalf("invalid backfill saved: %+v %v", d, err)
	}
}

func TestAddingMissingRateDoesNotReplaceSavedQuote(t *testing.T) {
	s := openTest(t)
	usd, err := s.CreateAccount("USD", "USD", "2026-10")
	if err != nil {
		t.Fatal(err)
	}
	rub, err := s.CreateAccount("RUB", "RUB", "2026-10")
	if err != nil {
		t.Fatal(err)
	}
	input := MonthInput{Balances: []BalanceInput{{usd.ID, "11000"}, {rub.ID, "1000000"}}, Rates: []RateInput{{"USD", "1.1"}}}
	if err = s.PutMonth("2026-10", input); err != nil {
		t.Fatal(err)
	}
	input.Rates = []RateInput{{"RUB", "100"}}
	if err = s.PutMonth("2026-10", input); err != nil {
		t.Fatal(err)
	}
	d, err := s.Month("2026-10")
	if err != nil || !d.Complete || *d.TotalEURMinor != "20000" || len(d.Rates) != 2 {
		t.Fatalf("missing rate not added: %+v %v", d, err)
	}
}
