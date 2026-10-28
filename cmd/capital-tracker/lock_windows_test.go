//go:build windows

package main

import (
	"errors"
	"path/filepath"
	"testing"
)

func TestWindowsLockReleasedOnClose(t *testing.T) {
	path := filepath.Join(t.TempDir(), ".capital-tracker.lock")
	first, err := acquireAppLock(path)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := acquireAppLock(path); !errors.Is(err, errAppLocked) {
		t.Fatalf("second process acquired active lock: %v", err)
	}
	if err := first.Close(); err != nil {
		t.Fatal(err)
	}
	second, err := acquireAppLock(path)
	if err != nil {
		t.Fatalf("persisting lock file blocked restart: %v", err)
	}
	if err := second.Close(); err != nil {
		t.Fatal(err)
	}
}
