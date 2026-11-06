# Access through fin.anasko.net

When authentication is configured, every new browser sees a standalone sign-in page immediately. The application HTML, scripts, styles and financial APIs are protected on the server; they are not sent to unauthenticated visitors. After signing in, the same browser opens the application directly without showing the sign-in form. Authenticated deployments disable offline asset caching and remove caches left by the local-mode service worker.

The app supports one configured username and password, persistent browser sessions, sign-out and login throttling. Closing the browser or restarting the server preserves unexpired sessions. **Keep me signed in on this device** is checked by default on the sign-in form. Remembered devices stay signed in for **180 days without activity**, with the deadline renewed during use. Uncheck it on shared devices: those sessions retain the shorter **30-day absolute lifetime and 7-day idle timeout**. API clients that omit `remember` also use the shorter policy. Activity is persisted at most once per hour, so inactivity can shorten these windows by up to one hour. Signing out revokes that browser's session, including after a server restart; other devices stay signed in. Changing the configured username or password hash and restarting invalidates all saved sessions. Upgrading from the old session format revokes existing sessions once; sign in again on each device.

Cookies include both Max-Age and Expires, with renewal acknowledged only after the server saves the new deadline. Existing sessions keep their original shorter policy after upgrading; sign out and sign in once with **Keep me signed in** checked to enable the longer policy. Clearing cookies, reinstalling the PWA, or using a private browsing session can also require signing in again. Safari and an installed Home Screen web app have separate cookie stores after installation, so signing in inside Safari later does not sign in the installed app.

The login fields support the system password manager's username/current-password AutoFill. On supported iPhones, a saved password can be filled after Face ID or Touch ID verification; the app does not store the password itself. Dedicated passwordless passkey sign-in is not implemented.

## Two-factor confirmation for new devices

Set `CAPITAL_TRACKER_TOTP_SECRET` to enable a second factor alongside the existing username and password. Generate a new secret on a private terminal, using the same username as the server:

```sh
CAPITAL_TRACKER_USERNAME=andrei ./capital-tracker generate-totp
```

