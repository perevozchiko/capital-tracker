package storage

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"time"
)

const BackupLimit = 50
const BackupInterval = 7 * 24 * time.Hour
const backupTimeFormat = "20060102T150405.000000000Z"

var backupName = regexp.MustCompile(`^([0-9]{8}T[0-9]{6}[.][0-9]{9}Z)-(automatic|manual|before-restore)[.]db$`)

type BackupInfo struct {
	ID        string    `json:"id"`
	CreatedAt time.Time `json:"created_at"`
	Kind      string    `json:"kind"`
	Size      int64     `json:"size"`
}

type BackupStatus struct {
	Backups   []BackupInfo `json:"backups"`
	Limit     int          `json:"limit"`
	NextAt    *time.Time   `json:"next_at"`
	LastError string       `json:"last_error,omitempty"`
}

func (s *Store) backupDir() string { return filepath.Join(filepath.Dir(s.Path), "backups") }

func (s *Store) ensureBackupDir() error {
	if err := os.MkdirAll(s.backupDir(), 0700); err != nil {
		return err
	}
	info, err := os.Lstat(s.backupDir())
	if err != nil {
		return err
	}
	if !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
		return errors.New("backup directory must be a real directory")
	}
	return nil
}

// listBackups only recognizes files owned by this backup mechanism.
// Temporary files, symlinks and unrelated user files never enter retention.
func (s *Store) listBackups() ([]BackupInfo, error) {
	if err := s.ensureBackupDir(); err != nil {
		return nil, err
	}
	entries, err := os.ReadDir(s.backupDir())
	if err != nil {
		return nil, err
	}
	backups := []BackupInfo{}
	for _, entry := range entries {
		match := backupName.FindStringSubmatch(entry.Name())
		if match == nil || !entry.Type().IsRegular() {
			continue
		}
		created, err := time.Parse(backupTimeFormat, match[1])
		if err != nil {
			continue
		}
		info, err := entry.Info()
		if err != nil {
			return nil, err
		}
		backups = append(backups, BackupInfo{entry.Name(), created, match[2], info.Size()})
	}
	sort.Slice(backups, func(i, j int) bool { return backups[i].ID > backups[j].ID })
	return backups, nil
}

func (s *Store) Backups() (BackupStatus, error) {
	s.backupMu.Lock()
	defer s.backupMu.Unlock()
	backups, err := s.listBackups()
	status := BackupStatus{Backups: backups, Limit: BackupLimit, LastError: s.backupError}
	if err != nil {
		return status, err
	}
	last, err := s.lastAutomatic(backups)
	if !last.IsZero() {
		next := last.Add(BackupInterval)
		status.NextAt = &next
	}
	return status, err
}

// Keep the automatic schedule even if 50 newer manual/recovery copies prune
// the last automatic snapshot. This metadata is independent of restored data.
func (s *Store) lastAutomatic(backups []BackupInfo) (time.Time, error) {
	var last time.Time
	data, err := os.ReadFile(filepath.Join(s.backupDir(), ".last-automatic"))
	if err == nil {
		last, err = time.Parse(time.RFC3339Nano, string(data))
	}
	if err != nil && !os.IsNotExist(err) {
		return last, err
	}
	for _, backup := range backups {
		if backup.Kind == "automatic" {
			if backup.CreatedAt.After(last) {
				last = backup.CreatedAt
			}
			break
		}
	}
	return last, nil
}

func (s *Store) saveAutomaticTime(at time.Time) error {
	file, err := os.CreateTemp(s.backupDir(), ".schedule-")
	if err != nil {
		return err
	}
	defer os.Remove(file.Name())
	_, err = file.WriteString(at.UTC().Format(time.RFC3339Nano))
	if err == nil {
		err = file.Sync()
	}
	closeErr := file.Close()
	if err != nil {
		return err
	}
	if closeErr != nil {
		return closeErr
	}
	return os.Rename(file.Name(), filepath.Join(s.backupDir(), ".last-automatic"))
}

// createBackup requires backupMu and writeMu. Publish only a complete SQLite
// snapshot, then prune the oldest copies; a failed snapshot never deletes history.
func (s *Store) createBackup(kind string, at time.Time) (BackupInfo, error) {
	if err := s.ensureBackupDir(); err != nil {
		return BackupInfo{}, err
	}
	id := at.UTC().Format(backupTimeFormat) + "-" + kind + ".db"
	destination := filepath.Join(s.backupDir(), id)
	if _, err := os.Lstat(destination); !os.IsNotExist(err) {
		return BackupInfo{}, fmt.Errorf("backup name already exists: %s", id)
	}
	pending := destination + ".pending"
	if err := backupDatabase(s.DB, pending); err != nil {
		return BackupInfo{}, err
	}
	if err := os.Rename(pending, destination); err != nil {
		_ = os.Remove(pending)
		return BackupInfo{}, err
	}
	if kind == "automatic" {
		if err := s.saveAutomaticTime(at); err != nil {
			return BackupInfo{}, err
		}
	}
	backups, err := s.listBackups()
	if err != nil {
		return BackupInfo{}, err
	}
	if err := s.pruneBackups(backups); err != nil {
		return BackupInfo{}, err
	}
	info, err := os.Stat(destination)
	if err != nil {
		return BackupInfo{}, err
	}
	return BackupInfo{id, at.UTC(), kind, info.Size()}, nil
}

