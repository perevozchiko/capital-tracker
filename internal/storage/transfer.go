package storage

import (
	"database/sql"
	"fmt"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/perevozchiko/capital-tracker/internal/finance"
)

// TransferDocument is a portable, versioned snapshot of application data.
// Monetary amounts and exchange rates use decimal strings to retain precision.
type TransferDocument struct {
	Format         string            `json:"format"`
	SchemaVersion  int               `json:"schema_version"`
	ExportedAt     string            `json:"exported_at"`
	Accounts       []Account         `json:"accounts"`
	Groups         []AccountGroup    `json:"groups,omitempty"`
	AccountPeriods []TransferPeriod  `json:"account_periods"`
	Months         []Month           `json:"months"`
	Balances       []TransferBalance `json:"balances"`
	Rates          []TransferRate    `json:"rates"`
	Settings       map[string]string `json:"settings"`
}

type TransferPeriod struct {
	AccountID  int64   `json:"account_id"`
	StartMonth string  `json:"start_month"`
	EndMonth   *string `json:"end_month"`
}

type TransferBalance struct {
	AccountID   int64  `json:"account_id"`
	Month       string `json:"month"`
	AmountMinor string `json:"amount_minor"`
	UpdatedAt   string `json:"updated_at"`
}

type TransferRate struct {
	Month      string `json:"month"`
	Currency   string `json:"currency"`
	RateScaled string `json:"rate_scaled"`
	UpdatedAt  string `json:"updated_at"`
}

// ExportData uses one SQLite read transaction so every table belongs to the
// same point-in-time snapshot, even if edits are happening in another request.
func (s *Store) ExportData() (TransferDocument, error) {
	s.writeMu.Lock()
	defer s.writeMu.Unlock()
	d := TransferDocument{Format: "capital-tracker", SchemaVersion: 2, ExportedAt: now(),
		Accounts: []Account{}, Groups: []AccountGroup{}, AccountPeriods: []TransferPeriod{}, Months: []Month{},
		Balances: []TransferBalance{}, Rates: []TransferRate{}, Settings: map[string]string{}}
	tx, err := s.DB.Begin()
	if err != nil {
		return d, err
	}
	defer tx.Rollback()

	groupRows, err := tx.Query("SELECT id,name,sort_order,created_at,updated_at FROM account_groups ORDER BY sort_order,id")
	if err != nil {
		return d, err
	}
	for groupRows.Next() {
		var g AccountGroup
		if err = groupRows.Scan(&g.ID, &g.Name, &g.SortOrder, &g.CreatedAt, &g.UpdatedAt); err != nil {
			groupRows.Close()
			return d, err
		}
		d.Groups = append(d.Groups, g)
	}
	if err = groupRows.Err(); err != nil {
		groupRows.Close()
		return d, err
	}
	groupRows.Close()

	rows, err := tx.Query("SELECT " + accountCols + " FROM accounts ORDER BY sort_order,id")
	if err != nil {
		return d, err
	}
	for rows.Next() {
		a, e := scanAccount(rows)
		if e != nil {
			rows.Close()
			return d, e
		}
		d.Accounts = append(d.Accounts, a)
	}
	if err = rows.Err(); err != nil {
		rows.Close()
		return d, err
	}
	rows.Close()

	rows, err = tx.Query("SELECT account_id,start_month,end_month FROM account_periods ORDER BY account_id,start_month")
	if err != nil {
		return d, err
	}
	for rows.Next() {
		var p TransferPeriod
		var end sql.NullString
		if err = rows.Scan(&p.AccountID, &p.StartMonth, &end); err != nil {
			rows.Close()
			return d, err
		}
		if end.Valid {
			p.EndMonth = &end.String
		}
		d.AccountPeriods = append(d.AccountPeriods, p)
	}
	if err = rows.Err(); err != nil {
		rows.Close()
		return d, err
	}
	rows.Close()

	rows, err = tx.Query("SELECT month,created_at,updated_at FROM months ORDER BY month")
	if err != nil {
		return d, err
	}
	for rows.Next() {
		var m Month
		if err = rows.Scan(&m.Month, &m.CreatedAt, &m.UpdatedAt); err != nil {
			rows.Close()
			return d, err
		}
		d.Months = append(d.Months, m)
	}
	if err = rows.Err(); err != nil {
		rows.Close()
		return d, err
	}
	rows.Close()

	rows, err = tx.Query("SELECT account_id,month,amount_minor,updated_at FROM monthly_balances ORDER BY month,account_id")
	if err != nil {
		return d, err
	}
	for rows.Next() {
		var b TransferBalance
		var minor int64
		if err = rows.Scan(&b.AccountID, &b.Month, &minor, &b.UpdatedAt); err != nil {
			rows.Close()
			return d, err
		}
		b.AmountMinor = strconv.FormatInt(minor, 10)
		d.Balances = append(d.Balances, b)
	}
	if err = rows.Err(); err != nil {
		rows.Close()
		return d, err
	}
	rows.Close()

	rows, err = tx.Query("SELECT month,currency,rate_scaled,updated_at FROM exchange_rates ORDER BY month,currency")
	if err != nil {
		return d, err
	}
	for rows.Next() {
		var r TransferRate
		var scaled int64
		if err = rows.Scan(&r.Month, &r.Currency, &scaled, &r.UpdatedAt); err != nil {
			rows.Close()
			return d, err
		}
		r.RateScaled = strconv.FormatInt(scaled, 10)
		d.Rates = append(d.Rates, r)
	}
	if err = rows.Err(); err != nil {
		rows.Close()
		return d, err
	}
	rows.Close()

	rows, err = tx.Query("SELECT key,value FROM app_settings ORDER BY key")
	if err != nil {
		return d, err
	}
	for rows.Next() {
		var k, v string
		if err = rows.Scan(&k, &v); err != nil {
			rows.Close()
			return d, err
		}
		d.Settings[k] = v
	}
	if err = rows.Err(); err != nil {
		rows.Close()
		return d, err
	}
	rows.Close()
	return d, tx.Commit()
}

