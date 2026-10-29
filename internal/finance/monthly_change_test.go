package finance

import (
	"math"
	"strconv"
	"testing"
)

func TestMonthlyChangePercentExactCases(t *testing.T) {
	for _, tc := range []struct {
		name              string
		current, previous int64
		want              string
	}{
		{"screenshot", 5122180, 62100, "814828"},
		{"immediate predecessor", 5122180, 5000000, "244"},
		{"unchanged", 5000000, 5000000, "0"},
		{"loss", 5100000, 5122180, "-43"},
		{"to zero", 0, 100, "-10000"},
		{"debt improves", -50, -100, "5000"},
		{"debt worsens", -150, -100, "-5000"},
		{"debt to assets", 100, -100, "20000"},
		{"assets to debt", -100, 100, "-20000"},
		{"positive half rounds away", 20001, 20000, "1"},
		{"negative half rounds away", 19999, 20000, "-1"},
		{"below half", 30001, 30000, "0"},
		{"negative below half", 29999, 30000, "0"},
		{"above safe JS integer", 9007199254740993, 9007199254740992, "0"},
		{"int64 difference overflow", math.MaxInt64, math.MinInt64, "20000"},
		{"int64 reverse difference overflow", math.MinInt64, math.MaxInt64, "-20000"},
		{"percent beyond int64", math.MaxInt64, 1, "92233720368547758060000"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			got, ok := ChangePercentBasisPointsString(tc.current, tc.previous)
			if !ok || got != tc.want {
				t.Fatalf("got %q, available=%v; want %q", got, ok, tc.want)
			}
			small, smallOK, err := ChangePercentBasisPoints(tc.current, tc.previous)
			expected, parseErr := strconv.ParseInt(tc.want, 10, 64)
			if parseErr != nil {
				if err == nil {
					t.Fatal("bounded percent must report overflow")
				}
			} else if err != nil || !smallOK || small != expected {
				t.Fatalf("bounded percent = %d, %v, %v; want %d", small, smallOK, err, expected)
			}
		})
	}
	for _, current := range []int64{-100, 0, 100, math.MaxInt64} {
		if got, ok := ChangePercentBasisPointsString(current, 0); ok || got != "" {
			t.Fatalf("zero base: %q, %v", got, ok)
		}
		if got, ok, err := ChangePercentBasisPoints(current, 0); ok || got != 0 || err != nil {
			t.Fatalf("bounded zero base: %d, %v, %v", got, ok, err)
		}
	}
}
