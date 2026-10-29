# Contributing to Capital Tracker

Thanks for helping improve Capital Tracker. It is an independently developed, open-source personal-finance application. Contributions are welcome, including bug reports, documentation fixes, accessibility improvements and tests.

## Start here

Read [Architecture](docs/ARCHITECTURE.md) for module ownership and accounting invariants, [Developer guide](docs/DEVELOPMENT.md) for build and release details, and [HTTP API](docs/API.md) for routes.

Requirements for local development: Go 1.23+, Node.js 22+, and npm. No frontend framework, bundler or production Node runtime is needed.

```sh
npm ci
npm run check
npx playwright install chromium
npm run test:ui
```

To format source before committing, use `npm run format`, then rerun `npm run check`. A pull request should describe the reason for the change and include relevant automated tests. An Issue is helpful for larger changes, but not required. Do not include personal financial records, live SQLite databases or sensitive information in bug reports or screenshots.

## Project conventions

- Keep the Go `net/http` + `database/sql` + SQLite architecture and browser ES modules simple; avoid adding frameworks, TypeScript, runtime npm dependencies or an ORM without an explicit design discussion.
- Keep financial arithmetic exact in Go. Money is integer minor units, exchange rates are decimal/fixed-point, and missing balances differ from zero.
- Maintain the existing local-only security model; do not expose the HTTP API on a public interface.
- Prefer small, independently reviewable changes. Update the relevant `docs/` file when interfaces, storage semantics, UX or release behavior change.
- Add regression tests for every fixed bug. Test destructive changes on isolated data, not real financial records.
- Use normal branches and PRs. CI and UI tests run on PRs; builds and GitHub Releases remain manually triggered.

## Licensing and provenance

The project's original code is made available under **MIT OR Apache-2.0** at the recipient's option. By submitting a contribution, you agree to license your contribution under the same dual-license terms. Only contribute work you have the right to license; don't copy proprietary code or assets from commercial finance apps or use their trademarks as this application's branding.

Third-party dependencies retain their own respective licenses. See [LICENSE](LICENSE) (MIT), [LICENSE-APACHE](LICENSE-APACHE) and the project's dependency manifests.
