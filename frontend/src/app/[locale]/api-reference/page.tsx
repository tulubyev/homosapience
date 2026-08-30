import { redirect } from 'next/navigation'
import { getLocale } from 'next-intl/server'

export default async function ApiReferencePage() {
  const locale = await getLocale()
  redirect(`/${locale}/developers#api-reference`)
}
