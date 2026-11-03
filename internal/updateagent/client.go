// Package updateagent implements the narrow authenticated host update protocol.
package updateagent

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"strconv"
	"strings"
	"time"
)

type Client struct {
	endpoint, key string
	http          *http.Client
}

// FromEnv deliberately leaves ordinary application startup working when the agent
// is absent or misconfigured. No command execution exists in the application.
func FromEnv() *Client {
	c, _ := New(os.Getenv("CAPITAL_TRACKER_UPDATE_AGENT_URL"), os.Getenv("CAPITAL_TRACKER_UPDATE_AGENT_KEY_FILE"))
	return c
}
func New(endpoint, keyFile string) (*Client, error) {
	u, err := url.Parse(endpoint)
	if err != nil || u.Scheme != "http" || u.User != nil || u.RawQuery != "" || u.Fragment != "" || (u.Path != "" && u.Path != "/") || (u.Hostname() != "host.docker.internal" && u.Hostname() != "127.0.0.1" && u.Hostname() != "localhost") || u.Port() == "" {
		return nil, errors.New("invalid update agent endpoint")
	}
	key, err := os.ReadFile(keyFile)
	if err != nil {
		return nil, err
	}
	secret := strings.TrimSpace(string(key))
	decoded, err := hex.DecodeString(secret)
	if err != nil || len(decoded) != 32 || secret != strings.ToLower(secret) {
		return nil, errors.New("update agent key must be 64 hex characters")
	}
	return &Client{endpoint: strings.TrimRight(endpoint, "/"), key: secret, http: &http.Client{Timeout: 15 * time.Second, Transport: &http.Transport{Proxy: nil}, CheckRedirect: func(_ *http.Request, _ []*http.Request) error { return http.ErrUseLastResponse }}}, nil
}
func signature(key, data string) string {
	mac := hmac.New(sha256.New, []byte(key))
	mac.Write([]byte(data))
	return hex.EncodeToString(mac.Sum(nil))
}
func (c *Client) Call(ctx context.Context, action string, payload any) (json.RawMessage, int, error) {
	method, path := "POST", "/v1/"+action
	if action == "status" {
		method = "GET"
	}
	if action != "status" && action != "check" && action != "start" {
		return nil, 0, errors.New("invalid agent action")
	}
	var body []byte
	if payload != nil {
		var err error
		body, err = json.Marshal(payload)
		if err != nil {
			return nil, 0, err
		}
	}
	nonceBytes := make([]byte, 24)
	if _, err := rand.Read(nonceBytes); err != nil {
		return nil, 0, err
	}
	nonce, timestamp := hex.EncodeToString(nonceBytes), strconv.FormatInt(time.Now().Unix(), 10)
	req, err := http.NewRequestWithContext(ctx, method, c.endpoint+path, bytes.NewReader(body))
	if err != nil {
		return nil, 0, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Update-Time", timestamp)
	req.Header.Set("X-Update-Nonce", nonce)
	req.Header.Set("X-Update-Signature", signature(c.key, method+"\n"+path+"\n"+timestamp+"\n"+nonce+"\n"+string(body)))
	resp, err := c.http.Do(req)
	if err != nil {
		return nil, 0, err
	}
	defer resp.Body.Close()
	data, err := io.ReadAll(io.LimitReader(resp.Body, 65537))
	if err != nil || len(data) > 65536 || !json.Valid(data) {
		return nil, 0, errors.New("invalid agent response")
	}
	expected := signature(c.key, fmt.Sprintf("%s\n%d\n%s", nonce, resp.StatusCode, data))
	if !hmac.Equal([]byte(expected), []byte(resp.Header.Get("X-Update-Signature"))) {
		return nil, 0, errors.New("unauthenticated agent response")
	}
	return data, resp.StatusCode, nil
}
