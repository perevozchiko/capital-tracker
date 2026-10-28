package finance

import (
	"math"
	"math/big"
	"testing"
)

func TestRateBoundariesAndRoundTrip(t *testing.T) {
	for _, tc := range []struct {
		input string
		want  int64
	}{
		{"0.00000001", 1}, {"100000000", MaxRateScaled}, {"001.23000000", 123000000},
	} {
		got, err := ParseRate(tc.input)
		if err != nil || got != tc.want {
			t.Fatalf("ParseRate(%q) = %d, %v", tc.input, got, err)
		}
		roundTrip, err := ParseRate(RateString(got))
		if err != nil || roundTrip != got {
			t.Fatalf("round trip %q: %d %v", tc.input, roundTrip, err)
		}
	}
	for _, input := range []string{"100000000.00000001", ".1", "1.", " 1", "+1", "1e3", "0.00000000"} {
		if _, err := ParseRate(input); err == nil {
			t.Errorf("accepted %q", input)
		}
	}
}

func TestMinorLimits(t *testing.T) {
	for _, input := range []string{"9000000000000000", "-9000000000000000", "0"} {
		if _, err := ParseMinor(input); err != nil {
			t.Errorf("rejected %q: %v", input, err)
		}
	}
	for _, input := range []string{"9000000000000001", "-9000000000000001", "1.0", " 1", "", "9223372036854775808"} {
		if _, err := ParseMinor(input); err == nil {
			t.Errorf("accepted %q", input)
		}
	}
}

func TestRoundingAndConversionEdges(t *testing.T) {
	for _, tc := range []struct{ n, d, want int64 }{{1, 3, 0}, {1, 2, 1}, {-1, 2, -1}, {-1, 3, 0}, {3, 2, 2}, {-3, 2, -2}} {
		got, err := RoundRat(big.NewRat(tc.n, tc.d))
		if err != nil || got != tc.want {
			t.Errorf("%d/%d = %d, %v", tc.n, tc.d, got, err)
		}
	}
	if _, err := RoundRat(new(big.Rat).SetInt(new(big.Int).Add(big.NewInt(math.MaxInt64), big.NewInt(1)))); err == nil {
		t.Error("expected overflow")
	}
	if _, err := TotalEURMinor([]Entry{{Amount: 1, Rate: 0}}); err == nil {
		t.Error("accepted missing rate")
	}
	if got, err := TotalEURMinor([]Entry{{1, 2 * RateScale}, {-1, 2 * RateScale}}); err != nil || got != 0 {
		t.Fatalf("cancellation = %d, %v", got, err)
	}
}

func TestPercentSignsAndConsistency(t *testing.T) {
	for _, tc := range []struct {
		current, previous int64
		want              string
	}{{150, 100, "5000"}, {50, 100, "-5000"}, {0, -100, "10000"}, {-150, -100, "-5000"}} {
		got, ok := ChangePercentBasisPointsString(tc.current, tc.previous)
		small, smallOK, err := ChangePercentBasisPoints(tc.current, tc.previous)
		if !ok || !smallOK || err != nil || got != tc.want || big.NewInt(small).String() != got {
			t.Errorf("%d/%d: %q %d %v", tc.current, tc.previous, got, small, err)
		}
	}
}
