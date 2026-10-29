package storage

import (
	"fmt"
	"testing"
)

func assertDashboardChange(t *testing.T, s *Store, month, previous, total, delta, percent string, columns int) {
	t.Helper()
	d, err := s.DashboardColumns(month, columns)
	if err != nil {
		t.Fatal(err)
	}
	check := func(name string, got *string, want string) {
		t.Helper()
		if want == "" {
			if got != nil {
				t.Fatalf("%s: got %q, want nil", name, *got)
			}
		} else if got == nil || *got != want {
			t.Fatalf("%s: got %v, want %q", name, got, want)
		}
	}
	if d.Month.Month != month {
		t.Fatalf("selected month = %s", d.Month.Month)
	}
	if d.Previous == nil || d.Previous.Month != previous {
		t.Fatalf("previous = %+v, want %s", d.Previous, previous)
	}
	check("total", d.Month.TotalEURMinor, total)
	check("delta", d.ChangeMinor, delta)
	check("percent", d.ChangePercentBP, percent)
}

func TestDashboardUsesAdjacentMonthRegardlessOfHistoryOrColumns(t *testing.T) {
	s := openTest(t)
	a, err := s.CreateAccount("EUR", "EUR", "2026-10")
	if err != nil {
		t.Fatal(err)
	}
	save := func(month, amount string) {
		t.Helper()
		if err := s.PutMonth(month, MonthInput{Balances: []BalanceInput{{a.ID, amount}}}); err != nil {
			t.Fatal(err)
		}
	}
	// Deliberately insert out of chronological order, including a future snapshot.
	save("2027-02", "12345678")
	save("2026-12", "5122180")
	save("2026-10", "62100")
	save("2027-01", "5100000")
	save("2026-11", "5000000")
	for _, columns := range []int{1, 6, 12, 24, 120} {
		t.Run(fmt.Sprint(columns), func(t *testing.T) {
			assertDashboardChange(t, s, "2026-12", "2026-11", "5122180", "122180", "244", columns)
			assertDashboardChange(t, s, "2027-01", "2026-12", "5100000", "-22180", "-43", columns)
			assertDashboardChange(t, s, "2026-10", "2026-09", "62100", "", "", columns)
		})
	}
	// Editing the first month must not change December's comparison.
	save("2026-10", "99900")
	assertDashboardChange(t, s, "2026-12", "2026-11", "5122180", "122180", "244", 12)
	// Editing the immediate predecessor must update both displayed metrics.
	save("2026-11", "4000000")
	assertDashboardChange(t, s, "2026-12", "2026-11", "5122180", "1122180", "2805", 12)
	save("2026-12", "4000000")
	assertDashboardChange(t, s, "2026-12", "2026-11", "4000000", "0", "0", 12)
	if err := s.DeleteMonth("2026-11"); err != nil {
		t.Fatal(err)
	}
	// Never fall back to October when November is missing or incomplete.
	assertDashboardChange(t, s, "2026-12", "2026-11", "4000000", "", "", 12)
	if err := s.CreateMonth("2026-11"); err != nil {
		t.Fatal(err)
	}
	assertDashboardChange(t, s, "2026-12", "2026-11", "4000000", "", "", 12)
	save("2026-11", "0")
	assertDashboardChange(t, s, "2026-12", "2026-11", "4000000", "4000000", "", 12)
	save("2026-12", "0")
	assertDashboardChange(t, s, "2026-12", "2026-11", "0", "0", "", 12)
	save("2026-11", "-10000")
	save("2026-12", "-5000")
	assertDashboardChange(t, s, "2026-12", "2026-11", "-5000", "5000", "5000", 12)
	if err := s.PutMonth("2026-12", MonthInput{}); err != nil {
		t.Fatal(err)
	}
	assertDashboardChange(t, s, "2026-12", "2026-11", "", "", "", 12)
	if err := s.DeleteMonth("2026-12"); err != nil {
		t.Fatal(err)
	}
	assertDashboardChange(t, s, "2026-12", "2026-11", "", "", "", 12)
}

func TestDashboardUsesEachMonthsRatesAndRoundedTotals(t *testing.T) {
	s := openTest(t)
	a, err := s.CreateAccount("USD A", "USD", "2026-10")
	if err != nil {
		t.Fatal(err)
	}
	b, err := s.CreateAccount("USD B", "USD", "2026-10")
	if err != nil {
		t.Fatal(err)
	}
	save := func(month, rate string) {
		t.Helper()
		if err := s.PutMonth(month, MonthInput{
			Balances: []BalanceInput{{a.ID, "1"}, {b.ID, "1"}},
			Rates:    []RateInput{{"USD", rate}},
		}); err != nil {
			t.Fatal(err)
		}
	}
	save("2026-10", "2")    // Two half-cents sum to one cent before rounding.
	save("2026-11", "1.25") // 1.6 cents rounds to two cents.
	assertDashboardChange(t, s, "2026-11", "2026-10", "2", "1", "10000", 12)
	// Missing FX must suppress the comparison rather than use another month's rate.
	if err := s.PutMonth("2026-10", MonthInput{Balances: []BalanceInput{{a.ID, "1"}, {b.ID, "1"}}}); err != nil {
		t.Fatal(err)
	}
	assertDashboardChange(t, s, "2026-11", "2026-10", "2", "", "", 12)
}

func TestDashboardChangePreservesLargeIntegerPrecision(t *testing.T) {
	s := openTest(t)
	a, err := s.CreateAccount("USD", "USD", "2026-10")
	if err != nil {
		t.Fatal(err)
	}
	for _, tc := range []struct{ month, amount string }{
		{"2026-10", "-9000000000000000"},
		{"2026-11", "9000000000000000"},
	} {
		if err := s.PutMonth(tc.month, MonthInput{Balances: []BalanceInput{{a.ID, tc.amount}}, Rates: []RateInput{{"USD", "0.001"}}}); err != nil {
			t.Fatal(err)
		}
	}
	// Both totals fit int64; their difference does not.
	assertDashboardChange(t, s, "2026-11", "2026-10", "9000000000000000000", "18000000000000000000", "20000", 12)
}
