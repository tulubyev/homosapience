import createMiddleware from 'next-intl/middleware'
import { NextRequest, NextResponse } from 'next/server'
import { routing } from './i18n/routing'

const intlMiddleware = createMiddleware(routing)

// The CartPilot HDAA demo lives at agent.homosapience.org, served by this same
// Next.js deployment (one Traefik router added to point that host at :3002 —
// no separate process). It's a plain top-level route (frontend/src/app/agent/),
// not under [locale], so incoming requests to that host are rewritten straight
// to it and never touch next-intl at all.
export default function middleware(request: NextRequest) {
  const host = request.headers.get('host') || ''
  if (host.startsWith('agent.')) {
    const url = request.nextUrl.clone()
    url.pathname = `/agent${url.pathname === '/' ? '' : url.pathname}`
    return NextResponse.rewrite(url)
  }
  return intlMiddleware(request)
}

export const config = {
  matcher: [
    // Match all pathnames except for
    // - files (e.g. /robots.txt, /favicon.ico)
    // - api routes (/api/...)
    // - _next (Next.js internals)
    // - metadata file routes (icon, apple-icon, opengraph-image) — these live
    //   at the app root, not under [locale]; redirecting them to /en/* 404s
    //   and breaks the favicon / social images
    // - agent — the CartPilot demo (host-routed above, not locale-routed).
    //   Negative lookahead `(?![\w-])` after "agent" so this excludes only the
    //   bare /agent route, NOT /agent-passport (an existing [locale] page).
    // - badge — backend endpoints (/badge/{platform}/{user}.svg + /info),
    //   proxied via next.config rewrites; locale-redirecting /badge/... to
    //   /en/badge/... breaks the public badge embeds
    '/((?!api|_next|_vercel|embed|badge|agent(?![\\w-])|icon|apple-icon|opengraph-image|sitemap|robots|manifest\\.webmanifest|.*\\..*).*)',
  ],
}
