#!/usr/bin/env python3
"""
Generate VAPID key pair for Web Push notifications.
Run once on the server, then add output to backend/.env

Usage:
    python3 generate_vapid_keys.py
"""
import base64
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.backends import default_backend
from cryptography.hazmat.primitives import serialization

private_key = ec.generate_private_key(ec.SECP256R1(), default_backend())

# Private key as PEM (store in .env with \n escaped)
pem = private_key.private_bytes(
    serialization.Encoding.PEM,
    serialization.PrivateFormat.TraditionalOpenSSL,
    serialization.NoEncryption(),
).decode()

# Public key as base64url uncompressed point (for browser applicationServerKey)
pub_bytes = private_key.public_key().public_bytes(
    serialization.Encoding.X962,
    serialization.PublicFormat.UncompressedPoint,
)
pub_b64 = base64.urlsafe_b64encode(pub_bytes).rstrip(b"=").decode()

# One-line PEM for .env
pem_oneline = pem.strip().replace("\n", "\\n")

print("# Add these lines to backend/.env")
print()
print(f'VAPID_PRIVATE_KEY="{pem_oneline}"')
print(f'VAPID_PUBLIC_KEY="{pub_b64}"')
print('VAPID_EMAIL="admin@aptogon.com"')
print()
print(f"# Public key (65 bytes, base64url): {pub_b64[:40]}...")
