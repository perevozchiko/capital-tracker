package storage

import (
	"crypto/sha256"
	"database/sql"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"reflect"
	"sync"
	"testing"
	"time"
)

func backupStatus(t *testing.T, s *Store) BackupStatus {
	t.Helper()
	status, err := s.Backups()
	if err != nil {
		t.Fatal(err)
	}
	return status
}

func TestWeeklyBackupScheduleSurvivesRestartAndMissedWeeks(t *testing.T) {
	dir := t.TempDir()
	s, err := Open(dir)
	if err != nil {
		t.Fatal(err)
	}
	base := time.Now().UTC().Add(-40 * 24 * time.Hour)
	for _, day := range []int{0, 0, 6, 7, 30} {
		if err := s.EnsureWeeklyBackup(base.Add(time.Duration(day) * 24 * time.Hour)); err != nil {
			t.Fatal(err)
		}
	}
	status := backupStatus(t, s)
	if len(status.Backups) != 3 || !status.NextAt.Equal(base.Add(37*24*time.Hour)) {
		t.Fatalf("schedule: %+v", status)
	}
	if err := s.Close(); err != nil {
		t.Fatal(err)
	}
	s, err = Open(dir)
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	if err := s.EnsureWeeklyBackup(base.Add(31 * 24 * time.Hour)); err != nil {
		t.Fatal(err)
	}
	if len(backupStatus(t, s).Backups) != 3 {
		t.Fatal("restart reset schedule")
	}
	if err := s.EnsureWeeklyBackup(base.Add(37 * 24 * time.Hour)); err != nil {
		t.Fatal(err)
	}
	if len(backupStatus(t, s).Backups) != 4 {
		t.Fatal("next weekly copy missing")
	}
}

func TestBackupRetentionAndFailedCopyPreserveHistoryAndSchedule(t *testing.T) {
	s := openTest(t)
	base := time.Now().UTC().Add(-24 * time.Hour)
	if err := s.EnsureWeeklyBackup(base); err != nil {
		t.Fatal(err)
	}
	oldest := backupStatus(t, s).Backups[0].ID
	for i := 0; i < BackupLimit; i++ {
		if _, err := s.CreateBackup(); err != nil {
			t.Fatal(err)
		}
	}
	status := backupStatus(t, s)
	if len(status.Backups) != BackupLimit || !status.NextAt.Equal(base.Add(BackupInterval)) {
		t.Fatalf("retention/schedule: %+v", status)
	}
	if _, err := os.Stat(filepath.Join(s.backupDir(), oldest)); !os.IsNotExist(err) {
		t.Fatalf("oldest file was not removed: %v", err)
	}
	if err := s.EnsureWeeklyBackup(base.Add(2 * 24 * time.Hour)); err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(status.Backups, backupStatus(t, s).Backups) {
		t.Fatal("pruned automatic copy reset weekly schedule")
	}
	if err := os.WriteFile(filepath.Join(s.backupDir(), "my-own-copy.db"), []byte("keep"), 0600); err != nil {
		t.Fatal(err)
	}
	s.Close()
	if _, err := s.CreateBackup(); err == nil {
		t.Fatal("closed database backup succeeded")
	}
	after := backupStatus(t, s)
	if after.LastError == "" || !reflect.DeepEqual(status.Backups, after.Backups) {
		t.Fatal("failed backup pruned history or hid failure")
	}
	entries, err := os.ReadDir(s.backupDir())
	if err != nil {
		t.Fatal(err)
	}
	// 50 backups, the schedule, and the unrelated user file; no partial copy.
	if len(entries) != BackupLimit+2 {
		t.Fatalf("unexpected files after failed backup: %v", entries)
	}
}

