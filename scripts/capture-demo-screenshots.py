#!/usr/bin/env python3
"""Capture genuine Capital Tracker UI screenshots from a fresh isolated demo.

Optional documentation tool; not required to build or run Capital Tracker.
Requires Python Playwright and its Chromium browser installation.
"""
from __future__ import annotations

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
            with sync_playwright() as playwright:
                browser = playwright.chromium.launch(headless=True)
                try:
                    page = browser.new_page(viewport={"width": 1440, "height": 960}, device_scale_factor=1)
                    page.goto(url, wait_until="networkidle")
                    page.locator(".grid-summary").wait_for()
                    page.screenshot(path=str(OUT / "dashboard.png"), full_page=True)

                    page.locator('#navigation [data-page="monthly"]').click()
                    page.locator(".balance-row").first.wait_for()
                    page.screenshot(path=str(OUT / "monthly-balances.png"), full_page=True)

                    page.locator('#navigation [data-page="accounts"]').click()
                    page.locator(".account-row").first.wait_for()
                    page.screenshot(path=str(OUT / "accounts.png"), full_page=True)
                finally:
                    browser.close()
        finally:
            process.terminate()
            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait()
    print("Screenshots captured in docs/screenshots/: dashboard.png, monthly-balances.png, accounts.png")


if __name__ == "__main__":
    try:
        main()
    except (OSError, RuntimeError, subprocess.CalledProcessError) as exc:
        raise SystemExit(f"Screenshot capture failed: {exc}")
