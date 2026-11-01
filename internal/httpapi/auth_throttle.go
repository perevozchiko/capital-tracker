package httpapi

import (
	"net"
	"net/http"
	"net/netip"
	"net/url"
	"strings"
	"time"
)

const maxLoginClients = 4096

type loginWindow struct {
	Started  time.Time
	Attempts int
}

func (a *Auth) loginClient(r *http.Request) (string, bool) {
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return "", false
	}
	peer, err := netip.ParseAddr(host)
	if err != nil {
		return "", false
	}
	peer = peer.Unmap()
	publicURL, _ := url.Parse(a.Origin)
	if a.Origin != "" && peer.IsLoopback() && strings.EqualFold(r.Host, publicURL.Host) {
		// Only the configured public origin through a local proxy can supply this
		// header. Caddy must overwrite it with the actual visitor's address.
		values := r.Header.Values("X-Capital-Tracker-Client-IP")
		if len(values) != 1 {
			return "", false
		}
		peer, err = netip.ParseAddr(values[0])
		if err != nil {
			return "", false
		}
		peer = peer.Unmap()
	}
	// Group IPv6 privacy addresses so rotating within a /64 cannot reset limits.
	if peer.Is6() {
		return netip.PrefixFrom(peer, 64).Masked().String(), true
	}
	return peer.String(), true
}

// reserveLogin counts all attempts before bcrypt. Limits are per source, with
// bounded memory; active windows are never evicted to let an attacker retry.
func (a *Auth) reserveLogin(client string, now time.Time) int {
	a.mu.Lock()
	defer a.mu.Unlock()
	window, exists := a.loginLimits[client]
	if !exists && len(a.loginLimits) >= maxLoginClients {
		for key, entry := range a.loginLimits {
			if now.Sub(entry.Started) >= time.Minute {
				delete(a.loginLimits, key)
			}
		}
		if len(a.loginLimits) >= maxLoginClients {
			return 60
		}
	}
	if !exists || now.Sub(window.Started) >= time.Minute {
		window = loginWindow{Started: now}
	}
	if window.Attempts >= 10 {
		return int((time.Minute - now.Sub(window.Started) + time.Second - 1) / time.Second)
	}
	window.Attempts++
	a.loginLimits[client] = window
	return 0
}
