package httpapi

import (
	"errors"
	"strings"
)

// ParseInstanceLabel validates CAPITAL_TRACKER_INSTANCE_LABEL: a short marker
// such as "DEV" shown on every screen so a test instance is not mistaken for
// the real one. The value is public: the sign-in page shows it too.
func ParseInstanceLabel(raw string) (string, error) {
	label := strings.TrimSpace(raw)
	if len(label) > 20 {
		return "", errors.New("CAPITAL_TRACKER_INSTANCE_LABEL must be at most 20 characters")
	}
	for _, r := range label {
		switch {
		case r >= 'a' && r <= 'z', r >= 'A' && r <= 'Z', r >= '0' && r <= '9', r == ' ', r == '-', r == '_', r == '.':
		default:
			return "", errors.New("CAPITAL_TRACKER_INSTANCE_LABEL may contain only letters, digits, spaces, '-', '_' and '.'")
		}
	}
	return label, nil
}
