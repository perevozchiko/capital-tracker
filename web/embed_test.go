package web

import (
	"io/fs"
	"regexp"
	"strings"
	"testing"
)

// Translation dictionaries deliberately use small static JS objects; check
// that their keys remain in sync without introducing a frontend build tool.
func TestTranslationKeyParity(t *testing.T) {
	re := regexp.MustCompile(`(?:^|[,{]\s*)([A-Za-z][A-Za-z0-9_]*)\s*:`)
	scan := func(name string) map[string]bool {
		t.Helper()
		b, err := fs.ReadFile(Assets, name)
		if err != nil {
			t.Fatal(err)
		}
		keys := make(map[string]bool)
		for _, match := range re.FindAllStringSubmatch(string(b), -1) {
			if keys[match[1]] {
				t.Fatalf("duplicate key %q in %s", match[1], name)
			}
			keys[match[1]] = true
		}
		if len(keys) < 70 {
			t.Fatalf("unexpectedly small dictionary %s: %d keys", name, len(keys))
		}
		return keys
	}
	en, ru := scan("js/i18n/en.js"), scan("js/i18n/ru.js")
	for key := range en {
		if !ru[key] {
			t.Errorf("missing Russian translation: %s", key)
		}
	}
	for key := range ru {
		if !en[key] {
			t.Errorf("missing English translation: %s", key)
		}
	}
	source, err := fs.ReadFile(Assets, "js/app.js")
	if err != nil {
		t.Fatal(err)
	}
	call := regexp.MustCompile(`\bt\('([A-Za-z][A-Za-z0-9_]*)'\)`)
	for _, match := range call.FindAllStringSubmatch(string(source), -1) {
		if !en[match[1]] {
			t.Errorf("UI translation key not defined: %s", match[1])
		}
	}
}

func TestEmbeddedStaticFiles(t *testing.T) {
	for _, file := range []string{"index.html", "css/app.css", "js/boot.js", "js/app.js", "icons/favicon.svg", "icons/icon-192.png", "icons/icon-512.png", "manifest.webmanifest", "sw.js"} {
		data, err := fs.ReadFile(Assets, file)
		if err != nil || len(data) == 0 {
			t.Fatalf("missing/empty %s: %v", file, err)
		}
	}
	page, _ := fs.ReadFile(Assets, "index.html")
	if !strings.Contains(string(page), `/js/boot.js`) || !strings.Contains(string(page), `/js/app.js`) {
		t.Fatal("frontend bootstrap not referenced")
	}
}
