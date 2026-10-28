//go:build windows

package main

import (
	"errors"
	"os"
)

// Until Windows builds are re-enabled, Windows retains the exclusive
// creation fallback. Native macOS and Linux use kernel advisory locks.
var errAppLocked = errors.New("database locked by another Capital Tracker process")

type appLock struct {
	file *os.File
	path string
}

func acquireAppLock(path string) (*appLock, error) {
	f, err := os.OpenFile(path, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
	if os.IsExist(err) {
		return nil, errAppLocked
	}
	if err != nil {
		return nil, err
	}
	return &appLock{file: f, path: path}, nil
}

func (l *appLock) Close() error {
	err := l.file.Close()
	removeErr := os.Remove(l.path)
	if err != nil {
		return err
	}
	return removeErr
}
