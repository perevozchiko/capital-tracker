package storage

import (
	"database/sql"
	"strconv"

	"github.com/perevozchiko/capital-tracker/internal/finance"
)

type RecurringExpenseSnapshot struct {
	Month   string                  `json:"month"`
	Entries []Expense               `json:"entries"`
	Groups  []RecurringExpenseGroup `json:"groups,omitempty"`
}

type RecurringExpenseMonth struct {
	ExpenseMonth
	InheritedFrom          string                       `json:"inherited_from,omitempty"`
	Groups                 []RecurringExpenseGroupTotal `json:"groups"`
	UngroupedTotalEURMinor string                       `json:"ungrouped_total_eur_minor"`
}

func readRecurringExpenses(q interface {
	Query(string, ...any) (*sql.Rows, error)
}) ([]RecurringExpenseSnapshot, error) {
	rows, err := q.Query(`SELECT m.month,e.currency,e.amount_minor,e.rate_scaled,e.name
 FROM recurring_expense_months m LEFT JOIN recurring_expenses e ON e.month=m.month ORDER BY m.month,e.position`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	snapshots := []RecurringExpenseSnapshot{}
	for rows.Next() {
		var month string
		var currency, name sql.NullString
		var amount, rate sql.NullInt64
		if err := rows.Scan(&month, &currency, &amount, &rate, &name); err != nil {
			return nil, err
		}
		if len(snapshots) == 0 || snapshots[len(snapshots)-1].Month != month {
			snapshots = append(snapshots, RecurringExpenseSnapshot{Month: month, Entries: []Expense{}})
		}
		if currency.Valid {
			m := &snapshots[len(snapshots)-1]
			m.Entries = append(m.Entries, Expense{Month: month, Currency: currency.String, AmountMinor: strconv.FormatInt(amount.Int64, 10), Rate: finance.RateString(rate.Int64), Name: name.String})
		}
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	rows.Close()
	groups, err := readRecurringExpenseGroups(q)
	if err != nil {
		return nil, err
	}
	for i := range snapshots {
		snapshots[i].Groups = groups[snapshots[i].Month]
	}
	return snapshots, nil
}

func recurringExpenseTotal(snapshot RecurringExpenseSnapshot) (ExpenseMonth, error) {
	values, err := validateExpense(snapshot.Month, snapshot.Entries)
	if err != nil {
		return ExpenseMonth{}, err
	}
	total, err := finance.TotalEURMinor(values)
	return ExpenseMonth{Month: snapshot.Month, Entries: snapshot.Entries, TotalEURMinor: strconv.FormatInt(total, 10), Complete: true}, err
}

func (s *Store) RecurringExpenses() ([]ExpenseMonth, error) {
	snapshots, err := s.recurringExpenseSnapshots()
	if err != nil {
		return nil, err
	}
	months := []ExpenseMonth{}
	for _, snapshot := range snapshots {
		month, err := recurringExpenseTotal(snapshot)
		if err != nil {
			return nil, err
		}
		months = append(months, month)
	}
	return months, nil
}

func (s *Store) recurringExpenseSnapshots() ([]RecurringExpenseSnapshot, error) {
	tx, err := s.DB.Begin()
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	return readRecurringExpenses(tx)
}

// Unsaved months inherit the most recent earlier snapshot, including an empty one.
// Reading never creates records; saving freezes only the selected month.
func (s *Store) RecurringExpense(month string) (RecurringExpenseMonth, error) {
	if !finance.ValidMonth(month) {
		return RecurringExpenseMonth{}, invalid("month")
	}
	snapshots, err := s.recurringExpenseSnapshots()
	if err != nil {
		return RecurringExpenseMonth{}, err
	}
	result := RecurringExpenseMonth{ExpenseMonth: ExpenseMonth{Month: month, Entries: []Expense{}, TotalEURMinor: "0", Complete: true}, Groups: []RecurringExpenseGroupTotal{}, UngroupedTotalEURMinor: "0"}
	for _, previous := range snapshots {
		if previous.Month > month {
			break
		}
		result.ExpenseMonth, err = recurringExpenseTotal(previous)
		if err != nil {
			return RecurringExpenseMonth{}, err
		}
		result.Groups, result.UngroupedTotalEURMinor, err = recurringExpenseGroupTotals(previous)
		if err != nil {
			return RecurringExpenseMonth{}, err
		}
		result.Month = month
		result.InheritedFrom = ""
		if previous.Month != month {
			result.InheritedFrom = previous.Month
		}
	}
	for i := range result.Entries {
		result.Entries[i].Month = month
	}
	return result, nil
}

func (s *Store) PutRecurringExpense(month string, entries []Expense) error {
	return s.PutRecurringExpenseSnapshot(RecurringExpenseSnapshot{Month: month, Entries: entries})
}

func (s *Store) PutRecurringExpenseSnapshot(snapshot RecurringExpenseSnapshot) error {
	s.writeMu.Lock()
	defer s.writeMu.Unlock()
	month, entries := snapshot.Month, snapshot.Entries
	values, err := validateExpense(month, entries)
	if err != nil {
		return err
	}
	if err := validateRecurringExpenseGroups(entries, snapshot.Groups); err != nil {
		return err
	}
	tx, err := s.DB.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if _, err = tx.Exec("INSERT INTO recurring_expense_months(month) VALUES(?) ON CONFLICT(month) DO NOTHING", month); err != nil {
		return err
	}
	if _, err = tx.Exec("DELETE FROM recurring_expenses WHERE month=?", month); err != nil {
		return err
	}
	if _, err = tx.Exec("DELETE FROM recurring_expense_groups WHERE month=?", month); err != nil {
		return err
	}
	for i, entry := range entries {
		if _, err = tx.Exec("INSERT INTO recurring_expenses(month,position,name,currency,amount_minor,rate_scaled) VALUES(?,?,?,?,?,?)", month, i, entry.Name, entry.Currency, values[i].Amount, values[i].Rate); err != nil {
			return err
		}
	}
	if err := writeRecurringExpenseGroups(tx, snapshot); err != nil {
		return err
	}
	return tx.Commit()
}
