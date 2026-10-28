package httpapi

import (
	"bytes"
	"encoding/json"
	"errors"
	"io"
	"io/fs"
	"net"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/perevozchiko/capital-tracker/internal/finance"
	"github.com/perevozchiko/capital-tracker/internal/storage"
)

type Server struct {
	Store   *storage.Store
	Version string
	Assets  fs.FS
}
type apiError struct {
	Code    string `json:"code"`
	Field   string `json:"field,omitempty"`
	Message string `json:"message,omitempty"`
	Reason  string `json:"reason,omitempty"`
}

func writeJSON(w http.ResponseWriter, status int, data any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(data)
}
func fail(w http.ResponseWriter, status int, code, field string) {
	writeJSON(w, status, map[string]any{"error": apiError{Code: code, Field: field}})
}
func handleError(w http.ResponseWriter, e error) {
	if errors.Is(e, storage.ErrNotFound) {
		fail(w, 404, "not_found", "")
		return
	}
	var domain *storage.DomainError
	if errors.As(e, &domain) {
		if errors.Is(e, storage.ErrConflict) {
			writeJSON(w, 409, map[string]any{"error": apiError{Code: "conflict", Reason: domain.Reason}})
			return
		}
		if errors.Is(e, storage.ErrValidation) {
			fail(w, 422, "validation_error", domain.Field)
			return
		}
	}
	fail(w, 500, "internal_error", "")
}

