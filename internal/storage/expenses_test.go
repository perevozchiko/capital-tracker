package storage

import (
	"reflect"
	"testing"
)

func TestExpenseLifecycleAndIsolation(t *testing.T) {
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
	if err := s.PutIncome("2026-01", []Income{{"2026-01", "EUR", "12300", "1", "Salary"}}); err != nil {
		t.Fatal(err)
	}
	before, err := s.ExportData()
	if err != nil {
		t.Fatal(err)
	}
	entries := []Expense{{"2026-01", "EUR", "10000", "1", "Car"}, {"2026-01", "USD", "11000", "1.1", "Car"}, {"2026-01", "RSD", "1172000", "117.2", "Car"}}
	if err := s.PutExpense("2026-01", entries); err != nil {
		t.Fatal(err)
	}
	if err := s.PutExpense("2025-12", []Expense{{"2025-12", "EUR", "0", "1", "Car"}}); err != nil {
		t.Fatal(err)
	}
	months, err := s.Expenses()
	if err != nil || len(months) != 2 || months[1].TotalEURMinor != "30000" || months[0].TotalEURMinor != "0" {
		t.Fatalf("expenses: %+v %v", months, err)
	}
	after, err := s.ExportData()
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(before.Incomes, after.Incomes) || !reflect.DeepEqual(before.Accounts, after.Accounts) || !reflect.DeepEqual(before.Months, after.Months) || !reflect.DeepEqual(before.Rates, after.Rates) || !reflect.DeepEqual(before.Balances, after.Balances) {
		t.Fatal("expense changed capital records")
	}
	s.Close()
	s, err = Open(dir)
	if err != nil {
		t.Fatal(err)
	}
	restarted, err := s.Expenses()
	if err != nil || !reflect.DeepEqual(months, restarted) {
		t.Fatalf("restart: %+v %v", restarted, err)
	}
	copy := openTest(t)
	if err := copy.ImportData(after); err != nil {
		t.Fatal(err)
	}
	imported, err := copy.Expenses()
	if err != nil || !reflect.DeepEqual(months, imported) {
		t.Fatalf("roundtrip: %+v %v", imported, err)
	}
	entries[1].Rate = "2.2"
	if err := s.PutExpense("2026-01", entries); err != nil {
		t.Fatal(err)
	}
	edited, _ := s.Expenses()
	if edited[1].TotalEURMinor != "25000" {
		t.Fatal(edited)
	}
	if err := s.DeleteMonth("2026-01"); err != nil {
		t.Fatal(err)
	}
	unchanged, _ := s.Expenses()
	if !reflect.DeepEqual(edited, unchanged) {
		t.Fatal("deleting capital month changed expense")
	}
	if err := s.PutExpense("2026-01", []Expense{}); err != nil {
		t.Fatal(err)
	}
	remaining, _ := s.Expenses()
	if len(remaining) != 1 {
		t.Fatal(remaining)
	}
	if err := s.ClearData(); err != nil {
		t.Fatal(err)
	}
	remaining, _ = s.Expenses()
	if len(remaining) != 0 {
		t.Fatal("clear retained expense")
	}
	// Older backups remain importable and replace expense notes too.
	after.SchemaVersion = 4
	after.Expenses = nil
	if err := copy.ImportData(after); err != nil {
		t.Fatal(err)
	}
	remaining, _ = copy.Expenses()
	if len(remaining) != 0 {
		t.Fatal("old import retained expense")
	}
}

