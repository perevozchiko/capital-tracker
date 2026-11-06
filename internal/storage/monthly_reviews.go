package storage

import (
	"database/sql"

	"github.com/perevozchiko/capital-tracker/internal/finance"
)

type MonthlyReview struct {
	Section string `json:"section"`
	Month   string `json:"month"`
}

func readMonthlyReviews(q interface {
	Query(string, ...any) (*sql.Rows, error)
}) ([]MonthlyReview, error) {
	rows, err := q.Query("SELECT section,month FROM monthly_reviews ORDER BY section,month")
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := []MonthlyReview{}
	for rows.Next() {
		var review MonthlyReview
		if err := rows.Scan(&review.Section, &review.Month); err != nil {
			return nil, err
		}
		result = append(result, review)
	}
	return result, rows.Err()
}

// DeleteFlowMonth removes both the entries and their explicit review state.
func (s *Store) DeleteFlowMonth(section, month string) error {
	if (section != "incomes" && section != "expenses") || !finance.ValidMonth(month) {
		return invalid("month")
	}
	s.writeMu.Lock()
	defer s.writeMu.Unlock()
	tx, err := s.DB.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if _, err = tx.Exec("DELETE FROM "+section+" WHERE month=?", month); err != nil {
		return err
	}
	if _, err = tx.Exec("DELETE FROM monthly_reviews WHERE section=? AND month=?", section, month); err != nil {
		return err
	}
	return tx.Commit()
}
