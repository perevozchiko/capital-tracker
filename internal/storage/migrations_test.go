package storage

import (
	"path/filepath"
	"testing"
)

func TestMigrationDiscoveryAndConnectionPragmas(t *testing.T) {
	paths, err := migrationsList()
	if err != nil || len(paths) != 2 || paths[0] != "migrations/001_init.sql" || paths[1] != "migrations/002_account_groups.sql" {
		t.Fatalf("unexpected migration list: %v %v", paths, err)
	}
	dataDir := filepath.Join(t.TempDir(), "data # special")
	s, err := Open(dataDir)
	if err != nil {
		t.Fatal(err)
	}
	var version, foreignKeys int
	if err := s.DB.QueryRow("PRAGMA user_version").Scan(&version); err != nil {
		t.Fatal(err)
	}
	if err := s.DB.QueryRow("PRAGMA foreign_keys").Scan(&foreignKeys); err != nil {
		t.Fatal(err)
	}
	if version != len(paths) || foreignKeys != 1 {
		t.Fatalf("unexpected SQLite settings: user_version=%d, foreign_keys=%d", version, foreignKeys)
	}
	if err := s.Close(); err != nil {
		t.Fatal(err)
	}
	s, err = Open(dataDir)
	if err != nil {
		t.Fatalf("reopening already migrated database: %v", err)
	}
	defer s.Close()
	var applied int
	if err := s.DB.QueryRow("SELECT COUNT(*) FROM schema_migrations").Scan(&applied); err != nil {
		t.Fatal(err)
	}
	if applied != 2 {
		t.Fatalf("migration re-applied: %d", applied)
	}
}
