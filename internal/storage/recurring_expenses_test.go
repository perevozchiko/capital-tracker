package storage

import (
	"reflect"
	"strings"
	"testing"
)

func TestRecurringExpenseInheritanceAndBackup(t *testing.T) {
	dir := t.TempDir()
	s, err := Open(dir)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { s.Close() }()
	put := func(month string, entries []Expense) {
		t.Helper()
		if err := s.PutRecurringExpense(month, entries); err != nil {
			t.Fatal(err)
		}
	}
	get := func(month, source, total string, count int) RecurringExpenseMonth {
		t.Helper()
		got, err := s.RecurringExpense(month)
		if err != nil || got.Month != month || got.InheritedFrom != source || got.TotalEURMinor != total || len(got.Entries) != count {
			t.Fatalf("%s: %+v %v", month, got, err)
		}
		for _, entry := range got.Entries {
			if entry.Month != month {
				t.Fatal("inherited entry has wrong month")
			}
		}
		return got
	}
	get("2026-01", "", "0", 0)
	put("2026-01", []Expense{{"2026-01", "USD", "11000", "1.1", "Internet"}, {"2026-01", "EUR", "80000", "1", "Rent"}})
	get("2025-12", "", "0", 0)
	feb := get("2026-02", "2026-01", "90000", 2)
	get("2026-04", "2026-01", "90000", 2)
	history, _ := s.RecurringExpenses()
	if len(history) != 1 {
		t.Fatal("reading created a snapshot")
	}
	put("2026-02", feb.Entries[1:])
	get("2026-01", "", "90000", 2)
	get("2026-03", "2026-02", "80000", 1)
	put("2026-01", []Expense{})
	get("2026-02", "", "80000", 1)
	put("2026-03", []Expense{})
	get("2026-03", "", "0", 0)
	get("2026-05", "2026-03", "0", 0)
	if err := s.PutRecurringExpense("2026-02", []Expense{{"2026-02", "EUR", "-1", "1", "Invalid"}}); err == nil {
		t.Fatal("accepted negative amount")
	}
	get("2026-02", "", "80000", 1)
	if err := s.PutRecurringExpense("2026-13", []Expense{}); err == nil {
		t.Fatal("accepted invalid month")
	}
	snapshot, err := s.ExportData()
	if err != nil {
		t.Fatal(err)
	}
	if snapshot.SchemaVersion != 6 || len(snapshot.RecurringExpenses) != 3 || len(snapshot.Months) != 0 || len(snapshot.Expenses) != 0 || len(snapshot.Incomes) != 0 {
		t.Fatalf("bad snapshot: %+v", snapshot)
	}
	if err := s.Close(); err != nil {
		t.Fatal(err)
	}
	s, err = Open(dir)
	if err != nil {
		t.Fatal(err)
	}
	get("2026-05", "2026-03", "0", 0)
	if err := s.ClearData(); err != nil {
		t.Fatal(err)
	}
	get("2026-05", "", "0", 0)
	if err := s.ImportData(snapshot); err != nil {
		t.Fatal(err)
	}
	restored, err := s.ExportData()
	if err != nil || !reflect.DeepEqual(snapshot.RecurringExpenses, restored.RecurringExpenses) {
		t.Fatalf("backup lost snapshots: %+v %v", restored, err)
	}
	get("2026-05", "2026-03", "0", 0)
	snapshot.RecurringExpenses = append(snapshot.RecurringExpenses, snapshot.RecurringExpenses[0])
	if err := s.ImportData(snapshot); err == nil {
		t.Fatal("accepted duplicate snapshot")
	}
	snapshot.RecurringExpenses = nil
	if err := s.ImportData(snapshot); err == nil {
		t.Fatal("accepted missing v6 data")
	}
	snapshot.SchemaVersion = 5
	if err := s.ImportData(snapshot); err != nil {
		t.Fatal(err)
	}
	get("2026-05", "", "0", 0)
}

