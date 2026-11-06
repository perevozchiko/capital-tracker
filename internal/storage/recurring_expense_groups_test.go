package storage

import (
	"path/filepath"
	"reflect"
	"strings"
	"testing"
)

func TestRecurringExpenseGroupsInheritAndRoundOncePerGroup(t *testing.T) {
	s := openTest(t)
	jan := RecurringExpenseSnapshot{
		Month:   "2026-01",
		Entries: []Expense{{"2026-01", "USD", "1", "2", "Phone"}, {"2026-01", "RSD", "1", "2", "Internet"}, {"2026-01", "EUR", "100", "1", "Rent"}},
		Groups:  []RecurringExpenseGroup{{Name: "Services", EntryPositions: []int{1, 0}}, {Name: "Empty", EntryPositions: []int{}}},
	}
	if err := s.PutRecurringExpenseSnapshot(jan); err != nil {
		t.Fatal(err)
	}
	feb, err := s.RecurringExpense("2026-02")
	if err != nil || feb.InheritedFrom != jan.Month || feb.TotalEURMinor != "101" || feb.UngroupedTotalEURMinor != "100" || len(feb.Groups) != 2 || feb.Groups[0].TotalEURMinor != "1" || feb.Groups[1].TotalEURMinor != "0" || !reflect.DeepEqual(feb.Groups[0].EntryPositions, []int{1, 0}) {
		t.Fatalf("incorrect inherited groups or rounding: %+v %v", feb, err)
	}
	updated := RecurringExpenseSnapshot{Month: "2026-02", Entries: feb.Entries, Groups: []RecurringExpenseGroup{{Name: "Home", EntryPositions: []int{2}}, {Name: "Services", EntryPositions: []int{0, 1}}}}
	if err := s.PutRecurringExpenseSnapshot(updated); err != nil {
		t.Fatal(err)
	}
	unchanged, err := s.RecurringExpense(jan.Month)
	if err != nil || unchanged.Groups[0].Name != "Services" || unchanged.Groups[1].Name != "Empty" {
		t.Fatalf("saved January changed: %+v %v", unchanged, err)
	}
	mar, err := s.RecurringExpense("2026-03")
	if err != nil || mar.InheritedFrom != updated.Month || mar.Groups[0].Name != "Home" || mar.UngroupedTotalEURMinor != "0" {
		t.Fatalf("March did not inherit February: %+v %v", mar, err)
	}
	before, err := s.ExportData()
	if err != nil {
		t.Fatal(err)
	}
	if err := s.ClearData(); err != nil {
		t.Fatal(err)
	}
	if err := s.ImportData(before); err != nil {
		t.Fatal(err)
	}
	after, err := s.ExportData()
	if err != nil || !reflect.DeepEqual(before.RecurringExpenses, after.RecurringExpenses) {
		t.Fatalf("groups lost during export/import: %+v %v", after.RecurringExpenses, err)
	}
	if err := s.PutRecurringExpense("2026-03", []Expense{}); err != nil {
		t.Fatal(err)
	}
	empty, err := s.RecurringExpense("2026-04")
	if err != nil || len(empty.Entries) != 0 || len(empty.Groups) != 0 || empty.TotalEURMinor != "0" {
		t.Fatalf("empty snapshot retained expenses or groups: %+v %v", empty, err)
	}
}