func TestBackupPreviewRestoreAndRecoveryPreserveAllData(t *testing.T) {
	s := openTest(t)
	fixture, err := os.ReadFile("../demo/sample-2025-2026.json")
	if err != nil {
		t.Fatal(err)
	}
	var initial TransferDocument
	if err := json.Unmarshal(fixture, &initial); err != nil {
		t.Fatal(err)
	}
	if err := s.ImportData(initial); err != nil {
		t.Fatal(err)
	}
	initial, err = s.ExportData()
	if err != nil {
		t.Fatal(err)
	}
	backup, err := s.CreateBackup()
	if err != nil {
		t.Fatal(err)
	}
	name := "Current bank name"
	if _, err := s.UpdateAccount(initial.Accounts[0].ID, &name, nil); err != nil {
		t.Fatal(err)
	}
	if err := s.UpdateSettings("en", "light"); err != nil {
		t.Fatal(err)
	}
	current, err := s.ExportData()
	if err != nil {
		t.Fatal(err)
	}
	assertDocument := func(want TransferDocument) {
		t.Helper()
		got, err := s.ExportData()
		if err != nil {
			t.Fatal(err)
		}
		got.ExportedAt, want.ExportedAt = "", ""
		if !reflect.DeepEqual(want, got) {
			t.Fatal("restore changed application data")
		}
	}
	err = s.WithBackup(backup.ID, func(archive *Store) error {
		got, err := archive.ExportData()
		if err != nil {
			return err
		}
		got.ExportedAt = initial.ExportedAt
		if !reflect.DeepEqual(initial, got) {
			t.Fatal("preview contains current data")
		}
		if err := archive.ClearData(); err == nil {
			t.Fatal("archive allowed writes")
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	assertDocument(current)
	safety, err := s.RestoreBackup(backup.ID)
	if err != nil || safety.Kind != "before-restore" {
		t.Fatalf("restore: %+v %v", safety, err)
	}
	assertDocument(initial)
	if _, err := s.RestoreBackup(safety.ID); err != nil {
		t.Fatal(err)
	}
	assertDocument(current)
}

func TestRestoreFailureRollsBackAndKeepsRecovery(t *testing.T) {
	s := openTest(t)
	a, err := s.CreateAccount("Old", "EUR", "2026-01")
	if err != nil {
		t.Fatal(err)
	}
	backup, err := s.CreateBackup()
	if err != nil {
		t.Fatal(err)
	}
	name := "Current"
	if _, err := s.UpdateAccount(a.ID, &name, nil); err != nil {
		t.Fatal(err)
	}
	if _, err := s.DB.Exec("CREATE TRIGGER reject_restore BEFORE INSERT ON accounts BEGIN SELECT RAISE(ABORT, 'test failure'); END"); err != nil {
		t.Fatal(err)
	}
	safety, err := s.RestoreBackup(backup.ID)
	if err == nil || safety.ID == "" {
		t.Fatal("expected transactional failure with recovery copy")
	}
	got, err := s.account(a.ID)
	if err != nil || got.Name != name {
		t.Fatalf("failed restore changed current data: %+v %v", got, err)
	}
}

func TestRestoreOldestCopyAtRetentionLimitKeepsRecovery(t *testing.T) {
	s := openTest(t)
	a, err := s.CreateAccount("Original", "EUR", "2026-01")
	if err != nil {
		t.Fatal(err)
	}
	oldest, err := s.CreateBackup()
	if err != nil {
		t.Fatal(err)
	}
	name := "Current"
	if _, err := s.UpdateAccount(a.ID, &name, nil); err != nil {
		t.Fatal(err)
	}
	for i := 1; i < BackupLimit; i++ {
		if _, err := s.CreateBackup(); err != nil {
			t.Fatal(err)
		}
	}
	safety, err := s.RestoreBackup(oldest.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(backupStatus(t, s).Backups) != BackupLimit {
		t.Fatal("recovery copy exceeded retention limit")
	}
	if _, err := os.Stat(filepath.Join(s.backupDir(), oldest.ID)); !os.IsNotExist(err) {
		t.Fatal("oldest copy was not pruned after recovery copy was saved")
	}
	restored, err := s.account(a.ID)
	if err != nil || restored.Name != "Original" {
		t.Fatalf("oldest copy was lost before restore: %+v %v", restored, err)
	}
	if _, err := s.RestoreBackup(safety.ID); err != nil {
		t.Fatal(err)
	}
	restored, err = s.account(a.ID)
	if err != nil || restored.Name != "Current" {
		t.Fatalf("recovery copy failed: %+v %v", restored, err)
	}
}

func TestFailedRecoveryCopyPreventsRestore(t *testing.T) {
	dir := t.TempDir()
	s, err := Open(dir)
	if err != nil {
		t.Fatal(err)
	}
	a, err := s.CreateAccount("Original", "EUR", "2026-01")
	if err != nil {
		t.Fatal(err)
	}
	backup, err := s.CreateBackup()
	if err != nil {
		t.Fatal(err)
	}
	name := "Current"
	if _, err := s.UpdateAccount(a.ID, &name, nil); err != nil {
		t.Fatal(err)
	}
	if err := s.Close(); err != nil {
		t.Fatal(err)
	}
	// The archive remains readable, but the closed live connection cannot make
	// its required recovery snapshot. Restoration must leave the file untouched.
	if _, err := s.RestoreBackup(backup.ID); err == nil {
		t.Fatal("restore proceeded without a recovery copy")
	}
	s, err = Open(dir)
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	current, err := s.account(a.ID)
	if err != nil || current.Name != name || len(backupStatus(t, s).Backups) != 1 {
		t.Fatalf("failed recovery changed current data: %+v %v", current, err)
	}
}

func TestConcurrentWeeklyChecksCreateOneCopy(t *testing.T) {
	s := openTest(t)
	var workers sync.WaitGroup
	for i := 0; i < 8; i++ {
		workers.Add(1)
		go func() {
			defer workers.Done()
			if err := s.EnsureWeeklyBackup(time.Now()); err != nil {
				t.Error(err)
			}
		}()
	}
	workers.Wait()
	if len(backupStatus(t, s).Backups) != 1 {
		t.Fatal("concurrent checks created duplicate copies")
	}
}

func TestBackupRejectsPathsSymlinksAndCorruptFiles(t *testing.T) {
	s := openTest(t)
	for _, id := range []string{"../capital.db", "capital.db", "", "/tmp/other.db"} {
		if err := s.WithBackup(id, func(*Store) error { t.Fatal("opened invalid path"); return nil }); !errors.Is(err, ErrNotFound) {
			t.Fatalf("path %q: %v", id, err)
		}
	}
	backup, err := s.CreateBackup()
	if err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(s.backupDir(), backup.ID)
	if err := os.Remove(path); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(s.Path, path); err == nil {
		if err := s.WithBackup(backup.ID, func(*Store) error { t.Fatal("followed symlink"); return nil }); !errors.Is(err, ErrNotFound) {
			t.Fatalf("symlink: %v", err)
		}
		if len(backupStatus(t, s).Backups) != 0 {
			t.Fatal("symlink listed as backup")
		}
		os.Remove(path)
	}
	if err := os.WriteFile(path, []byte("broken database"), 0600); err != nil {
		t.Fatal(err)
	}
	if _, err := s.RestoreBackup(backup.ID); err == nil {
		t.Fatal("restored corrupt database")
	}
	if len(backupStatus(t, s).Backups) != 1 {
		t.Fatal("invalid restore created a recovery copy")
	}
}

func TestOlderBackupMigratesDisposableCopy(t *testing.T) {
	s := openTest(t)
	if err := s.ensureBackupDir(); err != nil {
		t.Fatal(err)
	}
	id := time.Now().UTC().Format(backupTimeFormat) + "-manual.db"
	path := filepath.Join(s.backupDir(), id)
	db, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatal(err)
	}
	first, err := migrations.ReadFile("migrations/001_init.sql")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(string(first) + "; PRAGMA user_version=1;"); err != nil {
		t.Fatal(err)
	}
	if err := db.Close(); err != nil {
		t.Fatal(err)
	}
	original, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	err = s.WithBackup(id, func(archive *Store) error {
		document, err := archive.ExportData()
		if err != nil {
			return err
		}
		if err := archive.ClearData(); err == nil {
			t.Fatal("migrated preview allowed writes")
		}
		return ValidateTransfer(document)
	})
	if err != nil {
		t.Fatal(err)
	}
	after, err := os.ReadFile(path)
	if err != nil || sha256.Sum256(after) != sha256.Sum256(original) {
		t.Fatal("preview modified original backup", err)
	}
}
