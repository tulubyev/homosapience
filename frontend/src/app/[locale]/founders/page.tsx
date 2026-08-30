import type { Metadata } from 'next'
import FoundersClient from './FoundersClient'

// Unlisted for now: noindex + not in sitemap + not linked in nav. Founders are
// public by design, but the page isn't announced yet, so keep it out of search.
export const metadata: Metadata = {
  title: 'Founders — APTOGON',
  robots: { index: false, follow: false },
}

export default function FoundersPage() {
  return <FoundersClient />
}