func TestRecurringExpenseValidationPreservesAllSnapshots(t *testing.T) {
	s := openTest(t)
	good := []Expense{{"2026-01", "USD", "1", "2", "Internet"}, {"2026-01", "RSD", "1", "2", "Phone"}}
	if err := s.PutRecurringExpense("2026-01", good); err != nil {
		t.Fatal(err)
	}
	if err := s.PutRecurringExpense("2026-02", []Expense{}); err != nil {
		t.Fatal(err)
	}
	original, err := s.ExportData()
	if err != nil {
		t.Fatal(err)
	}
	total, err := s.RecurringExpense("2026-01")
	if err != nil || total.TotalEURMinor != "1" {
		t.Fatalf("must round once after summing: %+v %v", total, err)
	}
	cases := []struct {
		name  string
		entry Expense
	}{
		{"negative amount", Expense{"2026-01", "EUR", "-1", "1", "Rent"}},
		{"fractional minor units", Expense{"2026-01", "EUR", "1.2", "1", "Rent"}},
		{"amount limit", Expense{"2026-01", "EUR", "9000000000000001", "1", "Rent"}},
		{"conversion overflow", Expense{"2026-01", "USD", "9000000000000000", "0.00000001", "Rent"}},
		{"EUR rate", Expense{"2026-01", "EUR", "1", "2", "Rent"}},
		{"zero rate", Expense{"2026-01", "USD", "1", "0", "Rent"}},
		{"missing rate", Expense{"2026-01", "USD", "1", "", "Rent"}},
		{"unsupported currency", Expense{"2026-01", "GBP", "1", "1", "Rent"}},
		{"wrong month", Expense{"2026-02", "EUR", "1", "1", "Rent"}},
		{"empty name", Expense{"2026-01", "EUR", "1", "1", ""}},
		{"untrimmed name", Expense{"2026-01", "EUR", "1", "1", " Rent"}},
		{"long unicode name", Expense{"2026-01", "EUR", "1", "1", strings.Repeat("я", 101)}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			// A valid first row must not be partially written when the next row is invalid.
			entries := []Expense{good[0], tc.entry}
			if err := s.PutRecurringExpense("2026-01", entries); err == nil {
				t.Fatal("invalid update accepted")
			}
			broken := original
			broken.RecurringExpenses = []RecurringExpenseSnapshot{{Month: "2026-01", Entries: entries}}
			if err := s.ImportData(broken); err == nil {
				t.Fatal("invalid backup accepted")
			}
			after, err := s.ExportData()
			if err != nil || !reflect.DeepEqual(original.RecurringExpenses, after.RecurringExpenses) {
				t.Fatalf("rejected write changed snapshots: %+v %v", after.RecurringExpenses, err)
			}
		})
	}
}

func TestRecurringExpenseBackfillAndSavedMonthIsolation(t *testing.T) {
	s := openTest(t)
	put := func(month, amount, rate string) {
		t.Helper()
		if err := s.PutRecurringExpense(month, []Expense{{month, "USD", amount, rate, "Rent"}}); err != nil {
			t.Fatal(err)
		}
	}
	check := func(month, source, amount, rate string) {
		t.Helper()
		got, err := s.RecurringExpense(month)
		if err != nil || got.InheritedFrom != source || len(got.Entries) != 1 {
			t.Fatalf("%s: %+v %v", month, got, err)
		}
		if got.Entries[0] != (Expense{month, "USD", amount, rate, "Rent"}) {
			t.Fatalf("wrong inherited values: %+v", got)
		}
	}
	put("2026-01", "11000", "1.1")
	put("2026-06", "22000", "2.2")
	check("2026-04", "2026-01", "11000", "1.1")
	put("2026-03", "33000", "3.3")
	check("2026-04", "2026-03", "33000", "3.3")
	check("2026-02", "2026-01", "11000", "1.1")
	check("2026-06", "", "22000", "2.2")
	check("2026-07", "2026-06", "22000", "2.2")
	// Capital snapshot deletion must not delete the recurring list for that month.
	if err := s.CreateMonth("2026-03"); err != nil {
		t.Fatal(err)
	}
	if err := s.DeleteMonth("2026-03"); err != nil {
		t.Fatal(err)
	}
	check("2026-04", "2026-03", "33000", "3.3")
	history, err := s.RecurringExpenses()
	if err != nil {
		t.Fatal(err)
	}
	var months []string
	for _, month := range history {
		months = append(months, month.Month)
	}
	if !reflect.DeepEqual(months, []string{"2026-01", "2026-03", "2026-06"}) {
		t.Fatalf("history contains unsaved months or wrong order: %v", months)
	}
}

