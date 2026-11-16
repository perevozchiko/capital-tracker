package storage

import (
	"errors"
	"testing"
)

func wantAmount(t *testing.T, name string, got *string, want string) {
	t.Helper()
	if want == "" {
		if got != nil {
			t.Fatalf("%s: got %q, want nil", name, *got)
		}
		return
	}
	if got == nil || *got != want {
		t.Fatalf("%s: got %v, want %q", name, got, want)
	}
}

func TestAccountKindsSplitNetWorthWithoutRevaluingIt(t *testing.T) {
	s := openTest(t)
	bank, err := s.CreateAccount("Bank", "EUR", "2026-01")
	if err != nil || bank.Kind != KindAsset {
		t.Fatalf("default kind: %+v %v", bank, err)
	}
	loan, err := s.CreateAccountOfKind("Mortgage", "USD", "2026-01", KindLiability, nil)
	if err != nil || loan.Kind != KindLiability {
		t.Fatalf("liability: %+v %v", loan, err)
	}
	lent, err := s.CreateAccountOfKind("Lent to a friend", "EUR", "2026-01", KindReceivable, nil)
	if err != nil || lent.Kind != KindReceivable {
		t.Fatalf("receivable: %+v %v", lent, err)
	}
	if _, err = s.CreateAccountOfKind("Bad", "EUR", "2026-01", "equity", nil); !errors.Is(err, ErrValidation) {
		t.Fatalf("invalid kind accepted: %v", err)
	}
	// 1 EUR = 1.25 USD, so a 250.00 USD debt is 200.00 EUR.
	if err = s.PutMonth("2026-01", MonthInput{
		Balances: []BalanceInput{{bank.ID, "100000"}, {loan.ID, "-25000"}, {lent.ID, "30000"}},
		Rates:    []RateInput{{"USD", "1.25"}},
	}); err != nil {
		t.Fatal(err)
	}
	check := func(total, assets, debts, owed, ratio string) {
		t.Helper()
		d, err := s.Month("2026-01")
		if err != nil {
			t.Fatal(err)
		}
		wantAmount(t, "total", d.TotalEURMinor, total)
		wantAmount(t, "assets", d.AssetsEURMinor, assets)
		wantAmount(t, "liabilities", d.LiabilitiesEURMinor, debts)
		wantAmount(t, "receivables", d.ReceivablesEURMinor, owed)
		wantAmount(t, "ratio", d.DebtRatioBP, ratio)
	}
	check("110000", "130000", "20000", "30000", "1538")

	history, err := s.History()
	if err != nil || len(history) != 1 {
		t.Fatalf("history: %+v %v", history, err)
	}
	wantAmount(t, "history liabilities", history[0].LiabilitiesEURMinor, "20000")

	// Reclassifying moves the breakdown only: the saved total stays put.
	asset := KindAsset
	if _, err = s.PatchAccount(loan.ID, AccountPatch{Kind: &asset}); err != nil {
		t.Fatal(err)
	}
	check("110000", "110000", "0", "30000", "0")
	liability := KindLiability
	if _, err = s.PatchAccount(loan.ID, AccountPatch{Kind: &liability}); err != nil {
		t.Fatal(err)
	}
	check("110000", "130000", "20000", "30000", "1538")
	bad := "debt"
	if _, err = s.PatchAccount(loan.ID, AccountPatch{Kind: &bad}); !errors.Is(err, ErrValidation) {
		t.Fatalf("invalid kind patch accepted: %v", err)
	}
	// A rename must not reset the kind.
	name := "Home loan"
	renamed, err := s.UpdateAccount(loan.ID, &name, nil)
	if err != nil || renamed.Kind != KindLiability || renamed.Name != name {
		t.Fatalf("rename lost kind: %+v %v", renamed, err)
	}
}

