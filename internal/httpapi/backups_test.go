package httpapi

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/perevozchiko/capital-tracker/internal/storage"
)

func TestBackupAPIPreviewIsIsolatedReadOnlyAndRestoreIsReversible(t *testing.T) {
	s, err := storage.Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	a, err := s.CreateAccount("Old bank", "EUR", "2026-01")
	if err != nil {
		t.Fatal(err)
	}
	handler := (&Server{Store: s, Version: "test"}).Handler()
	call := func(method, path, snapshot string, headers map[string]string) *httptest.ResponseRecorder {
		t.Helper()
		r := httptest.NewRequest(method, "http://127.0.0.1:8765/api"+path, nil)
		r.Header.Set("X-Capital-Tracker", "1")
		if snapshot != "" {
			r.Header.Set(snapshotHeader, snapshot)
		}
		for key, value := range headers {
			r.Header.Set(key, value)
		}
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, r)
		return w
	}
	created := call("POST", "/backups", "", nil)
	if created.Code != 201 {
		t.Fatalf("create: %d %s", created.Code, created.Body)
	}
	var backup storage.BackupInfo
	if err := json.Unmarshal(created.Body.Bytes(), &backup); err != nil {
		t.Fatal(err)
	}
	name := "Current bank"
	if _, err := s.UpdateAccount(a.ID, &name, nil); err != nil {
		t.Fatal(err)
	}
	for _, path := range []string{"/accounts", "/data/export"} {
		archived := call("GET", path, backup.ID, nil)
		if archived.Code != 200 || !strings.Contains(archived.Body.String(), "Old bank") || strings.Contains(archived.Body.String(), "Current bank") {
			t.Fatalf("archive %s: %d %s", path, archived.Code, archived.Body)
		}
		if archived.Header().Get("Cache-Control") != "no-store" {
			t.Fatal("archive response can be cached")
		}
		live := call("GET", path, "", nil)
		if live.Code != 200 || !strings.Contains(live.Body.String(), "Current bank") {
			t.Fatalf("live %s: %d %s", path, live.Code, live.Body)
		}
	}
	for _, request := range []struct{ method, path string }{
		{"POST", "/accounts"}, {"PUT", "/months/2026-01"},
		{"POST", "/data/clear"}, {"POST", "/data/import"},
		{"POST", "/backups"}, {"PATCH", "/settings"},
		{"POST", "/backups/" + backup.ID + "/restore"},
		{"GET", "/update/status"}, {"POST", "/update/check"}, {"POST", "/update/start"},
		{"GET", "/exchange-rates"},
	} {
		w := call(request.method, request.path, backup.ID, nil)
		if w.Code != 403 || !strings.Contains(w.Body.String(), "backup_read_only") {
			t.Fatalf("archive allowed %s %s: %d %s", request.method, request.path, w.Code, w.Body)
		}
	}
	missing := "20000101T000000.000000000Z-manual.db"
	if w := call("GET", "/accounts", missing, nil); w.Code != 404 || !strings.Contains(w.Body.String(), "backup_not_found") {
		t.Fatalf("missing archive fell back to live data: %d %s", w.Code, w.Body)
	}
	path := "/backups/" + backup.ID + "/restore"
	if w := call("POST", path, "", nil); w.Code != 422 {
		t.Fatalf("restore without confirmation: %d %s", w.Code, w.Body)
	}
	if w := call("POST", path, "", map[string]string{"Origin": "https://evil.example", "X-Capital-Tracker-Restore": "replace"}); w.Code != 403 {
		t.Fatalf("cross-origin restore allowed: %d", w.Code)
	}
	w := call("POST", path, "", map[string]string{"X-Capital-Tracker-Restore": "replace"})
	if w.Code != 200 {
		t.Fatalf("restore: %d %s", w.Code, w.Body)
	}
	var response struct {
		Safety storage.BackupInfo `json:"safety_backup"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &response); err != nil {
		t.Fatal(err)
	}
	if w := call("GET", "/accounts", "", nil); !strings.Contains(w.Body.String(), "Old bank") {
		t.Fatal("restore did not replace live data")
	}
	w = call("POST", "/backups/"+response.Safety.ID+"/restore", "", map[string]string{"X-Capital-Tracker-Restore": "replace"})
	if w.Code != 200 {
		t.Fatalf("undo restore: %d %s", w.Code, w.Body)
	}
	if w := call("GET", "/accounts", "", nil); !strings.Contains(w.Body.String(), "Current bank") {
		t.Fatal("recovery did not return current data")
	}
}

func TestBackupRequiresCSRFHeader(t *testing.T) {
	s, err := storage.Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	h := (&Server{Store: s}).Handler()
	r := httptest.NewRequest(http.MethodPost, "http://127.0.0.1:8765/api/backups", nil)
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	if w.Code != 403 {
		t.Fatalf("backup without CSRF header: %d", w.Code)
	}
}
