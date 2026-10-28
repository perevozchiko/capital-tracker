// Package demo loads a deterministic, fictitious one-year financial sample.
// It never touches the user's normal Capital Tracker database.
package demo

import (
	"embed"
	"encoding/json"
	"fmt"

	"github.com/perevozchiko/capital-tracker/internal/storage"
)

//go:embed sample-2025-2026.json
var fixtures embed.FS

// Seed initializes only a completely empty database. Existing demo changes
// persist across runs, including partially completed months.
func Seed(s *storage.Store) error {
	accounts, err := s.Accounts()
	if err != nil {
		return err
	}
	months, err := s.Months()
	if err != nil {
		return err
	}
	if len(accounts) != 0 || len(months) != 0 {
		return nil
	}
	data, err := fixtures.ReadFile("sample-2025-2026.json")
	if err != nil {
		return err
	}
	var document storage.TransferDocument
	if err := json.Unmarshal(data, &document); err != nil {
		return fmt.Errorf("decode demo fixture: %w", err)
	}
	if err := s.ImportData(document); err != nil {
		return fmt.Errorf("import demo fixture: %w", err)
	}
	return nil
}
