import type { Metadata } from 'next'
import { Inter } from 'next/font/google'
import './globals.css'

const inter = Inter({ subsets: ['latin', 'cyrillic'] })

export const metadata: Metadata = {
  metadataBase: new URL('https://homosapience.org'),
  title: 'HSI — Homo Sapience Internet',
  description: 'Prove you are human — with a gesture. No password, no email, no tracking.',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html>
      <body className={inter.className} style={{ margin: 0 }}>
        {children}
      </body>
    </html>
  )
}
