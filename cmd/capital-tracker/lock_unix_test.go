//go:build darwin || linux

package main

import (
	"errors"
	"path/filepath"
	"testing"
)

func TestAppLockSurvivesStaleFile(t *testing.T) {
	path := filepath.Join(t.TempDir(), ".capital-tracker.lock")
	first, err := acquireAppLock(path)
	if err != nil { t.Fatal(err) }
	if second, err := acquireAppLock(path); !errors.Is(err, errAppLocked) {
		if second != nil { second.Close() }
		t.Fatalf("second instance acquired lock: %v", err)
	}
	if err := first.Close(); err != nil { t.Fatal(err) }
	// The lock filename remains on disk, as after an unclean process exit.
	// Its presence alone must not prevent a fresh launch.
	restart, err := acquireAppLock(path)
	if err != nil { t.Fatalf("stale lock file blocked restart: %v", err) }
	if err := restart.Close(); err != nil { t.Fatal(err) }
}