func validTransferTime(s string) bool {
	if s == "" {
		return false
	}
	_, err := time.Parse(time.RFC3339Nano, s)
	return err == nil
}
func periodActive(periods []TransferPeriod, month string) bool {
	for _, p := range periods {
		if p.StartMonth <= month && (p.EndMonth == nil || month < *p.EndMonth) {
			return true
		}
	}
	return false
}

// ValidateTransfer rejects malformed, inconsistent, unsupported or overflowing
// snapshots before touching the database. It never fixes invalid input silently.
func ValidateTransfer(d TransferDocument) error {
	bad := func() error { return invalid("import") }
	if d.Format != "capital-tracker" || (d.SchemaVersion != 1 && d.SchemaVersion != 2) || !validTransferTime(d.ExportedAt) ||
		d.Accounts == nil || (d.SchemaVersion == 2 && d.Groups == nil) || d.AccountPeriods == nil || d.Months == nil || d.Balances == nil || d.Rates == nil || d.Settings == nil {
		return bad()
	}
	if len(d.Settings) != 2 || (d.Settings["language"] != "en" && d.Settings["language"] != "ru") ||
		(d.Settings["theme"] != "system" && d.Settings["theme"] != "light" && d.Settings["theme"] != "dark") {
		return bad()
	}
	groups := make(map[int64]bool, len(d.Groups))
	groupNames := make(map[string]bool, len(d.Groups))
	if d.SchemaVersion == 1 && len(d.Groups) > 0 {
		return bad()
	}
	for _, g := range d.Groups {
		folded := strings.ToLower(g.Name)
		if g.ID <= 0 || groups[g.ID] || !validGroupName(g.Name) ||
			groupNames[folded] || g.SortOrder < 0 || !validTransferTime(g.CreatedAt) || !validTransferTime(g.UpdatedAt) {
			return bad()
		}
		groups[g.ID] = true
		groupNames[folded] = true
	}
	accounts := make(map[int64]Account, len(d.Accounts))
	periods := make(map[int64][]TransferPeriod, len(d.Accounts))
	for _, a := range d.Accounts {
		if a.ID <= 0 || accounts[a.ID].ID != 0 || strings.TrimSpace(a.Name) != a.Name || a.Name == "" ||
			len([]rune(a.Name)) > 100 || !finance.ValidCurrency(a.Currency) || !finance.ValidMonth(a.StartMonth) ||
			(a.ArchivedFromMonth != nil && !finance.ValidMonth(*a.ArchivedFromMonth)) ||
			!validTransferTime(a.CreatedAt) || !validTransferTime(a.UpdatedAt) || a.SortOrder < 0 ||
			(a.GroupID != nil && (d.SchemaVersion == 1 || !groups[*a.GroupID])) {
			return bad()
		}
		accounts[a.ID] = a
	}
	for _, p := range d.AccountPeriods {
		if accounts[p.AccountID].ID == 0 || !finance.ValidMonth(p.StartMonth) ||
			(p.EndMonth != nil && (!finance.ValidMonth(*p.EndMonth) || *p.EndMonth <= p.StartMonth)) {
			return bad()
		}
		periods[p.AccountID] = append(periods[p.AccountID], p)
	}
	for id, a := range accounts {
		ps := periods[id]
		if len(ps) == 0 {
			return bad()
		}
		sort.Slice(ps, func(i, j int) bool { return ps[i].StartMonth < ps[j].StartMonth })
		if ps[0].StartMonth != a.StartMonth {
			return bad()
		}
		for i, p := range ps {
			if i > 0 && (ps[i-1].EndMonth == nil || p.StartMonth < *ps[i-1].EndMonth) {
				return bad()
			}
			if i < len(ps)-1 && p.EndMonth == nil {
				return bad()
			}
		}
		last := ps[len(ps)-1]
		if (last.EndMonth == nil) != (a.ArchivedFromMonth == nil) {
			return bad()
		}
		if last.EndMonth != nil && *last.EndMonth != *a.ArchivedFromMonth {
			return bad()
		}
		periods[id] = ps
	}
	months := make(map[string]bool, len(d.Months))
	for _, m := range d.Months {
		if !finance.ValidMonth(m.Month) || months[m.Month] || !validTransferTime(m.CreatedAt) || !validTransferTime(m.UpdatedAt) {
			return bad()
		}
		months[m.Month] = true
	}
	balances := map[string]map[int64]int64{}
	for _, b := range d.Balances {
		a, ok := accounts[b.AccountID]
		if !ok || !months[b.Month] || !periodActive(periods[a.ID], b.Month) || !validTransferTime(b.UpdatedAt) {
			return bad()
		}
		v, err := finance.ParseMinor(b.AmountMinor)
		if err != nil {
			return bad()
		}
		if balances[b.Month] == nil {
			balances[b.Month] = map[int64]int64{}
		}
		if _, exists := balances[b.Month][b.AccountID]; exists {
			return bad()
		}
		balances[b.Month][b.AccountID] = v
	}
	rates := map[string]map[string]int64{}
	for _, r := range d.Rates {
		if !months[r.Month] || !finance.ValidCurrency(r.Currency) || r.Currency == "EUR" || !validTransferTime(r.UpdatedAt) {
			return bad()
		}
		v, err := strconv.ParseInt(r.RateScaled, 10, 64)
		if err != nil || v <= 0 || v > finance.MaxRateScaled || strconv.FormatInt(v, 10) != r.RateScaled {
			return bad()
		}
		if rates[r.Month] == nil {
			rates[r.Month] = map[string]int64{}
		}
		if _, exists := rates[r.Month][r.Currency]; exists {
			return bad()
		}
		rates[r.Month][r.Currency] = v
	}
	for month := range months {
		needed := map[string]bool{}
		entries := []finance.Entry{}
		activeCount := 0
		for id, a := range accounts {
			if !periodActive(periods[id], month) {
				continue
			}
			activeCount++
			if a.Currency != "EUR" {
				needed[a.Currency] = true
			}
			if b, ok := balances[month][id]; ok {
				rate := finance.RateScale
				if a.Currency != "EUR" {
					rate = rates[month][a.Currency]
				}
				if rate > 0 {
					entries = append(entries, finance.Entry{Amount: b, Rate: rate})
				}
			}
		}
		for currency := range rates[month] {
			if !needed[currency] {
				return bad()
			}
		}
		// Validate the same complete-month total arithmetic used in PutMonth.
		if activeCount > 0 && len(balances[month]) == activeCount && len(rates[month]) == len(needed) {
			if _, err := finance.TotalEURMinor(entries); err != nil {
				return bad()
			}
		}
	}
	return nil
}

