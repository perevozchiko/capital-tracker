package storage

// Settings retains Language for compatibility with existing clients and snapshots.
// The browser interface always uses English.
type Settings struct {
	Language string `json:"language"`
	Theme    string `json:"theme"`
	Version  string `json:"version"`
}

func (s *Store) Settings(version string) (Settings, error) {
	out := Settings{Version: version}
	rows, e := s.DB.Query("SELECT key,value FROM app_settings")
	if e != nil {
		return out, e
	}
	defer rows.Close()
	for rows.Next() {
		var k, v string
		if e = rows.Scan(&k, &v); e != nil {
			return out, e
		}
		switch k {
		case "language":
			out.Language = v
		case "theme":
			out.Theme = v
		}
	}
	return out, rows.Err()
}
func (s *Store) UpdateSettings(language, theme string) error {
	s.writeMu.Lock()
	defer s.writeMu.Unlock()
	if language != "en" && language != "ru" {
		return invalid("language")
	}
	if theme != "system" && theme != "light" && theme != "dark" {
		return invalid("theme")
	}
	tx, e := s.DB.Begin()
	if e != nil {
		return e
	}
	defer tx.Rollback()
	for k, v := range map[string]string{"language": language, "theme": theme} {
		if _, e = tx.Exec("UPDATE app_settings SET value=? WHERE key=?", v, k); e != nil {
			return e
		}
	}
	return tx.Commit()
}