func TestRecurringExpenseGroupsRejectInvalidAssignmentsAtomically(t *testing.T) {
	s := openTest(t)
	good := RecurringExpenseSnapshot{Month: "2026-01", Entries: []Expense{{"2026-01", "EUR", "100", "1", "Rent"}}, Groups: []RecurringExpenseGroup{{Name: "Home", EntryPositions: []int{0}}}}
	if err := s.PutRecurringExpenseSnapshot(good); err != nil {
		t.Fatal(err)
	}
	before, err := s.ExportData()
	if err != nil {
		t.Fatal(err)
	}
	cases := [][]RecurringExpenseGroup{
		{{Name: "", EntryPositions: []int{}}},
		{{Name: " Home", EntryPositions: []int{}}},
		{{Name: strings.Repeat("я", 101), EntryPositions: []int{}}},
		{{Name: "Home", EntryPositions: nil}},
		{{Name: "Home", EntryPositions: []int{-1}}},
		{{Name: "Home", EntryPositions: []int{1}}},
		{{Name: "Home", EntryPositions: []int{0, 0}}},
		{{Name: "Home", EntryPositions: []int{0}}, {Name: "Other", EntryPositions: []int{0}}},
		{{Name: "Home", EntryPositions: []int{}}, {Name: "home", EntryPositions: []int{}}},
	}
	for _, groups := range cases {
		broken := good
		broken.Groups = groups
		if err := s.PutRecurringExpenseSnapshot(broken); err == nil {
			t.Fatalf("accepted invalid groups: %+v", groups)
		}
		document := before
		document.RecurringExpenses = []RecurringExpenseSnapshot{broken}
		if err := s.ImportData(document); err == nil {
			t.Fatalf("accepted invalid import: %+v", groups)
		}
		after, err := s.ExportData()
		if err != nil || !reflect.DeepEqual(before.RecurringExpenses, after.RecurringExpenses) {
			t.Fatalf("invalid write changed groups: %+v %v", after.RecurringExpenses, err)
		}
	}
	legacy := before
	legacy.SchemaVersion = 6
	if err := s.ImportData(legacy); err == nil {
		t.Fatal("accepted groups in a v6 document")
	}
	legacy.RecurringExpenses = []RecurringExpenseSnapshot{{Month: good.Month, Entries: good.Entries}}
	if err := s.ImportData(legacy); err != nil {
		t.Fatalf("legacy v6 import rejected: %v", err)
	}
	got, err := s.RecurringExpense(good.Month)
	if err != nil || len(got.Groups) != 0 || got.UngroupedTotalEURMinor != "100" {
		t.Fatalf("legacy expenses not ungrouped: %+v %v", got, err)
	}
}

func TestRecurringExpenseGroupMigrationPreservesVersion6Snapshots(t *testing.T) {
	dir := t.TempDir()
	s, err := Open(dir)
	if err != nil {
		t.Fatal(err)
	}
	if err := s.PutRecurringExpense("2026-01", []Expense{{"2026-01", "USD", "11000", "1.1", "Internet"}}); err != nil {
		t.Fatal(err)
	}
	if err := s.PutRecurringExpense("2026-02", []Expense{}); err != nil {
		t.Fatal(err)
	}
	before, err := s.ExportData()
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.DB.Exec("DROP TABLE monthly_reviews; DROP TABLE recurring_expense_group_members; DROP TABLE recurring_expense_groups; DELETE FROM schema_migrations WHERE version>=7; PRAGMA user_version=6"); err != nil {
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
	after, err := s.ExportData()
	if err != nil || !reflect.DeepEqual(before.RecurringExpenses, after.RecurringExpenses) {
		t.Fatalf("migration changed snapshots: %+v %v", after.RecurringExpenses, err)
	}
	backups, err := filepath.Glob(s.Path + ".pre-migration-*")
	if err != nil || len(backups) == 0 {
		t.Fatalf("missing migration backup: %v %v", backups, err)
	}
}

func TestRecurringExpenseGroupWriteFailureRollsBackSnapshot(t *testing.T) {
	s := openTest(t)
	good := RecurringExpenseSnapshot{Month: "2026-01", Entries: []Expense{{"2026-01", "EUR", "100", "1", "Rent"}}, Groups: []RecurringExpenseGroup{{Name: "Home", EntryPositions: []int{0}}}}
	if err := s.PutRecurringExpenseSnapshot(good); err != nil {
		t.Fatal(err)
	}
	before, err := s.ExportData()
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.DB.Exec(`CREATE TRIGGER reject_group BEFORE INSERT ON recurring_expense_groups WHEN NEW.name='Rejected'
 BEGIN SELECT RAISE(ABORT,'test group write failure'); END`); err != nil {
		t.Fatal(err)
	}
	broken := good
	broken.Groups = []RecurringExpenseGroup{{Name: "Rejected", EntryPositions: []int{0}}}
	if err := s.PutRecurringExpenseSnapshot(broken); err == nil {
		t.Fatal("expected group write to fail")
	}
	document := before
	document.RecurringExpenses = []RecurringExpenseSnapshot{broken}
	if err := s.ImportData(document); err == nil {
		t.Fatal("expected group import to fail")
	}
	after, err := s.ExportData()
	if err != nil || !reflect.DeepEqual(before.RecurringExpenses, after.RecurringExpenses) {
		t.Fatalf("write failure partially replaced snapshot: %+v %v", after.RecurringExpenses, err)
	}
}
