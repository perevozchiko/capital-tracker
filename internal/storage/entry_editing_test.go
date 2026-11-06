package storage

import (
	"reflect"
	"testing"
)

func TestRecurringExpenseRenameAndAmountEditPreservePast(t *testing.T) {
	s := openTest(t)
	original := RecurringExpenseSnapshot{
		Month:   "2026-01",
		Entries: []Expense{{Month: "2026-01", Currency: "USD", AmountMinor: "11000", Rate: "1.1", Name: "Rent"}},
		Groups:  []RecurringExpenseGroup{{Name: "Home", EntryPositions: []int{0}}},
	}
	if err := s.PutRecurringExpenseSnapshot(original); err != nil {
		t.Fatal(err)
	}
	past, err := s.RecurringExpense("2026-10")
	if err != nil {
		t.Fatal(err)
	}
	current, err := s.RecurringExpense("2026-11")
	if err != nil {
		t.Fatal(err)
	}
	current.Entries[0].Name = "New rent"
	current.Entries[0].AmountMinor = "22055"
	edited := RecurringExpenseSnapshot{Month: current.Month, Entries: current.Entries, Groups: original.Groups}
	if err := s.PutRecurringExpenseSnapshot(edited); err != nil {
		t.Fatal(err)
	}
	for _, month := range []string{"2026-01", "2026-10", "2026-11", "2026-12", "2027-01"} {
		got, err := s.RecurringExpense(month)
		if err != nil {
			t.Fatal(err)
		}
		want := Expense{Month: month, Currency: "USD", AmountMinor: "11000", Rate: "1.1", Name: "Rent"}
		total := "10000"
		if month >= "2026-11" {
			want.Name, want.AmountMinor, total = "New rent", "22055", "20050"
		}
		if len(got.Entries) != 1 || got.Entries[0] != want || got.TotalEURMinor != total || len(got.Groups) != 1 || got.Groups[0].TotalEURMinor != total || !reflect.DeepEqual(got.Groups[0].EntryPositions, []int{0}) {
			t.Fatalf("%s: edit leaked across months or lost group: %+v", month, got)
		}
	}
	after, err := s.RecurringExpense("2026-10")
	if err != nil || !reflect.DeepEqual(past, after) {
		t.Fatalf("past changed: %+v, %v", after, err)
	}
	history, err := s.RecurringExpenses()
	if err != nil || len(history) != 2 {
		t.Fatalf("reads created snapshots: %+v, %v", history, err)
	}
}

func TestIncomeAndExpenseEditsAffectOnlySelectedMonth(t *testing.T) {
	for _, section := range []string{"income", "expense"} {
		t.Run(section, func(t *testing.T) {
			s := openTest(t)
			for _, month := range []string{"2026-10", "2026-11", "2026-12"} {
				var err error
				if section == "income" {
					err = s.PutIncome(month, []Income{{Month: month, Currency: "USD", AmountMinor: "11000", Rate: "1.1", Name: "Original"}})
				} else {
					err = s.PutExpense(month, []Expense{{Month: month, Currency: "USD", AmountMinor: "11000", Rate: "1.1", Name: "Original"}})
				}
				if err != nil {
					t.Fatal(err)
				}
			}
			var err error
			if section == "income" {
				err = s.PutIncome("2026-11", []Income{{Month: "2026-11", Currency: "USD", AmountMinor: "22055", Rate: "1.1", Name: "Updated"}})
			} else {
				err = s.PutExpense("2026-11", []Expense{{Month: "2026-11", Currency: "USD", AmountMinor: "22055", Rate: "1.1", Name: "Updated"}})
			}
			if err != nil {
				t.Fatal(err)
			}
			data, err := s.ExportData()
			if err != nil {
				t.Fatal(err)
			}
			entries := data.Expenses
			if section == "income" {
				entries = []Expense{}
				for _, entry := range data.Incomes {
					entries = append(entries, Expense(entry))
				}
			}
			if len(entries) != 3 {
				t.Fatalf("wrong entry count: %+v", entries)
			}
			for _, entry := range entries {
				wantName, wantAmount := "Original", "11000"
				if entry.Month == "2026-11" {
					wantName, wantAmount = "Updated", "22055"
				}
				if entry.Name != wantName || entry.AmountMinor != wantAmount || entry.Currency != "USD" || entry.Rate != "1.1" {
					t.Fatalf("wrong edited month: %+v", entry)
				}
			}
		})
	}
}
