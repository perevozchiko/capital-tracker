package httpapi

import (
	"encoding/json"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestParseInstanceLabel(t *testing.T) {
	for raw, want := range map[string]string{"": "", "  DEV ": "DEV", "dev-2 test_1.0": "dev-2 test_1.0"} {
		got, err := ParseInstanceLabel(raw)
		if err != nil || got != want {
			t.Errorf("ParseInstanceLabel(%q) = %q, %v; want %q", raw, got, err, want)
		}
	}
	for _, raw := range []string{"<b>DEV</b>", "dev\"", "дев", strings.Repeat("x", 21)} {
		if _, err := ParseInstanceLabel(raw); err == nil {
			t.Errorf("ParseInstanceLabel(%q) accepted an invalid label", raw)
		}
	}
}

func TestMetaReportsInstanceLabelOnlyWhenConfigured(t *testing.T) {
	for _, label := range []string{"", "DEV"} {
		handler := (&Server{Version: "1.0.0", Commit: "abcdef12", Label: label}).routes()
		response := httptest.NewRecorder()
		handler.ServeHTTP(response, httptest.NewRequest("GET", "http://127.0.0.1:8765/api/meta", nil))
		var meta map[string]string
		if err := json.Unmarshal(response.Body.Bytes(), &meta); err != nil {
			t.Fatal(err)
		}
		got, present := meta["label"]
		if got != label || present != (label != "") {
			t.Errorf("label %q: meta = %v", label, meta)
		}
		if meta["app"] != "capital-tracker" || meta["version"] != "1.0.0" || meta["commit"] != "abcdef12" {
			t.Errorf("label %q changed the existing metadata: %v", label, meta)
		}
	}
}
