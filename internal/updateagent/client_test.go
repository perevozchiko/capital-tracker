package updateagent

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestAuthenticatedProtocolAndTamperedResponse(t *testing.T) {
	key := strings.Repeat("a", 64)
	keyFile := filepath.Join(t.TempDir(), "key")
	if err := os.WriteFile(keyFile, []byte(key+"\n"), 0600); err != nil {
		t.Fatal(err)
	}
	tamper := false
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		nonce, stamp := r.Header.Get("X-Update-Nonce"), r.Header.Get("X-Update-Time")
		expected := signature(key, r.Method+"\n"+r.URL.Path+"\n"+stamp+"\n"+nonce+"\n"+string(body))
		if len(nonce) != 48 || r.Header.Get("X-Update-Signature") != expected {
			t.Error("request signature mismatch")
		}
		if r.URL.Path == "/v1/start" && !strings.Contains(string(body), `"target_version":"0.4.0"`) {
			t.Error("missing target")
		}
		raw := `{"enabled":true}`
		sig := signature(key, fmt.Sprintf("%s\n%d\n%s", nonce, 200, raw))
		if tamper {
			sig = strings.Repeat("0", 64)
		}
		w.Header().Set("X-Update-Signature", sig)
		w.Write([]byte(raw))
	}))
	defer server.Close()
	c, err := New(server.URL, keyFile)
	if err != nil {
		t.Fatal(err)
	}
	for _, action := range []string{"status", "check", "start"} {
		var payload any
		if action != "status" {
			payload = map[string]string{"target_version": "0.4.0"}
		}
		data, status, err := c.Call(context.Background(), action, payload)
		if err != nil || status != 200 || !json.Valid(data) {
			t.Fatalf("%s: %d %s %v", action, status, data, err)
		}
	}
	tamper = true
	if _, _, err := c.Call(context.Background(), "status", nil); err == nil {
		t.Fatal("accepted unsigned response")
	}
	if _, _, err := c.Call(context.Background(), "exec", nil); err == nil {
		t.Fatal("accepted arbitrary action")
	}
}

func TestInvalidConfigurationAndUnavailableAgent(t *testing.T) {
	keyFile := filepath.Join(t.TempDir(), "key")
	os.WriteFile(keyFile, []byte(strings.Repeat("a", 64)), 0600)
	for _, endpoint := range []string{"", "https://host.docker.internal:18765", "http://evil.test:18765", "http://127.0.0.1", "http://user@127.0.0.1:18765", "http://127.0.0.1:18765/exec", "http://127.0.0.1:18765/?exec=1"} {
		if _, err := New(endpoint, keyFile); err == nil {
			t.Fatalf("accepted %s", endpoint)
		}
	}
	os.WriteFile(keyFile, []byte("weak"), 0600)
	if _, err := New("http://127.0.0.1:18765", keyFile); err == nil {
		t.Fatal("accepted weak key")
	}
	t.Setenv("CAPITAL_TRACKER_UPDATE_AGENT_URL", "http://127.0.0.1:18765")
	t.Setenv("CAPITAL_TRACKER_UPDATE_AGENT_KEY_FILE", keyFile)
	if FromEnv() != nil {
		t.Fatal("broken configuration enabled updater")
	}
}
