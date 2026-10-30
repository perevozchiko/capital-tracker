package storage

import (
	"path/filepath"
	"reflect"
	"testing"
)

func TestIncomeLifecycleAndIsolation(t *testing.T) {
	dir := t.TempDir()
	s, err := Open(dir)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { s.Close() }()
	account, err := s.CreateAccount("Savings", "USD", "2025-01")
	if err != nil {
		t.Fatal(err)
	}
	if err := s.PutMonth("2026-01", MonthInput{Balances: []BalanceInput{{AccountID: account.ID, AmountMinor: "44000"}}, Rates: []RateInput{{Currency: "USD", Rate: "2"}}}); err != nil {
		t.Fatal(err)
	}
	before, err := s.ExportData()
	if err != nil {
		t.Fatal(err)
	}
	entries := []Income{{"2026-01", "EUR", "10000", "1"}, {"2026-01", "USD", "11000", "1.1"}, {"2026-01", "RSD", "1172000", "117.2"}}
	if err := s.PutIncome("2026-01", entries); err != nil {
		t.Fatal(err)
	}
	if err := s.PutIncome("2025-12", []Income{{"2025-12", "EUR", "0", "1"}}); err != nil {
		t.Fatal(err)
	}
	months, err := s.Incomes()
	if err != nil || len(months) != 2 || months[1].TotalEURMinor != "30000" || months[0].TotalEURMinor != "0" {
		t.Fatalf("incomes: %+v %v", months, err)
	}
	after, err := s.ExportData()
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(before.Accounts, after.Accounts) || !reflect.DeepEqual(before.Months, after.Months) || !reflect.DeepEqual(before.Rates, after.Rates) || !reflect.DeepEqual(before.Balances, after.Balances) {
		t.Fatal("income changed capital records")
	}
	s.Close()
	s, err = Open(dir)
	if err != nil {
		t.Fatal(err)
	}
	restarted, err := s.Incomes()
	if err != nil || !reflect.DeepEqual(months, restarted) {
		t.Fatalf("restart: %+v %v", restarted, err)
	}
	copy := openTest(t)
	if err := copy.ImportData(after); err != nil {
		t.Fatal(err)
	}
	imported, err := copy.Incomes()
	if err != nil || !reflect.DeepEqual(months, imported) {
		t.Fatalf("roundtrip: %+v %v", imported, err)
	}
	entries[1].Rate = "2.2"
	if err := s.PutIncome("2026-01", entries); err != nil {
		t.Fatal(err)
	}
	edited, _ := s.Incomes()
	if edited[1].TotalEURMinor != "25000" {
		t.Fatal(edited)
	}
	if err := s.DeleteMonth("2026-01"); err != nil {
		t.Fatal(err)
	}
	unchanged, _ := s.Incomes()
	if !reflect.DeepEqual(edited, unchanged) {
		t.Fatal("deleting capital month changed income")
	}
	if err := s.PutIncome("2026-01", []Income{}); err != nil {
		t.Fatal(err)
	}
	remaining, _ := s.Incomes()
	if len(remaining) != 1 {
		t.Fatal(remaining)
	}
	if err := s.ClearData(); err != nil {
		t.Fatal(err)
	}
	remaining, _ = s.Incomes()
	if len(remaining) != 0 {
		t.Fatal("clear retained income")
	}
	// Older backups remain importable and replace income notes too.
	after.SchemaVersion = 2
	after.Incomes = nil
	if err := copy.ImportData(after); err != nil {
		t.Fatal(err)
	}
	remaining, _ = copy.Incomes()
	if len(remaining) != 0 {
		t.Fatal("old import retained income")
	}
}

func TestIncomeValidationIsAtomic(t *testing.T) {
	s := openTest(t)
	good := []Income{{"2026-01", "USD", "1", "2"}, {"2026-01", "RSD", "1", "2"}}
	if err := s.PutIncome("2026-01", good); err != nil {
		t.Fatal(err)
	}
	original, _ := s.Incomes()
	if original[0].TotalEURMinor != "1" {
		t.Fatal("must sum before rounding")
	}
	cases := [][]Income{
		{{"2026-01", "EUR", "-1", "1"}},
		{{"2026-01", "EUR", "1", "2"}},
		{{"2026-01", "USD", "1", "0"}},
		{{"2026-01", "USD", "1", ""}},
		{{"2026-01", "USD", "1.2", "1"}},
		{{"2026-02", "USD", "1", "1"}},
		{{"2026-01", "GBP", "1", "1"}},
		{{"2026-01", "EUR", "9000000000000001", "1"}},
		{{"2026-01", "USD", "9000000000000000", "0.00000001"}},
		{good[0], good[0]},
	}
	for _, entries := range cases {
		if err := s.PutIncome("2026-01", entries); err == nil {
			t.Fatalf("accepted %+v", entries)
		}
		unchanged, _ := s.Incomes()
		if !reflect.DeepEqual(original, unchanged) {
			t.Fatal("failed update changed saved income")
		}
		if entries[0].Month == "2026-02" {
			continue
		} // A different month is valid in a standalone backup.
		d, _ := s.ExportData()
		d.Incomes = entries
		if err := s.ImportData(d); err == nil {
			t.Fatalf("import accepted %+v", entries)
		}
	}
	if err := s.PutIncome("2026-13", []Income{}); err == nil {
		t.Fatal("invalid month accepted")
	}
}

func TestIncomeMigrationPreservesExistingData(t *testing.T) {
	dir := t.TempDir()
	s, err := Open(dir)
	if err != nil {
		t.Fatal(err)
	}
	account, err := s.CreateAccount("Existing account", "EUR", "2026-01")
	if err != nil {
		t.Fatal(err)
	}
	if err := s.PutMonth("2026-01", MonthInput{Balances: []BalanceInput{{AccountID: account.ID, AmountMinor: "12345"}}}); err != nil {
		t.Fatal(err)
	}
	// Recreate the version 2 schema as shipped before income notes existed.
	if _, err := s.DB.Exec("DROP TABLE incomes; DELETE FROM schema_migrations WHERE version=3; PRAGMA user_version=2"); err != nil {
		t.Fatal(err)
	}
	if err := s.Close(); err != nil {
		t.Fatal(err)
	}
	s, err = Open(dir)
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	month, err := s.Month("2026-01")
	if err != nil || month.TotalEURMinor == nil || *month.TotalEURMinor != "12345" {
		t.Fatalf("migration changed capital: %+v %v", month, err)
	}
	incomes, err := s.Incomes()
	if err != nil || len(incomes) != 0 {
		t.Fatalf("migrated incomes: %+v %v", incomes, err)
	}
	backups, err := filepath.Glob(s.Path + ".pre-migration-*")
	if err != nil || len(backups) != 1 {
		t.Fatalf("missing pre-migration backup: %v %v", backups, err)
	}
}