The command prints a random setup secret and an `otpauth://` enrollment URI; it does not change server configuration. In Authy, add an account manually using that secret and select **6-digit** tokens. Other TOTP apps can use the URI or manual secret with **SHA-1, 6 digits, 30 seconds**. These parameters follow [RFC 6238](https://www.rfc-editor.org/rfc/rfc6238). Both printed values contain the credential: keep them private and do not use an online QR-code generator.

After adding the account to your authenticator, put the same secret into the private server environment file (for example `/etc/capital-tracker.env`):

```sh
CAPITAL_TRACKER_TOTP_SECRET='YOUR_GENERATED_BASE32_SECRET'
```

Restart the service. Enabling TOTP revokes existing password-only sessions, so each browser must confirm once. Invalid or weak secrets prevent startup; a secret without a valid username/password configuration also prevents startup. Leave the variable unset for password-only deployments.

After the username and password are accepted, a new browser is asked for its current authenticator code. **Trust this device — skip codes for 180 days** is checked by default. A trusted browser still needs the password after sign-out or session expiry, but skips the code. Trust lasts **180 days from the last successful password sign-in** with trust selected; each such sign-in rotates the device token and renews this deadline. A live authenticated session continues to follow its own lifetime described above. On a shared device, uncheck both **Keep me signed in** and **Trust this device**. API clients that omit `trust_device` do not create device trust.

Trust is a separate HttpOnly, SameSite=Strict cookie (also Secure under HTTPS) and survives sign-out and server restarts. It identifies a browser profile, not the physical machine: a different browser, a private window, an installed PWA with a separate cookie store, clearing cookies, or an expired trust cookie requires another code. A trusted-device cookie alone never grants access to financial data. Sign-out revokes the login session and keeps device trust as requested.

Codes accept at most one 30-second step of clock skew in either direction. Each accepted code step can only be used once across devices and restarts; if adding two devices quickly, wait for the next code. Keep server and phone clocks synchronized. In addition to source-based password throttling, code verification allows 10 attempts per minute across the account, including requests from different IPs; this budget can only be consumed after a correct password.

Trusted-device token hashes and the last accepted TOTP step are stored alongside session hashes in the private `auth-sessions.json`, outside financial backups. The TOTP secret stays in deployment configuration. Changing the username, password hash, or TOTP secret, or disabling TOTP and restarting, revokes all sessions and trusted devices. Reverting that configuration later does not restore them.

To revoke all devices immediately, stop the service, remove `auth-sessions.json` from the configured data directory, then restart. This signs out every browser and requires a fresh code. If the authenticator is lost, use server administrator access to generate and configure a new secret and restart; the new secret revokes old devices. There are no recovery codes or web-based factor reset. Keep a protected recovery copy of the setup secret if you need to enroll another authenticator later.

## HTTPS deployment

Session token hashes are stored in `auth-sessions.json` in the application data directory, with owner-only file permissions. Keep this file across restarts. Credentials and sessions are outside SQLite and financial JSON/SQLite backups; financial data import or deletion does not sign you out. With no auth environment variables, the original local-only mode still works. Setting a public origin without valid credentials prevents startup.

The Go server stays on `127.0.0.1:8765`. Caddy on the same Linux machine serves HTTPS at `fin.anasko.net` and proxies to Go. Only ports 80/443 should be forwarded from your router; do not forward 8765. A public IP or an existing tunnel/reverse proxy is required; router forwarding alone will not work behind CGNAT. Point DNS A (and AAAA only if IPv6 is configured) to your public address. Phones then use the same HTTPS URL, including outside home Wi-Fi.

## Install on a Linux server

Build with Go 1.27.3 or newer for your server's CPU (amd64 or arm64). The module enforces the minimum patched Go version; automatic toolchain selection downloads it when necessary:

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

Caddy handles certificates and HTTP-to-HTTPS redirects. The Go server validates the configured Host and HTTPS Origin. For login throttling, Caddy must overwrite `X-Capital-Tracker-Client-IP` with `{remote_host}`, as shown in `deploy/Caddyfile`. The app accepts this address only from a loopback connection to the configured public Host; other forwarding headers are ignored. Missing or malformed client IP headers on that proxy path return HTTP 503 on login. When upgrading an existing deployment, update and reload Caddy **before** restarting the new application binary. Other reverse proxies must set the same header from the actual connection address, replacing any visitor-supplied value. See [Caddy reverse proxy documentation](https://caddyserver.com/docs/caddyfile/directives/reverse_proxy).

Login allows 10 attempts per minute per source IPv4 address or IPv6 /64 subnet. An attacker on another source cannot exhaust the owner's source limit. Devices sharing the same public IP share that limit. With TOTP enabled, a caller who knows the password also shares the account-wide code-verification limit described above. At most two password checks run concurrently; authenticated API calls do not wait for their mutex.

Open `https://fin.anasko.net` and sign in. A direct request to `/api/data/export` without a session must return 401. Financial API responses are never cached. Session cookies are HttpOnly, SameSite=Strict and Secure in public mode. Password hashing uses [Go bcrypt](https://pkg.go.dev/golang.org/x/crypto/bcrypt).

For auth testing on the local machine, set username/hash and omit `CAPITAL_TRACKER_PUBLIC_ORIGIN`. This permits a non-Secure cookie only on the existing loopback Host allowlist. Use the HTTPS public origin when hosting remotely.

For example, build the app and start it with a separate local test database (Zsh/Bash):

```sh
go build -o /tmp/capital-tracker ./cmd/capital-tracker
export CAPITAL_TRACKER_USERNAME=andrei
read -r -s CAPITAL_TRACKER_PASSWORD
export CAPITAL_TRACKER_PASSWORD
export CAPITAL_TRACKER_PASSWORD_HASH="$(/tmp/capital-tracker hash-password)"
unset CAPITAL_TRACKER_PASSWORD CAPITAL_TRACKER_PUBLIC_ORIGIN
/tmp/capital-tracker --no-browser --data-dir /tmp/capital-tracker-auth-test --port 8766
```

Enter a test password of 12–72 bytes at the `read` step, then open `http://127.0.0.1:8766`. Use a private window to verify that another browser sees only the sign-in form; normal browsing preserves your existing login. This test directory is separate from your regular financial database.

See [host-managed release updates](UPDATES.md) for the optional Settings → About update button, macOS/OrbStack agent, IPC security and installation contract. Updates require an explicit button click.
