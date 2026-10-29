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

func TestExchangeRatesRejectsInvalidMonths(t *testing.T) {
	mux := http.NewServeMux()
	registerRates(mux)
	for _, month := range []string{"bad", "2026-13"} {
		req := httptest.NewRequest("GET", "/api/exchange-rates?month="+month, nil)
		res := httptest.NewRecorder()
		mux.ServeHTTP(res, req)
		if res.Code != 422 {
			t.Fatalf("month %q: got %d", month, res.Code)
		}
	}
}

func TestFetchRatesRejectsInvalidResponsesAndFallsBack(t *testing.T) {
	cases := []struct {
		name, body string
		status     int
	}{
		{"http error", `{"date":"2025-01-31","eur":{"usd":1}}`, 500},
		{"malformed JSON", `{`, 200},
		{"wrong date", `{"date":"2025-01-30","eur":{"usd":1}}`, 200},
		{"invalid date", `{"date":"invalid","eur":{"usd":1}}`, 200},
		{"future date", `{"date":"2200-12-31","eur":{"usd":1}}`, 200},
		{"no supported rates", `{"date":"2025-01-31","eur":{"eur":1,"usd":0}}`, 200},
		{"wrong value type", `{"date":"2025-01-31","eur":{"usd":{}}}`, 200},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.URL.Path == "/first" {
					w.WriteHeader(tc.status)
					_, _ = w.Write([]byte(tc.body))
					return
				}
				_, _ = w.Write([]byte(`{"date":"2025-01-31","eur":{"usd":1.2}}`))
			}))
			defer server.Close()
			rates, date, err := fetchRates(server.Client(), []string{server.URL + "/first", server.URL + "/fallback"}, "2025-01-31")
			if err != nil || date != "2025-01-31" || rates["USD"] != "1.2" {
				t.Fatalf("fallback: %v %q %v", rates, date, err)
			}
		})
	}
}

func TestFetchRatesRejectsOutOfRangeValues(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte(`{"date":"2025-01-31","eur":{"usd":0.000000004,"rsd":100000000.00000001,"rub":-2,"try":1e-8}}`))
	}))
	defer server.Close()
	rates, _, err := fetchRates(server.Client(), []string{server.URL}, "2025-01-31")
	if err != nil || len(rates) != 1 || rates["TRY"] != "0.00000001" {
		t.Fatalf("rates=%v err=%v", rates, err)
	}
}

func TestExchangeRatesRejectsWrongMethod(t *testing.T) {
	mux := http.NewServeMux()
	registerRates(mux)
	res := httptest.NewRecorder()
	mux.ServeHTTP(res, httptest.NewRequest(http.MethodPost, "/api/exchange-rates?month=2025-01", nil))
	if res.Code != http.StatusMethodNotAllowed {
		t.Fatalf("status=%d", res.Code)
	}
}
