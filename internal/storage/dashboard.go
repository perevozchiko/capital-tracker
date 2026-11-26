package storage

import (
	"errors"
	"fmt"
	"math/big"
	"strconv"

	"github.com/perevozchiko/capital-tracker/internal/finance"
)

type Point struct {
	Month         string  `json:"month"`
	Complete      bool    `json:"complete"`
	TotalEURMinor *string `json:"total_eur_minor"`
}

func (s *Store) History() ([]Point, error) {
	months, e := s.Months()
	if e != nil {
		return nil, e
	}
	out := []Point{}
	for _, m := range months {
		d, e := s.Month(m.Month)
		if e != nil {
			var domain *DomainError
			if errors.As(e, &domain) && domain.Reason == "total_overflow" {
				// Keep the remaining history usable for old or externally changed data.
				out = append(out, Point{Month: m.Month, Complete: false})
				continue
			}
			return nil, e
		}
		out = append(out, Point{m.Month, d.Complete, d.TotalEURMinor})
	}
	return out, nil
}

type Dashboard struct {
	Month           MonthData   `json:"month"`
	Previous        *MonthData  `json:"previous"`
	ChangeMinor     *string     `json:"change_minor"`
	ChangePercentBP *string     `json:"change_percent_bp"`
	Columns         []MonthData `json:"columns"`
	Accounts        []Account   `json:"accounts"`
}

func shiftMonth(month string, offset int) string {
	y, _ := strconv.Atoi(month[:4])
	m, _ := strconv.Atoi(month[5:])
	index := y*12 + m - 1 + offset
	if index < 0 {
		return "0000-01"
	}
	return fmt.Sprintf("%04d-%02d", index/12, index%12+1)
}
func (s *Store) Dashboard(month string) (Dashboard, error) {
	return s.DashboardColumns(month, 12)
}

// DashboardColumns returns a bounded number of consecutive calendar months.
func (s *Store) DashboardColumns(month string, columns int) (Dashboard, error) {
	if columns < 1 || columns > 120 {
		return Dashboard{}, invalid("columns")
	}
	var out Dashboard
	if !finance.ValidMonth(month) {
		return out, invalid("month")
	}
	var e error
	out.Month, e = s.Month(month)
	if e != nil {
		return out, e
	}
	prevMonth := shiftMonth(month, -1)
	if finance.ValidMonth(prevMonth) {
		prev, e := s.Month(prevMonth)
		if e != nil {
			return out, e
		}
		out.Previous = &prev
		if out.Month.Complete && prev.Complete {
			curr, _ := strconv.ParseInt(*out.Month.TotalEURMinor, 10, 64)
			old, _ := strconv.ParseInt(*prev.TotalEURMinor, 10, 64)
			delta := new(big.Int).Sub(big.NewInt(curr), big.NewInt(old)).String()
			out.ChangeMinor = &delta
			str, ok := finance.ChangePercentBasisPointsString(curr, old)
			if ok {
				out.ChangePercentBP = &str
			}
		}
	}
	for i := 1 - columns; i <= 0; i++ {
		m := shiftMonth(month, i)
		if !finance.ValidMonth(m) {
			continue
		}
		d, e := s.Month(m)
		if e != nil {
			return out, e
		}
		out.Columns = append(out.Columns, d)
	}
	out.Accounts, e = s.Accounts()
	return out, e
}
