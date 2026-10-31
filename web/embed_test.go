package web

import (
	"io/fs"
	"path"
	"regexp"
	"strings"
	"testing"
)

// Check the English message catalog and references across all browser modules.
func TestEnglishMessages(t *testing.T) {
	data, err := fs.ReadFile(Assets, "js/i18n/en.js")
	if err != nil {
		t.Fatal(err)
	}
	keys := make(map[string]bool)
	keyPattern := regexp.MustCompile(`(?m)^\s*([A-Za-z][A-Za-z0-9_]*)\s*:`)
	for _, match := range keyPattern.FindAllStringSubmatch(string(data), -1) {
		if keys[match[1]] {
			t.Fatalf("duplicate message key: %s", match[1])
		}
		keys[match[1]] = true
	}
	if len(keys) < 70 {
		t.Fatal("English message catalog is unexpectedly small")
	}
	call := regexp.MustCompile(`\bt\('([A-Za-z][A-Za-z0-9_]*)'\)`)
	err = fs.WalkDir(Assets, "js", func(path string, entry fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if entry.IsDir() || !strings.HasSuffix(path, ".js") {
			return nil
		}
		source, err := fs.ReadFile(Assets, path)
		if err != nil {
			return err
		}
		for _, match := range call.FindAllStringSubmatch(string(source), -1) {
			if !keys[match[1]] {
				t.Errorf("undefined message %s in %s", match[1], path)
			}
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
}

func TestEmbeddedStaticFiles(t *testing.T) {
	for _, file := range []string{"index.html", "login.html", "css/login.css", "js/login.js", "auth-sw.js", "css/app.css", "js/boot.js", "js/app.js", "icons/favicon.svg", "icons/icon-192.png", "icons/icon-512.png", "manifest.webmanifest", "sw.js"} {
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

// Every imported module and service-worker cache entry must ship in the binary.
func TestEmbeddedModuleGraph(t *testing.T) {
	imports := regexp.MustCompile(`from\s+['"]([^'"]+)['"]`)
	err := fs.WalkDir(Assets, "js", func(name string, entry fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if entry.IsDir() || !strings.HasSuffix(name, ".js") {
			return nil
		}
		source, err := fs.ReadFile(Assets, name)
		if err != nil {
			return err
		}
		for _, match := range imports.FindAllStringSubmatch(string(source), -1) {
			target := path.Join(path.Dir(name), match[1])
			if _, err := fs.Stat(Assets, target); err != nil {
				t.Errorf("%s imports missing module %s", name, target)
			}
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	worker, err := fs.ReadFile(Assets, "sw.js")
	if err != nil {
		t.Fatal(err)
	}
	cacheEntry := regexp.MustCompile(`(?m)^\s*'(/[^']*)',`)
	for _, match := range cacheEntry.FindAllStringSubmatch(string(worker), -1) {
		name := strings.TrimPrefix(match[1], "/")
		if name == "" {
			name = "index.html"
		}
		if _, err := fs.Stat(Assets, name); err != nil {
			t.Errorf("service worker caches missing asset %s", name)
		}
	}
}
