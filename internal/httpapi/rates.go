package httpapi

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math/big"
	"net/http"
	"strings"
	"time"

	"github.com/perevozchiko/capital-tracker/internal/finance"
)

var rateClient = &http.Client{Timeout: 8 * time.Second}

// fetchRates reads a bounded response and converts decimal JSON numbers exactly.
func fetchRates(client *http.Client, urls []string, date string) (map[string]string, string, error) {
	for _, url := range urls {
		resp, err := client.Get(url)
		if err != nil {
			continue
		}
		var data struct {
			Date string                 `json:"date"`
			EUR  map[string]json.Number `json:"eur"`
		}
		dec := json.NewDecoder(io.LimitReader(resp.Body, 1024*1024))
		dec.UseNumber()
		err = dec.Decode(&data)
		resp.Body.Close()
		if resp.StatusCode != http.StatusOK || err != nil || (date != "latest" && data.Date != date) {
			continue
		}
		actualDate, dateErr := time.Parse("2006-01-02", data.Date)
		if dateErr != nil || actualDate.After(time.Now().UTC()) {
			continue
		}
		rates := map[string]string{}
		for _, currency := range finance.Currencies() {
			if currency == "EUR" {
				continue
			}
			value, ok := new(big.Rat).SetString(string(data.EUR[strings.ToLower(currency)]))
			if !ok || value.Sign() <= 0 {
				continue
			}
			scaled, err := finance.RoundRat(new(big.Rat).Mul(value, big.NewRat(finance.RateScale, 1)))
			if err == nil && scaled > 0 && scaled <= finance.MaxRateScaled {
				rates[currency] = finance.RateString(scaled)
			}
		}
		if len(rates) > 0 {
			return rates, data.Date, nil
		}
	}
	return nil, "", errors.New("exchange rates unavailable")
}

func registerRates(mux *http.ServeMux) {
	mux.HandleFunc("/api/exchange-rates", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			fail(w, 405, "method_not_allowed", "")
			return
		}
		month := r.URL.Query().Get("month")
		if !finance.ValidMonth(month) {
			fail(w, 422, "validation_error", "month")
			return
		}
		start, _ := time.Parse("2006-01", month)
		now := time.Now().UTC()
		current := now.Format("2006-01")
		if month > current {
			fail(w, 422, "validation_error", "month")
			return
		}
		date := start.AddDate(0, 1, -1).Format("2006-01-02")
		if month == current {
			date = "latest"
		}
		urls := []string{
			fmt.Sprintf("https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@%s/v1/currencies/eur.json", date),
			fmt.Sprintf("https://%s.currency-api.pages.dev/v1/currencies/eur.json", date),
		}
		rates, actualDate, err := fetchRates(rateClient, urls, date)
		if err != nil {
			fail(w, 502, "rates_unavailable", "")
			return
		}
		writeJSON(w, 200, map[string]any{"date": actualDate, "rates": rates})
	})
}
