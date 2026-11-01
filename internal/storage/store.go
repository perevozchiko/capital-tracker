package storage

import (
	"database/sql"
	"embed"
	"errors"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	_ "modernc.org/sqlite"
)

//go:embed migrations/*.sql
var migrations embed.FS

const applicationID = 1128354379

func now() string { return time.Now().UTC().Format(time.RFC3339Nano) }

type Store struct {
	// Write operations are serialized so month/account validation cannot race.
	writeMu sync.Mutex
	DB      *sql.DB
	Path    string
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
	// Per-connection PRAGMAs belong in the SQLite DSN, not a one-time Exec.
	uriPath := filepath.ToSlash(path)
	if !strings.HasPrefix(uriPath, "/") {
		uriPath = "/" + uriPath // file:///C:/... on Windows
	}
	uri := url.URL{Scheme: "file", Path: uriPath}
	query := url.Values{}
	query.Add("_pragma", "busy_timeout(5000)")
	query.Add("_pragma", "foreign_keys(ON)")
	uri.RawQuery = query.Encode()
	db, err := sql.Open("sqlite", uri.String())
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(1)
	db.SetMaxIdleConns(1)
	failed := func(e error) (*Store, error) { db.Close(); return nil, e }
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
	paths, err := migrationsList()
	if err != nil {
		return failed(err)
	}
	if version > len(paths) {
		return failed(fmt.Errorf("database version %d is newer than application version %d", version, len(paths)))
	}
	if version < len(paths) && exists {
		backup := path + ".pre-migration-" + time.Now().UTC().Format("20060102-150405")
		if err = backupDatabase(db, backup); err != nil {
			return failed(fmt.Errorf("pre-migration backup: %w", err))
		}
	}
	for index := version; index < len(paths); index++ {
		sqlFile, e := migrations.ReadFile(paths[index])
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
		migrationVersion := index + 1
		if _, e = tx.Exec("INSERT INTO schema_migrations(version,applied_at) VALUES(?,?)", migrationVersion, now()); e != nil {
			tx.Rollback()
			return failed(e)
		}
		if _, e = tx.Exec(fmt.Sprintf("PRAGMA user_version=%d", migrationVersion)); e != nil {
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

// migrationsList validates a contiguous version sequence before any migration runs.
func migrationsList() ([]string, error) {
	paths, err := migrations.ReadDir("migrations")
	if err != nil {
		return nil, err
	}
	var names []string
	for _, entry := range paths {
		name := entry.Name()
		if entry.IsDir() || !strings.HasSuffix(name, ".sql") {
			continue
		}
		names = append(names, name)
	}
	sort.Strings(names)
	for i, name := range names {
		if len(name) < 8 || name[3] != '_' {
			return nil, fmt.Errorf("invalid migration filename %q", name)
		}
		n, err := strconv.Atoi(name[:3])
		if err != nil || n != i+1 {
			return nil, fmt.Errorf("missing or repeated migration version near %q", name)
		}
		names[i] = "migrations/" + name
	}
	if len(names) == 0 {
		return nil, errors.New("no database migrations found")
	}
	return names, nil
}

func (s *Store) Close() error { return s.DB.Close() }

func (s *Store) Backup(destination string) error {
	s.writeMu.Lock()
	defer s.writeMu.Unlock()
	abs, e := filepath.Abs(destination)
	if e != nil {
		return e
	}
	if filepath.Clean(abs) == filepath.Clean(s.Path) {
		return invalid("destination")
	}
	return backupDatabase(s.DB, abs)
}

// Reserve an empty owner-only file before SQLite writes any financial data.
// O_EXCL also refuses existing files and dangling symlinks without a stat race.
func backupDatabase(db *sql.DB, destination string) error {
	file, err := os.OpenFile(destination, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600)
	if err != nil {
		return err
	}
	if err = file.Close(); err == nil {
		_, err = db.Exec("VACUUM INTO ?", destination)
	}
	if err != nil {
		_ = os.Remove(destination)
	}
	return err
}
