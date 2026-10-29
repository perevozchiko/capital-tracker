# Security Policy

Capital Tracker runs locally and stores personal financial snapshots on the device. It is open-source software, **not** a hosted bank service or a secure encrypted vault.

## Reporting a vulnerability

Please do **not** post an exploit, token, private financial data or database contents in a public Issue. Instead use the repository's **Security → Report a vulnerability** private reporting feature, if enabled. If private reporting is unavailable, open a public Issue requesting a private contact channel without disclosing vulnerability details.

No guaranteed response or support timeframe is offered.

## Security model

- The server listens on loopback only, with Host and Origin protections and a custom header for mutations.
- A database lock prevents two application processes from writing the same data directory.
- The embedded PWA serves assets locally; API responses are not stored in the service-worker cache.
- The optional exchange-rate service makes network requests only when rates are explicitly requested, without transmitting account names or balances.
- The local SQLite file, exported JSON and backup copies are **not encrypted by the application**. Protect them with OS account permissions, full-disk encryption and a backup policy.
- Downloaded binaries are not signed or notarized. Verify release checksums; use builds only from sources you trust.

See [Architecture](docs/ARCHITECTURE.md) and [Developer guide](docs/DEVELOPMENT.md) for implementation and build details.
