package httpapi

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/perevozchiko/capital-tracker/internal/storage"
)

func TestTransferEndpointsAndImportSafety(t *testing.T) {
	s, err := storage.Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	a, err := s.CreateAccount("A", "EUR", "2026-01")
	if err != nil {
		t.Fatal(err)
	}
	if err := s.PutMonth("2026-01", storage.MonthInput{Balances: []storage.BalanceInput{{AccountID: a.ID, AmountMinor: "12345"}}}); err != nil {
		t.Fatal(err)
	}
	h := (&Server{Store: s, Version: "test"}).Handler()
	call := func(method, path, body string, withCSRF, withConfirm bool, ctype string) *httptest.ResponseRecorder {
		t.Helper()
		req := httptest.NewRequest(method, "http://127.0.0.1:8765"+path, strings.NewReader(body))
		if withCSRF {
			req.Header.Set("X-Capital-Tracker", "1")
		}
		if withConfirm {
			req.Header.Set("X-Capital-Tracker-Import", "replace")
		}
		if ctype != "" {
			req.Header.Set("Content-Type", ctype)
		}
		w := httptest.NewRecorder()
		h.ServeHTTP(w, req)
		return w
	}
	exported := call("GET", "/api/data/export", "", false, false, "")
	if exported.Code != 200 || !strings.Contains(exported.Header().Get("Content-Disposition"), ".json") {
		t.Fatalf("export: %d", exported.Code)
	}
	var doc storage.TransferDocument
	if err := json.NewDecoder(bytes.NewReader(exported.Body.Bytes())).Decode(&doc); err != nil {
		t.Fatal(err)
	}
	if len(doc.Balances) != 1 || doc.Balances[0].AmountMinor != "12345" {
		t.Fatalf("missing data: %+v", doc)
	}
	body := exported.Body.String()
	for name, setup := range map[string]struct {
		csrf, confirm bool
		ctype         string
		code          int
	}{
		"csrf":         {false, true, "application/json", 403},
		"confirmation": {true, false, "application/json", 422},
		"content type": {true, true, "text/plain", 400},
		"valid":        {true, true, "application/json", 200},
	} {
		t.Run(name, func(t *testing.T) {
			w := call("POST", "/api/data/import", body, setup.csrf, setup.confirm, setup.ctype)
			if w.Code != setup.code {
				t.Fatalf("%d: %s", w.Code, w.Body.String())
			}
		})
	}
	bad := call("POST", "/api/data/import", `{"format":"wrong"}`, true, true, "application/json")
	if bad.Code != 422 {
		t.Fatalf("invalid schema: %d", bad.Code)
	}
	tooLarge := call("POST", "/api/data/import", strings.Repeat(" ", maxJSONImportSize+1), true, true, "application/json")
	if tooLarge.Code != 413 {
		t.Fatalf("oversized import: %d", tooLarge.Code)
	}
	last, err := s.Month("2026-01")
	if err != nil || !last.Complete || *last.TotalEURMinor != "12345" {
		t.Fatalf("import changed data after failed upload: %+v %v", last, err)
	}
	if w := call(http.MethodPut, "/api/data/import", body, true, true, "application/json"); w.Code != 405 {
		t.Fatalf("method: %d", w.Code)
	}
}
