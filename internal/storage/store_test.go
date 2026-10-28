package storage

import (
	"errors"
	"path/filepath"
	"testing"
)

func openTest(t *testing.T) *Store {
	t.Helper()
	s, e := Open(t.TempDir())
	if e != nil {
		t.Fatal(e)
	}
	t.Cleanup(func() { s.Close() })
	return s
}
func TestCompleteHistoricalWorkflow(t *testing.T) {
	s := openTest(t)
	configs := []struct{ n, c string }{{"Main Bank", "EUR"}, {"Savings", "USD"}, {"Serbian Bank", "RSD"}, {"Russian Bank", "RUB"}, {"Turkish Bank", "TRY"}}
	ids := make([]int64, 0, len(configs))
	for _, c := range configs {
		a, e := s.CreateAccount(c.n, c.c, "2026-09")
		if e != nil {
			t.Fatal(e)
		}
		ids = append(ids, a.ID)
	}
	september := MonthInput{Balances: []BalanceInput{{ids[0], "500000"}, {ids[1], "108000"}, {ids[2], "11720000"}, {ids[3], "0"}, {ids[4], "0"}}, Rates: []RateInput{{"USD", "1.08"}, {"RSD", "117.2"}, {"RUB", "95.50"}, {"TRY", "48.5"}}}
	if e := s.PutMonth("2026-09", september); e != nil {
		t.Fatal(e)
	}
	first, e := s.Month("2026-09")
	if e != nil {
		t.Fatal(e)
	}
	if !first.Complete || *first.TotalEURMinor != "700000" {
		t.Fatalf("September: %+v", first)
	}
	october := MonthInput{Balances: []BalanceInput{{ids[0], "540000"}, {ids[1], "129600"}, {ids[2], "11720000"}, {ids[3], "0"}, {ids[4], "0"}}, Rates: []RateInput{{"USD", "1.08"}, {"RSD", "117.2"}, {"RUB", "95.50"}, {"TRY", "48.5"}}}
	if e := s.PutMonth("2026-10", october); e != nil {
		t.Fatal(e)
	}
	d, e := s.Dashboard("2026-10")
	if e != nil {
		t.Fatal(e)
	}
	if *d.Month.TotalEURMinor != "760000" || *d.ChangeMinor != "60000" {
		t.Fatalf("October: %+v", d)
	}
	// Replacement is idempotent and editing September changes only its total.
	september.Balances[0].AmountMinor = "510000"
	if e := s.PutMonth("2026-09", september); e != nil {
		t.Fatal(e)
	}
	if e := s.PutMonth("2026-09", september); e != nil {
		t.Fatal(e)
	}
	d, e = s.Dashboard("2026-10")
	if e != nil {
		t.Fatal(e)
	}
	if *d.Month.TotalEURMinor != "760000" || *d.Previous.TotalEURMinor != "710000" || *d.ChangeMinor != "50000" {
		t.Fatalf("history edit: %+v", d)
	}
	// Invalid second rate rejects the whole replacement transaction.
	invalid := september
	invalid.Rates = []RateInput{{"USD", "0"}}
	if e := s.PutMonth("2026-09", invalid); e == nil {
		t.Fatal("invalid rate was accepted")
	}
	again, e := s.Month("2026-09")
	if e != nil || !again.Complete || *again.TotalEURMinor != "710000" {
		t.Fatalf("partial commit: %+v %v", again, e)
	}
	if e := s.ArchiveAccount(ids[4], "2026-11"); e != nil {
		t.Fatal(e)
	}
	old, e := s.Month("2026-09")
	if e != nil || !old.Complete || len(old.Accounts) != 5 {
		t.Fatalf("history lost on archive: %+v %v", old, e)
	}
	if e := s.RestoreAccount(ids[4], "2026-11"); e != nil {
		t.Fatal(e)
	}
	old, e = s.Month("2026-09")
	if e != nil || !old.Complete {
		t.Fatal("restoration changed historical status", e)
	}
}
func TestMissingDifferentFromZeroAndPersistence(t *testing.T) {
	dir := t.TempDir()
	s, e := Open(dir)
	if e != nil {
		t.Fatal(e)
	}
	a, e := s.CreateAccount("A", "EUR", "2026-01")
	if e != nil {
		t.Fatal(e)
	}
	if e := s.PutMonth("2026-01", MonthInput{}); e != nil {
		t.Fatal(e)
	}
	d, e := s.Month("2026-01")
	if e != nil || d.Complete || len(d.MissingBalances) != 1 {
		t.Fatalf("missing: %+v %v", d, e)
	}
	if e := s.PutMonth("2026-01", MonthInput{Balances: []BalanceInput{{a.ID, "0"}}}); e != nil {
		t.Fatal(e)
	}
	d, e = s.Month("2026-01")
	if e != nil || !d.Complete || *d.TotalEURMinor != "0" {
		t.Fatalf("zero: %+v %v", d, e)
	}
	if e := s.UpdateSettings("ru", "dark"); e != nil {
		t.Fatal(e)
	}
	s.Close()
	s, e = Open(dir)
	if e != nil {
		t.Fatal(e)
	}
	defer s.Close()
	d, e = s.Month("2026-01")
	if e != nil || !d.Complete || *d.TotalEURMinor != "0" {
		t.Fatalf("reload: %+v %v", d, e)
	}
	settings, e := s.Settings("test")
	if e != nil || settings.Language != "ru" || settings.Theme != "dark" {
		t.Fatalf("settings: %+v %v", settings, e)
	}
	backup := filepath.Join(dir, "export.db")
	if e := s.Backup(backup); e != nil {
		t.Fatal(e)
	}
	if e := s.Backup(backup); e == nil {
		t.Fatal("backup unexpectedly overwritten")
	}
}
func TestHistoryAndRestrictions(t *testing.T) {
	s := openTest(t)
	a, e := s.CreateAccount("Account", "EUR", "2026-01")
	if e != nil {
		t.Fatal(e)
	}
	if e := s.CreateMonth("2026-01"); e != nil {
		t.Fatal(e)
	}
	if _, e = s.CreateAccount("Late", "USD", "2026-01"); !errors.Is(e, ErrConflict) {
		t.Fatalf("backdating accepted: %v", e)
	}
	if e := s.PutMonth("2026-01", MonthInput{Balances: []BalanceInput{{a.ID, "100"}}}); e != nil {
		t.Fatal(e)
	}
	if e := s.DeleteAccount(a.ID); !errors.Is(e, ErrConflict) {
		t.Fatalf("history deletion allowed: %v", e)
	}
	if e := s.ArchiveAccount(a.ID, "2026-01"); !errors.Is(e, ErrConflict) {
		t.Fatalf("retroactive archive allowed: %v", e)
	}
	if e := s.ArchiveAccount(a.ID, "2026-02"); e != nil {
		t.Fatal(e)
	}
	if e := s.CreateMonth("2026-02"); e != nil {
		t.Fatal(e)
	}
	if e := s.RestoreAccount(a.ID, "2026-02"); !errors.Is(e, ErrConflict) {
		t.Fatalf("retroactive restore allowed: %v", e)
	}
	if e := s.RestoreAccount(a.ID, "2026-03"); e != nil {
		t.Fatal(e)
	}
}

func TestAccountCurrencyCanChangeOnlyBeforeHistory(t *testing.T) {
	s := openTest(t)
	a, err := s.CreateAccount("Bank", "USD", "2026-01")
	if err != nil {
		t.Fatal(err)
	}
	currency := "RSD"
	updated, err := s.UpdateAccount(a.ID, nil, &currency)
	if err != nil || updated.Currency != "RSD" {
		t.Fatalf("currency edit: %+v %v", updated, err)
	}
	if err = s.PutMonth("2026-01", MonthInput{Balances: []BalanceInput{{a.ID, "100"}}, Rates: []RateInput{{"RSD", "117.2"}}}); err != nil {
		t.Fatal(err)
	}
	currency = "EUR"
	if _, err = s.UpdateAccount(a.ID, nil, &currency); !errors.Is(err, ErrConflict) {
		t.Fatalf("history changed currency: %v", err)
	}
	updated, err = s.account(a.ID)
	if err != nil || updated.Currency != "RSD" {
		t.Fatalf("currency mutated: %+v %v", updated, err)
	}
}
