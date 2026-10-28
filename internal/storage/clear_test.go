package storage

import (
	"reflect"
	"testing"
)

func TestClearDataRemovesEverythingAndResetsPreferences(t *testing.T) {
	s := openTest(t)
	eur, err := s.CreateAccount("Cash", "EUR", "2026-01")
	if err != nil {
		t.Fatal(err)
	}
	usd, err := s.CreateAccount("Savings", "USD", "2026-01")
	if err != nil {
		t.Fatal(err)
	}
	if err = s.PutMonth("2026-01", MonthInput{
		Balances: []BalanceInput{{eur.ID, "12345"}, {usd.ID, "45678"}},
		Rates: []RateInput{{"USD", "1.12345678"}},
	}); err != nil {
		t.Fatal(err)
	}
	if err = s.CreateMonth("2026-02"); err != nil {
		t.Fatal(err)
	}
	if err = s.ArchiveAccount(usd.ID, "2026-03"); err != nil {
		t.Fatal(err)
	}
	if err = s.RestoreAccount(usd.ID, "2026-04"); err != nil {
		t.Fatal(err)
	}
	if err = s.UpdateSettings("ru", "dark"); err != nil {
		t.Fatal(err)
	}
	if err = s.ClearData(); err != nil {
		t.Fatal(err)
	}

	cleared, err := s.ExportData()
	if err != nil {
		t.Fatal(err)
	}
	if len(cleared.Accounts) != 0 || len(cleared.AccountPeriods) != 0 ||
		len(cleared.Months) != 0 || len(cleared.Balances) != 0 || len(cleared.Rates) != 0 {
		t.Fatalf("some records survived clearing: %+v", cleared)
	}
	if !reflect.DeepEqual(cleared.Settings, map[string]string{"language": "en", "theme": "system"}) {
		t.Fatalf("unexpected settings: %+v", cleared.Settings)
	}
	var schema int
	if err := s.DB.QueryRow("PRAGMA user_version").Scan(&schema); err != nil || schema != 1 {
		t.Fatalf("schema was removed: version %d, %v", schema, err)
	}
	created, err := s.CreateAccount("New account", "EUR", "2026-05")
	if err != nil || created.ID != 1 {
		t.Fatalf("database cannot restart fresh: %+v %v", created, err)
	}
	if err := s.PutMonth("2026-05", MonthInput{Balances: []BalanceInput{{created.ID, "100"}}}); err != nil {
		t.Fatal(err)
	}
	m, err := s.Month("2026-05")
	if err != nil || !m.Complete || m.TotalEURMinor == nil || *m.TotalEURMinor != "100" {
		t.Fatalf("new data cannot be saved: %+v %v", m, err)
	}
}

func TestClearDataFailureRollsBackAllTables(t *testing.T) {
	s := openTest(t)
	a, err := s.CreateAccount("Protected account", "EUR", "2026-01")
	if err != nil {
		t.Fatal(err)
	}
	if err = s.PutMonth("2026-01", MonthInput{Balances: []BalanceInput{{a.ID, "900"}}}); err != nil {
		t.Fatal(err)
	}
	if err = s.UpdateSettings("ru", "dark"); err != nil {
		t.Fatal(err)
	}
	before, err := s.ExportData()
	if err != nil {
		t.Fatal(err)
	}
	// The trigger rejects deletion after the clear operation has already
	// deleted balances and periods, exercising rollback rather than validation.
	_, err = s.DB.Exec(`CREATE TRIGGER prevent_clear BEFORE DELETE ON accounts
		BEGIN SELECT RAISE(ABORT,'test failure'); END`)
	if err != nil {
		t.Fatal(err)
	}
	if err = s.ClearData(); err == nil {
		t.Fatal("clear unexpectedly succeeded")
	}
	if _, err = s.DB.Exec("DROP TRIGGER prevent_clear"); err != nil {
		t.Fatal(err)
	}
	after, err := s.ExportData()
	if err != nil {
		t.Fatal(err)
	}
	before.ExportedAt, after.ExportedAt = "", ""
	if !reflect.DeepEqual(before, after) {
		t.Fatalf("clear failure partially deleted records: before=%+v after=%+v", before, after)
	}
}
