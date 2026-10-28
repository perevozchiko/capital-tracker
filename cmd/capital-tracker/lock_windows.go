//go:build windows

package main

import (
	"errors"
	"os"

	"golang.org/x/sys/windows"
)

// LockFileEx locks an open handle; unlike O_EXCL, the lock is released on crash.
var errAppLocked = errors.New("database locked by another Capital Tracker process")

type appLock struct {
	file       *os.File
	overlapped windows.Overlapped
}

func acquireAppLock(path string) (*appLock, error) {
	file, err := os.OpenFile(path, os.O_RDWR|os.O_CREATE, 0600)
	if err != nil {
		return nil, err
	}
	lock := &appLock{file: file}
	err = windows.LockFileEx(windows.Handle(file.Fd()), windows.LOCKFILE_EXCLUSIVE_LOCK|windows.LOCKFILE_FAIL_IMMEDIATELY, 0, 1, 0, &lock.overlapped)
	if err != nil {
		file.Close()
		if errors.Is(err, windows.ERROR_LOCK_VIOLATION) || errors.Is(err, windows.ERROR_SHARING_VIOLATION) {
			return nil, errAppLocked
		}
		return nil, err
	}
	return lock, nil
}

func (l *appLock) Close() error {
	err := windows.UnlockFileEx(windows.Handle(l.file.Fd()), 0, 1, 0, &l.overlapped)
	closeErr := l.file.Close()
	if err != nil {
		return err
	}
	return closeErr
}
