package httpapi

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha1"
	"crypto/subtle"
	"encoding/base32"
	"encoding/binary"
	"errors"
	"fmt"
	"net/url"
	"strings"
	"time"
)

// NewTOTPEnrollment creates an RFC 6238 SHA-1, six-digit, 30-second account.
// The secret and URI are credentials: only display them to the administrator.
func NewTOTPEnrollment(username string) (secret, uri string, err error) {
	if username == "" || len(username) > 100 {
		return "", "", errors.New("set CAPITAL_TRACKER_USERNAME (max 100 bytes)")
	}
	var key [20]byte
	if _, err = rand.Read(key[:]); err != nil {
		return "", "", err
	}
	secret = base32.StdEncoding.WithPadding(base32.NoPadding).EncodeToString(key[:])
	account := url.URL{Scheme: "otpauth", Host: "totp", Path: "/Capital Tracker:" + username}
	account.RawQuery = url.Values{"secret": {secret}, "issuer": {"Capital Tracker"}, "algorithm": {"SHA1"}, "digits": {"6"}, "period": {"30"}}.Encode()
	return secret, account.String(), nil
}

func decodeTOTPSecret(secret string) ([]byte, error) {
	// Canonicalize once so harmless case/padding differences do not revoke devices.
	secret = strings.TrimRight(strings.ToUpper(strings.TrimSpace(secret)), "=")
	key, err := base32.StdEncoding.WithPadding(base32.NoPadding).DecodeString(secret)
	if err != nil || len(key) < 20 || len(key) > 64 {
		return nil, errors.New("TOTP secret must be base32 encoding of 20..64 bytes")
	}
	return key, nil
}

func totpCode(key []byte, step int64) string {
	var counter [8]byte
	binary.BigEndian.PutUint64(counter[:], uint64(step))
	mac := hmac.New(sha1.New, key) // SHA-1 is required for authenticator interoperability.
	mac.Write(counter[:])
	sum := mac.Sum(nil)
	offset := sum[len(sum)-1] & 15
	value := binary.BigEndian.Uint32(sum[offset:offset+4]) & 0x7fffffff
	return fmt.Sprintf("%06d", value%1000000)
}

// Accept a single step of clock skew in either direction. A successful step
// can only be consumed once, including across restarts and concurrent requests.
func verifyTOTP(key []byte, code string, now time.Time, lastStep int64) (int64, bool) {
	if len(code) != 6 {
		return 0, false
	}
	for _, digit := range code {
		if digit < '0' || digit > '9' {
			return 0, false
		}
	}
	step := now.Unix() / 30
	for _, candidate := range []int64{step, step - 1, step + 1} {
		if candidate > lastStep && subtle.ConstantTimeCompare([]byte(code), []byte(totpCode(key, candidate))) == 1 {
			return candidate, true
		}
	}
	return 0, false
}
