package storage

import (
	"encoding/json"
	"errors"
	"testing"
)

func TestGroupsTotalsMovementAndJSONRoundTrip(t *testing.T) {
	s := openTest(t)
	cashGroup, err := s.CreateGroup("Cash")
	if err != nil {
		t.Fatal(err)
	}
	investGroup, err := s.CreateGroup("Investments")
	if err != nil {
		t.Fatal(err)
	}
	debtGroup, err := s.CreateGroup("Liabilities")
	if err != nil {
		t.Fatal(err)
	}
	if _, err = s.CreateGroup("cash"); !errors.Is(err, ErrConflict) {
		t.Fatalf("duplicate group name accepted: %v", err)
	}
	cash, err := s.CreateAccountInGroup("Bank", "EUR", "2026-01", &cashGroup.ID)
	if err != nil {
		t.Fatal(err)
	}
	broker, err := s.CreateAccountInGroup("Broker", "USD", "2026-01", &investGroup.ID)
	if err != nil {
		t.Fatal(err)
	}
	loan, err := s.CreateAccountInGroup("Loan", "EUR", "2026-01", &debtGroup.ID)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = s.CreateAccountInGroup("Invalid", "EUR", "2026-01", ptrGroupID(9999)); !errors.Is(err, ErrValidation) {
		t.Fatalf("unknown group accepted: %v", err)
	}
	if err = s.PutMonth("2026-01", MonthInput{
		Balances: []BalanceInput{{cash.ID, "100000"}, {broker.ID, "108000"}, {loan.ID, "-25000"}},
		Rates:    []RateInput{{"USD", "1.08"}},
	}); err != nil {
		t.Fatal(err)
	}
	check := func(expected map[int64]string) {
		t.Helper()
		summary, err := s.GroupsAt("2026-01")
		if err != nil {
			t.Fatal(err)
		}
		for _, group := range summary.Groups {
			value, present := expected[group.ID]
			if !present {
				continue
			}
			if !group.Complete || group.TotalEURMinor == nil || *group.TotalEURMinor != value {
				t.Fatalf("group %s: got %+v, want %q", group.Name, group.GroupTotal, value)
			}
		}
	}
	check(map[int64]string{cashGroup.ID: "100000", investGroup.ID: "100000", debtGroup.ID: "-25000"})
	originalMonth, err := s.Month("2026-01")
	if err != nil || !originalMonth.Complete || *originalMonth.TotalEURMinor != "175000" {
		t.Fatalf("bad original total: %+v %v", originalMonth, err)
	}
	if err = s.AssignAccounts([]AccountAssignment{{cash.ID, &investGroup.ID}, {cash.ID, &cashGroup.ID}, {loan.ID, &debtGroup.ID}}); !errors.Is(err, ErrValidation) {
		t.Fatalf("duplicate account assignment accepted: %v", err)
	}
	if err = s.AssignAccounts([]AccountAssignment{{cash.ID, &investGroup.ID}, {broker.ID, &investGroup.ID}, {loan.ID, &debtGroup.ID}}); err != nil {
		t.Fatal(err)
	}
	check(map[int64]string{investGroup.ID: "200000", debtGroup.ID: "-25000"})
	movedMonth, err := s.Month("2026-01")
	if err != nil || *movedMonth.TotalEURMinor != *originalMonth.TotalEURMinor {
		t.Fatalf("moving groups changed monthly net worth: %+v %v", movedMonth, err)
	}
	if err = s.ReorderGroups([]int64{debtGroup.ID, investGroup.ID, cashGroup.ID}); err != nil {
		t.Fatal(err)
	}
	groups, err := s.Groups()
	if err != nil || len(groups) != 3 || groups[0].ID != debtGroup.ID {
		t.Fatalf("group ordering: %+v %v", groups, err)
	}
	exported, err := s.ExportData()
	if err != nil || exported.SchemaVersion != 3 || len(exported.Groups) != 3 {
		t.Fatalf("groups missing from export: %+v %v", exported, err)
	}
	encoded, err := json.Marshal(exported)
	if err != nil {
		t.Fatal(err)
	}
	var decoded TransferDocument
	if err = json.Unmarshal(encoded, &decoded); err != nil {
		t.Fatal(err)
	}
	if err = s.ImportData(decoded); err != nil {
		t.Fatal(err)
	}
	accounts, err := s.Accounts()
	if err != nil || accounts[0].GroupID == nil || *accounts[0].GroupID != investGroup.ID {
		t.Fatalf("group lost after JSON import: %+v %v", accounts, err)
	}
	if err = s.DeleteGroup(debtGroup.ID); err != nil {
		t.Fatal(err)
	}
	summary, err := s.GroupsAt("2026-01")
	if err != nil || !summary.Ungrouped.Complete || *summary.Ungrouped.TotalEURMinor != "-25000" {
		t.Fatalf("deleting group lost loan balance: %+v %v", summary, err)
	}
}

