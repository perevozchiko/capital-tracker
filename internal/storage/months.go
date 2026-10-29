package storage

import (
	"database/sql"
	"sort"
	"strconv"
	"strings"

	"github.com/perevozchiko/capital-tracker/internal/finance"
)

func (s *Store) LatestMonth() (string, error) {
	var m sql.NullString
	e := s.DB.QueryRow("SELECT MAX(month) FROM months").Scan(&m)
	return m.String, e
}

type Month struct {
	Month     string `json:"month"`
	CreatedAt string `json:"created_at"`
	UpdatedAt string `json:"updated_at"`
}

func (s *Store) Months() ([]Month, error) {
	rows, e := s.DB.Query("SELECT month,created_at,updated_at FROM months ORDER BY month")
	if e != nil {
		return nil, e
	}
	defer rows.Close()
	out := []Month{}
	for rows.Next() {
		var m Month
		if e = rows.Scan(&m.Month, &m.CreatedAt, &m.UpdatedAt); e != nil {
			return nil, e
		}
		out = append(out, m)
	}
	return out, rows.Err()
}

// DeleteMonth deliberately discards a snapshot and all associated balances/rates.
// Foreign-key ON DELETE CASCADE removes dependent entries in the same transaction.
// It never modifies adjacent months or account activity periods.
func (s *Store) DeleteMonth(month string) error {
	s.writeMu.Lock()
	defer s.writeMu.Unlock()
	if !finance.ValidMonth(month) {
		return invalid("month")
	}
	tx, err := s.DB.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	result, err := tx.Exec("DELETE FROM months WHERE month=?", month)
	if err != nil {
		return err
	}
	count, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if count == 0 {
		return ErrNotFound
	}
	return tx.Commit()
}

func (s *Store) CreateMonth(month string) error {
	s.writeMu.Lock()
	defer s.writeMu.Unlock()
	if !finance.ValidMonth(month) {
		return invalid("month")
	}
	_, e := s.DB.Exec("INSERT INTO months(month,created_at,updated_at) VALUES(?,?,?)", month, now(), now())
	if e != nil {
		if strings.Contains(strings.ToLower(e.Error()), "unique") {
			return conflict("month_exists")
		}
		return e
	}
	return nil
}

type BalanceInput struct {
	AccountID   int64  `json:"account_id"`
	AmountMinor string `json:"amount_minor"`
}
type RateInput struct {
	Currency string `json:"currency"`
	Rate     string `json:"rate"`
}
type MonthInput struct {
	Balances []BalanceInput `json:"balances"`
	Rates    []RateInput    `json:"rates"`
}
type Balance struct {
	AccountID   int64  `json:"account_id"`
	AmountMinor string `json:"amount_minor"`
}
type Rate struct {
	Currency string `json:"currency"`
	Rate     string `json:"rate"`
}
type MonthData struct {
	Month           string    `json:"month"`
	Exists          bool      `json:"exists"`
	Accounts        []Account `json:"accounts"`
	Balances        []Balance `json:"balances"`
	Rates           []Rate    `json:"rates"`
	Complete        bool      `json:"complete"`
	TotalEURMinor   *string   `json:"total_eur_minor"`
	MissingBalances []int64   `json:"missing_balances"`
	MissingRates    []string  `json:"missing_rates"`
}