func TestExpenseValidationIsAtomic(t *testing.T) {
	s := openTest(t)
	good := []Expense{{"2026-01", "USD", "1", "2", "Car"}, {"2026-01", "RSD", "1", "2", "Car"}}
	if err := s.PutExpense("2026-01", good); err != nil {
		t.Fatal(err)
	}
	original, _ := s.Expenses()
	if original[0].TotalEURMinor != "1" {
		t.Fatal("must sum before rounding")
	}
	cases := [][]Expense{
		{{"2026-01", "EUR", "-1", "1", "Car"}},
		{{"2026-01", "EUR", "1", "2", "Car"}},
		{{"2026-01", "USD", "1", "0", "Car"}},
		{{"2026-01", "USD", "1", "", "Car"}},
		{{"2026-01", "USD", "1.2", "1", "Car"}},
		{{"2026-02", "USD", "1", "1", "Car"}},
		{{"2026-01", "GBP", "1", "1", "Car"}},
		{{"2026-01", "EUR", "9000000000000001", "1", "Car"}},
		{{"2026-01", "USD", "9000000000000000", "0.00000001", "Car"}},
		{{"2026-01", "EUR", "1", "1", ""}},
		{{"2026-01", "EUR", "1", "1", "  Car"}},
	}
	for _, entries := range cases {
		if err := s.PutExpense("2026-01", entries); err == nil {
			t.Fatalf("accepted %+v", entries)
		}
		unchanged, _ := s.Expenses()
		if !reflect.DeepEqual(original, unchanged) {
			t.Fatal("failed update changed saved expense")
		}
		if entries[0].Month == "2026-02" {
			continue
		} // A different month is valid in a standalone backup.
		d, _ := s.ExportData()
		d.Expenses = entries
		if err := s.ImportData(d); err == nil {
			t.Fatalf("import accepted %+v", entries)
		}
	}
	if err := s.PutExpense("2026-13", []Expense{}); err == nil {
		t.Fatal("invalid month accepted")
	}
}

func TestExpenseMigrationAndBackupVersions(t *testing.T) {
	dir := t.TempDir()
	s, err := Open(dir)
	if err != nil {
		t.Fatal(err)
	}
	if err := s.PutIncome("2026-10", []Income{{"2026-10", "EUR", "10000", "1", "Salary"}}); err != nil {
		t.Fatal(err)
	}
	before, err := s.ExportData()
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.DB.Exec("DROP TABLE expenses; DELETE FROM schema_migrations WHERE version=5; PRAGMA user_version=4"); err != nil {
		t.Fatal(err)
	}
	s.Close()
	s, err = Open(dir)
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	after, err := s.ExportData()
	if err != nil || !reflect.DeepEqual(before.Incomes, after.Incomes) || len(after.Expenses) != 0 {
		t.Fatalf("migration: %+v %v", after, err)
	}
	entries := []Expense{{"2026-10", "EUR", "10000", "1", "Car"}, {"2026-10", "EUR", "20000", "1", "Holiday"}}
	if err := s.PutExpense("2026-10", entries); err != nil {
		t.Fatal(err)
	}
	snapshot, err := s.ExportData()
	if err != nil {
		t.Fatal(err)
	}
	if snapshot.SchemaVersion != 5 || !reflect.DeepEqual(snapshot.Expenses, entries) {
		t.Fatal(snapshot)
	}
	copy := openTest(t)
	if err := copy.ImportData(snapshot); err != nil {
		t.Fatal(err)
	}
	restored, err := copy.Expenses()
	if err != nil || len(restored) != 1 || restored[0].TotalEURMinor != "30000" || !reflect.DeepEqual(restored[0].Entries, entries) {
		t.Fatalf("roundtrip: %+v %v", restored, err)
	}
	snapshot.Expenses = nil
	if err := ValidateTransfer(snapshot); err == nil {
		t.Fatal("version 5 must include expenses")
	}
	snapshot.SchemaVersion = 4
	snapshot.Expenses = entries
	if err := ValidateTransfer(snapshot); err == nil {
		t.Fatal("version 4 cannot contain expenses")
	}
	snapshot.Expenses = nil
	if err := copy.ImportData(snapshot); err != nil {
		t.Fatal(err)
	}
	restored, err = copy.Expenses()
	if err != nil || len(restored) != 0 {
		t.Fatalf("legacy import: %+v %v", restored, err)
	}
}