// ImportData atomically replaces all application records while keeping the
// existing SQLite schema, migrations and database file. A failure rolls back.
func (s *Store) ImportData(d TransferDocument) error {
	if err := ValidateTransfer(d); err != nil {
		return err
	}
	s.writeMu.Lock()
	defer s.writeMu.Unlock()
	tx, err := s.DB.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	for _, table := range []string{"monthly_balances", "exchange_rates", "account_periods", "months", "accounts", "account_groups", "app_settings"} {
		if _, err = tx.Exec("DELETE FROM " + table); err != nil {
			return err
		}
	}
	for _, g := range d.Groups {
		if _, err = tx.Exec("INSERT INTO account_groups(id,name,sort_order,created_at,updated_at) VALUES(?,?,?,?,?)", g.ID, g.Name, g.SortOrder, g.CreatedAt, g.UpdatedAt); err != nil {
			return invalid("import")
		}
	}
	for _, a := range d.Accounts {
		if _, err = tx.Exec("INSERT INTO accounts("+accountCols+") VALUES(?,?,?,?,?,?,?,?,?)", a.ID, a.Name, a.Currency, a.StartMonth, a.ArchivedFromMonth, a.SortOrder, a.CreatedAt, a.UpdatedAt, a.GroupID); err != nil {
			return invalid("import")
		}
	}
	for _, p := range d.AccountPeriods {
		if _, err = tx.Exec("INSERT INTO account_periods(account_id,start_month,end_month) VALUES(?,?,?)", p.AccountID, p.StartMonth, p.EndMonth); err != nil {
			return invalid("import")
		}
	}
	for _, m := range d.Months {
		if _, err = tx.Exec("INSERT INTO months(month,created_at,updated_at) VALUES(?,?,?)", m.Month, m.CreatedAt, m.UpdatedAt); err != nil {
			return invalid("import")
		}
	}
	for _, b := range d.Balances {
		v, _ := finance.ParseMinor(b.AmountMinor)
		if _, err = tx.Exec("INSERT INTO monthly_balances(account_id,month,amount_minor,updated_at) VALUES(?,?,?,?)", b.AccountID, b.Month, v, b.UpdatedAt); err != nil {
			return invalid("import")
		}
	}
	for _, r := range d.Rates {
		v, _ := strconv.ParseInt(r.RateScaled, 10, 64)
		if _, err = tx.Exec("INSERT INTO exchange_rates(month,currency,rate_scaled,updated_at) VALUES(?,?,?,?)", r.Month, r.Currency, v, r.UpdatedAt); err != nil {
			return invalid("import")
		}
	}
	for k, v := range d.Settings {
		if _, err = tx.Exec("INSERT INTO app_settings(key,value) VALUES(?,?)", k, v); err != nil {
			return invalid("import")
		}
	}
	if err = tx.Commit(); err != nil {
		return fmt.Errorf("import commit: %w", err)
	}
	return nil
}