func (s *Store) PutMonth(month string, input MonthInput) error {
	s.writeMu.Lock()
	defer s.writeMu.Unlock()
	if !finance.ValidMonth(month) {
		return invalid("month")
	}
	accounts, e := s.ActiveAt(month)
	if e != nil {
		return e
	}
	active := map[int64]bool{}
	needed := map[string]bool{}
	for _, a := range accounts {
		active[a.ID] = true
		if a.Currency != "EUR" {
			needed[a.Currency] = true
		}
	}
	seenB := map[int64]bool{}
	bvals := map[int64]int64{}
	for _, b := range input.Balances {
		if !active[b.AccountID] || seenB[b.AccountID] {
			return invalid("balances")
		}
		v, e := finance.ParseMinor(b.AmountMinor)
		if e != nil {
			return invalid("amount_minor")
		}
		bvals[b.AccountID] = v
		seenB[b.AccountID] = true
	}
	seenR := map[string]bool{}
	rvals := map[string]int64{}
	for _, r := range input.Rates {
		if !finance.ValidCurrency(r.Currency) || r.Currency == "EUR" || seenR[r.Currency] || !needed[r.Currency] {
			return invalid("rates")
		}
		v, e := finance.ParseRate(r.Rate)
		if e != nil {
			return invalid("rate")
		}
		rvals[r.Currency] = v
		seenR[r.Currency] = true
	}
	// Reject totals outside int64 before writing, so the saved month is always readable.
	if len(accounts) > 0 && len(bvals) == len(accounts) && len(rvals) == len(needed) {
		entries := make([]finance.Entry, 0, len(accounts))
		for _, a := range accounts {
			rate := finance.RateScale
			if a.Currency != "EUR" {
				rate = rvals[a.Currency]
			}
			entries = append(entries, finance.Entry{Amount: bvals[a.ID], Rate: rate})
		}
		if _, e := finance.TotalEURMinor(entries); e != nil {
			return invalidReason("total_eur_minor", "total_overflow")
		}
	}
	tx, e := s.DB.Begin()
	if e != nil {
		return e
	}
	defer tx.Rollback()
	timestamp := now()
	if _, e = tx.Exec("INSERT INTO months(month,created_at,updated_at) VALUES(?,?,?) ON CONFLICT(month) DO UPDATE SET updated_at=excluded.updated_at", month, timestamp, timestamp); e != nil {
		return e
	}
	if _, e = tx.Exec("DELETE FROM monthly_balances WHERE month=?", month); e != nil {
		return e
	}
	if _, e = tx.Exec("DELETE FROM exchange_rates WHERE month=?", month); e != nil {
		return e
	}
	for id, v := range bvals {
		if _, e = tx.Exec("INSERT INTO monthly_balances(account_id,month,amount_minor,updated_at) VALUES(?,?,?,?)", id, month, v, timestamp); e != nil {
			return e
		}
	}
	for c, v := range rvals {
		if _, e = tx.Exec("INSERT INTO exchange_rates(month,currency,rate_scaled,updated_at) VALUES(?,?,?,?)", month, c, v, timestamp); e != nil {
			return e
		}
	}
	return tx.Commit()
}
func (s *Store) Month(month string) (MonthData, error) {
	if !finance.ValidMonth(month) {
		return MonthData{}, invalid("month")
	}
	d := MonthData{Month: month, Balances: []Balance{}, Rates: []Rate{}, MissingBalances: []int64{}, MissingRates: []string{}}
	var count int
	e := s.DB.QueryRow("SELECT COUNT(*) FROM months WHERE month=?", month).Scan(&count)
	if e != nil {
		return d, e
	}
	d.Exists = count > 0
	d.Accounts, e = s.ActiveAt(month)
	if e != nil {
		return d, e
	}
	rows, e := s.DB.Query("SELECT account_id,amount_minor FROM monthly_balances WHERE month=?", month)
	if e != nil {
		return d, e
	}
	vals := map[int64]int64{}
	for rows.Next() {
		var id, v int64
		if e = rows.Scan(&id, &v); e != nil {
			rows.Close()
			return d, e
		}
		d.Balances = append(d.Balances, Balance{id, strconv.FormatInt(v, 10)})
		vals[id] = v
	}
	e = rows.Err()
	rows.Close()
	if e != nil {
		return d, e
	}
	rows, e = s.DB.Query("SELECT currency,rate_scaled FROM exchange_rates WHERE month=?", month)
	if e != nil {
		return d, e
	}
	rates := map[string]int64{"EUR": finance.RateScale}
	for rows.Next() {
		var currency string
		var rate int64
		if e = rows.Scan(&currency, &rate); e != nil {
			rows.Close()
			return d, e
		}
		d.Rates = append(d.Rates, Rate{currency, finance.RateString(rate)})
		rates[currency] = rate
	}
	e = rows.Err()
	rows.Close()
	if e != nil {
		return d, e
	}
	sort.Slice(d.Rates, func(i, j int) bool { return d.Rates[i].Currency < d.Rates[j].Currency })
	needed := map[string]bool{}
	entries := []finance.Entry{}
	for _, a := range d.Accounts {
		value, exists := vals[a.ID]
		if !exists {
			d.MissingBalances = append(d.MissingBalances, a.ID)
		}
		if a.Currency != "EUR" && rates[a.Currency] == 0 {
			needed[a.Currency] = true
		}
		if exists && rates[a.Currency] > 0 {
			entries = append(entries, finance.Entry{Amount: value, Rate: rates[a.Currency]})
		}
	}
	for c := range needed {
		d.MissingRates = append(d.MissingRates, c)
	}
	sort.Strings(d.MissingRates)
	// A created month with no active accounts has no meaningful net-worth observation.
	d.Complete = d.Exists && len(d.Accounts) > 0 && len(d.MissingBalances) == 0 && len(d.MissingRates) == 0
	if d.Complete {
		total, e := finance.TotalEURMinor(entries)
		if e != nil {
			return d, invalidReason("total_eur_minor", "total_overflow")
		}
		t := strconv.FormatInt(total, 10)
		d.TotalEURMinor = &t
	}
	return d, nil
}
