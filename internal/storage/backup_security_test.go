//go:build unix

package storage

import (
	"database/sql"
	"os"
	"path/filepath"
	"syscall"
	"testing"
)

func TestBackupPermissionsAndExistingDestination(t *testing.T) {
	previous := syscall.Umask(0022)
	defer syscall.Umask(previous)
	s := openTest(t)
	if _, err := s.CreateAccount("Private savings", "EUR", "2026-01"); err != nil {
		t.Fatal(err)
	}
	dir := t.TempDir()
	destination := filepath.Join(dir, "backup.db")
	if err := s.Backup(destination); err != nil {
		t.Fatal(err)
	}
	info, err := os.Stat(destination)
	if err != nil || info.Mode().Perm() != 0600 {
		t.Fatalf("backup is not owner-only: %v %v", info, err)
	}
	db, err := sql.Open("sqlite", destination)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	var name string
	if err := db.QueryRow("SELECT name FROM accounts").Scan(&name); err != nil || name != "Private savings" {
		t.Fatalf("backup contents: %q %v", name, err)
	}
	if err := s.Backup(destination); err == nil {
		t.Fatal("overwrote an existing backup")
	}
	// O_EXCL must also reject a dangling symlink without creating its target.
	target := filepath.Join(dir, "must-not-create.db")
	link := filepath.Join(dir, "symlink.db")
	if err := os.Symlink(target, link); err != nil {
		t.Fatal(err)
	}
	if err := s.Backup(link); err == nil {
		t.Fatal("followed destination symlink")
	}
	if _, err := os.Stat(target); !os.IsNotExist(err) {
		t.Fatalf("symlink target was created: %v", err)
	}
	if err := s.Close(); err != nil {
		t.Fatal(err)
	}
	failed := filepath.Join(dir, "failed.db")
	if err := s.Backup(failed); err == nil {
		t.Fatal("backup of closed database succeeded")
	}
	if _, err := os.Stat(failed); !os.IsNotExist(err) {
		t.Fatalf("failed backup left an incomplete file: %v", err)
	}
}
