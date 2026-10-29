package httpapi

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strconv"
	"strings"

	"github.com/perevozchiko/capital-tracker/internal/storage"
)

type apiError struct {
	Code    string `json:"code"`
	Field   string `json:"field,omitempty"`
	Message string `json:"message,omitempty"`
	Reason  string `json:"reason,omitempty"`
}

func writeJSON(w http.ResponseWriter, status int, data any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(data)
}
func fail(w http.ResponseWriter, status int, code, field string) {
	writeJSON(w, status, map[string]any{"error": apiError{Code: code, Field: field}})
}
func handleError(w http.ResponseWriter, e error) {
	if errors.Is(e, storage.ErrNotFound) {
		fail(w, 404, "not_found", "")
		return
	}
	var domain *storage.DomainError
	if errors.As(e, &domain) {
		if errors.Is(e, storage.ErrConflict) {
			writeJSON(w, 409, map[string]any{"error": apiError{Code: "conflict", Reason: domain.Reason}})
			return
		}
		if errors.Is(e, storage.ErrValidation) {
			fail(w, 422, "validation_error", domain.Field)
			return
		}
	}
	fail(w, 500, "internal_error", "")
}

func decode(r *http.Request, v any) error {
	if !strings.HasPrefix(strings.ToLower(r.Header.Get("Content-Type")), "application/json") {
		return errors.New("json content type required")
	}
	reader := io.LimitReader(r.Body, 1024*1024+1)
	dec := json.NewDecoder(reader)
	dec.DisallowUnknownFields()
	if err := dec.Decode(v); err != nil {
		return err
	}
	var second any
	if err := dec.Decode(&second); err != io.EOF {
		return errors.New("unexpected trailing content")
	}
	return nil
}
func readJSON(w http.ResponseWriter, r *http.Request, v any) bool {
	if e := decode(r, v); e != nil {
		fail(w, 400, "invalid_json", "")
		return false
	}
	return true
}
func pathID(s string) (int64, bool) {
	if s == "" || strings.Contains(s, "/") {
		return 0, false
	}
	id, e := strconv.ParseInt(s, 10, 64)
	return id, id > 0 && e == nil
}