func decode(r *http.Request, v any) error {
	if !strings.HasPrefix(strings.ToLower(r.Header.Get("Content-Type")), "application/json") {
		return errors.New("json content type required")
	}
	reader := io.LimitReader(r.Body, 1024*1024+1)
	dec := json.NewDecoder(reader)
	dec.DisallowUnknownFields()
	if err := dec.Decode(v); err != nil {
		return err
	}
	var second any
	if err := dec.Decode(&second); err != io.EOF {
		return errors.New("unexpected trailing content")
	}
	return nil
}
func readJSON(w http.ResponseWriter, r *http.Request, v any) bool {
	if e := decode(r, v); e != nil {
		fail(w, 400, "invalid_json", "")
		return false
	}
	return true
}
func pathID(s string) (int64, bool) {
	if s == "" || strings.Contains(s, "/") {
		return 0, false
	}
	id, e := strconv.ParseInt(s, 10, 64)
	return id, id > 0 && e == nil
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
		writeJSON(w, 200, map[string]string{"app": "capital-tracker", "version": s.Version})
	})
	mux.HandleFunc("/api/currencies", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != "GET" {
			fail(w, 405, "method_not_allowed", "")
			return
		}
		writeJSON(w, 200, map[string]any{"currencies": finance.Currencies()})
	})
	mux.HandleFunc("/api/accounts", func(w http.ResponseWriter, r *http.Request) {
		switch r.Method {
		case "GET":
			a, e := s.Store.Accounts()
			if e != nil {
				handleError(w, e)
				return
			}
			writeJSON(w, 200, a)
		case "POST":
			var p struct {
				Name       string `json:"name"`
				Currency   string `json:"currency"`
				StartMonth string `json:"start_month"`
				GroupID    *int64 `json:"group_id"`
			}
			if !readJSON(w, r, &p) {
				return
			}
			a, e := s.Store.CreateAccountInGroup(p.Name, p.Currency, p.StartMonth, p.GroupID)
			if e != nil {
				handleError(w, e)
				return
			}
			writeJSON(w, 201, a)
		default:
			fail(w, 405, "method_not_allowed", "")
		}
	})
	mux.HandleFunc("/api/accounts/reorder", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != "PUT" {
			fail(w, 405, "method_not_allowed", "")
			return
		}
		var p struct {
			IDs []int64 `json:"ids"`
		}
		if !readJSON(w, r, &p) {
			return
		}
		if e := s.Store.Reorder(p.IDs); e != nil {
			handleError(w, e)
			return
		}
		writeJSON(w, 200, map[string]bool{"ok": true})
	})
	mux.HandleFunc("/api/accounts/", func(w http.ResponseWriter, r *http.Request) {
		path := strings.TrimPrefix(r.URL.Path, "/api/accounts/")
		parts := strings.Split(path, "/")
		id, ok := pathID(parts[0])
		if !ok || len(parts) > 2 {
			fail(w, 404, "not_found", "")
			return
		}
		if len(parts) == 2 {
			switch parts[1] {
			case "archive":
				if r.Method != "POST" {
					break
				}
				var p struct {
					Month string `json:"month"`
				}
				if !readJSON(w, r, &p) {
					return
				}
				e := s.Store.ArchiveAccount(id, p.Month)
				if e != nil {
					handleError(w, e)
					return
				}
				writeJSON(w, 200, map[string]bool{"ok": true})
				return
			case "restore":
				if r.Method != "POST" {
					break
				}
				var p struct {
					StartMonth string `json:"start_month"`
				}
				if !readJSON(w, r, &p) {
					return
				}
				e := s.Store.RestoreAccount(id, p.StartMonth)
				if e != nil {
					handleError(w, e)
					return
				}
				writeJSON(w, 200, map[string]bool{"ok": true})
				return
			}
			fail(w, 405, "method_not_allowed", "")
			return
		}
		switch r.Method {
		case "PATCH":
			var p struct {
				Name     *string `json:"name"`
				Currency *string `json:"currency"`
			}
			if !readJSON(w, r, &p) {
				return
			}
			a, e := s.Store.UpdateAccount(id, p.Name, p.Currency)
			if e != nil {
				handleError(w, e)
				return
			}
			writeJSON(w, 200, a)
		case "DELETE":
			if e := s.Store.DeleteAccount(id); e != nil {
				handleError(w, e)
				return
			}
			w.WriteHeader(204)
		default:
			fail(w, 405, "method_not_allowed", "")
		}
	})
	mux.HandleFunc("/api/months", func(w http.ResponseWriter, r *http.Request) {
		switch r.Method {
		case "GET":
			months, e := s.Store.Months()
			if e != nil {
				handleError(w, e)
				return
			}
			writeJSON(w, 200, months)
		case "POST":
			var p struct {
				Month string `json:"month"`
			}
			if !readJSON(w, r, &p) {
				return
			}
			if e := s.Store.CreateMonth(p.Month); e != nil {
				handleError(w, e)
				return
			}
			writeJSON(w, 201, map[string]string{"month": p.Month})
		default:
			fail(w, 405, "method_not_allowed", "")
		}
	})
	mux.HandleFunc("/api/months/", func(w http.ResponseWriter, r *http.Request) {
		month := strings.TrimPrefix(r.URL.Path, "/api/months/")
		if !finance.ValidMonth(month) {
			fail(w, 422, "validation_error", "month")
			return
		}
		switch r.Method {
		case "GET":
			d, e := s.Store.Month(month)
			if e != nil {
				handleError(w, e)
				return
			}
			writeJSON(w, 200, d)
		case "DELETE":
			var p struct {
				Confirm bool `json:"confirm"`
			}
			if !readJSON(w, r, &p) {
				return
			}
			if !p.Confirm {
				fail(w, 422, "validation_error", "confirm")
				return
			}
			if err := s.Store.DeleteMonth(month); err != nil {
				handleError(w, err)
				return
			}
			w.WriteHeader(http.StatusNoContent)
		case "PUT":
			var p storage.MonthInput
			if !readJSON(w, r, &p) {
				return
			}
			if e := s.Store.PutMonth(month, p); e != nil {
				handleError(w, e)
				return
			}
			d, e := s.Store.Month(month)
			if e != nil {
				handleError(w, e)
				return
			}
			writeJSON(w, 200, d)
		default:
			fail(w, 405, "method_not_allowed", "")
		}
	})
	mux.HandleFunc("/api/capital/history", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != "GET" {
			fail(w, 405, "method_not_allowed", "")
			return
		}
		p, e := s.Store.History()
		if e != nil {
			handleError(w, e)
			return
		}
		writeJSON(w, 200, map[string]any{"points": p})
	})
	mux.HandleFunc("/api/dashboard", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != "GET" {
			fail(w, 405, "method_not_allowed", "")
			return
		}
		month := r.URL.Query().Get("month")
		if month == "" {
			month = time.Now().Format("2006-01")
		}
		columns := 12
		if q := r.URL.Query().Get("columns"); q != "" {
			n, err := strconv.Atoi(q)
			if err != nil || n < 1 || n > 120 {
				fail(w, 422, "validation_error", "columns")
				return
			}
			columns = n
		}
		d, e := s.Store.DashboardColumns(month, columns)
		if e != nil {
			handleError(w, e)
			return
		}
		writeJSON(w, 200, d)
	})
	mux.HandleFunc("/api/settings", func(w http.ResponseWriter, r *http.Request) {
		switch r.Method {
		case "GET":
			settings, e := s.Store.Settings(s.Version)
			if e != nil {
				handleError(w, e)
				return
			}
			writeJSON(w, 200, settings)
		case "PATCH":
			var p struct {
				Language string `json:"language"`
				Theme    string `json:"theme"`
			}
			if !readJSON(w, r, &p) {
				return
			}
			if e := s.Store.UpdateSettings(p.Language, p.Theme); e != nil {
				handleError(w, e)
				return
			}
			settings, e := s.Store.Settings(s.Version)
			if e != nil {
				handleError(w, e)
				return
			}
			writeJSON(w, 200, settings)
		default:
			fail(w, 405, "method_not_allowed", "")
		}
	})
	static := http.FileServer(http.FS(s.Assets))
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != "GET" && r.Method != "HEAD" {
			fail(w, 405, "method_not_allowed", "")
			return
		}
		path := r.URL.Path
		if path == "/" || path == "/index.html" {
			// FileServer intentionally redirects /index.html to ./.
			// Passing the root request through it causes an infinite loop.
			index, err := fs.ReadFile(s.Assets, "index.html")
			if err != nil {
				http.Error(w, "application page unavailable", http.StatusInternalServerError)
				return
			}
			w.Header().Set("Cache-Control", "no-cache, must-revalidate")
			w.Header().Set("Content-Type", "text/html; charset=utf-8")
			http.ServeContent(w, r, "index.html", time.Time{}, bytes.NewReader(index))
			return
		}
		if strings.HasPrefix(path, "/css/") || strings.HasPrefix(path, "/js/") || strings.HasPrefix(path, "/icons/") || path == "/sw.js" || path == "/manifest.webmanifest" {
			w.Header().Set("Cache-Control", "no-cache, must-revalidate")
			static.ServeHTTP(w, r)
			return
		}
		http.NotFound(w, r)
	})
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// A loopback listener alone does not defeat DNS rebinding; reject unexpected Host.
		host, _, e := net.SplitHostPort(r.Host)
		if e != nil {
			host = r.Host
		}
		if host != "127.0.0.1" && host != "localhost" && host != "[::1]" && host != "::1" {
			fail(w, 403, "invalid_host", "")
			return
		}
		if strings.HasPrefix(r.URL.Path, "/api/") && r.Method != "GET" && r.Method != "HEAD" {
			if r.Header.Get("X-Capital-Tracker") != "1" {
				fail(w, 403, "csrf_header_required", "")
				return
			}
			if origin := r.Header.Get("Origin"); origin != "" {
				u, e := url.Parse(origin)
				if e != nil || u.Scheme != "http" || !strings.EqualFold(u.Host, r.Host) {
					fail(w, 403, "invalid_origin", "")
					return
				}
			}
			if site := r.Header.Get("Sec-Fetch-Site"); site == "cross-site" {
				fail(w, 403, "cross_site_request", "")
				return
			}
		}
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("X-Frame-Options", "DENY")
		w.Header().Set("Referrer-Policy", "no-referrer")
		w.Header().Set("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'")
		mux.ServeHTTP(w, r)
	})
}

func NewHTTPServer(addr string, handler http.Handler) *http.Server {
	return &http.Server{Addr: addr, Handler: handler, ReadHeaderTimeout: 5 * time.Second, ReadTimeout: 15 * time.Second, WriteTimeout: 30 * time.Second, IdleTimeout: 90 * time.Second, MaxHeaderBytes: 1 << 16}
}
