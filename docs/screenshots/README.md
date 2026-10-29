# Screenshot assets

These PNGs are captures from the real Capital Tracker interface in Chromium using the **isolated fictional demo database** and Dark appearance. They are not mockups or images of the author's personal financial records.

- [Dashboard](dashboard.png)
- [Monthly balances](monthly-balances.png)
- [Accounts](accounts.png)

The files are displayed directly in the [repository README](../../README.md).

To regenerate locally, install Python Playwright and Chromium as described in [Developer guide](../DEVELOPMENT.md), then run `python3 scripts/capture-demo-screenshots.py` from the repository root.

Alternatively, run the manually triggered **Actions → Capture demo screenshots** workflow. It replaces only the three PNG assets with actual browser captures; the README layout remains under normal review.
