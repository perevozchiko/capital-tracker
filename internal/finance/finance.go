// Package finance performs exact financial calculations without floats.
package finance

import (
	"errors"
	"fmt"
	"math/big"
	"regexp"
	"strconv"
	"strings"
)

const RateScale int64 = 100000000
const MaxAbsMinor int64 = 9000000000000000
const MaxRateScaled int64 = 10000000000000000

var currencySet = map[string]bool{"EUR": true, "USD": true, "RSD": true, "RUB": true, "TRY": true}
var ratePattern = regexp.MustCompile(`^[0-9]+(?:\.[0-9]{1,8})?$`)
var monthPattern = regexp.MustCompile(`^(\d{4})-(0[1-9]|1[0-2])$`)

func ValidCurrency(s string) bool { return currencySet[s] }
func ValidMonth(s string) bool {
	return monthPattern.MatchString(s) && s >= "1900-01" && s <= "2200-12"
}

func ParseMinor(s string) (int64, error) {
	if s == "" || strings.TrimSpace(s) != s {
		return 0, errors.New("invalid monetary amount")
	}
	v, err := strconv.ParseInt(s, 10, 64)
	if err != nil || v < -MaxAbsMinor || v > MaxAbsMinor {
		return 0, errors.New("amount outside supported range")
	}
	return v, nil
}

// ParseRate parses an exact positive rate with at most eight decimals.
func ParseRate(s string) (int64, error) {
	if !ratePattern.MatchString(s) {
		return 0, errors.New("exchange rate must have at most eight decimal places")
	}
	parts := strings.SplitN(s, ".", 2)
	major, ok := new(big.Int).SetString(parts[0], 10)
	if !ok {
		return 0, errors.New("invalid exchange rate")
	}
	whole := new(big.Int).Mul(major, big.NewInt(RateScale))
	if len(parts) == 2 {
		decimals := parts[1] + strings.Repeat("0", 8-len(parts[1]))
		minor, _ := new(big.Int).SetString(decimals, 10)
		whole.Add(whole, minor)
	}
	if !whole.IsInt64() || whole.Sign() <= 0 || whole.Int64() > MaxRateScaled {
		return 0, errors.New("exchange rate outside supported range")
	}
	return whole.Int64(), nil
}

func RateString(rate int64) string {
	whole := rate / RateScale
	frac := rate % RateScale
	if frac == 0 {
		return strconv.FormatInt(whole, 10)
	}
	return strings.TrimRight(fmt.Sprintf("%d.%08d", whole, frac), "0")
}

// Entry is an account balance, in minor units, with a scaled exchange rate.
// EUR uses RateScale. Missing entries are excluded by the caller and make a month incomplete.
type Entry struct {
	Amount int64
	Rate   int64
}

// RoundRat rounds the exact rational to the nearest integer; ties go away from zero.
func RoundRat(r *big.Rat) (int64, error) {
	numerator := new(big.Int).Abs(r.Num())
	denominator := r.Denom()
	q, rem := new(big.Int).QuoRem(numerator, denominator, new(big.Int))
	if new(big.Int).Mul(rem, big.NewInt(2)).Cmp(denominator) >= 0 {
		q.Add(q, big.NewInt(1))
	}
	if r.Sign() < 0 {
		q.Neg(q)
	}
	if !q.IsInt64() {
		return 0, errors.New("total exceeds int64")
	}
	return q.Int64(), nil
}

// TotalEURMinor sums exact EUR-cent equivalents before rounding once.
func TotalEURMinor(entries []Entry) (int64, error) {
	total := new(big.Rat)
	for _, e := range entries {
		if e.Rate <= 0 {
			return 0, errors.New("missing or invalid exchange rate")
		}
		term := new(big.Rat).SetFrac(new(big.Int).Mul(big.NewInt(e.Amount), big.NewInt(RateScale)), big.NewInt(e.Rate))
		total.Add(total, term)
	}
	return RoundRat(total)
}

// ChangePercentBasisPoints returns percentage * 100 (two fractional percentage places).
// The rounded monthly EUR-cent totals are used so displayed percent matches displayed totals.
func ChangePercentBasisPoints(current, previous int64) (int64, bool, error) {
	if previous == 0 {
		return 0, false, nil
	}
	diff := new(big.Int).Sub(big.NewInt(current), big.NewInt(previous))
	d := new(big.Int).Abs(big.NewInt(previous))
	pct := new(big.Rat).SetFrac(new(big.Int).Mul(diff, big.NewInt(10000)), d)
	out, err := RoundRat(pct)
	return out, true, err
}
