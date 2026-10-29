package storage

import (
	"database/sql"
	"errors"
	"strings"

	"github.com/perevozchiko/capital-tracker/internal/finance"
)

// Accounts are kept even when archived; active periods control historical inclusion.
type Account struct {
	ID                int64   `json:"id"`
	Name              string  `json:"name"`
	Currency          string  `json:"currency"`
	StartMonth        string  `json:"start_month"`
	ArchivedFromMonth *string `json:"archived_from_month"`
	SortOrder         int64   `json:"sort_order"`
	GroupID           *int64  `json:"group_id,omitempty"`
	CreatedAt         string  `json:"created_at"`
	UpdatedAt         string  `json:"updated_at"`
}

func scanAccount(rows interface{ Scan(...any) error }) (Account, error) {
	var a Account
	var archived sql.NullString
	var group sql.NullInt64
	e := rows.Scan(&a.ID, &a.Name, &a.Currency, &a.StartMonth, &archived, &a.SortOrder, &a.CreatedAt, &a.UpdatedAt, &group)
	if archived.Valid {
		a.ArchivedFromMonth = &archived.String
	}
	if group.Valid {
		a.GroupID = &group.Int64
	}
	return a, e
}

const accountCols = "id,name,currency,start_month,archived_from_month,sort_order,created_at,updated_at,group_id"

func (s *Store) Accounts() ([]Account, error) {
	rows, e := s.DB.Query("SELECT " + accountCols + " FROM accounts ORDER BY sort_order,id")
	if e != nil {
		return nil, e
	}
	defer rows.Close()
	out := []Account{}
	for rows.Next() {
		a, e := scanAccount(rows)
		if e != nil {
			return nil, e
		}
		out = append(out, a)
	}
	return out, rows.Err()
}
func (s *Store) account(id int64) (Account, error) {
	a, e := scanAccount(s.DB.QueryRow("SELECT "+accountCols+" FROM accounts WHERE id=?", id))
	if errors.Is(e, sql.ErrNoRows) {
		return a, ErrNotFound
	}
	return a, e
}
func (s *Store) CreateAccount(name, currency, start string) (Account, error) {
	return s.CreateAccountInGroup(name, currency, start, nil)
}

func (s *Store) CreateAccountInGroup(name, currency, start string, groupID *int64) (Account, error) {
	s.writeMu.Lock()
	defer s.writeMu.Unlock()
	name = strings.TrimSpace(name)
	if name == "" || len([]rune(name)) > 100 {
		return Account{}, invalid("name")
	}
	if !finance.ValidCurrency(currency) {
		return Account{}, invalid("currency")
	}
	if !finance.ValidMonth(start) {
		return Account{}, invalid("start_month")
	}
	latest, e := s.LatestMonth()
	if e != nil {
		return Account{}, e
	}
	if latest != "" && start <= latest {
		return Account{}, conflict("account_start_after_history")
	}
	tx, e := s.DB.Begin()
	if e != nil {
		return Account{}, e
	}
	defer tx.Rollback()
	if e = validateGroupID(tx, groupID); e != nil {
		return Account{}, e
	}
	ts := now()
	var order int64
	if e = tx.QueryRow("SELECT COALESCE(MAX(sort_order),0)+1 FROM accounts").Scan(&order); e != nil {
		return Account{}, e
	}
	res, e := tx.Exec("INSERT INTO accounts(name,currency,start_month,sort_order,created_at,updated_at,group_id) VALUES(?,?,?,?,?,?,?)", name, currency, start, order, ts, ts, groupID)
	if e != nil {
		return Account{}, e
	}
	id, e := res.LastInsertId()
	if e != nil {
		return Account{}, e
	}
	if _, e = tx.Exec("INSERT INTO account_periods(account_id,start_month) VALUES(?,?)", id, start); e != nil {
		return Account{}, e
	}
	if e = tx.Commit(); e != nil {
		return Account{}, e
	}
	return s.account(id)
}
func (s *Store) RenameAccount(id int64, name string) (Account, error) {
	s.writeMu.Lock()
	defer s.writeMu.Unlock()
	name = strings.TrimSpace(name)
	if name == "" || len([]rune(name)) > 100 {
		return Account{}, invalid("name")
	}
	r, e := s.DB.Exec("UPDATE accounts SET name=?,updated_at=? WHERE id=?", name, now(), id)
	if e != nil {
		return Account{}, e
	}
	n, _ := r.RowsAffected()
	if n == 0 {
		return Account{}, ErrNotFound
	}
	return s.account(id)
}

// UpdateAccount changes the name and, only before history exists, the currency.
// An omitted field leaves its existing value unchanged.
func (s *Store) UpdateAccount(id int64, name, currency *string) (Account, error) {
	s.writeMu.Lock()
	defer s.writeMu.Unlock()
	if name == nil && currency == nil {
		return Account{}, invalid("name")
	}
	tx, err := s.DB.Begin()
	if err != nil {
		return Account{}, err
	}
	defer tx.Rollback()
	a, err := scanAccount(tx.QueryRow("SELECT "+accountCols+" FROM accounts WHERE id=?", id))
	if errors.Is(err, sql.ErrNoRows) {
		return Account{}, ErrNotFound
	}
	if err != nil {
		return Account{}, err
	}
	if name != nil {
		trimmed := strings.TrimSpace(*name)
		if trimmed == "" || len([]rune(trimmed)) > 100 {
			return Account{}, invalid("name")
		}
		a.Name = trimmed
	}
	if currency != nil {
		if !finance.ValidCurrency(*currency) {
			return Account{}, invalid("currency")
		}
		if a.Currency != *currency {
			protected, err := recordedAccountPeriod(tx, id)
			if err != nil {
				return Account{}, err
			}
			if protected {
				return Account{}, conflict("currency_locked_by_history")
			}
			a.Currency = *currency
		}
	}
	if _, err = tx.Exec("UPDATE accounts SET name=?,currency=?,updated_at=? WHERE id=?", a.Name, a.Currency, now(), id); err != nil {
		return Account{}, err
	}
	if err = tx.Commit(); err != nil {
		return Account{}, err
	}
	return s.account(id)
}

