package finance

import "testing"

func TestRates(t *testing.T) {
	for input, want := range map[string]int64{"1": 100000000, "117.20": 11720000000, "0.00000001": 1, "48.50": 4850000000} {
		got, e := ParseRate(input)
		if e != nil || got != want {
			t.Fatalf("%q: %d %v", input, got, e)
		}
	}
	for _, bad := range []string{"0", "-1", "1.123456789", "NaN", "1e4", "0.00000000"} {
		if _, e := ParseRate(bad); e == nil {
			t.Fatal(bad)
		}
	}
}
func TestExactConversion(t *testing.T) {
	amount, e := TotalEURMinor([]Entry{{500000, RateScale}, {11720000, 11720000000}, {108000, 108000000}, {-1, RateScale}})
	if e != nil || amount != 699999 {
		t.Fatalf("got %d %v", amount, e)
	}
	// Two fractions of 0.5 cent each must total 1 cent, not 2 cents.
	v, e := TotalEURMinor([]Entry{{1, 200000000}, {1, 200000000}})
	if e != nil || v != 1 {
		t.Fatalf("combined rounding: %d %v", v, e)
	}
	v, e = TotalEURMinor([]Entry{{-1, 200000000}})
	if e != nil || v != -1 {
		t.Fatalf("negative rounding: %d %v", v, e)
	}
}
func TestPercent(t *testing.T) {
	v, ok, e := ChangePercentBasisPoints(700000, 650000)
	if e != nil || !ok || v != 769 {
		t.Fatalf("%v %v %v", v, ok, e)
	}
	_, ok, _ = ChangePercentBasisPoints(10, 0)
	if ok {
		t.Fatal("zero previous")
	}
}
func TestMonths(t *testing.T) {
	for _, s := range []string{"2026-10", "1900-01", "2200-12"} {
		if !ValidMonth(s) {
			t.Fatal(s)
		}
	}
	for _, s := range []string{"2026-00", "2026-13", "2026-1", "0000-01"} {
		if ValidMonth(s) {
			t.Fatal(s)
		}
	}
}

func TestPercentCannotOverflowForLargeNetWorthChanges(t *testing.T) {
	got, ok := ChangePercentBasisPointsString(9000000000000000000, 1)
	if !ok || got != "89999999999999999990000" {
		t.Fatalf("unexpected large percent: %q", got)
	}
	small, ok := ChangePercentBasisPointsString(-1, 0)
	if ok || small != "" { t.Fatal("zero previous month must not have percent") }
}
