package storage

import (
	"reflect"
	"testing"
)

func TestExpenseGroupsSaveRoundOncePerGroupAndStayInTheirMonth(t *testing.T) {
	s := openTest(t)
	entries := []Expense{{"2026-01", "USD", "1", "2", "Laptop"}, {"2026-01", "RSD", "1", "2", "Phone"}, {"2026-01", "EUR", "50000", "1", "Holiday"}}
	groups := []RecurringExpenseGroup{{Name: "Electronics", EntryPositions: []int{1, 0}}, {Name: "Empty", EntryPositions: []int{}}}
	if err := s.PutExpenseGroups("2026-01", entries, groups); err != nil {
		t.Fatal(err)
	}
	if err := s.PutExpense("2026-02", []Expense{{"2026-02", "EUR", "100", "1", "Gift"}}); err != nil {
		t.Fatal(err)
	}
	months, err := s.Expenses()
	if err != nil || len(months) != 2 {
		t.Fatalf("expenses: %+v %v", months, err)
	}
	jan, feb := months[0], months[1]
	// 0.5 + 0.5 cents round once per group, not once per entry.
	if jan.TotalEURMinor != "50001" || jan.UngroupedTotalEURMinor != "50000" || len(jan.Groups) != 2 ||
		jan.Groups[0].TotalEURMinor != "1" || jan.Groups[1].TotalEURMinor != "0" || !reflect.DeepEqual(jan.Groups[0].EntryPositions, []int{1, 0}) {
		t.Fatalf("incorrect January groups: %+v", jan)
	}
	if feb.Groups == nil || len(feb.Groups) != 0 || feb.UngroupedTotalEURMinor != "100" {
		t.Fatalf("February should have no groups: %+v", feb)
	}

	before, err := s.ExportData()
	if err != nil || len(before.ExpenseGroups) != 1 || before.ExpenseGroups[0].Month != "2026-01" {
		t.Fatalf("export: %+v %v", before.ExpenseGroups, err)
	}
	copy := openTest(t)
	if err := copy.ImportData(before); err != nil {
		t.Fatal(err)
	}
	imported, err := copy.Expenses()
	if err != nil || !reflect.DeepEqual(months, imported) {
		t.Fatalf("roundtrip: %+v %v", imported, err)
	}
	after, err := copy.ExportData()
	if err != nil || !reflect.DeepEqual(before.ExpenseGroups, after.ExpenseGroups) {
		t.Fatalf("groups changed in export/import: %+v %v", after.ExpenseGroups, err)
	}

	// Saving without groups replaces the month's groups, like any omitted entry.
	if err := s.PutExpense("2026-01", entries); err != nil {
		t.Fatal(err)
	}
	months, _ = s.Expenses()
	if len(months[0].Groups) != 0 || months[0].UngroupedTotalEURMinor != "50001" {
		t.Fatalf("groups were not replaced: %+v", months[0])
	}
	if err := s.PutExpenseGroups("2026-01", entries, groups); err != nil {
		t.Fatal(err)
	}
	if err := s.DeleteFlowMonth("expenses", "2026-01"); err != nil {
		t.Fatal(err)
	}
	if err := s.PutExpense("2026-01", entries); err != nil {
		t.Fatal(err)
	}
	months, _ = s.Expenses()
	if len(months[0].Groups) != 0 {
		t.Fatalf("deleted month kept its groups: %+v", months[0])
	}
	if err := s.PutExpenseGroups("2026-01", entries, groups); err != nil {
		t.Fatal(err)
	}
	if err := s.ClearData(); err != nil {
		t.Fatal(err)
	}
	if exported, _ := s.ExportData(); len(exported.ExpenseGroups) != 0 {
		t.Fatal("clear retained expense groups")
	}
}

