"""Capture a real screenshot of the extension popup (verified state).

Loads the unpacked extension into new-headless Chromium, seeds a sample
credential into chrome.storage.local, mocks /api/verify/status so the
on-chain row shows "verified", opens popup.html, and screenshots it.

Usage:
    python design/capture-popup.py
Output:
    design/store-screenshots/png/00-popup-real.png
"""
import json
import tempfile
import time
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
EXT = ROOT / "browser-extension"
OUT = ROOT / "design" / "store-screenshots" / "png" / "00-popup-real.png"

# Sample credential matching what background.js getCredential() expects.
DID = "did:key:z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK"
now_ms = int(time.time() * 1000)
CRED = {
    "issuanceDate":   time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    "expirationDate": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(now_ms / 1000 + 26 * 86400)),
    "credentialSubject": {
        "id":              DID,
        "confidence":      0.94,
        "txHash":          "0xEXAMPLE000000000000000000000000000000000000000000000000000000001",
        "expressionProof": "sha3-256:demo",
    },
}

VERIFY_STATUS_MOCK = {
    "did": DID, "is_human": True, "valid_until": now_ms // 1000 + 26 * 86400,
    "bond_count": 3, "trust_score": 0.5, "trust_label": "community_verified",
}


def main() -> None:
    with sync_playwright() as p:
        ctx = p.chromium.launch_persistent_context(
            user_data_dir=tempfile.mkdtemp(),
            headless=False,  # combined with --headless=new below = headless that supports extensions
            args=[
                "--headless=new",
                f"--disable-extensions-except={EXT}",
                f"--load-extension={EXT}",
            ],
        )

        # Wait for the MV3 service worker to register and grab the extension ID.
        # The SW can be lazy in new-headless; fall back to wait_for_event.
        sw = ctx.service_workers[0] if ctx.service_workers else None
        if sw is None:
            try:
                sw = ctx.wait_for_event("serviceworker", timeout=15000)
            except Exception:
                raise SystemExit("Service worker did not start — extension failed to load")
        ext_id = sw.url.split("/")[2]
        print(f"extension id: {ext_id}")

        # Seed credential into chrome.storage.local via the SW context.
        sw.evaluate(
            """async ({ cred, did }) => {
                await chrome.storage.local.set({ hsi_credential: JSON.stringify(cred), hsi_did: did });
            }""",
            {"cred": CRED, "did": DID},
        )

        # Mock the on-chain status call so the popup shows a verified result.
        # Route at CONTEXT level — verifyOnChain() runs in the service worker,
        # so a page-level route would not intercept it.
        ctx.route(
            "**/api/verify/status*",
            lambda route: route.fulfill(
                status=200, content_type="application/json",
                body=json.dumps(VERIFY_STATUS_MOCK),
            ),
        )
        # Also stub the bond-guarantor poll so it doesn't hang/error.
        ctx.route(
            "**/api/bond/pending-for-guarantor*",
            lambda route: route.fulfill(status=200, content_type="application/json", body="[]"),
        )

        page = ctx.new_page()
        page.set_viewport_size({"width": 340, "height": 640})

        page.goto(f"chrome-extension://{ext_id}/popup.html")
        # Wait for the verified UI (the "Verified" title) to render.
        page.wait_for_selector("text=Verified", timeout=8000)
        # Wait until the on-chain row is enriched (no longer "checking…").
        try:
            page.wait_for_function(
                """() => { const el = document.getElementById('onchain-status');
                           return el && !/checking|проверка/i.test(el.textContent); }""",
                timeout=6000,
            )
        except Exception:
            print("warn: on-chain row did not update in time")
        page.wait_for_timeout(400)

        OUT.parent.mkdir(parents=True, exist_ok=True)
        page.screenshot(path=str(OUT), full_page=True)
        print(f"✓ saved {OUT.relative_to(ROOT)}")

        ctx.close()


if __name__ == "__main__":
    main()
