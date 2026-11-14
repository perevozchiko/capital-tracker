package storage

import (
	"database/sql"
	"sort"
	"strconv"
	"strings"

	"github.com/perevozchiko/capital-tracker/internal/finance"
)

type Expense struct {
	Month       string `json:"month"`
	Currency    string `json:"currency"`
	AmountMinor string `json:"amount_minor"`
	Rate        string `json:"rate"`
	Name        string `json:"name"`
}

type ExpenseMonth struct {
	Month         string    `json:"month"`
	Entries       []Expense `json:"entries"`
	TotalEURMinor string    `json:"total_eur_minor"`
	Complete      bool      `json:"complete"`
}

// MajorExpenseMonth adds the month's own groups and their EUR subtotals.
// Groups organize entries only; the month total is unchanged by grouping.
type MajorExpenseMonth struct {
	ExpenseMonth
	Groups                 []RecurringExpenseGroupTotal `json:"groups"`
	UngroupedTotalEURMinor string                       `json:"ungrouped_total_eur_minor"`
}

// ExpenseGroupMonth is one month's major-expense groups in JSON transfers.
type ExpenseGroupMonth struct {
	Month  string                  `json:"month"`
	Groups []RecurringExpenseGroup `json:"groups"`
}

func readExpenseGroups(q interface {
	Query(string, ...any) (*sql.Rows, error)
}) (map[string][]RecurringExpenseGroup, error) {
	return readEntryGroups(q, "expense_groups", "expense_group_members")
}

func readExpenseGroupMonths(q interface {
	Query(string, ...any) (*sql.Rows, error)
}) ([]ExpenseGroupMonth, error) {
	groups, err := readExpenseGroups(q)
	if err != nil {
		return nil, err
	}
	result := []ExpenseGroupMonth{}
	for month, items := range groups {
		result = append(result, ExpenseGroupMonth{Month: month, Groups: items})
	}
	sort.Slice(result, func(i, j int) bool { return result[i].Month < result[j].Month })
	return result, nil
}

func validateExpense(month string, entries []Expense) ([]finance.Entry, error) {
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

func readExpenses(q interface {
	Query(string, ...any) (*sql.Rows, error)
}) ([]Expense, error) {
	rows, err := q.Query("SELECT month,currency,amount_minor,rate_scaled,name FROM expenses ORDER BY month,position")
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	entries := []Expense{}
	for rows.Next() {
		var entry Expense
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

func (s *Store) Expenses() ([]MajorExpenseMonth, error) {
	// One read transaction keeps entries, reviews and groups consistent.
	tx, err := s.DB.Begin()
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	entries, err := readExpenses(tx)
	if err != nil {
		return nil, err
	}
	months := []MajorExpenseMonth{}
	for _, entry := range entries {
		if len(months) == 0 || months[len(months)-1].Month != entry.Month {
			months = append(months, MajorExpenseMonth{ExpenseMonth: ExpenseMonth{Month: entry.Month, Entries: []Expense{}, Complete: true}})
		}
		m := &months[len(months)-1]
		m.Entries = append(m.Entries, entry)
	}
	reviews, err := readMonthlyReviews(tx)
	if err != nil {
		return nil, err
	}
	groups, err := readExpenseGroups(tx)
	if err != nil {
		return nil, err
	}
	present := map[string]bool{}
	for _, m := range months {
		present[m.Month] = true
	}
	for _, review := range reviews {
		if review.Section == "expenses" && !present[review.Month] {
			months = append(months, MajorExpenseMonth{ExpenseMonth: ExpenseMonth{Month: review.Month, Entries: []Expense{}, Complete: true}})
		}
	}
	sort.Slice(months, func(i, j int) bool { return months[i].Month < months[j].Month })
	for i := range months {
		values, err := validateExpense(months[i].Month, months[i].Entries)
		if err != nil {
			return nil, err
		}
		total, err := finance.TotalEURMinor(values)
		if err != nil {
			return nil, err
		}
		months[i].TotalEURMinor = strconv.FormatInt(total, 10)
		months[i].Groups, months[i].UngroupedTotalEURMinor, err = recurringExpenseGroupTotals(RecurringExpenseSnapshot{Month: months[i].Month, Entries: months[i].Entries, Groups: groups[months[i].Month]})
		if err != nil {
			return nil, err
		}
	}
	return months, tx.Commit()
}

// PutExpense replaces only the selected month's notes. An empty list records a reviewed zero month.
func (s *Store) PutExpense(month string, entries []Expense) error {
	return s.PutExpenseGroups(month, entries, nil)
}

// PutExpenseGroups replaces the selected month's notes and groups together.
// Groups only organize entries, so they never change the month total.
func (s *Store) PutExpenseGroups(month string, entries []Expense, groups []RecurringExpenseGroup) error {
	s.writeMu.Lock()
	defer s.writeMu.Unlock()
	values, err := validateExpense(month, entries)
	if err != nil {
		return err
	}
	if err := validateRecurringExpenseGroups(entries, groups); err != nil {
		return err
	}
	tx, err := s.DB.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if _, err = tx.Exec("INSERT INTO monthly_reviews(section,month) VALUES(?,?) ON CONFLICT DO NOTHING", "expenses", month); err != nil {
		return err
	}
	if _, err = tx.Exec("DELETE FROM expense_groups WHERE month=?", month); err != nil {
		return err
	}
	if _, err = tx.Exec("DELETE FROM expenses WHERE month=?", month); err != nil {
		return err
	}
	for i, entry := range entries {
		if _, err = tx.Exec("INSERT INTO expenses(month,position,name,currency,amount_minor,rate_scaled) VALUES(?,?,?,?,?,?)", month, i, entry.Name, entry.Currency, values[i].Amount, values[i].Rate); err != nil {
			return err
		}
	}
	if err := writeEntryGroups(tx, "expense_groups", "expense_group_members", month, groups); err != nil {
		return err
	}
	return tx.Commit()
}
