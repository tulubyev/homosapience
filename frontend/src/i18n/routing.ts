import { defineRouting } from 'next-intl/routing'

export const routing = defineRouting({
  locales: ['en', 'ru', 'zh', 'es', 'fr', 'ar', 'he', 'pt', 'hi', 'de', 'ja'],
  defaultLocale: 'en',
  localeDetection: true,
})
