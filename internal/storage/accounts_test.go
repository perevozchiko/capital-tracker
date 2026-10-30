package storage

import (
	"errors"
	"reflect"
	"testing"
)

func TestArchiveAccountRequiresZeroBalance(t *testing.T) {
	for _, tc := range []struct {
		name     string
		balances []string // Empty strings represent missing balances.
		allowed  bool
	}{
		{"no history", nil, false},
		{"missing balance", []string{""}, false},
		{"positive balance", []string{"100"}, false},
		{"one minor unit", []string{"1"}, false},
		{"negative balance", []string{"-1"}, false},
		{"old zero then nonzero", []string{"0", "100"}, false},
		{"old zero then missing", []string{"0", ""}, false},
		{"old nonzero then missing", []string{"100", ""}, false},
		{"zero balance", []string{"0"}, true},
		{"nonzero then zero", []string{"100", "0"}, true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			s := openTest(t)
			a, err := s.CreateAccount("Bank", "EUR", "2026-01")
			if err != nil {
				t.Fatal(err)
			}
			for i, value := range tc.balances {
				input := MonthInput{}
				if value != "" {
					input.Balances = []BalanceInput{{a.ID, value}}
				}
				if err = s.PutMonth([]string{"2026-01", "2026-02"}[i], input); err != nil {
					t.Fatal(err)
				}
			}
			before, err := s.ExportData()
			if err != nil {
				t.Fatal(err)
			}
			err = s.ArchiveAccount(a.ID, "2026-03")
			if tc.allowed {
				if err != nil {
					t.Fatal(err)
				}
				archived, err := s.account(a.ID)
				if err != nil || archived.ArchivedFromMonth == nil || *archived.ArchivedFromMonth != "2026-03" {
					t.Fatalf("account not archived: %+v %v", archived, err)
				}
				active, err := s.ActiveAt("2026-03")
				if err != nil || len(active) != 0 {
					t.Fatalf("archived account still active: %+v %v", active, err)
				}
			} else {
				var domain *DomainError
				if !errors.Is(err, ErrConflict) || !errors.As(err, &domain) || domain.Reason != "archive_requires_zero_balance" {
					t.Fatalf("expected zero balance conflict, got %v", err)
				}
			}
			after, err := s.ExportData()
			if err != nil {
				t.Fatal(err)
			}
			if tc.allowed {
				if !reflect.DeepEqual(before.Balances, after.Balances) || !reflect.DeepEqual(before.Months, after.Months) {
					t.Fatal("archiving changed historical balances or months")
				}
			} else {
				before.ExportedAt, after.ExportedAt = "", ""
				if !reflect.DeepEqual(before, after) {
					t.Fatal("rejected archive mutated stored data")
				}
			}
		})
	}
}
