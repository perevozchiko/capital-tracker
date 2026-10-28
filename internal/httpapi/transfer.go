package httpapi

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/perevozchiko/capital-tracker/internal/storage"
)

const maxJSONImportSize = 8 << 20

func registerTransfer(mux *http.ServeMux, s *Server) {
	mux.HandleFunc("/api/data/export", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			fail(w, http.StatusMethodNotAllowed, "method_not_allowed", "")
			return
		}
		data, err := s.Store.ExportData()
		if err != nil {
			handleError(w, err)
			return
		}
		w.Header().Set("Content-Disposition", "attachment; filename=capital-tracker-"+time.Now().UTC().Format("20060102-150405")+".json")
		writeJSON(w, http.StatusOK, data)
	})
	mux.HandleFunc("/api/data/import", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			fail(w, http.StatusMethodNotAllowed, "method_not_allowed", "")
			return
		}
		// Import is destructive: require a separate opt-in header in addition
		// to the application's existing same-origin/CSRF protections.
		if r.Header.Get("X-Capital-Tracker-Import") != "replace" {
			fail(w, http.StatusUnprocessableEntity, "validation_error", "confirm")
			return
		}
		if !strings.HasPrefix(strings.ToLower(r.Header.Get("Content-Type")), "application/json") {
			fail(w, http.StatusBadRequest, "invalid_json", "")
			return
		}
		r.Body = http.MaxBytesReader(w, r.Body, maxJSONImportSize)
		decoder := json.NewDecoder(r.Body)
		decoder.DisallowUnknownFields()
		var data storage.TransferDocument
		err := decoder.Decode(&data)
		if err == nil {
			var extra any
			if trailing := decoder.Decode(&extra); trailing != io.EOF {
				if trailing != nil {
					err = trailing
				} else {
					err = errors.New("trailing JSON")
				}
			}
		}
		if err != nil {
			var large *http.MaxBytesError
			if errors.As(err, &large) {
				fail(w, http.StatusRequestEntityTooLarge, "json_too_large", "")
			} else {
				fail(w, http.StatusBadRequest, "invalid_json", "")
			}
			return
		}
		if err := s.Store.ImportData(data); err != nil {
			handleError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
	})
}
