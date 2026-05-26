import createMiddleware from 'next-intl/middleware'
import { routing } from './i18n/routing'

export default createMiddleware(routing)

export const config = {
  matcher: [
    // Match all pathnames except for
    // - files (e.g. /robots.txt, /favicon.ico)
    // - api routes (/api/...)
    // - _next (Next.js internals)
    // - metadata file routes (icon, apple-icon, opengraph-image) — these live
    //   at the app root, not under [locale]; redirecting them to /en/* 404s
    //   and breaks the favicon / social images
    '/((?!api|_next|_vercel|embed|icon|apple-icon|opengraph-image|sitemap|robots|manifest\\.webmanifest|.*\\..*).*)',
  ],
}
