package httpapi

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

type rateTransportFunc func(*http.Request) (*http.Response, error)

func (f rateTransportFunc) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }

func TestLatestRatesAreOnDemandForAnySelectedMonth(t *testing.T) {
	for _, query := range []string{"", "?month=2025-01", "?month=2200-12"} {
		t.Run(query, func(t *testing.T) {
			var urls []string
			client := &http.Client{Transport: rateTransportFunc(func(r *http.Request) (*http.Response, error) {
				urls = append(urls, r.URL.String())
				return &http.Response{StatusCode: 200, Body: io.NopCloser(strings.NewReader(`{"date":"2025-01-31","eur":{"usd":1.123456785,"rsd":117.2,"rub":100,"try":40}}`)), Header: make(http.Header)}, nil
			})}
			mux := http.NewServeMux()
			registerRatesWithClient(mux, client)
			if len(urls) != 0 {
				t.Fatal("registration fetched rates automatically")
			}
			for i := 0; i < 2; i++ {
				rec := httptest.NewRecorder()
				mux.ServeHTTP(rec, httptest.NewRequest("GET", "/api/exchange-rates"+query, nil))
				if rec.Code != 200 || rec.Header().Get("Cache-Control") != "no-store" {
					t.Fatalf("response: %d %v %s", rec.Code, rec.Header(), rec.Body.String())
				}
				var got struct {
					Date  string            `json:"date"`
					Rates map[string]string `json:"rates"`
				}
				if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
					t.Fatal(err)
				}
				if got.Date != "2025-01-31" || got.Rates["USD"] != "1.12345679" || len(got.Rates) != 4 {
					t.Fatalf("quote: %+v", got)
				}
			}
			// Each explicit request must fetch latest again instead of reusing a month-end quote.
			if len(urls) != 2 {
				t.Fatalf("requests=%v", urls)
			}
			for _, url := range urls {
				if url != "https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/eur.json" {
					t.Fatalf("not latest: %s", url)
				}
			}
		})
	}
}

func TestLatestRatesFallbackAndUnavailable(t *testing.T) {
	for _, bothFail := range []bool{false, true} {
		t.Run(map[bool]string{false: "fallback succeeds", true: "both unavailable"}[bothFail], func(t *testing.T) {
			var urls []string
			client := &http.Client{Transport: rateTransportFunc(func(r *http.Request) (*http.Response, error) {
				urls = append(urls, r.URL.String())
				if len(urls) == 1 {
					return nil, errors.New("connection failed")
				}
				body := `{"date":"2025-01-31","eur":{"usd":1.1}}`
				status := 200
				if bothFail {
					status = 403
					body = "forbidden"
				}
				return &http.Response{StatusCode: status, Body: io.NopCloser(strings.NewReader(body)), Header: make(http.Header)}, nil
			})}
			mux := http.NewServeMux()
			registerRatesWithClient(mux, client)
			rec := httptest.NewRecorder()
			mux.ServeHTTP(rec, httptest.NewRequest("GET", "/api/exchange-rates?month=2025-01", nil))
			if len(urls) != 2 || urls[1] != "https://latest.currency-api.pages.dev/v1/currencies/eur.json" {
				t.Fatalf("fallback URLs: %v", urls)
			}
			if bothFail {
				if rec.Code != 502 || !strings.Contains(rec.Body.String(), "rates_unavailable") {
					t.Fatalf("failure: %d %s", rec.Code, rec.Body.String())
				}
			} else if rec.Code != 200 || !strings.Contains(rec.Body.String(), `"USD":"1.1"`) {
				t.Fatalf("fallback: %d %s", rec.Code, rec.Body.String())
			}
		})
	}
}

func TestInvalidLatestRateRequestsDoNotContactProvider(t *testing.T) {
	client := &http.Client{Transport: rateTransportFunc(func(r *http.Request) (*http.Response, error) {
		t.Fatal("invalid request contacted provider")
		return nil, errors.New("unexpected request")
	})}
	mux := http.NewServeMux()
	registerRatesWithClient(mux, client)
	for _, tc := range []struct {
		method, query string
		code          int
	}{
		{"GET", "?month=invalid", 422}, {"GET", "?month=2026-13", 422}, {"POST", "", 405},
	} {
		rec := httptest.NewRecorder()
		mux.ServeHTTP(rec, httptest.NewRequest(tc.method, "/api/exchange-rates"+tc.query, nil))
		if rec.Code != tc.code {
			t.Fatalf("%s %s: %d", tc.method, tc.query, rec.Code)
		}
	}
}
