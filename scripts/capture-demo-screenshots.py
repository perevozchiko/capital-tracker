#!/usr/bin/env python3
"""Capture genuine Capital Tracker UI screenshots from a fresh isolated demo.

Optional documentation tool; not required to build or run Capital Tracker.
Requires Python Playwright and its Chromium browser installation.
"""
from __future__ import annotations

import json
import os
from pathlib import Path
import socket
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request

try:
    from playwright.sync_api import sync_playwright
except ImportError:
    raise SystemExit(
        "Python Playwright is required only for screenshots. "
        "Run: python3 -m pip install playwright && python3 -m playwright install chromium"
    )

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "docs" / "screenshots"


def free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.bind(("127.0.0.1", 0))
        return int(sock.getsockname()[1])


def wait_for_server(url: str, process: subprocess.Popen, deadline: float) -> None:
    while time.monotonic() < deadline:
        if process.poll() is not None:
            raise RuntimeError("Capital Tracker stopped before it became ready")
        try:
            with urllib.request.urlopen(url + "/api/meta", timeout=0.5) as response:
                if response.status == 200:
                    return
        except (OSError, urllib.error.URLError):
            pass
        time.sleep(0.15)
    raise RuntimeError("Capital Tracker did not become ready")



def seed_showcase(url: str) -> None:
    """Populate *only* the disposable screenshot demo with realistic notes.

    The normal --demo fixture deliberately contains capital balances only.
    These additional records exercise the real Income, Major expenses and
    Recurring expenses pages, including their monthly history charts.
    """
    months = [f"{year}-{month:02d}" for year in (2025, 2026)
              for month in range(1, 13)
              if "2025-10" <= f"{year}-{month:02d}" <= "2026-09"]
    for idx, month in enumerate(months):
        def entry(name: str, cents: int, currency: str = "EUR") -> dict:
            return {
                "month": month, "name": name, "currency": currency,
                "amount_minor": str(cents), "rate": "1" if currency == "EUR" else "1.10",
            }

        incomes = [
            entry("Salary", 280000 + (idx // 4) * 7500),
            entry("Side projects", 18000 + (idx % 3) * 2200, "USD"),
        ]
        if idx in (2, 8):
            incomes.append(entry("Annual bonus", 55000 if idx == 2 else 40000))
        expenses = [
            entry("Car maintenance" if idx % 3 == 0 else "Household purchase",
                  24000 + (idx % 4) * 9200),
        ]
        if idx in (7, 8):
            expenses.append(entry("Summer holiday", 120000 + (idx - 7) * 60000))
        if idx == 4:
            expenses.append(entry("New laptop", 94000))
        recurring = [
            entry("Rent", 85000),
            entry("Groceries", 39000 + (idx % 3) * 2300),
            entry("Utilities", 14000 + (idx % 4) * 1100),
            entry("Internet & mobile", 4800),
            entry("Transport", 12000),
        ]

        for endpoint, entries in (
            ("incomes", incomes),
            ("expenses", expenses),
            ("recurring-expenses", recurring),
        ):
            request = urllib.request.Request(
                f"{url}/api/{endpoint}/{month}",
                data=json.dumps({"entries": entries}).encode("utf-8"),
                headers={
                    "Content-Type": "application/json",
                    "X-Capital-Tracker": "1",
                },
                method="PUT",
            )
            try:
                with urllib.request.urlopen(request, timeout=5) as response:
                    if response.status not in (200, 204):
                        raise RuntimeError(f"{endpoint}/{month}: HTTP {response.status}")
            except urllib.error.HTTPError as exc:
                raise RuntimeError(
                    f"Cannot seed {endpoint}/{month}: HTTP {exc.code} "
                    f"{exc.read().decode('utf-8', errors='replace')}"
                ) from exc


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="capital-tracker-screenshots-") as temp:
        root = Path(temp)
        binary = root / ("CapitalTracker.exe" if os.name == "nt" else "CapitalTracker")
        subprocess.run(["go", "build", "-o", str(binary), "./cmd/capital-tracker"], cwd=ROOT, check=True)

        # Change every platform's normal config base so even an existing demo
        # database is never used for screenshot capture.
        env = os.environ.copy()
        env["HOME"] = str(root)
        env["XDG_CONFIG_HOME"] = str(root / "config")
        env["APPDATA"] = str(root / "AppData" / "Roaming")
        port = free_port()
        url = f"http://127.0.0.1:{port}"
        process = subprocess.Popen(
            [str(binary), "--demo", "--no-browser", "--port", str(port)],
            cwd=ROOT, env=env, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE,
        )
        try:
            wait_for_server(url, process, time.monotonic() + 30)
            seed_showcase(url)
            with sync_playwright() as playwright:
                browser = playwright.chromium.launch(headless=True)
                try:
                    page = browser.new_page(
                        viewport={"width": 1440, "height": 960},
                        device_scale_factor=1,
                        color_scheme="dark",
                    )
                    page.goto(url, wait_until="networkidle")
                    # Choose Dark via the actual Settings UI (not a CSS mock).
                    page.locator('#navigation [data-page="settings"]').click()
                    page.locator("#themeSelect").wait_for()
                    with page.expect_response(
                        lambda response: response.url.endswith("/api/settings")
                        and response.request.method == "PATCH"
                    ):
                        page.locator("#themeSelect").select_option("dark")
                    page.locator("html[data-theme='dark']").wait_for()
                    page.locator('#navigation [data-page="dashboard"]').click()
                    page.locator(".grid-summary").wait_for()
                    page.screenshot(path=str(OUT / "dashboard.png"), full_page=True)

                    page.locator('#navigation [data-page="monthly"]').click()
                    page.locator(".balance-row").first.wait_for()
                    page.locator("html[data-theme='dark']").wait_for()
                    page.screenshot(path=str(OUT / "monthly-balances.png"), full_page=True)

                    page.locator('#navigation [data-page="accounts"]').click()
                    page.locator(".account-row").first.wait_for()
                    page.locator("html[data-theme='dark']").wait_for()
                    page.screenshot(path=str(OUT / "accounts.png"), full_page=True)

                    for route, selector, filename in (
                        ("incomes", "[data-income-row]", "income.png"),
                        ("expenses", "[data-expense-row]", "major-expenses.png"),
                        ("recurringExpenses", "[data-recurring-expense-row]", "recurring-expenses.png"),
                    ):
                        page.locator(f'#navigation [data-page="{route}"]').click()
                        page.locator(selector).first.wait_for()
                        page.locator("html[data-theme='dark']").wait_for()
                        page.screenshot(path=str(OUT / filename), full_page=True, animations="disabled")

                    page.locator('#navigation [data-page="dashboard"]').click()
                    page.locator(".grid-summary").wait_for()
                    page.set_viewport_size({"width": 390, "height": 844})
                    page.evaluate("window.scrollTo(0, 0)")
                    page.screenshot(
                        path=str(OUT / "mobile-dashboard.png"),
                        full_page=False, animations="disabled",
                    )

                    page.set_viewport_size({"width": 1440, "height": 960})
                    page.locator('#navigation [data-page="monthly"]').click()
                    page.locator(".balance-row").first.wait_for()
                    page.set_viewport_size({"width": 390, "height": 844})
                    page.evaluate("window.scrollTo(0, 0)")
                    page.screenshot(
                        path=str(OUT / "mobile-balances.png"),
                        full_page=False, animations="disabled",
                    )
                finally:
                    browser.close()
        finally:
            process.terminate()
            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait()
    print("Captured eight real Chromium screenshots in docs/screenshots/ (desktop and mobile).")


if __name__ == "__main__":
    try:
        main()
    except (OSError, RuntimeError, subprocess.CalledProcessError) as exc:
        raise SystemExit(f"Screenshot capture failed: {exc}")
