# Access through fin.anasko.net

The app supports one configured username and password, browser sessions lasting seven days, sign-out and login throttling. Credentials are outside SQLite and JSON backups. Restarting the server signs out all browsers. Changing credentials requires a restart. With no auth environment variables, the original local-only mode still works. Setting a public origin without valid credentials prevents startup.

The Go server stays on `127.0.0.1:8765`. Caddy on the same Linux machine serves HTTPS at `fin.anasko.net` and proxies to Go. Only ports 80/443 should be forwarded from your router; do not forward 8765. A public IP or an existing tunnel/reverse proxy is required; router forwarding alone will not work behind CGNAT. Point DNS A (and AAAA only if IPv6 is configured) to your public address. Phones then use the same HTTPS URL, including outside home Wi-Fi.

## Install on a Linux server

Build the binary for your server's CPU (amd64 or arm64):

```sh
CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -trimpath -o capital-tracker ./cmd/capital-tracker
```

Copy it to the server, then install as root:

```sh
install -m 755 capital-tracker /usr/local/bin/capital-tracker
useradd --system --home-dir /var/lib/capital-tracker --shell /usr/sbin/nologin capital-tracker
install -d -m 700 -o capital-tracker -g capital-tracker /var/lib/capital-tracker
```

To move your existing finances, stop the local app first and copy its `capital.db` to `/var/lib/capital-tracker/capital.db`, then set owner `capital-tracker:capital-tracker` and mode `600`. Alternatively import your JSON backup after signing in. Keep a backup before moving data.

Generate a bcrypt hash without putting the password in command arguments or shell history (Bash):

```bash
read -r -s -p 'New password (12–72 bytes): ' CAPITAL_TRACKER_PASSWORD; echo
export CAPITAL_TRACKER_PASSWORD
/usr/local/bin/capital-tracker hash-password
unset CAPITAL_TRACKER_PASSWORD
```

Copy `deploy/capital-tracker.env.example` to `/etc/capital-tracker.env`, replace username and hash, and set `chmod 600 /etc/capital-tracker.env`. Keep the hash in single quotes so `$` characters remain literal. Do not use the placeholder hash. Copy `deploy/capital-tracker.service` to `/etc/systemd/system/`, then:

```sh
systemctl daemon-reload
systemctl enable --now capital-tracker
journalctl -u capital-tracker -n 30
```

Install Caddy using its official distribution for your server OS. Add the contents of `deploy/Caddyfile` to `/etc/caddy/Caddyfile`, validate and reload:

```sh
caddy validate --config /etc/caddy/Caddyfile
systemctl reload caddy
```

Caddy handles certificates and HTTP-to-HTTPS redirects. The Go server validates the configured Host and HTTPS Origin, without trusting client-supplied forwarding headers. See [Caddy reverse proxy documentation](https://caddyserver.com/docs/caddyfile/directives/reverse_proxy).

Open `https://fin.anasko.net` and sign in. A direct request to `/api/data/export` without a session must return 401. Financial API responses are never cached. Session cookies are HttpOnly, SameSite=Strict and Secure in public mode. Password hashing uses [Go bcrypt](https://pkg.go.dev/golang.org/x/crypto/bcrypt).

For auth testing on the local machine, set username/hash and omit `CAPITAL_TRACKER_PUBLIC_ORIGIN`. This permits a non-Secure cookie only on the existing loopback Host allowlist. Use the HTTPS public origin when hosting remotely.
