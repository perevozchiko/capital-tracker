//go:build darwin || linux

package main

import (
	"errors"
	"os"
	"syscall"
)

// Advisory locks are released by the kernel even if the process is killed.
// The lock file itself is deliberately persistent; removing it would race
// with a second process already waiting to acquire the same inode.
var errAppLocked = errors.New("database locked by another Capital Tracker process")

type appLock struct{ file *os.File }

func acquireAppLock(path string) (*appLock, error) {
	file, err := os.OpenFile(path, os.O_RDWR|os.O_CREATE, 0600)
	if err != nil {
		return nil, err
	}
	if err := syscall.Flock(int(file.Fd()), syscall.LOCK_EX|syscall.LOCK_NB); err != nil {
		file.Close()
		if err == syscall.EWOULDBLOCK || err == syscall.EAGAIN {
			return nil, errAppLocked
		}
		return nil, err
	}
	return &appLock{file: file}, nil
}

func (l *appLock) Close() error {
	err := syscall.Flock(int(l.file.Fd()), syscall.LOCK_UN)
	closeErr := l.file.Close()
	if err != nil {
		return err
	}
	return closeErr
}
