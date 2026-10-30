package storage

// ClearData permanently removes all application records and resets preferences.
// It intentionally leaves schema migrations and the SQLite database intact.
// Deletions and default-settings insertion are a single atomic transaction.
func (s *Store) ClearData() error {
	s.writeMu.Lock()
	defer s.writeMu.Unlock()

	tx, err := s.DB.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	// Children first, with no foreign-key disabling.
	for _, table := range []string{
		"incomes",
		"monthly_balances",
		"exchange_rates",
		"account_periods",
		"months",
		"accounts",
		"account_groups",
		"app_settings",
	} {
		if _, err := tx.Exec("DELETE FROM " + table); err != nil {
			return err
		}
	}

	// Reset AUTOINCREMENT IDs as for a fresh installation.
	if _, err := tx.Exec("DELETE FROM sqlite_sequence WHERE name IN ('accounts','account_periods','account_groups')"); err != nil {
		return err
	}
	if _, err := tx.Exec("INSERT INTO app_settings(key,value) VALUES ('language','en'),('theme','dark')"); err != nil {
		return err
	}
	return tx.Commit()
}
