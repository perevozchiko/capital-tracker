package buildinfo

// Version is the sole authoritative application version.
const Version = "0.3.0"

// Commit is set at build time and needs no Git at runtime.
var Commit = "unknown"

func ShortCommit() string {
	if len(Commit) >= 8 {
		return Commit[:8]
	}
	if Commit == "" {
		return "unknown"
	}
	return Commit
}