func TestBreakdownIsAbsentForIncompleteMonthAndWithoutAssets(t *testing.T) {
	s := openTest(t)
	bank, err := s.CreateAccount("Bank", "EUR", "2026-01")
	if err != nil {
		t.Fatal(err)
	}
	card, err := s.CreateAccountOfKind("Card", "EUR", "2026-01", KindLiability, nil)
	if err != nil {
		t.Fatal(err)
	}
	if err = s.PutMonth("2026-01", MonthInput{Balances: []BalanceInput{{card.ID, "-5000"}}}); err != nil {
		t.Fatal(err)
	}
	d, err := s.Month("2026-01")
	if err != nil || d.Complete {
		t.Fatalf("month should be incomplete: %+v %v", d, err)
	}
	wantAmount(t, "assets", d.AssetsEURMinor, "")
	wantAmount(t, "liabilities", d.LiabilitiesEURMinor, "")
	wantAmount(t, "ratio", d.DebtRatioBP, "")

	// Debt without any assets has no meaningful ratio. An overpaid card is a
	// positive balance and reduces the amount owed.
	if err = s.PutMonth("2026-01", MonthInput{Balances: []BalanceInput{{bank.ID, "0"}, {card.ID, "700"}}}); err != nil {
		t.Fatal(err)
	}
	d, err = s.Month("2026-01")
	if err != nil {
		t.Fatal(err)
	}
	wantAmount(t, "total", d.TotalEURMinor, "700")
	wantAmount(t, "assets", d.AssetsEURMinor, "0")
	wantAmount(t, "liabilities", d.LiabilitiesEURMinor, "-700")
	wantAmount(t, "ratio", d.DebtRatioBP, "")
}

func TestTransferKeepsAccountKindAndOlderVersionsImportAsAssets(t *testing.T) {
	s := openTest(t)
	loan, err := s.CreateAccountOfKind("Loan", "EUR", "2026-01", KindLiability, nil)
	if err != nil {
		t.Fatal(err)
	}
	if err = s.PutMonth("2026-01", MonthInput{Balances: []BalanceInput{{loan.ID, "-100"}}}); err != nil {
		t.Fatal(err)
	}
	exported, err := s.ExportData()
	if err != nil || exported.SchemaVersion != 10 || exported.Accounts[0].Kind != KindLiability {
		t.Fatalf("export: %+v %v", exported, err)
	}
	if err = s.ImportData(exported); err != nil {
		t.Fatal(err)
	}
	accounts, err := s.Accounts()
	if err != nil || len(accounts) != 1 || accounts[0].Kind != KindLiability {
		t.Fatalf("round trip lost kind: %+v %v", accounts, err)
	}

	missing := exported
	missing.Accounts = []Account{exported.Accounts[0]}
	missing.Accounts[0].Kind = ""
	if err = s.ImportData(missing); !errors.Is(err, ErrValidation) {
		t.Fatalf("version 10 without a kind accepted: %v", err)
	}
	unknown := exported
	unknown.Accounts = []Account{exported.Accounts[0]}
	unknown.Accounts[0].Kind = "equity"
	if err = s.ImportData(unknown); !errors.Is(err, ErrValidation) {
		t.Fatalf("unknown kind accepted: %v", err)
	}

	legacy := exported
	legacy.SchemaVersion = 9
	legacy.Accounts = []Account{exported.Accounts[0]}
	legacy.Accounts[0].Kind = ""
	if err = s.ImportData(legacy); err != nil {
		t.Fatal(err)
	}
	accounts, err = s.Accounts()
	if err != nil || len(accounts) != 1 || accounts[0].Kind != KindAsset {
		t.Fatalf("legacy import kind: %+v %v", accounts, err)
	}
	d, err := s.Month("2026-01")
	if err != nil {
		t.Fatal(err)
	}
	wantAmount(t, "legacy total", d.TotalEURMinor, "-100")
	wantAmount(t, "legacy liabilities", d.LiabilitiesEURMinor, "0")
}
