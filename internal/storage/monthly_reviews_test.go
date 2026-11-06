package storage

import (
	"reflect"
	"testing"
)

func TestEmptyFlowSavesSurviveRestartExportAndDelete(t *testing.T) {
	dir := t.TempDir()
	s, err := Open(dir)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { s.Close() }()
	if err := s.PutIncome("2026-02", []Income{}); err != nil {
		t.Fatal(err)
	}
	if err := s.PutExpense("2026-02", []Expense{}); err != nil {
		t.Fatal(err)
	}
	if err := s.PutRecurringExpense("2026-02", []Expense{}); err != nil {
		t.Fatal(err)
	}
	assertZero := func(store *Store) {
		t.Helper()
		incomes, e := store.Incomes()
		if e != nil || len(incomes) != 1 || incomes[0].Month != "2026-02" || incomes[0].TotalEURMinor != "0" || !incomes[0].Complete || len(incomes[0].Entries) != 0 {
			t.Fatalf("incomes: %+v %v", incomes, e)
		}
		expenses, e := store.Expenses()
		if e != nil || len(expenses) != 1 || expenses[0].Month != "2026-02" || expenses[0].TotalEURMinor != "0" || !expenses[0].Complete {
			t.Fatalf("expenses: %+v %v", expenses, e)
		}
	}
	assertZero(s)
	snapshot, err := s.ExportData()
	if err != nil || len(snapshot.MonthlyReviews) != 2 {
		t.Fatalf("snapshot: %+v %v", snapshot.MonthlyReviews, err)
	}
	if err := s.Close(); err != nil {
		t.Fatal(err)
	}
	s, err = Open(dir)
	if err != nil {
		t.Fatal(err)
	}
	assertZero(s)
	copy := openTest(t)
	if err := copy.ImportData(snapshot); err != nil {
		t.Fatal(err)
	}
	assertZero(copy)
	if err := copy.DeleteFlowMonth("incomes", "2026-02"); err != nil {
		t.Fatal(err)
	}
	incomes, _ := copy.Incomes()
	expenses, _ := copy.Expenses()
	if len(incomes) != 0 || len(expenses) != 1 {
		t.Fatal("delete did not isolate section")
	}
	if err := s.ClearData(); err != nil {
		t.Fatal(err)
	}
	cleared, _ := s.ExportData()
	if len(cleared.MonthlyReviews) != 0 {
		t.Fatal("clear retained review markers")
	}
	// A recurring list inherited into the following month is not an explicit save.
	next, _ := copy.RecurringExpense("2026-03")
	history, _ := copy.RecurringExpenses()
	if next.InheritedFrom != "2026-02" || len(history) != 1 || history[0].Month != "2026-02" {
		t.Fatal("inheritance created a review")
	}
	for _, bad := range []MonthlyReview{{"incomes", "2026-13"}, {"other", "2026-02"}} {
		invalid := snapshot
		invalid.MonthlyReviews = []MonthlyReview{bad}
		if err := copy.ImportData(invalid); err == nil {
			t.Fatal("accepted invalid review", bad)
		}
	}
}

func TestSavedRatesKeepSourcesAndExactQuotes(t *testing.T) {
	s := openTest(t)
	account, _ := s.CreateAccount("USD", "USD", "2026-01")
	if err := s.PutMonth("2026-01", MonthInput{Balances: []BalanceInput{{account.ID, "10000"}}, Rates: []RateInput{{"USD", "1.1"}}}); err != nil {
		t.Fatal(err)
	}
	if err := s.PutIncome("2026-01", []Income{{"2026-01", "USD", "100", "1.2", "Salary"}, {"2026-01", "USD", "200", "1.2", "Bonus"}, {"2026-01", "EUR", "100", "1", "Other"}}); err != nil {
		t.Fatal(err)
	}
	if err := s.PutExpense("2026-01", []Expense{{"2026-01", "RSD", "100", "117.23456789", "Car"}}); err != nil {
		t.Fatal(err)
	}
	if err := s.PutRecurringExpense("2026-02", []Expense{{"2026-02", "USD", "100", "1.3", "Rent"}}); err != nil {
		t.Fatal(err)
	}
	got, err := s.SavedRates()
	want := []SavedRate{{"2026-01", "RSD", "117.23456789", "expenses"}, {"2026-01", "USD", "1.2", "incomes"}, {"2026-01", "USD", "1.1", "monthly"}, {"2026-02", "USD", "1.3", "recurringExpenses"}}
	if err != nil || !reflect.DeepEqual(got, want) {
		t.Fatalf("quotes: %+v %v", got, err)
	}
	snapshot, _ := s.ExportData()
	copy := openTest(t)
	if err := copy.ImportData(snapshot); err != nil {
		t.Fatal(err)
	}
	restored, _ := copy.SavedRates()
	if !reflect.DeepEqual(restored, got) {
		t.Fatal("import changed saved quotes")
	}
}
