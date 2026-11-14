# Security Policy

Capital Tracker runs locally and stores personal financial snapshots on the device. It is open-source software, **not** a hosted bank service or a secure encrypted vault.

## Reporting a vulnerability

Please do **not** post an exploit, token, private financial data or database contents in a public Issue. Instead use the repository's **Security → Report a vulnerability** private reporting feature, if enabled. If private reporting is unavailable, open a public Issue requesting a private contact channel without disclosing vulnerability details.

No guaranteed response or support timeframe is offered.

## Security model

- The server listens on loopback only, with Host and Origin protections and a custom header for mutations.
- Public deployments use revocable sessions. The sign-in form remembers the device by default with a 180-day lifetime renewed during use; unchecking that option retains a 30-day absolute lifetime and 7-day idle timeout. Source-based login throttling and bounded password-check concurrency apply to both. See [Hosting](docs/HOSTING.md) for the required proxy client-IP header.
- Optional TOTP requires a six-digit authenticator code for new browsers. A separate trusted-browser cookie skips codes for 180 days after password sign-in and survives sign-out; it never grants access without a password/session. Codes have a limited clock window, persistent replay protection, and account-wide attempt throttling after password verification. Changing credentials or the TOTP secret revokes sessions and trust. Enrollment and administrator recovery are documented in [Hosting](docs/HOSTING.md#two-factor-confirmation-for-new-devices).
- Builds require Go 1.27.4 or newer; CI and releases scan reachable Go dependencies and npm advisories.
- On Unix, SQLite backups are created owner-only (`0600`) before financial data is written; Windows deployments must protect the backup directory ACL.
- A database lock prevents two application processes from writing the same data directory.
- The embedded PWA serves assets locally; API responses are not stored in the service-worker cache.
- The optional exchange-rate service makes network requests only when rates are explicitly requested, without transmitting account names or balances.
- The local SQLite file, exported JSON and backup copies are **not encrypted by the application**. Protect them with OS account permissions, full-disk encryption and a backup policy.
- Downloaded binaries are not signed or notarized. Verify release checksums; use builds only from sources you trust.

See [Architecture](docs/ARCHITECTURE.md) and [Developer guide](docs/DEVELOPMENT.md) for implementation and build details.