// recordedAccountPeriod prevents account edits that would silently rewrite
// completion status for months where the account was active but has no balance.
func recordedAccountPeriod(tx *sql.Tx, id int64) (bool, error) {
	var exists int
	err := tx.QueryRow(`SELECT EXISTS(SELECT 1 FROM months m
        JOIN account_periods p ON p.account_id=? AND p.start_month<=m.month
             AND (p.end_month IS NULL OR p.end_month>m.month))`, id).Scan(&exists)
	return exists != 0, err
}

func (s *Store) DeleteAccount(id int64) error {
	s.writeMu.Lock()
	defer s.writeMu.Unlock()
	tx, e := s.DB.Begin()
	if e != nil {
		return e
	}
	defer tx.Rollback()
	protected, e := recordedAccountPeriod(tx, id)
	if e != nil {
		return e
	}
	if protected {
		return conflict("account_delete_changes_history")
	}
	r, e := tx.Exec("DELETE FROM accounts WHERE id=?", id)
	if e != nil {
		return e
	}
	count, _ := r.RowsAffected()
	if count == 0 {
		return ErrNotFound
	}
	return tx.Commit()
}
func (s *Store) ArchiveAccount(id int64, month string) error {
	s.writeMu.Lock()
	defer s.writeMu.Unlock()
	if !finance.ValidMonth(month) {
		return invalid("month")
	}
	a, e := s.account(id)
	if e != nil {
		return e
	}
	if a.ArchivedFromMonth != nil {
		return conflict("account_already_archived")
	}
	var last sql.NullString
	e = s.DB.QueryRow("SELECT MAX(month) FROM monthly_balances WHERE account_id=?", id).Scan(&last)
	if e != nil {
		return e
	}
	if last.Valid && month <= last.String {
		return conflict("archive_after_last_balance")
	}
	latest, e := s.LatestMonth()
	if e != nil {
		return e
	}
	if latest != "" && month <= latest {
		return conflict("archive_after_history")
	}
	tx, e := s.DB.Begin()
	if e != nil {
		return e
	}
	defer tx.Rollback()
	r, e := tx.Exec("UPDATE account_periods SET end_month=? WHERE account_id=? AND end_month IS NULL AND start_month<?", month, id, month)
	if e != nil {
		return e
	}
	n, _ := r.RowsAffected()
	if n != 1 {
		return conflict("archive_after_active_period")
	}
	if _, e = tx.Exec("UPDATE accounts SET archived_from_month=?,updated_at=? WHERE id=?", month, now(), id); e != nil {
		return e
	}
	return tx.Commit()
}
func (s *Store) RestoreAccount(id int64, start string) error {
	s.writeMu.Lock()
	defer s.writeMu.Unlock()
	if !finance.ValidMonth(start) {
		return invalid("start_month")
	}
	a, e := s.account(id)
	if e != nil {
		return e
	}
	if a.ArchivedFromMonth == nil {
		return conflict("account_already_active")
	}
	if start < *a.ArchivedFromMonth {
		return conflict("restore_after_archive")
	}
	latest, e := s.LatestMonth()
	if e != nil {
		return e
	}
	if latest != "" && start <= latest {
		return conflict("restore_after_history")
	}
	tx, e := s.DB.Begin()
	if e != nil {
		return e
	}
	defer tx.Rollback()
	if _, e = tx.Exec("INSERT INTO account_periods(account_id,start_month) VALUES(?,?)", id, start); e != nil {
		return e
	}
	if _, e = tx.Exec("UPDATE accounts SET archived_from_month=NULL,updated_at=? WHERE id=?", now(), id); e != nil {
		return e
	}
	return tx.Commit()
}
func (s *Store) Reorder(ids []int64) error {
	s.writeMu.Lock()
	defer s.writeMu.Unlock()
	accounts, e := s.Accounts()
	if e != nil {
		return e
	}
	if len(ids) != len(accounts) {
		return invalid("ids")
	}
	expected := map[int64]bool{}
	for _, a := range accounts {
		expected[a.ID] = true
	}
	seen := map[int64]bool{}
	for _, id := range ids {
		if !expected[id] || seen[id] {
			return invalid("ids")
		}
		seen[id] = true
	}
	tx, e := s.DB.Begin()
	if e != nil {
		return e
	}
	defer tx.Rollback()
	for i, id := range ids {
		if _, e = tx.Exec("UPDATE accounts SET sort_order=?,updated_at=? WHERE id=?", i+1, now(), id); e != nil {
			return e
		}
	}
	return tx.Commit()
}

func (s *Store) ActiveAt(month string) ([]Account, error) {
	rows, e := s.DB.Query("SELECT DISTINCT a."+strings.ReplaceAll(accountCols, ",", ",a.")+" FROM accounts a JOIN account_periods p ON p.account_id=a.id WHERE p.start_month<=? AND (p.end_month IS NULL OR p.end_month>?) ORDER BY a.sort_order,a.id", month, month)
	if e != nil {
		return nil, e
	}
	defer rows.Close()
	out := []Account{}
	for rows.Next() {
		a, e := scanAccount(rows)
		if e != nil {
			return nil, e
		}
		out = append(out, a)
	}
	return out, rows.Err()
}
