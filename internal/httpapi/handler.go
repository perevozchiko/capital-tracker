package httpapi

import (
	"io/fs"
	"net/http"
	"time"

	"github.com/perevozchiko/capital-tracker/internal/finance"
	"github.com/perevozchiko/capital-tracker/internal/storage"
)

type Server struct {
	Auth    *Auth
	Store   *storage.Store
	Version string
	Commit  string
	Assets  fs.FS
}

func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()
	registerTransfer(mux, s)
	registerGroups(mux, s)
	registerRates(mux)
	mux.HandleFunc("/api/meta", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != "GET" {
			fail(w, 405, "method_not_allowed", "")
			return
		}
		writeJSON(w, 200, map[string]string{"app": "capital-tracker", "version": s.Version, "commit": s.Commit})
	})
	mux.HandleFunc("/api/currencies", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != "GET" {
			fail(w, 405, "method_not_allowed", "")
			return
		}
		writeJSON(w, 200, map[string]any{"currencies": finance.Currencies()})
	})
	registerAccounts(mux, s)
	registerMonths(mux, s)
	registerIncomes(mux, s)
	registerExpenses(mux, s)
	registerRecurringExpenses(mux, s)
	registerDashboard(mux, s)
	registerSettings(mux, s)
	registerStatic(mux, s)
	if s.Auth != nil {
		return secureRequests(s.Auth.protect(mux, s.Assets), s.Auth.Origin)
	}
	mux.HandleFunc("/api/auth/status", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != "GET" {
			fail(w, 405, "method_not_allowed", "")
			return
		}
		writeJSON(w, 200, map[string]bool{"enabled": false, "authenticated": true})
	})
	return secureLocalRequests(mux)
}

func NewHTTPServer(addr string, handler http.Handler) *http.Server {
	return &http.Server{Addr: addr, Handler: handler, ReadHeaderTimeout: 5 * time.Second, ReadTimeout: 15 * time.Second, WriteTimeout: 30 * time.Second, IdleTimeout: 90 * time.Second, MaxHeaderBytes: 1 << 16}
}
