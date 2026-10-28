package storage

import (
	"errors"
	"testing"
)

func TestOverflowRejectedBeforeWritingMonth(t *testing.T) {
	s := openTest(t)
	a, err := s.CreateAccount("Large USD account", "USD", "2026-09")
	if err != nil {
		t.Fatal(err)
	}
	input := MonthInput{
		Balances: []BalanceInput{{AccountID: a.ID, AmountMinor: "9000000000000000"}},
		Rates:    []RateInput{{Currency: "USD", Rate: "0.00000001"}},
	}
	err = s.PutMonth("2026-09", input)
	if !errors.Is(err, ErrValidation) {
		t.Fatalf("expected validation error, got %v", err)
	}
	var domain *DomainError
	if !errors.As(err, &domain) || domain.Field != "total_eur_minor" {
		t.Fatalf("wrong validation field: %v", err)
	}
	month, err := s.Month("2026-09")
	if err != nil || month.Exists {
		t.Fatalf("overflowing month was persisted: %+v %v", month, err)
	}
}

func TestHistorySkipsLegacyOverflowButPreservesOtherMonths(t *testing.T) {
	s := openTest(t)
	a, err := s.CreateAccount("USD", "USD", "2026-09")
	if err != nil {
		t.Fatal(err)
	}
	if err := s.PutMonth("2026-09", MonthInput{
		Balances: []BalanceInput{{AccountID: a.ID, AmountMinor: "100"}},
		Rates:    []RateInput{{Currency: "USD", Rate: "1"}},
	}); err != nil {
		t.Fatal(err)
	}
	if err := s.CreateMonth("2026-10"); err != nil {
		t.Fatal(err)
	}
	if _, err := s.DB.Exec("INSERT INTO monthly_balances(account_id, month, amount_minor, updated_at) VALUES(?, ?, ?, ?)", a.ID, "2026-10", 9000000000000000, now()); err != nil {
		t.Fatal(err)
	}
	if _, err := s.DB.Exec("INSERT INTO exchange_rates(month, currency, rate_scaled, updated_at) VALUES(?, ?, ?, ?)", "2026-10", "USD", 1, now()); err != nil {
		t.Fatal(err)
	}
	history, err := s.History()
	if err != nil {
		t.Fatal(err)
	}
	if len(history) != 2 || !history[0].Complete || history[1].Complete || history[1].TotalEURMinor != nil {
		t.Fatalf("legacy month damaged history: %+v", history)
	}
	_, err = s.Month("2026-10")
	if !errors.Is(err, ErrValidation) {
		t.Fatalf("legacy overflow must have validation classification, got %v", err)
	}
}
