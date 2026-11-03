# Updates from Settings → About

Updates run **only after clicking Update**. Opening the app, checking a release,
reconnecting, launchd restarts and timers never start an update. Check for updates
uses GitHub's latest published stable release for `perevozchiko/capital-tracker`;
drafts, prereleases, equal versions and downgrades cannot be installed. A changed
release between check and start requires another check and click.

The Go application has three protected API routes: `GET /api/update/status`,
`POST /api/update/check` (`{}`), and `POST /api/update/start`
(`{"target_version":"0.4.0","request_id":"<UUID>"}`). They use the existing
session, Host, Origin, fetch metadata and `X-Capital-Tracker: 1` checks. There is
no browser-facing agent URL or credential. No agent configuration means disabled
buttons; missing/broken credentials or an unreachable agent do not prevent the
application from starting or using financial features.

## Boundary and durable state

The unprivileged Python 3.10+ agent runs on **macOS**, outside OrbStack. It invokes
one administrator-configured absolute argv without a shell. Neither HTTP endpoint
accepts commands, arguments, repository names, paths or download URLs. Only this
host process and the existing host updater have Docker access. The app container
has neither Docker socket nor root privileges. Its sole new permission is reading
an owner-only shared random key, which permits these three operations.

The default listener is `127.0.0.1:18765`. OrbStack provides
[`host.docker.internal`](https://docs.orbstack.dev/docker/network#connecting-to-servers-on-mac)
for accessing Mac services from containers, including containers sharing Caddy's
network namespace. Verify connectivity on the actual installed OrbStack version.
Do not change the listener to `0.0.0.0` or expose it through Caddy/Cloudflare. If
loopback forwarding is unavailable, bind an explicitly firewalled private host
interface accessible only to OrbStack; retain request authentication.

IPC v1 has only `GET /v1/status`, `POST /v1/check`, `POST /v1/start`. POST bodies are
created by Go and include `current_version` from its compiled version, plus the
start route's two fields. No cookies, CORS or browser auth are accepted by the
agent. Maximum body size is 4096 bytes. The key is the ASCII content of a 64-digit
lowercase hex file, without trailing whitespace. Requests carry:

- `X-Update-Time`: Unix seconds, within 30 seconds of host time.
- `X-Update-Nonce`: 24 random bytes encoded as 48 hex digits.
- `X-Update-Signature`: hex HMAC-SHA256 over
  `METHOD + "\n" + PATH + "\n" + TIME + "\n" + NONCE + "\n" + BODY`.

Responses are authenticated with the same header over
`NONCE + "\n" + HTTP_STATUS + "\n" + RESPONSE_BODY`. Go disables redirects and
HTTP proxies for this connection. Nonces are committed to host `ipc.sqlite` before
an action, preventing replay even across agent restarts. Rotate the key on both
sides to revoke access. This authenticated HTTP channel does not encrypt version
metadata; no financial data or app credentials cross it.

Host `operation.json` is written atomically with fsync. An inherited `flock`
serializes the whole operation, including the subprocess handoff. Repeated clicks
join the running operation; the same request UUID returns its stored result. A
stale pre-update app cannot repeat an already successful target. The detached
worker and updater survive stopping the Go container, closing a tab, and restarting
the agent listener. launchd leaves the detached worker alone. A vanished worker
leaves `recovery_required`, blocks retries, and **never** automatically reruns the
updater. After a Mac power loss or a killed worker, use the existing updater's
recovery journal to restore/check the image and database manually before archiving
`operation.json` with the agent stopped. Never clear an active operation lock.

The browser polls status while an operation runs and retries through transient
Caddy/Cloudflare errors. Reopening any tab discovers the host operation. It checks
`/api/meta` after restart, refreshes the service worker, removes Capital Tracker's
static caches and reloads to obtain the new code. A successful result is confirmed
only when the running version matches the target. Unsaved edits delay that reload.
Auth sessions remain in the existing data directory and remain required; if a
session expires, sign in again to resume status monitoring. There is no public
unauthenticated status bypass. API requests are never served from the PWA cache.

## Existing host updater: required protocol adapter

**The server file `/Users/server/capital-tracker-setup/update.py` was unavailable
in the development workspace. This implementation supplies the integration
contract, not a replacement for that deployment/rollback implementation. Before
enabling the button, add and test the following explicit protocol mode in that
script or a fixed wrapper around its internal functions. Do not simply pipe its
human-readable output into this agent.** Unsupported protocol flags must fail
without deploying. Configure `updater_protocol: 1` only after this adapter exists.

The configured command, for example
`/Users/server/bin/update-capital-tracker --agent-protocol=1`, receives one JSON
line on stdin:

```json
{"protocol":1,"repository":"perevozchiko/capital-tracker","operation_id":"UUID","current_version":"0.3.2","release":{"version":"0.4.0","tag":"v0.4.0","release_id":123,"url":"https://github.com/perevozchiko/capital-tracker/releases/tag/v0.4.0"}}
```

The adapter must validate all fields, compare `current_version` with the actually
installed version, and revalidate the release ID/tag through
GitHub, reject prereleases/drafts, resolve the tag to an exact commit, and build
that commit (never `master` or an unpinned branch). This is a **source build on
Apple Silicon**: published archives currently have no Linux arm64 artifact. Keep
the existing Linux arm64/OrbStack image build and test procedure. A GitHub API
failure must stop before mutation. The agent rechecks the
[latest release endpoint](https://docs.github.com/en/rest/releases/releases#get-the-latest-release)
on each explicit check/start. The adapter must pin the resolved release throughout
the operation even if another release is subsequently published.

Stdout is newline-delimited protocol JSON only, flushed immediately; diagnostics
are stderr (private per-operation host log). Emit these stages **before** starting
each phase, exactly in order:

```json
{"event":"stage","stage":"build"}
{"event":"stage","stage":"test"}
{"event":"stage","stage":"backup"}
{"event":"stage","stage":"sqlite_check"}
{"event":"stage","stage":"switch"}
{"event":"stage","stage":"health_check"}
{"event":"result","outcome":"succeeded","verified_version":"0.4.0"}
```

Retain the existing consistent SQLite backup, `PRAGMA integrity_check`, backups
of deployment configuration/image identity, exclusive deployment lock (also used
by manual `~/bin/update-capital-tracker` invocations), startup health tests and
rollback. Never copy only a live `capital.db`: include WAL consistency with SQLite's
backup API/`VACUUM INTO`, or quiesce writes before snapshotting. Before switching,
stop/quiesce the app and capture a **final** consistent snapshot; otherwise writes
between the backup and switch could be lost on rollback. Verify both the snapshot
and the restarted database. Keep auth/session files and original backup files.
On any failure after switch, stop the new app, safely restore the old database
(including handling WAL/SHM), configuration and image, restart, run SQLite and
HTTP/version health checks, then emit:

```json
{"event":"stage","stage":"rollback"}
{"event":"result","outcome":"rolled_back","verified_version":"0.3.2"}
```

A successful update exits 0. A pre-switch failure must leave or restart the original healthy application; it emits
`{"event":"result","outcome":"failed"}` and exits nonzero. A verified rollback
also exits nonzero. A failed rollback emits `recovery_required` and exits nonzero.
Handle signals/timeouts using the existing rollback/journal mechanism; the agent
does not kill a deployment because an HTTP caller disconnected or a timer expired.
The host command owns bounded phase timeouts, rollback, and crash recovery. Do not
report success until all verification passes. Missing/malformed/out-of-order events,
a mismatched verified version or unexplained exit becomes `recovery_required`;
it is never treated as successful. The agent trusts this **local** adapter's reports;
it cannot prove SQLite integrity itself from inside the app container.

## Install on the server (manual; no production changes made)

First integrate the protocol mode above and validate it against an isolated clone
of the deployment/data. Deploy a release containing this UI/API once using the
existing host command; future releases can then be started from Settings. The
agent/adapter are host software and should be upgraded separately, while idle.

As the existing `server` user (not root), adjust Python and UID/GID to the actual
machine:

```sh
mkdir -p /Users/server/.config/capital-tracker /Users/server/Library/LaunchAgents
chmod 700 /Users/server/.config/capital-tracker
# Install scripts/update_agent.py beside existing update.py; do not overwrite it.
install -m 700 scripts/update_agent.py /Users/server/capital-tracker-setup/update_agent.py
/opt/homebrew/bin/python3 -c 'import pathlib,secrets; p=pathlib.Path("/Users/server/.config/capital-tracker/updater.key"); p.touch(mode=0o600, exist_ok=False); p.write_text(secrets.token_hex(32)+"\n")'
cp deploy/update-agent.json.example /Users/server/.config/capital-tracker/update-agent.json
chmod 600 /Users/server/.config/capital-tracker/update-agent.json
```

Check the actual command path: `~/bin` may differ from `/Users/server/bin`.
Keep `state_dir` **outside** `data` and outside all container mounts. Protect the
parent directory and keep backups/logs on the SSD with owner-only permissions;
rotate private operation/launchd logs. Copy the plist, verify paths, then:

```sh
cp deploy/net.anasko.capital-tracker-updater.plist /Users/server/Library/LaunchAgents/
plutil -lint /Users/server/Library/LaunchAgents/net.anasko.capital-tracker-updater.plist
launchctl bootstrap gui/$(id -u) /Users/server/Library/LaunchAgents/net.anasko.capital-tracker-updater.plist
launchctl print gui/$(id -u)/net.anasko.capital-tracker-updater
```

A LaunchAgent requires that user's login session; configure the server's normal
persistent user login. A system LaunchDaemon alternative must explicitly set
`UserName=server` and use that user's OrbStack Docker context; never run the updater
as root. The supplied template is a LaunchAgent, not a root daemon.

Merge `deploy/compose.updates.example.yml` into
`/Volumes/server-ssd/server-data/services/caddy/compose.yml`, preserving the existing
Caddy/Tunnel/auth settings. Determine `id -u server` / `id -g server`; use a matching
non-root container user so the `0600` bind-mounted key and data remain readable.
Preserve these settings/mounts in every future image recreation. The app continues
to bind `127.0.0.1:8765` inside `network_mode: service:caddy`. Do not publish a new
app port. Validate the merged Compose and host connectivity before recreating just
the application; retain the old image/config for rollback.

Verify unauthenticated access to `/api/update/status` is 401, CSRF-less POST is 403,
check alone creates no operation, and Update shows progress. Close the tab during
a **staging** update, reopen, verify success/new version; repeat with injected build,
health and rollback failures on temporary data. On production, click Update only
when intentionally installing the displayed stable release. This repository does
not add scheduled updates or publish a new GitHub Release.

## Development validation

```sh
python3 -m unittest discover -s tests -p '*update*test.py'
npm run check
npm run test:ui -- tests/ui/updates.spec.cjs
```

Tests use private temporary SQLite databases and protocol fixture updaters; they never
read or modify production paths, Docker services or Cloudflare configuration. They
exercise SQLite backup/restore, the IPC/worker lifecycle, and a real Go application
restarting between two compiled test versions, but cannot certify the
unavailable server updater or actual OrbStack connectivity. Validate the adapter
and installed networking in staging before enabling this integration on the server.
