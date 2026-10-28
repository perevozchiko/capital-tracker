package storage

import (
	"database/sql"
	"embed"
	"errors"
	"fmt"
	"math/big"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/perevozchiko/capital-tracker/internal/finance"
	_ "modernc.org/sqlite"
)

//go:embed migrations/*.sql
var migrations embed.FS

const applicationID = 1128354379

var ErrValidation = errors.New("validation_error")
var ErrConflict = errors.New("conflict")
var ErrNotFound = errors.New("not_found")

func invalid(s string) error  { return fmt.Errorf("%w: %s", ErrValidation, s) }
func conflict(s string) error { return fmt.Errorf("%w: %s", ErrConflict, s) }

func now() string { return time.Now().UTC().Format(time.RFC3339Nano) }

type Store struct {
	// Write operations are serialized so month/account validation cannot race.
	writeMu sync.Mutex
	DB   *sql.DB
	Path string
}

func DefaultDataDir() (string, error) {
	base, e := os.UserConfigDir()
	if e != nil {
		return "", e
	}
	return filepath.Join(base, "CapitalTracker"), nil
}

func Open(dataDir string) (*Store, error) {
	if err := os.MkdirAll(dataDir, 0700); err != nil {
		return nil, err
	}
	path := filepath.Join(dataDir, "capital.db")
	stat, err := os.Stat(path)
	exists := err == nil && stat.Size() > 0
	if err != nil && !os.IsNotExist(err) {
		return nil, err
	}
	db, err := sql.Open("sqlite", path)
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(1)
	db.SetMaxIdleConns(1)
	failed := func(e error) (*Store, error) { db.Close(); return nil, e }
	for _, p := range []string{"PRAGMA busy_timeout=5000", "PRAGMA foreign_keys=ON"} {
		if _, e := db.Exec(p); e != nil {
			return failed(e)
		}
	}
	var application int
	if err = db.QueryRow("PRAGMA application_id").Scan(&application); err != nil {
		return failed(err)
	}
	if exists && application != applicationID {
		return failed(errors.New("existing SQLite database is not a Capital Tracker database; refusing to modify"))
	}
	var version int
	if err = db.QueryRow("PRAGMA user_version").Scan(&version); err != nil {
		return failed(err)
	}
	if version > 1 {
		return failed(fmt.Errorf("database version %d is newer than application version 1", version))
	}
	if version < 1 {
		if exists {
			backup := path + ".pre-migration-" + time.Now().UTC().Format("20060102-150405")
			if _, err = db.Exec("VACUUM INTO ?", backup); err != nil {
				return failed(fmt.Errorf("pre-migration backup: %w", err))
			}
		}
		sqlFile, e := migrations.ReadFile("migrations/001_init.sql")
		if e != nil {
			return failed(e)
		}
		tx, e := db.Begin()
		if e != nil {
			return failed(e)
		}
		if _, e = tx.Exec(string(sqlFile)); e != nil {
			tx.Rollback()
			return failed(e)
		}
		if _, e = tx.Exec("INSERT INTO schema_migrations(version,applied_at) VALUES(1,?)", now()); e != nil {
			tx.Rollback()
			return failed(e)
		}
		if _, e = tx.Exec("PRAGMA user_version=1"); e != nil {
			tx.Rollback()
			return failed(e)
		}
		if e = tx.Commit(); e != nil {
			return failed(e)
		}
	}
	if _, err = db.Exec("PRAGMA journal_mode=WAL"); err != nil {
		return failed(err)
	}
	if _, err = db.Exec("PRAGMA synchronous=FULL"); err != nil {
		return failed(err)
	}
	return &Store{DB: db, Path: path}, nil
}

func (s *Store) Close() error { return s.DB.Close() }

func (s *Store) Backup(destination string) error {
	s.writeMu.Lock()
	defer s.writeMu.Unlock()
	abs, e := filepath.Abs(destination)
	if e != nil {
		return e
	}
	if _, e = os.Stat(abs); e == nil {
		return errors.New("backup destination already exists")
	}
	if !os.IsNotExist(e) {
		return e
	}
	if filepath.Clean(abs) == filepath.Clean(s.Path) {
		return invalid("backup path is database path")
	}
	_, e = s.DB.Exec("VACUUM INTO ?", abs)
	return e
}

// Accounts are kept even when archived; active periods control historical inclusion.
type Account struct {
	ID                int64   `json:"id"`
	Name              string  `json:"name"`
	Currency          string  `json:"currency"`
	StartMonth        string  `json:"start_month"`
	ArchivedFromMonth *string `json:"archived_from_month"`
	SortOrder         int64   `json:"sort_order"`
	CreatedAt         string  `json:"created_at"`
	UpdatedAt         string  `json:"updated_at"`
}

