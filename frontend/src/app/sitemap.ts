import { MetadataRoute } from 'next'

const BASE_URL = 'https://homosapience.org'

const LOCALES = ['en', 'ru', 'zh', 'es', 'fr', 'ar', 'he', 'pt', 'hi', 'de', 'ja'] as const

// Public pages with their SEO weights
const PAGES: Array<{
  path: string
  priority: number
  changeFrequency: MetadataRoute.Sitemap[number]['changeFrequency']
}> = [
  { path: '',                   priority: 1.0, changeFrequency: 'weekly'  },
  { path: '/verify',            priority: 0.9, changeFrequency: 'weekly'  },
  { path: '/for-organizations', priority: 0.9, changeFrequency: 'monthly' },
  { path: '/manifest',          priority: 0.8, changeFrequency: 'monthly' },
  { path: '/developers',        priority: 0.8, changeFrequency: 'monthly' },
  { path: '/gold-guide', priority: 0.7, changeFrequency: 'monthly' },
  { path: '/governance', priority: 0.7, changeFrequency: 'monthly' },
  { path: '/donate',     priority: 0.7, changeFrequency: 'monthly' },
  { path: '/bond',       priority: 0.6, changeFrequency: 'monthly' },
  { path: '/chat',       priority: 0.6, changeFrequency: 'weekly'  },
  { path: '/privacy',    priority: 0.4, changeFrequency: 'yearly'  },
]

// Not included: /admin, /bond-panel, /payment (private / app-only pages)

export default function sitemap(): MetadataRoute.Sitemap {
  const entries: MetadataRoute.Sitemap = []

  for (const page of PAGES) {
    // Build hreflang alternates for every locale
    const languages: Record<string, string> = { 'x-default': `${BASE_URL}/en${page.path}` }
    for (const locale of LOCALES) {
      languages[locale] = `${BASE_URL}/${locale}${page.path}`
    }

    // One entry per locale (Google recommends listing all variants)
    for (const locale of LOCALES) {
      entries.push({
        url: `${BASE_URL}/${locale}${page.path}`,
        lastModified: new Date(),
        changeFrequency: page.changeFrequency,
        priority: locale === 'en' ? page.priority : Math.max(page.priority - 0.1, 0.1),
        alternates: { languages },
      })
    }
  }

  return entries
}
