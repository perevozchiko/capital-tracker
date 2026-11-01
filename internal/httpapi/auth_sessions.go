package httpapi

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"time"
)

const (
	sessionCookieLifetime   = 30 * 24 * time.Hour
	sessionIdleTimeout      = 7 * 24 * time.Hour
	sessionActivityInterval = time.Hour
)

type sessionState struct {
	ExpiresAt time.Time `json:"expires_at"`
	LastSeen  time.Time `json:"last_seen"`
}

func (s sessionState) valid(now time.Time) bool {
	return !s.LastSeen.IsZero() && now.Before(s.ExpiresAt) && now.Before(s.LastSeen.Add(sessionIdleTimeout))
}

func (s sessionState) maxAge(now time.Time) int {
	return int((s.ExpiresAt.Sub(now) + time.Second - 1) / time.Second)
}

type savedSession struct {
	Key string `json:"key"`
	sessionState
}

// Session hashes are separate from the financial database and its backups.
type savedSessions struct {
	Version     int            `json:"version"`
	Credentials string         `json:"credentials"`
	Sessions    []savedSession `json:"sessions"`
}

func sessionKey(token string) string {
	key := sha256.Sum256([]byte(token))
	return hex.EncodeToString(key[:])
}

// Called once at startup, after the application's data-directory lock is held.
func (a *Auth) loadSessions() error {
	a.sessions = make(map[string]sessionState)
	data, err := os.ReadFile(a.sessionPath)
	if err != nil && !os.IsNotExist(err) {
		return fmt.Errorf("read auth sessions: %w", err)
	}
	if err == nil {
		var envelope struct {
			Version  int             `json:"version"`
			Sessions json.RawMessage `json:"sessions"`
		}
		if err := json.Unmarshal(data, &envelope); err != nil {
			return fmt.Errorf("decode auth sessions: %w", err)
		}
		if envelope.Version == 0 {
			// Legacy hashes have no trustworthy creation time. Revoke them once
			// during upgrade instead of granting a fresh lifetime on every restart.
			var legacy []string
			if err := json.Unmarshal(envelope.Sessions, &legacy); err != nil {
				return fmt.Errorf("decode legacy auth sessions: %w", err)
			}
			for _, key := range legacy {
				if !validSessionKey(key) {
					return fmt.Errorf("invalid auth session hash")
				}
			}
			return a.saveSessions()
		}
		if envelope.Version != 1 {
			return fmt.Errorf("unsupported auth sessions version %d", envelope.Version)
		}
		var saved savedSessions
		if err := json.Unmarshal(data, &saved); err != nil {
			return fmt.Errorf("decode auth sessions: %w", err)
		}
		if saved.Credentials == a.credentials {
			for _, session := range saved.Sessions {
				if !validSessionKey(session.Key) || session.LastSeen.IsZero() || !session.ExpiresAt.After(session.LastSeen) {
					return fmt.Errorf("invalid auth session")
				}
				if session.valid(a.now()) {
					a.sessions[session.Key] = session.sessionState
				}
			}
			return a.saveSessions()
		}
	}
	// Persist credential changes immediately so reverting credentials cannot
	// restore sessions that were previously revoked by the change.
	return a.saveSessions()
}

func validSessionKey(key string) bool {
	decoded, err := hex.DecodeString(key)
	return err == nil && len(decoded) == sha256.Size
}

// Caller holds a.mu, or is initializing Auth before serving requests.
func (a *Auth) saveSessions() error {
	saved := savedSessions{Version: 1, Credentials: a.credentials, Sessions: make([]savedSession, 0, len(a.sessions))}
	for key, session := range a.sessions {
		if session.valid(a.now()) {
			saved.Sessions = append(saved.Sessions, savedSession{Key: key, sessionState: session})
		}
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