func ptrGroupID(id int64) *int64 { return &id }

func TestGroupsPartialBalanceAndLegacyImport(t *testing.T) {
	s := openTest(t)
	group, err := s.CreateGroup("Cash")
	if err != nil {
		t.Fatal(err)
	}
	one, err := s.CreateAccountInGroup("Account one", "EUR", "2026-01", &group.ID)
	if err != nil {
		t.Fatal(err)
	}
	two, err := s.CreateAccountInGroup("Account two", "EUR", "2026-01", &group.ID)
	if err != nil {
		t.Fatal(err)
	}
	if err = s.PutMonth("2026-01", MonthInput{Balances: []BalanceInput{{one.ID, "10000"}}, Rates: []RateInput{}}); err != nil {
		t.Fatal(err)
	}
	summary, err := s.GroupsAt("2026-01")
	if err != nil || summary.Groups[0].Complete || summary.Groups[0].TotalEURMinor != nil {
		t.Fatalf("partial group exposed misleading total: %+v %v", summary, err)
	}
	if err = s.PutMonth("2026-01", MonthInput{Balances: []BalanceInput{{one.ID, "10000"}, {two.ID, "0"}}, Rates: []RateInput{}}); err != nil {
		t.Fatal(err)
	}
	snapshot, err := s.ExportData()
	if err != nil {
		t.Fatal(err)
	}
	snapshot.SchemaVersion = 1
	snapshot.Groups = nil
	for i := range snapshot.Accounts {
		snapshot.Accounts[i].GroupID = nil
	}
	if err = s.ImportData(snapshot); err != nil {
		t.Fatalf("legacy v1 import failed: %v", err)
	}
	after, err := s.Month("2026-01")
	if err != nil || !after.Complete || *after.TotalEURMinor != "10000" {
		t.Fatalf("legacy import changed balances: %+v %v", after, err)
	}
	groups, err := s.Groups()
	if err != nil || len(groups) != 0 {
		t.Fatalf("legacy import left groups: %+v %v", groups, err)
	}
}

func TestArchivedAccountsUseVirtualGroupWithoutLosingOriginalGroup(t *testing.T) {
	s := openTest(t)
	group, err := s.CreateGroup("Savings")
	if err != nil {
		t.Fatal(err)
	}
	a, err := s.CreateAccountInGroup("Bank", "EUR", "2026-01", &group.ID)
	if err != nil {
		t.Fatal(err)
	}
	if err = s.PutMonth("2026-01", MonthInput{
		Balances: []BalanceInput{{a.ID, "10000"}},
		Rates:    []RateInput{},
	}); err != nil {
		t.Fatal(err)
	}
	if err = s.PutMonth("2026-02", MonthInput{Balances: []BalanceInput{{a.ID, "0"}}}); err != nil {
		t.Fatal(err)
	}
	if err = s.ArchiveAccount(a.ID, "2026-03"); err != nil {
		t.Fatal(err)
	}
	summary, err := s.GroupsAt("2026-01")
	if err != nil {
		t.Fatal(err)
	}
	if summary.Groups[0].TotalEURMinor != nil ||
		!summary.Archive.Complete || summary.Archive.TotalEURMinor == nil ||
		*summary.Archive.TotalEURMinor != "10000" {
		t.Fatalf("unexpected archived group totals: %+v", summary)
	}
	if err = s.RestoreAccount(a.ID, "2026-03"); err != nil {
		t.Fatal(err)
	}
	restored, err := s.account(a.ID)
	if err != nil || restored.GroupID == nil || *restored.GroupID != group.ID || restored.ArchivedFromMonth != nil {
		t.Fatalf("restoration lost the original group: %+v %v", restored, err)
	}
	summary, err = s.GroupsAt("2026-01")
	if err != nil || summary.Archive.TotalEURMinor != nil ||
		!summary.Groups[0].Complete || *summary.Groups[0].TotalEURMinor != "10000" {
		t.Fatalf("unexpected restored group totals: %+v %v", summary, err)
	}
}
