package httpapi

import (
	"net/http"
	"strings"

	"github.com/perevozchiko/capital-tracker/internal/storage"
)

const snapshotHeader = "X-Capital-Tracker-Snapshot"

func registerBackups(mux *http.ServeMux, s *Server) {
	mux.HandleFunc("/api/backups", func(w http.ResponseWriter, r *http.Request) {
		switch r.Method {
		case http.MethodGet:
			status, err := s.Store.Backups()
			if err != nil {
				handleError(w, err)
				return
			}
			writeJSON(w, http.StatusOK, status)
		case http.MethodPost:
			backup, err := s.Store.CreateBackup()
			if err != nil {
				handleError(w, err)
				return
			}
			writeJSON(w, http.StatusCreated, backup)
		default:
			fail(w, http.StatusMethodNotAllowed, "method_not_allowed", "")
		}
	})
	mux.HandleFunc("/api/backups/", func(w http.ResponseWriter, r *http.Request) {
		id, operation, ok := strings.Cut(strings.TrimPrefix(r.URL.Path, "/api/backups/"), "/")
		if !ok || operation != "restore" {
			fail(w, http.StatusNotFound, "not_found", "")
			return
		}
		if r.Method != http.MethodPost {
			fail(w, http.StatusMethodNotAllowed, "method_not_allowed", "")
			return
		}
		if r.Header.Get("X-Capital-Tracker-Restore") != "replace" {
			fail(w, http.StatusUnprocessableEntity, "validation_error", "confirm")
			return
		}
		safety, err := s.Store.RestoreBackup(id)
		if err != nil {
			handleError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"ok": true, "safety_backup": safety})
	})
}

// Preview selection belongs to each request/tab, never to the shared server.
// Authentication and same-origin checks wrap this middleware.
func (s *Server) backupView(live http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		id := r.Header.Get(snapshotHeader)
		if id == "" || !strings.HasPrefix(r.URL.Path, "/api/") {
			live.ServeHTTP(w, r)
			return
		}
		if r.Method != http.MethodGet {
			fail(w, http.StatusForbidden, "backup_read_only", "")
			return
		}
		if r.URL.Path == "/api/backups" || r.URL.Path == "/api/meta" || strings.HasPrefix(r.URL.Path, "/api/auth/") {
			live.ServeHTTP(w, r)
			return
		}
		if strings.HasPrefix(r.URL.Path, "/api/update/") || r.URL.Path == "/api/exchange-rates" || strings.HasPrefix(r.URL.Path, "/api/backups/") {
			fail(w, http.StatusForbidden, "backup_read_only", "")
			return
		}
		err := s.Store.WithBackup(id, func(archive *storage.Store) error {
			view := *s
			view.Store = archive
			view.routes().ServeHTTP(w, r)
			return nil
		})
		if err != nil {
			if err == storage.ErrNotFound {
				fail(w, http.StatusNotFound, "backup_not_found", "")
			} else {
				handleError(w, err)
			}
		}
	})
}
