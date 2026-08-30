import { MetadataRoute } from 'next'

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: [
          '/*/admin',
          '/*/bond-panel',
          '/*/payment',
          '/api/',
        ],
      },
    ],
    sitemap: 'https://homosapience.org/sitemap.xml',
  }
}
