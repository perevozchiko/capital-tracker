package buildinfo

import "testing"

func TestVersionAndCommit(t *testing.T) {
    if Version == "" {
        t.Fatal("missing application version")
    }
    previous := Commit
    defer func() { Commit = previous }()
    Commit = "0123456789abcdef0123456789abcdef01234567"
    if got := ShortCommit(); got != "01234567" {
        t.Fatalf("short commit: %s", got)
    }
    Commit = ""
    if got := ShortCommit(); got != "unknown" {
        t.Fatalf("fallback: %s", got)
    }
}
