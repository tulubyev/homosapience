#!/usr/bin/env python3
"""Render promo banner and X mockup screenshot via Playwright."""
import os
from pathlib import Path
from playwright.sync_api import sync_playwright

BASE = Path(__file__).parent
OUT  = BASE / "store-screenshots"
OUT.mkdir(exist_ok=True)

with sync_playwright() as p:
    browser = p.chromium.launch()

    # 1 — Promo banner 440×280
    page = browser.new_page(viewport={"width": 440, "height": 280})
    page.goto(f"file://{BASE / 'promo-banner.html'}")
    page.wait_for_timeout(300)
    page.screenshot(path=str(OUT / "promo-banner-440x280.png"), clip={"x":0,"y":0,"width":440,"height":280})
    print("✓ promo-banner-440x280.png")

    # 2 — X mockup 1280×800
    page2 = browser.new_page(viewport={"width": 1280, "height": 800})
    page2.goto(f"file://{BASE / 'screenshot-x-mockup.html'}")
    page2.wait_for_timeout(300)
    page2.screenshot(path=str(OUT / "06-x-badge.png"), clip={"x":0,"y":0,"width":1280,"height":800})
    print("✓ 06-x-badge.png (1280×800)")

    browser.close()

print("Done →", OUT)
