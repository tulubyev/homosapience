"""Render the APTOGON brand SVG to PNGs at multiple sizes via headless Chromium.

Used to regenerate the browser-extension icons whenever the brand mark changes.

Usage:
    python design/render-icons.py
"""
from pathlib import Path
import tempfile
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent

# Inline SVG must match frontend/src/components/Logo.tsx so the badge in the
# browser tab, the extension icon, and the in-app Header all show the same mark.
LOGO_SVG = """<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
  <circle cx="50" cy="50" r="48" fill="#dcfce7" stroke="#16a34a" stroke-width="3"/>
  <circle cx="44" cy="34" r="11" fill="#16a34a"/>
  <path d="M 22 80 Q 22 52 44 52 Q 66 52 66 80 Z" fill="#16a34a"/>
  <circle cx="74" cy="72" r="14" fill="#16a34a" stroke="#ffffff" stroke-width="3"/>
  <polyline points="67,72 73,78 81,66" fill="none" stroke="#ffffff" stroke-width="3.5"
            stroke-linecap="round" stroke-linejoin="round"/>
</svg>"""

# Each entry: (output path relative to ROOT, pixel size)
TARGETS = [
    ("browser-extension/icons/icon16.png", 16),
    ("browser-extension/icons/icon48.png", 48),
    ("browser-extension/icons/icon128.png", 128),
]


def main() -> None:
    with tempfile.TemporaryDirectory() as td:
        html = Path(td) / "logo.html"
        html.write_text(
            f"<!doctype html><html><body "
            f"style='margin:0;padding:0;background:transparent'>{LOGO_SVG}</body></html>"
        )

        with sync_playwright() as p:
            browser = p.chromium.launch()
            for rel_path, size in TARGETS:
                page = browser.new_page(
                    viewport={"width": size, "height": size},
                    device_scale_factor=1,
                )
                page.goto(f"file://{html}")
                # Force the SVG to fill viewport
                page.add_style_tag(content=f"svg{{width:{size}px;height:{size}px}}")
                out = ROOT / rel_path
                out.parent.mkdir(parents=True, exist_ok=True)
                page.screenshot(path=str(out), omit_background=True)
                print(f"✓ {rel_path}  ({size}×{size})")
                page.close()
            browser.close()


if __name__ == "__main__":
    main()