func scanAccount(rows interface{ Scan(...any) error }) (Account, error) {
	var a Account
	var archived sql.NullString
	e := rows.Scan(&a.ID, &a.Name, &a.Currency, &a.StartMonth, &archived, &a.SortOrder, &a.CreatedAt, &a.UpdatedAt)
	if archived.Valid {
		a.ArchivedFromMonth = &archived.String
	}
	return a, e
}

const accountCols = "id,name,currency,start_month,archived_from_month,sort_order,created_at,updated_at"

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
func (s *Store) LatestMonth() (string, error) {
	var m sql.NullString
	e := s.DB.QueryRow("SELECT MAX(month) FROM months").Scan(&m)
	return m.String, e
}

func (s *Store) CreateAccount(name, currency, start string) (Account, error) {
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
		return Account{}, conflict("account start must be after the last recorded month")
	}
	tx, e := s.DB.Begin()
	if e != nil {
		return Account{}, e
	}
	defer tx.Rollback()
	ts := now()
	var order int64
	if e = tx.QueryRow("SELECT COALESCE(MAX(sort_order),0)+1 FROM accounts").Scan(&order); e != nil {
		return Account{}, e
	}
	res, e := tx.Exec("INSERT INTO accounts(name,currency,start_month,sort_order,created_at,updated_at) VALUES(?,?,?,?,?,?)", name, currency, start, order, ts, ts)
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
				return Account{}, conflict("currency cannot change after a month has been recorded for this account")
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
		return conflict("account was active in a recorded month; deleting it would alter historical completeness")
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
		return conflict("account already archived")
	}
	var last sql.NullString
	e = s.DB.QueryRow("SELECT MAX(month) FROM monthly_balances WHERE account_id=?", id).Scan(&last)
	if e != nil {
		return e
	}
	if last.Valid && month <= last.String {
		return conflict("archive month must follow last recorded balance")
	}
	latest, e := s.LatestMonth()
	if e != nil {
		return e
	}
	if latest != "" && month <= latest {
		return conflict("archive month must be after the latest recorded month to protect history")
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
		return conflict("archive month must follow current active period start")
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
		return conflict("account is already active")
	}
	if start < *a.ArchivedFromMonth {
		return conflict("restoration must follow archival")
	}
	latest, e := s.LatestMonth()
	if e != nil {
		return e
	}
	if latest != "" && start <= latest {
		return conflict("restoration must start after last recorded month to protect history")
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
		return invalid("order must contain every account")
	}
	expected := map[int64]bool{}
	for _, a := range accounts {
		expected[a.ID] = true
	}
	seen := map[int64]bool{}
	for _, id := range ids {
		if !expected[id] || seen[id] {
			return invalid("unknown or repeated account id")
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
func (s *Store) CreateMonth(month string) error {
	s.writeMu.Lock()
	defer s.writeMu.Unlock()
	if !finance.ValidMonth(month) {
		return invalid("month")
	}
	_, e := s.DB.Exec("INSERT INTO months(month,created_at,updated_at) VALUES(?,?,?)", month, now(), now())
	if e != nil {
		if strings.Contains(strings.ToLower(e.Error()), "unique") {
			return conflict("month already exists")
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
			return invalid("balances: inactive or duplicated account")
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
			return invalid("rates: currency is not required or duplicated")
		}
		v, e := finance.ParseRate(r.Rate)
		if e != nil {
			return invalid("rate")
		}
		rvals[r.Currency] = v
		seenR[r.Currency] = true
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
			return d, e
		}
		t := strconv.FormatInt(total, 10)
		d.TotalEURMinor = &t
	}
	return d, nil
}

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
	for i := -5; i <= 0; i++ {
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

type Settings struct {
	Language string `json:"language"`
	Theme    string `json:"theme"`
	Version  string `json:"version"`
}

func (s *Store) Settings(version string) (Settings, error) {
	out := Settings{Version: version}
	rows, e := s.DB.Query("SELECT key,value FROM app_settings")
	if e != nil {
		return out, e
	}
	defer rows.Close()
	for rows.Next() {
		var k, v string
		if e = rows.Scan(&k, &v); e != nil {
			return out, e
		}
		switch k {
		case "language":
			out.Language = v
		case "theme":
			out.Theme = v
		}
	}
	return out, rows.Err()
}
func (s *Store) UpdateSettings(language, theme string) error {
	s.writeMu.Lock()
	defer s.writeMu.Unlock()
	if language != "en" && language != "ru" {
		return invalid("language")
	}
	if theme != "system" && theme != "light" && theme != "dark" {
		return invalid("theme")
	}
	tx, e := s.DB.Begin()
	if e != nil {
		return e
	}
	defer tx.Rollback()
	for k, v := range map[string]string{"language": language, "theme": theme} {
		if _, e = tx.Exec("UPDATE app_settings SET value=? WHERE key=?", v, k); e != nil {
			return e
		}
	}
	return tx.Commit()
}
