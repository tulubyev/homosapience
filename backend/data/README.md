# backend/data/ — runtime data files (NOT in git)

## GeoLite2-ASN.mmdb

Required for R2 IP intelligence (datacenter/hosting ASN detection).

### Download (free, requires MaxMind account)

```bash
# Option A — MaxMind direct (requires free account + license key)
wget -O GeoLite2-ASN.tar.gz \
  "https://download.maxmind.com/app/geoip_download?edition_id=GeoLite2-ASN&license_key=YOUR_KEY&suffix=tar.gz"
tar -xzf GeoLite2-ASN.tar.gz --strip-components=1 --wildcards "*.mmdb"
mv GeoLite2-ASN.mmdb /var/www/aptogon/backend/data/

# Option B — via geoipupdate tool
# Install: apt install geoipupdate
# Configure /etc/GeoIP.conf with AccountID + LicenseKey
# EditionIDs GeoLite2-ASN
geoipupdate

# Option C — mirror (check license compliance before production use)
# https://github.com/P3TERX/GeoLite.mmdb/releases/latest
```

### Environment variable

```env
MAXMIND_ASN_DB=/path/to/GeoLite2-ASN.mmdb
# Default: <backend_dir>/data/GeoLite2-ASN.mmdb
```

### Without the file

If the .mmdb file is absent, `ip_intel.py` silently skips ASN lookup
(returns `is_datacenter=False, asn=None`). Risk engine degrades gracefully
— S1 signals are simply absent, S2–S6 still work.

### .gitignore note

`*.mmdb` is excluded from git. Never commit the database file — it is
large (~8 MB), updated monthly, and MaxMind requires redistribution
restrictions under GeoLite2 EULA.

## APTOGON_JWT_PRIVATE_KEY (R1 EMBED_API)

Server-side Ed25519 key that signs assertion JWTs. Required when
`FEATURE_EMBED_API=true`. Generate once and store in `.env`:

```bash
python3 -c "import base64; \
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey; \
from cryptography.hazmat.primitives.serialization import Encoding,PrivateFormat,NoEncryption; \
print('APTOGON_JWT_PRIVATE_KEY='+base64.urlsafe_b64encode( \
Ed25519PrivateKey.generate().private_bytes(Encoding.Raw,PrivateFormat.Raw,NoEncryption())).decode())"
```

The public half is exposed at `GET /api/embed/jwks`. Never commit the private key.
