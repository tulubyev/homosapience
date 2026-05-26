import Link from 'next/link'

export default function NotFound() {
  return (
    <div style={{
      minHeight: '60vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      flexDirection: 'column',
      gap: 16,
      fontFamily: 'Inter, system-ui, sans-serif',
      background: '#f8fafc',
    }}>
      <div style={{ fontSize: 64 }}>🌐</div>
      <h1 style={{ fontWeight: 900, fontSize: '2rem', color: '#111827', margin: 0 }}>404</h1>
      <p style={{ color: '#6b7280', margin: 0 }}>Page not found</p>
      <Link href="/" style={{
        marginTop: 8,
        padding: '12px 28px',
        background: 'linear-gradient(135deg,#7c3aed,#2563eb)',
        color: '#fff',
        fontWeight: 700,
        borderRadius: 12,
        textDecoration: 'none',
        fontSize: 14,
      }}>
        ← APTOGON
      </Link>
    </div>
  )
}
