package httpapi

import (
	"net/url"
	"strings"
	"testing"
	"time"
)

const testTOTPSecret = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ"

func TestTOTPMatchesRFCVectors(t *testing.T) {
	key := []byte("12345678901234567890")
	// RFC 6238 Appendix B SHA-1 vectors, reduced to six digits.
	for _, vector := range []struct {
		unix int64
		code string
	}{{59, "287082"}, {1111111109, "081804"}, {1111111111, "050471"}, {1234567890, "005924"}, {2000000000, "279037"}, {20000000000, "353130"}} {
		if got := totpCode(key, vector.unix/30); got != vector.code {
			t.Fatalf("RFC vector at %d: got %s, want %s", vector.unix, got, vector.code)
		}
		if step, ok := verifyTOTP(key, vector.code, time.Unix(vector.unix, 0), 0); !ok || step != vector.unix/30 {
			t.Fatalf("RFC vector rejected at %d", vector.unix)
		}
	}
}

func TestTOTPWindowFormatAndReplay(t *testing.T) {
	key := []byte("12345678901234567890")
	now := time.Unix(1234567890, 0)
	step := now.Unix() / 30
	for delta := int64(-2); delta <= 2; delta++ {
		_, ok := verifyTOTP(key, totpCode(key, step+delta), now, 0)
		if ok != (delta >= -1 && delta <= 1) {
			t.Fatalf("unexpected acceptance at offset %d", delta)
		}
	}
	for _, code := range []string{"", "00592", "0005924", " 05924", "１２３４５６", "abcdef"} {
		if _, ok := verifyTOTP(key, code, now, 0); ok {
			t.Fatalf("accepted malformed code %q", code)
		}
	}
	if _, ok := verifyTOTP(key, "005924", now, step); ok {
		t.Fatal("accepted replay")
	}
}

func TestTOTPEnrollmentAndSecretValidation(t *testing.T) {
	secret, uri, err := NewTOTPEnrollment("andrei / phone?")
	if err != nil {
		t.Fatal(err)
	}
	key, err := decodeTOTPSecret(secret)
	if err != nil || len(key) != 20 {
		t.Fatalf("invalid generated secret: %v", err)
	}
	parsed, err := url.Parse(uri)
	if err != nil || parsed.Scheme != "otpauth" || parsed.Host != "totp" || parsed.Path != "/Capital Tracker:andrei / phone?" || parsed.Query().Get("secret") != secret || parsed.Query().Get("issuer") != "Capital Tracker" || parsed.Query().Get("digits") != "6" || parsed.Query().Get("period") != "30" {
		t.Fatalf("invalid enrollment URI: %v", err)
	}
	second, _, err := NewTOTPEnrollment("tester")
	if err != nil || second == secret {
		t.Fatal("enrollment secrets must be random")
	}
	for _, username := range []string{"", strings.Repeat("x", 101)} {
		if _, _, err := NewTOTPEnrollment(username); err == nil {
			t.Fatal("invalid enrollment username accepted")
		}
	}
	if _, err := decodeTOTPSecret(strings.ToLower(secret) + "="); err != nil {
		t.Fatal("valid lowercase secret rejected")
	}
	for _, invalid := range []string{" ", "not a base32 secret!", "MY", strings.Repeat("A", 112)} {
		if _, err := decodeTOTPSecret(invalid); err == nil {
			t.Fatal("invalid or weak secret accepted")
		}
	}
}
