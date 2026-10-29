package httpapi

import (
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"reflect"
	"sync/atomic"
	"testing"

	"github.com/perevozchiko/capital-tracker/internal/storage"
)

func TestLoadedRateSnapshotSurvivesProviderChangesRestartAndImport(t *testing.T) {
	var quoteVersion, providerRequests atomic.Int32
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		providerRequests.Add(1)
		if r.URL.Path != "/npm/@fawazahmed0/currency-api@latest/v1/currencies/eur.json" {
			t.Errorf("unexpected provider path %s", r.URL.Path)
		}
		w.Header().Set("Content-Type", "application/json")
		if quoteVersion.Load() == 0 {
			io.WriteString(w, `{"date":"2026-10-28","eur":{"usd":1.1,"rsd":117.2,"rub":100,"try":40}}`)
		} else {
			io.WriteString(w, `{"date":"2026-10-29","eur":{"usd":2.2,"rsd":234.4,"rub":200,"try":80}}`)
		}
	}))
	defer upstream.Close()
	target, err := url.Parse(upstream.URL)
	if err != nil {
		t.Fatal(err)
	}
	client := &http.Client{Transport: rateTransportFunc(func(r *http.Request) (*http.Response, error) {
		forwarded := r.Clone(r.Context())
		forwarded.URL.Scheme = target.Scheme
		forwarded.URL.Host = target.Host
		forwarded.Host = target.Host
		return http.DefaultTransport.RoundTrip(forwarded)
	})}
	dir := t.TempDir()
	s, err := storage.Open(dir)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { s.Close() })
	newHandler := func() http.Handler {
		// Keep production request validation and storage routes; replace only the
		// external transport so the provider can change predictably during the test.
		rates := http.NewServeMux()
		registerRatesWithClient(rates, client)
		mux := http.NewServeMux()
		mux.Handle("/api/exchange-rates", secureLocalRequests(rates))
		mux.Handle("/", (&Server{Store: s, Version: "test"}).Handler())
		return mux
	}
	handler := newHandler()
	call := func(method, path string, payload any, code int) map[string]any {
		t.Helper()
		return regressionCall(t, handler, method, path, payload, code)
	}
	balances := []any{}
	for _, tc := range []struct{ currency, amount string }{{"USD", "11000"}, {"RSD", "1172000"}, {"RUB", "1000000"}, {"TRY", "400000"}} {
		account := call("POST", "/api/accounts", map[string]any{"name": tc.currency, "currency": tc.currency, "start_month": "2025-01"}, 201)
		balances = append(balances, map[string]any{"account_id": account["id"], "amount_minor": tc.amount})
	}
	first := call("GET", "/api/exchange-rates?month=2025-01", nil, 200)
	if first["date"] != "2026-10-28" {
		t.Fatal(first)
	}
	unsaved := call("GET", "/api/months/2025-01", nil, 200)
	if unsaved["exists"] != false || len(unsaved["rates"].([]any)) != 0 {
		t.Fatal("loading saved data prematurely", unsaved)
	}
	// The provider moves before Save: PUT must use the first response's values.
	quoteVersion.Store(1)
	save := func(month string, quote map[string]any) {
		t.Helper()
		rates := []any{}
		for currency, rate := range quote["rates"].(map[string]any) {
			rates = append(rates, map[string]any{"currency": currency, "rate": rate})
		}
		call("PUT", "/api/months/"+month, map[string]any{"balances": balances, "rates": rates}, 200)
	}
	save("2025-01", first)
	if providerRequests.Load() != 1 {
		t.Fatal("saving unexpectedly refetched the quote")
	}
	second := call("GET", "/api/exchange-rates?month=2025-02", nil, 200)
	save("2025-02", second)
	assertHistory := func() {
		t.Helper()
		for _, tc := range []struct {
			month, total string
			quote        map[string]any
		}{{"2025-01", "40000", first}, {"2025-02", "20000", second}} {
			got := call("GET", "/api/months/"+tc.month, nil, 200)
			if got["total_eur_minor"] != tc.total || got["complete"] != true {
				t.Fatalf("%s total: %v", tc.month, got)
			}
			savedRates := map[string]any{}
			for _, entry := range got["rates"].([]any) {
				r := entry.(map[string]any)
				savedRates[r["currency"].(string)] = r["rate"]
			}
			if !reflect.DeepEqual(savedRates, tc.quote["rates"]) {
				t.Fatalf("%s rates changed: %v", tc.month, savedRates)
			}
		}
		dashboard := call("GET", "/api/dashboard?month=2025-02", nil, 200)
		if dashboard["change_minor"] != "-20000" || dashboard["change_percent_bp"] != "-5000" {
			t.Fatal("history recalculated using a different quote", dashboard)
		}
		call("GET", "/api/capital/history", nil, 200)
		if providerRequests.Load() != 2 {
			t.Fatal("reading history unexpectedly contacted provider")
		}
	}
	assertHistory()
	if err := s.Close(); err != nil {
		t.Fatal(err)
	}
	s, err = storage.Open(dir)
	if err != nil {
		t.Fatal(err)
	}
	handler = newHandler()
	assertHistory()
	// Re-saving old balances must retain the originally loaded rates.
	save("2025-01", first)
	assertHistory()
	exported, err := s.ExportData()
	if err != nil {
		t.Fatal(err)
	}
	if err := s.ClearData(); err != nil {
		t.Fatal(err)
	}
	if err := s.ImportData(exported); err != nil {
		t.Fatal(err)
	}
	assertHistory()
}
