import Link from 'next/link'
import { getLocale } from 'next-intl/server'

export default async function GoldMemberGuidePage() {
  const locale = await getLocale()
  const isRu = locale === 'ru'

  const t = {
    title:       isRu ? 'Руководство Gold Member' : 'Gold Member Guide',
    subtitle:    isRu ? 'Вы — основатель сети. Вот что это значит.' : 'You are a founding validator. Here is what that means.',
    role_title:  isRu ? '👑 Ваша роль' : '👑 Your Role',
    role_body:   isRu
      ? 'Gold Members — первые 20 верифицированных участников APTOGON. Во время bootstrap-периода (первые 60 дней или 150 пользователей) вы вручную одобряете или отклоняете запросы новых людей на поручительство (bond).'
      : 'Gold Members are the first 20 verified participants of APTOGON. During the bootstrap period (first 60 days or 150 users) you manually approve or decline bond requests from new people.',
    how_title:   isRu ? '📱 Как это работает' : '📱 How It Works',
    notify_title: isRu ? 'Уведомление' : 'Notification',
    notify_body:  isRu
      ? 'Когда новый пользователь проходит жестовую верификацию и его уверенность AI < 95%, его запрос попадает в очередь Gold Members. Расширение покажет баннер.'
      : 'When a new user passes gesture verification with AI confidence < 95%, their request enters the Gold Members queue. Your extension will show a banner.',
    review_title: isRu ? 'Что проверять' : 'What to review',
    review_body:  isRu
      ? 'Вы видите только уверенность AI (число в %). Никаких персональных данных — ни имени, ни IP, ни устройства. Решение принимается только по AI-оценке жеста.'
      : 'You see only the AI confidence score (%). No personal data — no name, IP, or device. Your decision is based solely on the AI gesture assessment.',
    approve_title: isRu ? '✅ Одобрить' : '✅ Approve',
    approve_body:  isRu
      ? 'Нажмите "Поручиться" в расширении. Ваш DID-ключ автоматически подпишет одобрение. Когда 3 Gold Members одобряют — выдаётся HumanCredential на Aptos.'
      : 'Click "Vouch" in the extension. Your DID key automatically signs the approval. When 3 Gold Members approve — a HumanCredential is issued on Aptos.',
    decline_title: isRu ? '❌ Отклонить' : '❌ Decline',
    decline_body:  isRu
      ? 'Нажмите "Отклонить" если что-то кажется неправильным. Один отказ не блокирует — нужно 3+ отказа. Запрос перейдёт к другим Gold Members.'
      : 'Click "Decline" if something seems off. One decline doesn\'t block — 3+ are needed. The request will go to other Gold Members.',
    limits_title: isRu ? '⚖️ Лимиты и защита' : '⚖️ Limits & Safety',
    limits: isRu ? [
      '20 одобрений в сутки — защита от компрометации',
      'Нельзя поручиться за себя самого',
      'Ваш DID хранится только у вас — никто другой не может подписать от вашего имени',
      'Bootstrap завершается автоматически: через 60 дней или при 150+ пользователях',
      'После bootstrap ваш статус становится обычным поручителем (trust_score ≥ 0.5)',
    ] : [
      '20 approvals per day — protection against account compromise',
      'Cannot vouch for yourself',
      'Your DID is stored only with you — no one else can sign on your behalf',
      'Bootstrap ends automatically: after 60 days or 150+ users',
      'After bootstrap your status becomes a regular guarantor (trust_score ≥ 0.5)',
    ],
    ext_title:   isRu ? '🔌 Расширение' : '🔌 Extension',
    ext_steps: isRu ? [
      'Установи расширение APTOGON из Chrome Web Store',
      'Открой homosapience.org/verify и пройди верификацию',
      'Расширение считает твой DID автоматически',
      'Когда придёт bond-запрос — баннер появится при следующем открытии расширения',
    ] : [
      'Install the APTOGON extension from the Chrome Web Store',
      'Open homosapience.org/verify and complete verification',
      'The extension reads your DID automatically',
      'When a bond request arrives — the banner appears next time you open the extension',
    ],
    privacy_title: isRu ? '🔒 Приватность' : '🔒 Privacy',
    privacy_body:  isRu
      ? 'Вы никогда не видите: имена, email, IP, устройство, страну, фото. Только AI-оценку движения (7 числовых метрик, агрегированных из жеста). Это задумано специально — чтобы поручительство было основано на поведенческой биометрии, а не на социальных маркерах.'
      : 'You never see: names, email, IP, device, country, photo. Only the AI motion score (7 aggregated numeric metrics from the gesture). This is by design — vouching is based on behavioral biometrics, not social markers.',
    faq_title:   isRu ? '❓ Вопросы и ответы' : '❓ FAQ',
    faq: isRu ? [
      ['Что если я пропущу запрос?', 'Ничего страшного. Запрос через 24 часа перейдёт к следующей волне поручителей. Вы можете закрыть расширение не отвечая.'],
      ['Могу ли я ошибиться?', 'Да. Но система требует 3 независимых одобрения — ошибка одного Gold Member не выдаёт credential боту. Реальный вред возможен только при сговоре 3+ Gold Members.'],
      ['Можно ли передать статус кому-то другому?', 'Нет. DID привязан к конкретному устройству/ключу. Но можно сообщить администратору об утере ключа — статус будет отозван.'],
      ['Сколько времени занимает одобрение?', '~10 секунд включая подпись Ed25519. Всё автоматически через расширение.'],
      ['Что будет когда bootstrap закончится?', 'Ваш Gold Member DID станет обычным trusted-поручителем. Новые пользователи смогут сами выбирать вас как поручителя.'],
    ] : [
      ['What if I miss a request?', 'No problem. The request moves to the next batch of guarantors after 24 hours. You can close the extension without responding.'],
      ['Can I make a mistake?', 'Yes. But the system requires 3 independent approvals — one Gold Member mistake doesn\'t issue a credential to a bot. Real harm requires collusion of 3+ Gold Members.'],
      ['Can I transfer my status to someone else?', 'No. The DID is tied to a specific device/key. You can notify an admin if you lose your key — the status will be revoked.'],
      ['How long does approval take?', '~10 seconds including Ed25519 signing. Everything is automatic via the extension.'],
      ['What happens when bootstrap ends?', 'Your Gold Member DID becomes a regular trusted guarantor. New users can choose you as a guarantor themselves.'],
    ],
    contact_title: isRu ? '📬 Связь' : '📬 Contact',
    contact_body:  isRu ? 'Вопросы — в Telegram @aptogon' : 'Questions — Telegram @aptogon',
    back:          isRu ? '← Главная' : '← Home',
  }

  return (
    <div style={{ minHeight: '100vh', background: '#0f172a', fontFamily: 'Inter, system-ui, sans-serif', color: '#e2e8f0' }}>

      {/* Hero */}
      <div style={{ background: 'linear-gradient(135deg, #1e1b4b 0%, #2d1b69 60%, #4c1d95 100%)', padding: '64px 24px 48px', textAlign: 'center' }}>
        <div style={{ fontSize: 52, marginBottom: 12 }}>👑</div>
        <h1 style={{ fontSize: 'clamp(1.8rem,4vw,2.6rem)', fontWeight: 900, color: '#fff', marginBottom: 12 }}>
          {t.title}
        </h1>
        <p style={{ color: '#c4b5fd', fontSize: '1rem', maxWidth: 520, margin: '0 auto' }}>
          {t.subtitle}
        </p>
        <div style={{
          display: 'inline-flex', alignItems: 'center', gap: 8,
          marginTop: 20, padding: '6px 18px', borderRadius: 99,
          background: 'rgba(167,139,250,0.15)', border: '1px solid rgba(167,139,250,0.35)',
        }}>
          <span style={{ color: '#4ade80', fontSize: 11, fontWeight: 800 }}>●</span>
          <span style={{ color: '#a78bfa', fontSize: 12, fontWeight: 700 }}>
            {isRu ? 'Bootstrap период · до 20 участников' : 'Bootstrap period · up to 20 members'}
          </span>
        </div>
      </div>

      <div style={{ maxWidth: 740, margin: '0 auto', padding: '48px 24px' }}>

        {/* Role */}
        <Section bg="#1e293b" border="#334155">
          <SectionTitle>{t.role_title}</SectionTitle>
          <p style={{ color: '#94a3b8', lineHeight: 1.8, margin: 0 }}>{t.role_body}</p>
        </Section>

        {/* How it works */}
        <Section bg="#1e293b" border="#334155">
          <SectionTitle>{t.how_title}</SectionTitle>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {[
              { icon: '🔔', title: t.notify_title, body: t.notify_body },
              { icon: '🔍', title: t.review_title, body: t.review_body },
              { icon: '✅', title: t.approve_title, body: t.approve_body },
              { icon: '❌', title: t.decline_title, body: t.decline_body },
            ].map((step, i) => (
              <div key={i} style={{ display: 'flex', gap: 14, alignItems: 'flex-start' }}>
                <div style={{
                  flexShrink: 0, width: 36, height: 36, borderRadius: 10,
                  background: 'rgba(124,58,237,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 18,
                }}>{step.icon}</div>
                <div>
                  <div style={{ fontWeight: 700, color: '#f1f5f9', marginBottom: 4, fontSize: '0.95rem' }}>{step.title}</div>
                  <p style={{ color: '#94a3b8', margin: 0, lineHeight: 1.7, fontSize: '0.88rem' }}>{step.body}</p>
                </div>
              </div>
            ))}
          </div>
        </Section>

        {/* Extension setup */}
        <Section bg="#1e293b" border="#334155">
          <SectionTitle>{t.ext_title}</SectionTitle>
          <ol style={{ margin: 0, padding: '0 0 0 20px', color: '#94a3b8', lineHeight: 2.2 }}>
            {t.ext_steps.map((s, i) => (
              <li key={i} style={{ fontSize: '0.9rem' }}>{s}</li>
            ))}
          </ol>
        </Section>

        {/* Limits */}
        <Section bg="#1e293b" border="#334155">
          <SectionTitle>{t.limits_title}</SectionTitle>
          <ul style={{ margin: 0, padding: '0 0 0 4px', listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 10 }}>
            {t.limits.map((l, i) => (
              <li key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, fontSize: '0.88rem', color: '#94a3b8' }}>
                <span style={{ color: '#a78bfa', fontWeight: 800, marginTop: 1 }}>✦</span> {l}
              </li>
            ))}
          </ul>
        </Section>

        {/* Privacy */}
        <Section bg="rgba(124,58,237,0.08)" border="rgba(124,58,237,0.25)">
          <SectionTitle>{t.privacy_title}</SectionTitle>
          <p style={{ color: '#94a3b8', lineHeight: 1.8, margin: 0 }}>{t.privacy_body}</p>
        </Section>

        {/* FAQ */}
        <Section bg="#1e293b" border="#334155">
          <SectionTitle>{t.faq_title}</SectionTitle>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {t.faq.map(([q, a], i) => (
              <div key={i} style={{ borderLeft: '3px solid #7c3aed', paddingLeft: 16 }}>
                <div style={{ fontWeight: 700, color: '#c4b5fd', marginBottom: 4, fontSize: '0.9rem' }}>{q}</div>
                <p style={{ color: '#64748b', margin: 0, fontSize: '0.85rem', lineHeight: 1.7 }}>{a}</p>
              </div>
            ))}
          </div>
        </Section>

        {/* Contact + back */}
        <div style={{ textAlign: 'center', marginTop: 12 }}>
          <p style={{ color: '#475569', marginBottom: 20 }}>
            {t.contact_body} ·{' '}
            <a href="https://t.me/aptogon" target="_blank" rel="noopener noreferrer" style={{ color: '#7c3aed' }}>@aptogon</a>
          </p>
          <Link href={`/${locale}`} style={{ color: '#7c3aed', fontWeight: 600, textDecoration: 'none' }}>{t.back}</Link>
        </div>

      </div>
    </div>
  )
}

function Section({ children, bg, border }: { children: React.ReactNode; bg: string; border: string }) {
  return (
    <div style={{
      background: bg, border: `1px solid ${border}`,
      borderRadius: 18, padding: '28px 28px', marginBottom: 20,
    }}>
      {children}
    </div>
  )
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h2 style={{ color: '#f1f5f9', fontWeight: 800, fontSize: '1.05rem', marginTop: 0, marginBottom: 18 }}>
      {children}
    </h2>
  )
}
