package storage

import (
	"encoding/json"
	"errors"
	"reflect"
	"testing"
)

func TestTransferRoundTripAtomicAndPrecision(t *testing.T) {
	s := openTest(t)
	old, err := s.CreateAccount("EUR savings", "EUR", "2026-01")
	if err != nil {
		t.Fatal(err)
	}
	usd, err := s.CreateAccount("USD savings", "USD", "2026-01")
	if err != nil {
		t.Fatal(err)
	}
	if err := s.PutMonth("2026-01", MonthInput{Balances: []BalanceInput{{old.ID, "9000000000000000"}, {usd.ID, "0"}}, Rates: []RateInput{{"USD", "1.12345678"}}}); err != nil {
		t.Fatal(err)
	}
	if err := s.PutMonth("2026-02", MonthInput{Balances: []BalanceInput{{usd.ID, "0"}}}); err != nil {
		t.Fatal(err)
	}
	if err := s.ArchiveAccount(usd.ID, "2026-03"); err != nil {
		t.Fatal(err)
	}
	if err := s.RestoreAccount(usd.ID, "2026-04"); err != nil {
		t.Fatal(err)
	}
	if err := s.UpdateSettings("ru", "dark"); err != nil {
		t.Fatal(err)
	}

	original, err := s.ExportData()
	if err != nil {
		t.Fatal(err)
	}
	encoded, err := json.Marshal(original)
	if err != nil {
		t.Fatal(err)
	}
	var parsed TransferDocument
	if err := json.Unmarshal(encoded, &parsed); err != nil {
		t.Fatal(err)
	}
	if parsed.Balances[0].AmountMinor != "9000000000000000" {
		t.Fatalf("precision lost: %+v", parsed.Balances)
	}
	if len(parsed.AccountPeriods) != 3 || parsed.Rates[0].RateScaled != "112345678" {
		t.Fatalf("missing details: %+v", parsed)
	}
	if err := s.ImportData(parsed); err != nil {
		t.Fatal(err)
	}
	after, err := s.ExportData()
	if err != nil {
		t.Fatal(err)
	}
	original.ExportedAt = ""
	after.ExportedAt = ""
	if !reflect.DeepEqual(original, after) {
		t.Fatal("export/import changed snapshot")
	}

	broken := parsed
	broken.Balances = append([]TransferBalance{}, parsed.Balances...)
	broken.Balances[0].AmountMinor = "not-a-number"
	if err := s.ImportData(broken); !errors.Is(err, ErrValidation) {
		t.Fatalf("invalid import accepted: %v", err)
	}
	after, err = s.ExportData()
	if err != nil {
		t.Fatal(err)
	}
	after.ExportedAt = ""
	if !reflect.DeepEqual(original, after) {
		t.Fatal("failed import modified database")
	}
}

func TestTransferInvalidDocuments(t *testing.T) {
	s := openTest(t)
	a, err := s.CreateAccount("Cash", "EUR", "2026-01")
	if err != nil {
		t.Fatal(err)
	}
	if err = s.PutMonth("2026-01", MonthInput{Balances: []BalanceInput{{a.ID, "10"}}}); err != nil {
		t.Fatal(err)
	}
	base, err := s.ExportData()
	if err != nil {
		t.Fatal(err)
	}
	tests := map[string]func(*TransferDocument){
		"version":        func(d *TransferDocument) { d.SchemaVersion = 999 },
		"format":         func(d *TransferDocument) { d.Format = "other" },
		"period missing": func(d *TransferDocument) { d.AccountPeriods = nil },
		"period overlap": func(d *TransferDocument) {
			d.AccountPeriods = append(d.AccountPeriods, TransferPeriod{AccountID: a.ID, StartMonth: "2026-01"})
		},
		"bad reference":     func(d *TransferDocument) { d.Balances[0].AccountID = 9999 },
		"duplicate balance": func(d *TransferDocument) { d.Balances = append(d.Balances, d.Balances[0]) },
		"missing account":   func(d *TransferDocument) { d.Accounts = nil },
		"bad rate": func(d *TransferDocument) {
			d.Rates = append(d.Rates, TransferRate{Month: "2026-01", Currency: "USD", RateScaled: "0", UpdatedAt: base.ExportedAt})
		},
		"bad settings": func(d *TransferDocument) { d.Settings = map[string]string{"language": "zz", "theme": "dark"} },
	}
	for name, change := range tests {
		t.Run(name, func(t *testing.T) {
			encoded, _ := json.Marshal(base)
			var d TransferDocument
			if err := json.Unmarshal(encoded, &d); err != nil {
				t.Fatal(err)
			}
			change(&d)
			if err := s.ImportData(d); !errors.Is(err, ErrValidation) {
				t.Fatalf("accepted invalid data: %v", err)
			}
		})
	}
}
