package httpapi

import (
	"bytes"
	"encoding/json"
	"net/http/httptest"
	"testing"

	"github.com/perevozchiko/capital-tracker/internal/storage"
)

func TestMonthDeletionNeedsExplicitConfirmationAndProtectsOtherMonths(t *testing.T) {
	s, err := storage.Open(t.TempDir())
	if err != nil { t.Fatal(err) }
	defer s.Close()
	a, err := s.CreateAccount("Cash", "EUR", "2026-09")
	if err != nil { t.Fatal(err) }
	if err := s.PutMonth("2026-09", storage.MonthInput{Balances: []storage.BalanceInput{{AccountID:a.ID,AmountMinor:"100"}}}); err != nil { t.Fatal(err) }
	if err := s.PutMonth("2026-10", storage.MonthInput{Balances: []storage.BalanceInput{{AccountID:a.ID,AmountMinor:"200"}}}); err != nil { t.Fatal(err) }

	handler := (&Server{Store:s,Version:"test"}).Handler()
	call := func(method, path string, body string, csrf bool) (int, map[string]any) {
		t.Helper()
		req := httptest.NewRequest(method, "http://127.0.0.1:8765"+path, bytes.NewBufferString(body))
		if body != "" { req.Header.Set("Content-Type","application/json") }
		if csrf { req.Header.Set("X-Capital-Tracker","1") }
		rec := httptest.NewRecorder()
		handler.ServeHTTP(rec,req)
		var out map[string]any
		if rec.Body.Len()>0 { _=json.Unmarshal(rec.Body.Bytes(),&out) }
		return rec.Code,out
	}
	if code,_:=call("DELETE","/api/months/2026-09",`{"confirm":true}`,false); code!=403 { t.Fatalf("missing CSRF allowed: %d",code) }
	if code,_:=call("DELETE","/api/months/2026-09",`{"confirm":false}`,true); code!=422 { t.Fatalf("missing confirmation allowed: %d",code) }
	if code,_:=call("DELETE","/api/months/2026-09",`{"confirm":true}`,true); code!=204 { t.Fatalf("delete: %d",code) }
	if code,_:=call("DELETE","/api/months/2026-09",`{"confirm":true}`,true); code!=404 { t.Fatalf("repeat delete: %d",code) }
	if code,out:=call("GET","/api/months/2026-10","",false); code!=200||out["total_eur_minor"]!="200" { t.Fatalf("other month changed: %d %+v",code,out) }
	if code,out:=call("GET","/api/dashboard?month=2026-10&columns=24","",false); code!=200||len(out["columns"].([]any))!=24 { t.Fatalf("columns: %d %+v",code,out) }
	if code,_:=call("GET","/api/dashboard?month=2026-10&columns=121","",false); code!=422 { t.Fatalf("invalid columns: %d",code) }
	if code,out:=call("GET","/api/currencies","",false); code!=200||len(out["currencies"].([]any))!=5 { t.Fatalf("currencies: %d %+v",code,out) }
}
