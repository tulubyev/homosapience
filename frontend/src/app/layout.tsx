import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  metadataBase: new URL('https://homosapience.org'),
  title: 'APTOGON — Human Verification',
  description: 'Prove you are human — with a gesture. No password, no email, no tracking.',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html>
      <body style={{ margin: 0 }}>
        {children}
      </body>
    </html>
  )
}
