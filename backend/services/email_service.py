# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2025-2026 Alexander K. Tulubyev and APTOGON contributors.
"""
Transactional email — currently just the self-serve owner email-verification
magic link.

Delivery is authenticated SMTP through the domain mailbox (beget hosts
homosapience.org mail), configured entirely from the environment:

  SMTP_HOST      e.g. smtp.beget.com
  SMTP_PORT      465 (implicit TLS) or 587 (STARTTLS)
  SMTP_USER      the full mailbox address, e.g. admin@homosapience.org
  SMTP_PASS      the mailbox password
  SMTP_FROM      From address (defaults to SMTP_USER)

If SMTP is not configured (no host/user/pass), we DO NOT fail — we log the
verification link at WARNING and return False. That keeps local/dev and the
dark-launch state working: the link is visible in the server log, nothing is
sent. Production must set the SMTP_* vars for real delivery.

The mailbox password is a secret and lives only in the environment — never in
code, git, or logs.
"""

from __future__ import annotations

import logging
import os
import smtplib
import ssl
from email.message import EmailMessage

log = logging.getLogger("aptogon.email")


def smtp_configured() -> bool:
    return bool(os.getenv("SMTP_HOST") and os.getenv("SMTP_USER") and os.getenv("SMTP_PASS"))


def _send_smtp(to: str, subject: str, text: str, html: str) -> None:
    host = os.environ["SMTP_HOST"]
    port = int(os.getenv("SMTP_PORT", "465"))
    user = os.environ["SMTP_USER"]
    password = os.environ["SMTP_PASS"]
    sender = os.getenv("SMTP_FROM", user)

    msg = EmailMessage()
    msg["Subject"] = subject
    msg["From"] = sender
    msg["To"] = to
    msg.set_content(text)
    msg.add_alternative(html, subtype="html")

    if port == 465:
        ctx = ssl.create_default_context()
        with smtplib.SMTP_SSL(host, port, context=ctx, timeout=15) as s:
            s.login(user, password)
            s.send_message(msg)
    else:
        with smtplib.SMTP(host, port, timeout=15) as s:
            s.ehlo()
            s.starttls(context=ssl.create_default_context())
            s.login(user, password)
            s.send_message(msg)


def send_verification(email: str, link: str) -> bool:
    """Send the magic-link email. Returns True if actually sent via SMTP, False if
    SMTP is unconfigured (link logged instead) or delivery raised. Never raises —
    the caller reports "check your inbox" regardless, so a transient mail outage
    does not leak account state or 500 the request."""
    subject = "Confirm your APTOGON developer email"
    text = (
        "Confirm your email to finish setting up your APTOGON developer account.\n\n"
        f"{link}\n\n"
        "The link expires in 24 hours. If you did not request this, ignore this email."
    )
    html = (
        '<div style="font-family:system-ui,sans-serif;max-width:480px">'
        "<h2>Confirm your email</h2>"
        "<p>Confirm your email to finish setting up your APTOGON developer account.</p>"
        f'<p><a href="{link}" style="display:inline-block;background:#7c3aed;color:#fff;'
        'padding:10px 22px;border-radius:8px;text-decoration:none;font-weight:600">'
        "Confirm email</a></p>"
        f'<p style="color:#6b7280;font-size:13px">Or paste this link:<br>{link}</p>'
        '<p style="color:#9ca3af;font-size:12px">The link expires in 24 hours. '
        "If you did not request this, ignore this email.</p></div>"
    )

    if not smtp_configured():
        log.warning("SMTP not configured — verification link for %s: %s", email, link)
        return False
    try:
        _send_smtp(email, subject, text, html)
        return True
    except Exception as e:  # noqa: BLE001 — never propagate mail errors to the request
        log.error("verification email to %s failed: %s", email, e)
        return False


_KIND_PREFIX = {
    "message":  "Message from APTOGON",
    "warning":  "⚠️ Warning from APTOGON",
    "proposal": "Proposal from APTOGON",
}


def send_owner_message(email: str, kind: str, subject: str, body: str) -> bool:
    """Super-admin → site owner email (message / warning / proposal). Returns True if
    sent, False if SMTP is unconfigured (logged) or delivery raised. Never raises."""
    prefix = _KIND_PREFIX.get(kind, _KIND_PREFIX["message"])
    full_subject = f"{prefix}: {subject}" if subject else prefix
    text = f"{body}\n\n— APTOGON (homosapience.org)"
    # Body is plain text from the super-admin; escape it for the HTML part so it
    # renders literally and cannot inject markup.
    import html as _html
    safe_body = _html.escape(body).replace("\n", "<br>")
    html_part = (
        '<div style="font-family:system-ui,sans-serif;max-width:520px;line-height:1.6">'
        f"<p>{safe_body}</p>"
        '<p style="color:#9ca3af;font-size:12px">— APTOGON · homosapience.org</p></div>'
    )
    if not smtp_configured():
        log.warning("SMTP not configured — owner message (%s) to %s not sent", kind, email)
        return False
    try:
        _send_smtp(email, full_subject, text, html_part)
        return True
    except Exception as e:  # noqa: BLE001
        log.error("owner message to %s failed: %s", email, e)
        return False