func (s *Store) pruneBackups(backups []BackupInfo) error {
	for _, backup := range backups[min(BackupLimit, len(backups)):] {
		if err := os.Remove(filepath.Join(s.backupDir(), backup.ID)); err != nil {
			return fmt.Errorf("backup retention: %w", err)
		}
	}
	return nil
}

func (s *Store) CreateBackup() (BackupInfo, error) {
	s.backupMu.Lock()
	defer s.backupMu.Unlock()
	s.writeMu.Lock()
	defer s.writeMu.Unlock()
	backup, err := s.createBackup("manual", time.Now())
	if err != nil {
		s.backupError = "backup_failed"
	} else {
		s.backupError = ""
	}
	return backup, err
}

// EnsureWeeklyBackup uses persisted automatic timestamps, so manual copies and
// restoring older data never reset the schedule. Missed weeks create one copy.
func (s *Store) EnsureWeeklyBackup(at time.Time) error {
	s.backupMu.Lock()
	defer s.backupMu.Unlock()
	err := s.ensureWeeklyBackup(at)
	if err != nil {
		s.backupError = "backup_failed"
	}
	return err
}

func (s *Store) ensureWeeklyBackup(at time.Time) error {
	backups, err := s.listBackups()
	if err != nil {
		return err
	}
	last, err := s.lastAutomatic(backups)
	if err != nil {
		return err
	}
	if !last.IsZero() && at.Before(last.Add(BackupInterval)) {
		return s.pruneBackups(backups)
	}
	s.writeMu.Lock()
	defer s.writeMu.Unlock()
	_, err = s.createBackup("automatic", at)
	if err == nil {
		s.backupError = ""
	}
	return err
}

// RunWeeklyBackups checks on startup and every minute, including after sleep.
// The caller must wait for this method to stop before closing the Store.
func (s *Store) RunWeeklyBackups(ctx context.Context, report func(error)) {
	ticker := time.NewTicker(time.Minute)
	defer ticker.Stop()
	for {
		if err := s.EnsureWeeklyBackup(time.Now()); err != nil && report != nil {
			report(err)
		}
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
	}
}

// WithBackup keeps retention from removing a file while it is being read.
// The Store is isolated and read-only; the live database is never switched.
func (s *Store) WithBackup(id string, read func(*Store) error) error {
	s.backupMu.Lock()
	defer s.backupMu.Unlock()
	return s.withBackup(id, read)
}

func (s *Store) withBackup(id string, read func(*Store) error) error {
	if !backupName.MatchString(id) {
		return ErrNotFound
	}
	if err := s.ensureBackupDir(); err != nil {
		return err
	}
	path, err := filepath.Abs(filepath.Join(s.backupDir(), id))
	if err != nil {
		return err
	}
	info, err := os.Lstat(path)
	if os.IsNotExist(err) {
		return ErrNotFound
	}
	if err != nil {
		return err
	}
	if !info.Mode().IsRegular() {
		return ErrNotFound
	}
	uri := url.URL{Scheme: "file", Path: "/" + strings.TrimPrefix(filepath.ToSlash(path), "/")}
	uri.RawQuery = "mode=ro&immutable=1"
	db, err := sql.Open("sqlite", uri.String())
	if err != nil {
		return err
	}
	defer db.Close()
	db.SetMaxOpenConns(1)
	var application, version int
	if err := db.QueryRow("PRAGMA application_id").Scan(&application); err != nil {
		return err
	}
	if application != applicationID {
		return invalid("backup")
	}
	if err := db.QueryRow("PRAGMA user_version").Scan(&version); err != nil {
		return err
	}
	paths, err := migrationsList()
	if err != nil {
		return err
	}
	if version < 1 || version > len(paths) {
		return invalid("backup")
	}
	if version < len(paths) {
		// Migrate a disposable copy for archives created by an older release.
		// The original backup remains untouched and available for export.
		dir, err := os.MkdirTemp("", "capital-tracker-archive-")
		if err != nil {
			return err
		}
		defer os.RemoveAll(dir)
		if err := backupDatabase(db, filepath.Join(dir, "capital.db")); err != nil {
			return err
		}
		archive, err := Open(dir)
		if err != nil {
			return err
		}
		defer archive.Close()
		if _, err := archive.DB.Exec("PRAGMA query_only=ON"); err != nil {
			return err
		}
		return read(archive)
	}
	return read(&Store{DB: db, Path: path})
}

// RestoreBackup validates the archive before making a safety copy. The safety
// copy and replacement share the live write lock, preserving the exact previous
// state even when another browser is editing. Import runs in one transaction.
func (s *Store) RestoreBackup(id string) (BackupInfo, error) {
	s.backupMu.Lock()
	defer s.backupMu.Unlock()
	var document TransferDocument
	err := s.withBackup(id, func(archive *Store) error {
		var err error
		document, err = archive.ExportData()
		return err
	})
	if err != nil {
		return BackupInfo{}, err
	}
	if err := ValidateTransfer(document); err != nil {
		return BackupInfo{}, err
	}
	s.writeMu.Lock()
	defer s.writeMu.Unlock()
	safety, err := s.createBackup("before-restore", time.Now())
	if err != nil {
		s.backupError = "backup_failed"
		return BackupInfo{}, err
	}
	if err := s.importData(document); err != nil {
		return safety, err
	}
	s.backupError = ""
	return safety, nil
}
