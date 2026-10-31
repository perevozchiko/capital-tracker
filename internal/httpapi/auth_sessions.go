package httpapi

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
)

// Session hashes are separate from the financial database and its backups.
type savedSessions struct {
	Credentials string   `json:"credentials"`
	Sessions    []string `json:"sessions"`
}

func sessionKey(token string) string {
	key := sha256.Sum256([]byte(token))
	return hex.EncodeToString(key[:])
}

// Called once at startup, after the application's data-directory lock is held.
func (a *Auth) loadSessions() error {
	a.sessions = make(map[string]struct{})
	data, err := os.ReadFile(a.sessionPath)
	if err != nil && !os.IsNotExist(err) {
		return fmt.Errorf("read auth sessions: %w", err)
	}
	if err == nil {
		var saved savedSessions
		if err := json.Unmarshal(data, &saved); err != nil {
			return fmt.Errorf("decode auth sessions: %w", err)
		}
		if saved.Credentials == a.credentials {
			for _, key := range saved.Sessions {
				decoded, err := hex.DecodeString(key)
				if err != nil || len(decoded) != sha256.Size {
					return fmt.Errorf("invalid auth session hash")
				}
				a.sessions[key] = struct{}{}
			}
			return nil
		}
	}
	// Persist credential changes immediately so reverting credentials cannot
	// restore sessions that were previously revoked by the change.
	return a.saveSessions()
}

// Caller holds a.mu, or is initializing Auth before serving requests.
func (a *Auth) saveSessions() error {
	saved := savedSessions{Credentials: a.credentials, Sessions: make([]string, 0, len(a.sessions))}
	for key := range a.sessions {
		saved.Sessions = append(saved.Sessions, key)
	}
	data, err := json.Marshal(saved)
	if err != nil {
		return err
	}
	// A complete replacement keeps the previous file intact if writing fails.
	file, err := os.CreateTemp(filepath.Dir(a.sessionPath), ".auth-sessions-*")
	if err != nil {
		return fmt.Errorf("create auth sessions: %w", err)
	}
	defer os.Remove(file.Name())
	if _, err = file.Write(data); err != nil {
		file.Close()
		return fmt.Errorf("write auth sessions: %w", err)
	}
	if err = file.Sync(); err != nil {
		file.Close()
		return fmt.Errorf("sync auth sessions: %w", err)
	}
	if err = file.Close(); err != nil {
		return fmt.Errorf("close auth sessions: %w", err)
	}
	if err = os.Rename(file.Name(), a.sessionPath); err != nil {
		return fmt.Errorf("replace auth sessions: %w", err)
	}
	return nil
}
