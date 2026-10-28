package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"net"
	"net/http"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"syscall"
	"time"

	"github.com/perevozchiko/capital-tracker/internal/httpapi"
	"github.com/perevozchiko/capital-tracker/internal/storage"
	"github.com/perevozchiko/capital-tracker/web"
)

var version = "0.1.2"

func envOr(name, fallback string) string {
	if v := os.Getenv(name); v != "" {
		return v
	}
	return fallback
}
func browser(url string) error {
	var cmd *exec.Cmd
	switch runtime.GOOS {
	case "darwin":
		cmd = exec.Command("open", url)
	case "windows":
		cmd = exec.Command("cmd", "/c", "start", "", url)
	default:
		cmd = exec.Command("xdg-open", url)
	}
	return cmd.Start()
}
func main() {
	if e := run(); e != nil {
		fmt.Fprintln(os.Stderr, "Capital Tracker:", e)
		os.Exit(1)
	}
}
func run() error {
	dir, err := storage.DefaultDataDir()
	if err != nil {
		return err
	}
	if len(os.Args) > 1 && os.Args[1] == "backup" {
		if len(os.Args) != 3 {
			return errors.New("usage: CapitalTracker backup <destination.db>")
		}
		dir = envOr("CAPITAL_TRACKER_DATA_DIR", dir)
		s, e := storage.Open(dir)
		if e != nil {
			return e
		}
		defer s.Close()
		if e = s.Backup(os.Args[2]); e != nil {
			return e
		}
		fmt.Println("Backup created:", os.Args[2])
		return nil
	}
	flags := flag.NewFlagSet("capital-tracker", flag.ContinueOnError)
	dataDir := flags.String("data-dir", envOr("CAPITAL_TRACKER_DATA_DIR", dir), "application data directory")
	port := flags.String("port", envOr("CAPITAL_TRACKER_PORT", "8765"), "loopback HTTP port")
	noBrowser := flags.Bool("no-browser", false, "do not open a browser")
	if err = flags.Parse(os.Args[1:]); err != nil {
		return err
	}
	p, e := strconv.Atoi(*port)
	if e != nil || p < 1 || p > 65535 {
		return errors.New("port must be 1..65535")
	}
	if err = os.MkdirAll(*dataDir, 0700); err != nil {
		return err
	}
	lockFile := filepath.Join(*dataDir, ".capital-tracker.lock")
	lock, e := os.OpenFile(lockFile, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
	if e != nil {
		if os.IsExist(e) {
			target := fmt.Sprintf("http://127.0.0.1:%d", p)
			client := http.Client{Timeout: 2 * time.Second}
			if resp, checkErr := client.Get(target + "/api/meta"); checkErr == nil {
				var buf [128]byte
				n, _ := resp.Body.Read(buf[:])
				resp.Body.Close()
				if resp.StatusCode == 200 && strings.Contains(string(buf[:n]), `"app":"capital-tracker"`) {
					if !*noBrowser {
						_ = browser(target)
					}
					fmt.Println("Capital Tracker is already running at", target)
					return nil
				}
			}
			return fmt.Errorf("another instance may be running (lock at %s); if it crashed, verify it is stopped and remove stale lock", lockFile)
		}
		return e
	}
	fmt.Fprintln(lock, os.Getpid())
	lock.Close()
	defer os.Remove(lockFile)
	s, e := storage.Open(*dataDir)
	if e != nil {
		return e
	}
	defer s.Close()
	handler := (&httpapi.Server{Store: s, Version: version, Assets: web.Assets}).Handler()
	srv := httpapi.NewHTTPServer(net.JoinHostPort("127.0.0.1", *port), handler)
	listener, e := net.Listen("tcp", srv.Addr)
	if e != nil {
		return fmt.Errorf("cannot listen on %s: %w", srv.Addr, e)
	}
	errCh := make(chan error, 1)
	go func() { errCh <- srv.Serve(listener) }()
	url := fmt.Sprintf("http://127.0.0.1:%d", p)
	// The TCP listener is already bound; wait until the HTTP handler responds.
	client := http.Client{Timeout: 250 * time.Millisecond}
	ready := false
	for i := 0; i < 40; i++ {
		response, requestErr := client.Get(url + "/api/meta")
		if requestErr == nil {
			response.Body.Close()
			if response.StatusCode == 200 {
				ready = true
				break
			}
		}
		time.Sleep(25 * time.Millisecond)
	}
	if !ready {
		_ = srv.Close()
		return errors.New("HTTP server did not become ready")
	}
	fmt.Printf("Capital Tracker %s running at %s\nData: %s\nPress Ctrl+C to stop.\n", version, url, s.Path)
	if !*noBrowser {
		if e = browser(url); e != nil {
			fmt.Fprintln(os.Stderr, "Could not open browser:", e, "— visit", url)
		}
	}
	signals := make(chan os.Signal, 1)
	signal.Notify(signals, os.Interrupt, syscall.SIGTERM)
	defer signal.Stop(signals)
	select {
	case <-signals:
	case e = <-errCh:
		if e != nil && !errors.Is(e, http.ErrServerClosed) {
			return e
		}
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	return srv.Shutdown(ctx)
}
