package storage

import "github.com/perevozchiko/capital-tracker/internal/finance"

type SavedRate struct {
	Month    string `json:"month"`
	Currency string `json:"currency"`
	Rate     string `json:"rate"`
	Source   string `json:"source"`
}

// SavedRates includes independent editor quotes without choosing one source over another.
func (s *Store) SavedRates() ([]SavedRate, error) {
	rows, err := s.DB.Query(`SELECT month,currency,rate_scaled,source FROM (
 SELECT month,currency,rate_scaled,'monthly' AS source FROM exchange_rates
 UNION SELECT month,currency,rate_scaled,'incomes' FROM incomes
 UNION SELECT month,currency,rate_scaled,'expenses' FROM expenses
 UNION SELECT month,currency,rate_scaled,'recurringExpenses' FROM recurring_expenses
 ) WHERE currency <> 'EUR' ORDER BY currency,month,source,rate_scaled`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := []SavedRate{}
	for rows.Next() {
		var rate SavedRate
		var scaled int64
		if err := rows.Scan(&rate.Month, &rate.Currency, &scaled, &rate.Source); err != nil {
			return nil, err
		}
		rate.Rate = finance.RateString(scaled)
		result = append(result, rate)
	}
	return result, rows.Err()
}