func TestRecurringExpenseBackupRejectsMalformedSnapshots(t *testing.T) {
	s := openTest(t)
	if err := s.PutRecurringExpense("2026-01", []Expense{{"2026-01", "EUR", "0", "1", "Free plan"}}); err != nil {
		t.Fatal(err)
	}
	original, err := s.ExportData()
	if err != nil {
		t.Fatal(err)
	}
	cases := []struct {
		name      string
		snapshots []RecurringExpenseSnapshot
	}{
		{"missing collection", nil},
		{"null entries", []RecurringExpenseSnapshot{{Month: "2026-02"}}},
		{"invalid empty month", []RecurringExpenseSnapshot{{Month: "2026-13", Entries: []Expense{}}}},
		{"duplicate empty months", []RecurringExpenseSnapshot{{Month: "2026-02", Entries: []Expense{}}, {Month: "2026-02", Entries: []Expense{}}}},
		{"entry outside snapshot", []RecurringExpenseSnapshot{{Month: "2026-02", Entries: original.RecurringExpenses[0].Entries}}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			broken := original
			broken.RecurringExpenses = tc.snapshots
			if err := s.ImportData(broken); err == nil {
				t.Fatal("malformed snapshot accepted")
			}
			after, err := s.ExportData()
			if err != nil || !reflect.DeepEqual(original.RecurringExpenses, after.RecurringExpenses) {
				t.Fatalf("failed import changed data: %+v %v", after, err)
			}
		})
	}
}

func TestRecurringExpenseMigrationPreservesVersion5Data(t *testing.T) {
	dir := t.TempDir()
	s, err := Open(dir)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { s.Close() }()
	if err := s.PutExpense("2026-01", []Expense{{"2026-01", "EUR", "12300", "1", "Car"}}); err != nil {
		t.Fatal(err)
	}
	if err := s.PutIncome("2026-01", []Income{{"2026-01", "EUR", "45000", "1", "Salary"}}); err != nil {
		t.Fatal(err)
	}
	before, err := s.ExportData()
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.DB.Exec("DROP TABLE recurring_expenses; DROP TABLE recurring_expense_months; DELETE FROM schema_migrations WHERE version=6; PRAGMA user_version=5"); err != nil {
		t.Fatal(err)
	}
	if err := s.Close(); err != nil {
		t.Fatal(err)
	}
	s, err = Open(dir)
	if err != nil {
		t.Fatal(err)
	}
	after, err := s.ExportData()
	if err != nil || !reflect.DeepEqual(before.Expenses, after.Expenses) || !reflect.DeepEqual(before.Incomes, after.Incomes) || after.RecurringExpenses == nil || len(after.RecurringExpenses) != 0 {
		t.Fatalf("migration lost data: %+v %v", after, err)
	}
	if err := s.PutRecurringExpense("2026-02", []Expense{}); err != nil {
		t.Fatal(err)
	}
	got, err := s.RecurringExpense("2026-03")
	if err != nil || got.InheritedFrom != "2026-02" || len(got.Entries) != 0 {
		t.Fatalf("migrated tables unusable: %+v %v", got, err)
	}
}