func TestExpenseGroupsRejectInvalidAssignmentsAtomically(t *testing.T) {
	s := openTest(t)
	entries := []Expense{{"2026-01", "EUR", "100", "1", "Car"}, {"2026-01", "EUR", "200", "1", "Sofa"}}
	good := []RecurringExpenseGroup{{Name: "Home", EntryPositions: []int{1}}}
	if err := s.PutExpenseGroups("2026-01", entries, good); err != nil {
		t.Fatal(err)
	}
	original, _ := s.Expenses()
	for name, groups := range map[string][]RecurringExpenseGroup{
		"duplicate name":    {{Name: "Home", EntryPositions: []int{0}}, {Name: "home", EntryPositions: []int{}}},
		"empty name":        {{Name: "", EntryPositions: []int{}}},
		"untrimmed name":    {{Name: " Home", EntryPositions: []int{}}},
		"missing positions": {{Name: "Home"}},
		"out of range":      {{Name: "Home", EntryPositions: []int{2}}},
		"negative position": {{Name: "Home", EntryPositions: []int{-1}}},
		"assigned twice":    {{Name: "Home", EntryPositions: []int{0}}, {Name: "Car", EntryPositions: []int{0}}},
		"repeated in group": {{Name: "Home", EntryPositions: []int{1, 1}}},
	} {
		if err := s.PutExpenseGroups("2026-01", []Expense{entries[0]}, groups); err == nil {
			t.Fatalf("%s: accepted invalid groups", name)
		}
		unchanged, _ := s.Expenses()
		if !reflect.DeepEqual(original, unchanged) {
			t.Fatalf("%s: rejected save changed data: %+v", name, unchanged)
		}
	}
}

func TestExpenseGroupImportValidation(t *testing.T) {
	s := openTest(t)
	entries := []Expense{{"2026-01", "EUR", "100", "1", "Car"}}
	if err := s.PutExpenseGroups("2026-01", entries, []RecurringExpenseGroup{{Name: "Transport", EntryPositions: []int{0}}}); err != nil {
		t.Fatal(err)
	}
	valid, err := s.ExportData()
	if err != nil {
		t.Fatal(err)
	}
	for name, mutate := range map[string]func(*TransferDocument){
		"older schema":      func(d *TransferDocument) { d.SchemaVersion = 8 },
		"unknown month":     func(d *TransferDocument) { d.ExpenseGroups[0].Month = "2026-05" },
		"invalid month":     func(d *TransferDocument) { d.ExpenseGroups[0].Month = "2026-13" },
		"duplicate month":   func(d *TransferDocument) { d.ExpenseGroups = append(d.ExpenseGroups, d.ExpenseGroups[0]) },
		"null groups":       func(d *TransferDocument) { d.ExpenseGroups[0].Groups = nil },
		"position too high": func(d *TransferDocument) { d.ExpenseGroups[0].Groups[0].EntryPositions = []int{1} },
	} {
		d := valid
		d.ExpenseGroups = []ExpenseGroupMonth{{Month: valid.ExpenseGroups[0].Month, Groups: []RecurringExpenseGroup{{Name: "Transport", EntryPositions: []int{0}}}}}
		mutate(&d)
		if err := ValidateTransfer(d); err == nil {
			t.Fatalf("%s: accepted invalid import", name)
		}
	}
	// A reviewed empty month may keep empty groups.
	if err := s.PutExpenseGroups("2026-02", []Expense{}, []RecurringExpenseGroup{{Name: "Later", EntryPositions: []int{}}}); err != nil {
		t.Fatal(err)
	}
	withEmpty, err := s.ExportData()
	if err != nil {
		t.Fatal(err)
	}
	copy := openTest(t)
	if err := copy.ImportData(withEmpty); err != nil {
		t.Fatal(err)
	}
	months, err := copy.Expenses()
	if err != nil || len(months) != 2 || len(months[1].Groups) != 1 || months[1].Groups[0].Name != "Later" {
		t.Fatalf("empty reviewed month lost its group: %+v %v", months, err)
	}
}

func TestExpenseImportUsesPerMonthPositions(t *testing.T) {
	s := openTest(t)
	if err := s.PutExpense("2026-01", []Expense{{"2026-01", "EUR", "100", "1", "A"}, {"2026-01", "EUR", "200", "1", "B"}}); err != nil {
		t.Fatal(err)
	}
	if err := s.PutExpenseGroups("2026-02", []Expense{{"2026-02", "EUR", "300", "1", "C"}, {"2026-02", "EUR", "400", "1", "D"}}, []RecurringExpenseGroup{{Name: "Second", EntryPositions: []int{1}}}); err != nil {
		t.Fatal(err)
	}
	exported, err := s.ExportData()
	if err != nil {
		t.Fatal(err)
	}
	copy := openTest(t)
	if err := copy.ImportData(exported); err != nil {
		t.Fatal(err)
	}
	months, err := copy.Expenses()
	if err != nil || len(months) != 2 || months[1].Groups[0].TotalEURMinor != "400" || months[1].UngroupedTotalEURMinor != "300" {
		t.Fatalf("imported group points at the wrong entry: %+v %v", months, err)
	}
}
