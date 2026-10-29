package storage

import (
	"errors"
	"testing"
)

func TestDeleteMonthRemovesSnapshotAndUnblocksAccountChanges(t *testing.T) {
	s := openTest(t)
	a, err := s.CreateAccount("Savings", "EUR", "2026-09")
	if err != nil {
		t.Fatal(err)
	}
	if err := s.PutMonth("2026-09", MonthInput{Balances: []BalanceInput{{AccountID: a.ID, AmountMinor: "12345"}}}); err != nil {
		t.Fatal(err)
	}
	if err := s.CreateMonth("2099-01"); err != nil {
		t.Fatal(err)
	}
	if _, err := s.CreateAccount("Cash", "USD", "2026-10"); !errors.Is(err, ErrConflict) {
		t.Fatalf("expected future month conflict: %v", err)
	}
	if err := s.DeleteMonth("2099-01"); err != nil {
		t.Fatal(err)
	}
	if _, err := s.CreateAccount("Cash", "USD", "2026-10"); err != nil {
		t.Fatalf("creation remained blocked after deleting future month: %v", err)
	}
	if err := s.DeleteMonth("2026-09"); err != nil {
		t.Fatal(err)
	}
	d, err := s.Month("2026-09")
	if err != nil || d.Exists || len(d.Balances) != 0 || d.TotalEURMinor != nil {
		t.Fatalf("deleted month still exists: %+v %v", d, err)
	}
	months, err := s.Months()
	if err != nil || len(months) != 0 {
		t.Fatalf("expected no months, got %+v %v", months, err)
	}
	if err := s.DeleteMonth("2026-09"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("deleting absent month: %v", err)
	}
	if err := s.DeleteMonth("2026-13"); !errors.Is(err, ErrValidation) {
		t.Fatalf("invalid month: %v", err)
	}
}

func TestDashboardColumnBounds(t *testing.T) {
	s := openTest(t)
	for _, n := range []int{0, -1, 121} {
		if _, err := s.DashboardColumns("2026-10", n); !errors.Is(err, ErrValidation) {
			t.Fatalf("columns=%d: %v", n, err)
		}
	}
	d, err := s.DashboardColumns("2026-10", 24)
	if err != nil || len(d.Columns) != 24 {
		t.Fatalf("expected 24 columns, got %d, err %v", len(d.Columns), err)
	}
}
