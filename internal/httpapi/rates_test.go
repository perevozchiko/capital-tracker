package httpapi

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestFetchRatesFallbackAndRounding(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/bad" {
			http.Error(w, "unavailable", 503)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"date":"2025-02-28","eur":{"usd":1.123456785,"rsd":117.2,"rub":-1,"try":0}}`))
	}))
	defer server.Close()
	rates, date, err := fetchRates(server.Client(), []string{server.URL + "/bad", server.URL + "/good"}, "2025-02-28")
	if err != nil || date != "2025-02-28" || rates["USD"] != "1.12345679" || rates["RSD"] != "117.2" || len(rates) != 2 {
		t.Fatalf("rates=%v date=%q err=%v", rates, date, err)
	}
	if _, _, err := fetchRates(server.Client(), []string{server.URL + "/good"}, "2025-02-27"); err == nil {
		t.Fatal("accepted wrong historical date")
	}
}

func TestExchangeRatesRejectsInvalidAndFutureMonths(t *testing.T) {
	mux := http.NewServeMux()
	registerRates(mux)
	for _, month := range []string{"bad", "2200-12"} {
		req := httptest.NewRequest("GET", "/api/exchange-rates?month="+month, nil)
		res := httptest.NewRecorder()
		mux.ServeHTTP(res, req)
		if res.Code != 422 {
			t.Fatalf("month %q: got %d", month, res.Code)
		}
	}
}
