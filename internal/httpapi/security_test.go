package httpapi

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/perevozchiko/capital-tracker/internal/storage"
)

func TestHostOriginAndCSRFRejections(t *testing.T) {
	handler := (&Server{Version: "test"}).Handler()
	tests := []struct {
		name   string
		host   string
		origin string
		site   string
		csrf   bool
		method string
		status int
		code   string
	}{
		{"foreign host", "evil.example:8765", "", "", true, http.MethodPost, 403, "invalid_host"},
		{"foreign host on GET", "evil.example:8765", "", "", false, http.MethodGet, 403, "invalid_host"},
		{"missing csrf", "127.0.0.1:8765", "", "", false, http.MethodPost, 403, "csrf_header_required"},
		{"foreign origin", "127.0.0.1:8765", "http://evil.example:8765", "", true, http.MethodPost, 403, "invalid_origin"},
		{"origin port mismatch", "127.0.0.1:8765", "http://127.0.0.1:9000", "", true, http.MethodPost, 403, "invalid_origin"},
		{"origin scheme mismatch", "127.0.0.1:8765", "https://127.0.0.1:8765", "", true, http.MethodPost, 403, "invalid_origin"},
		{"cross-site fetch", "127.0.0.1:8765", "", "cross-site", true, http.MethodPost, 403, "cross_site_request"},
		{"matching origin", "127.0.0.1:8765", "http://127.0.0.1:8765", "same-origin", true, http.MethodPost, 405, "method_not_allowed"},
		{"allowed GET", "localhost:8765", "", "", false, http.MethodGet, 200, ""},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			req := httptest.NewRequest(tc.method, "http://127.0.0.1:8765/api/meta", nil)
			req.Host = tc.host
			if tc.csrf {
				req.Header.Set("X-Capital-Tracker", "1")
			}
			if tc.origin != "" {
				req.Header.Set("Origin", tc.origin)
			}
			if tc.site != "" {
				req.Header.Set("Sec-Fetch-Site", tc.site)
			}
			rec := httptest.NewRecorder()
			handler.ServeHTTP(rec, req)
			if rec.Code != tc.status {
				t.Fatalf("HTTP status: got %d, want %d: %s", rec.Code, tc.status, rec.Body.String())
			}
			if tc.code != "" {
				var body struct {
					Error struct {
						Code string `json:"code"`
					} `json:"error"`
				}
				if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
					t.Fatal(err)
				}
				if body.Error.Code != tc.code {
					t.Fatalf("error code: got %q, want %q", body.Error.Code, tc.code)
				}
			}
		})
	}
}

func TestDomainErrorStableAPIContract(t *testing.T) {
	for _, tc := range []struct {
		err    error
		status int
		code   string
		field  string
		reason string
	}{
		{&storage.DomainError{Kind: storage.ErrConflict, Reason: "month_exists"}, 409, "conflict", "", "month_exists"},
		{&storage.DomainError{Kind: storage.ErrValidation, Field: "balances"}, 422, "validation_error", "balances", ""},
		{&storage.DomainError{Kind: storage.ErrValidation, Field: "total_eur_minor", Reason: "total_overflow"}, 422, "validation_error", "total_eur_minor", ""},
	} {
		rec := httptest.NewRecorder()
		handleError(rec, tc.err)
		if rec.Code != tc.status {
			t.Fatalf("status %d != %d", rec.Code, tc.status)
		}
		var body struct {
			Error apiError `json:"error"`
		}
		if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
			t.Fatal(err)
		}
		if body.Error.Code != tc.code || body.Error.Field != tc.field || body.Error.Reason != tc.reason {
			t.Fatalf("unexpected API error: %+v", body.Error)
		}
	}
}
