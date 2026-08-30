const createNextIntlPlugin = require('next-intl/plugin')
const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts')

/** @type {import('next').NextConfig} */
const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'

const nextConfig = {
  // Skip type-checking and linting at build time — run these locally before pushing.
  typescript: { ignoreBuildErrors: true },
  eslint:     { ignoreDuringBuilds: true },

  // Stable Server Actions encryption key.
  // Without this, Next.js generates a NEW key per build → old open tabs send
  // outdated action hashes and the server logs:
  //   Error: Failed to find Server Action "<hash>". This request might be from
  //   an older or newer deployment.
  // The key must be a 32-byte AES-GCM key (base64). Set in env on prod:
  //   NEXT_SERVER_ACTIONS_ENCRYPTION_KEY=$(openssl rand -base64 32)
  // If unset → fallback to build-time random (current noisy behavior).
  // VPS is slow — give static page generation workers more time before SIGTERM.
  staticPageGenerationTimeout: 180,

  experimental: {
    serverActions: {
      ...(process.env.NEXT_SERVER_ACTIONS_ENCRYPTION_KEY
        ? { encryptionKey: process.env.NEXT_SERVER_ACTIONS_ENCRYPTION_KEY }
        : {}),
    },
  },

  async rewrites() {
    return [
      {
        source: '/api/:path*',
        destination: `${API_URL}/api/:path*`,
      },
      {
        // Public badge SVG/info live on the backend at a bare /badge prefix
        // (backend/main.py). Traefik sends ALL homosapience.org traffic here,
        // so without this rewrite /badge/* 404s into the Next.js not-found
        // page — breaking every ![Human Verified](…/badge/….svg) embed.
        source: '/badge/:path*',
        destination: `${API_URL}/badge/:path*`,
      },
    ]
  },
}

module.exports = withNextIntl(nextConfig)
