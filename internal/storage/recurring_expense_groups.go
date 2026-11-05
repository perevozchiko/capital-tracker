package storage

import (
	"database/sql"
	"strconv"
	"strings"

	"github.com/perevozchiko/capital-tracker/internal/finance"
)

// EntryPositions preserves membership and order without changing expense values.
type RecurringExpenseGroup struct {
	Name           string `json:"name"`
	EntryPositions []int  `json:"entry_positions"`
}

type RecurringExpenseGroupTotal struct {
	RecurringExpenseGroup
	TotalEURMinor string `json:"total_eur_minor"`
}

func validateRecurringExpenseGroups(entries []Expense, groups []RecurringExpenseGroup) error {
	names := []string{}
	assigned := map[int]bool{}
	for _, group := range groups {
		if strings.TrimSpace(group.Name) != group.Name || group.Name == "" || len([]rune(group.Name)) > 100 || group.EntryPositions == nil {
			return invalid("groups")
		}
		for _, name := range names {
			if strings.EqualFold(name, group.Name) {
				return invalid("groups")
			}
		}
		names = append(names, group.Name)
		for _, position := range group.EntryPositions {
			if position < 0 || position >= len(entries) || assigned[position] {
				return invalid("groups")
			}
			assigned[position] = true
		}
	}
	return nil
}

func readRecurringExpenseGroups(q interface {
	Query(string, ...any) (*sql.Rows, error)
}) (map[string][]RecurringExpenseGroup, error) {
	rows, err := q.Query(`SELECT g.month,g.position,g.name,m.entry_position
 FROM recurring_expense_groups g LEFT JOIN recurring_expense_group_members m
 ON m.month=g.month AND m.group_position=g.position
 ORDER BY g.month,g.position,m.sort_order`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	groups := map[string][]RecurringExpenseGroup{}
	lastMonth, lastPosition := "", -1
	for rows.Next() {
		var month, name string
		var position int
		var entry sql.NullInt64
		if err := rows.Scan(&month, &position, &name, &entry); err != nil {
			return nil, err
		}
		if month != lastMonth || position != lastPosition {
			groups[month] = append(groups[month], RecurringExpenseGroup{Name: name, EntryPositions: []int{}})
			lastMonth, lastPosition = month, position
		}
		if entry.Valid {
			group := &groups[month][len(groups[month])-1]
			group.EntryPositions = append(group.EntryPositions, int(entry.Int64))
		}
	}
	return groups, rows.Err()
}

func writeRecurringExpenseGroups(tx *sql.Tx, snapshot RecurringExpenseSnapshot) error {
	for position, group := range snapshot.Groups {
		if _, err := tx.Exec("INSERT INTO recurring_expense_groups(month,position,name) VALUES(?,?,?)", snapshot.Month, position, group.Name); err != nil {
			return err
		}
		for order, entry := range group.EntryPositions {
			if _, err := tx.Exec("INSERT INTO recurring_expense_group_members(month,entry_position,group_position,sort_order) VALUES(?,?,?,?)", snapshot.Month, entry, position, order); err != nil {
				return err
			}
		}
	}
	return nil
}

func recurringExpenseGroupTotals(snapshot RecurringExpenseSnapshot) ([]RecurringExpenseGroupTotal, string, error) {
	values, err := validateExpense(snapshot.Month, snapshot.Entries)
	if err != nil {
		return nil, "", err
	}
	if err := validateRecurringExpenseGroups(snapshot.Entries, snapshot.Groups); err != nil {
		return nil, "", err
	}
	groups := []RecurringExpenseGroupTotal{}
	assigned := map[int]bool{}
	for _, group := range snapshot.Groups {
		members := []finance.Entry{}
		for _, position := range group.EntryPositions {
			members = append(members, values[position])
			assigned[position] = true
		}
		total, err := finance.TotalEURMinor(members)
		if err != nil {
			return nil, "", err
		}
		groups = append(groups, RecurringExpenseGroupTotal{RecurringExpenseGroup: group, TotalEURMinor: strconv.FormatInt(total, 10)})
	}
	ungrouped := []finance.Entry{}
	for position, entry := range values {
		if !assigned[position] {
			ungrouped = append(ungrouped, entry)
		}
	}
	total, err := finance.TotalEURMinor(ungrouped)
	return groups, strconv.FormatInt(total, 10), err
}
