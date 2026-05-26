#!/usr/bin/env python3
from pathlib import Path
from playwright.sync_api import sync_playwright

BASE = Path(__file__).parent
OUT  = BASE / "store-screenshots"

with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page(viewport={"width": 1400, "height": 560})
    page.goto(f"file://{BASE / 'marquee-banner.html'}")
    page.wait_for_timeout(500)
    page.screenshot(
        path=str(OUT / "marquee-1400x560.png"),
        clip={"x": 0, "y": 0, "width": 1400, "height": 560}
    )
    browser.close()
    print("✓ marquee-1400x560.png →", OUT)
