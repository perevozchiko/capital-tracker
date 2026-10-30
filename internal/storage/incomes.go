package storage

import (
	"database/sql"
	"strconv"
	"strings"

	"github.com/perevozchiko/capital-tracker/internal/finance"
)

type Income struct {
	Month       string `json:"month"`
	Currency    string `json:"currency"`
	AmountMinor string `json:"amount_minor"`
	Rate        string `json:"rate"`
	Name        string `json:"name"`
}

type IncomeMonth struct {
	Month         string   `json:"month"`
	Entries       []Income `json:"entries"`
	TotalEURMinor string   `json:"total_eur_minor"`
	Complete      bool     `json:"complete"`
}

func validateIncome(month string, entries []Income) ([]finance.Entry, error) {
	if !finance.ValidMonth(month) {
		return nil, invalid("month")
	}
	values := []finance.Entry{}
	for _, entry := range entries {
		if entry.Month != month {
			return nil, invalid("month")
		}
		if !finance.ValidCurrency(entry.Currency) {
			return nil, invalid("currency")
		}
		if strings.TrimSpace(entry.Name) != entry.Name || entry.Name == "" || len([]rune(entry.Name)) > 100 {
			return nil, invalid("name")
		}
		amount, err := finance.ParseMinor(entry.AmountMinor)
		if err != nil || amount < 0 {
			return nil, invalid("amount_minor")
		}
		rate, err := finance.ParseRate(entry.Rate)
		if err != nil || (entry.Currency == "EUR" && rate != finance.RateScale) {
			return nil, invalid("rate")
		}
		values = append(values, finance.Entry{Amount: amount, Rate: rate})
	}
	if _, err := finance.TotalEURMinor(values); err != nil {
		return nil, invalid("total_eur_minor")
	}
	return values, nil
}

func readIncomes(q interface {
	Query(string, ...any) (*sql.Rows, error)
}) ([]Income, error) {
	rows, err := q.Query("SELECT month,currency,amount_minor,rate_scaled,name FROM incomes ORDER BY month,position")
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	entries := []Income{}
	for rows.Next() {
		var entry Income
		var amount, rate int64
		if err := rows.Scan(&entry.Month, &entry.Currency, &amount, &rate, &entry.Name); err != nil {
			return nil, err
		}
		entry.AmountMinor = strconv.FormatInt(amount, 10)
		entry.Rate = finance.RateString(rate)
		entries = append(entries, entry)
	}
	return entries, rows.Err()
}

func (s *Store) Incomes() ([]IncomeMonth, error) {
	entries, err := readIncomes(s.DB)
	if err != nil {
		return nil, err
	}
	months := []IncomeMonth{}
	for _, entry := range entries {
		if len(months) == 0 || months[len(months)-1].Month != entry.Month {
			months = append(months, IncomeMonth{Month: entry.Month, Entries: []Income{}, Complete: true})
		}
		m := &months[len(months)-1]
		m.Entries = append(m.Entries, entry)
	}
	for i := range months {
		values, err := validateIncome(months[i].Month, months[i].Entries)
		if err != nil {
			return nil, err
		}
		total, err := finance.TotalEURMinor(values)
		if err != nil {
			return nil, err
		}
		months[i].TotalEURMinor = strconv.FormatInt(total, 10)
	}
	return months, nil
}

// PutIncome replaces only the selected month's notes. An empty list deletes it.
func (s *Store) PutIncome(month string, entries []Income) error {
	s.writeMu.Lock()
	defer s.writeMu.Unlock()
	values, err := validateIncome(month, entries)
	if err != nil {
		return err
	}
	tx, err := s.DB.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if _, err = tx.Exec("DELETE FROM incomes WHERE month=?", month); err != nil {
		return err
	}
	for i, entry := range entries {
		if _, err = tx.Exec("INSERT INTO incomes(month,position,name,currency,amount_minor,rate_scaled) VALUES(?,?,?,?,?,?)", month, i, entry.Name, entry.Currency, values[i].Amount, values[i].Rate); err != nil {
			return err
		}
	}
	return tx.Commit()
}
