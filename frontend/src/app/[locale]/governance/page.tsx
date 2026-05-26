'use client'
import { useState, useEffect } from 'react'
import Link from 'next/link'
import { useTranslations } from 'next-intl'

interface Proposal {
  id: string
  title: string
  description: string
  type: string
  proposer: string
  status: string
  supporters: string[]
  votes: { yes: number; no: number; abstain: number; veto: number }
  created_at: number
  voting_end: number
}

const TYPE_META: Record<string, { color: string; days: number }> = {
  text:          { color: 'text-slate-400',  days: 3 },
  parameter:     { color: 'text-blue-400',   days: 7 },
  ai_model:      { color: 'text-purple-400', days: 7 },
  upgrade:       { color: 'text-orange-400', days: 14 },
  constitution:  { color: 'text-red-400',    days: 21 },
}

export default function GovernancePage() {
  const t = useTranslations('governance')

  const TYPE_LABELS: Record<string, { label: string; color: string; days: number }> = {
    text:         { label: t('type_text'),         ...TYPE_META.text },
    parameter:    { label: t('type_parameter'),    ...TYPE_META.parameter },
    ai_model:     { label: t('type_ai_model'),     ...TYPE_META.ai_model },
    upgrade:      { label: t('type_upgrade'),      ...TYPE_META.upgrade },
    constitution: { label: t('type_constitution'), ...TYPE_META.constitution },
  }

  const [proposals, setProposals] = useState<Proposal[]>([])
  const [showCreate, setShowCreate] = useState(false)
  const [newTitle, setNewTitle] = useState('')
  const [newDesc, setNewDesc] = useState('')
  const [newType, setNewType] = useState('text')
  const [creating, setCreating] = useState(false)
  const [votingId, setVotingId] = useState<string | null>(null)

  // Демо-данные
  useEffect(() => {
    setProposals([
      {
        id: 'demo-1',
        title: 'Снизить порог confidence для людей с моторными ограничениями',
        description: 'Предлагаю снизить порог с 0.70 до 0.60 для пользователей с возможными моторными трудностями, чтобы не блокировать людей с тремором.',
        type: 'parameter',
        proposer: 'a1b2c3d4',
        status: 'voting',
        supporters: Array(100).fill('x'),
        votes: { yes: 847, no: 42, abstain: 31, veto: 8 },
        created_at: Date.now() - 3 * 86400000,
        voting_end: Date.now() + 4 * 86400000,
      },
      {
        id: 'demo-2',
        title: 'Деплой hsi-human-detector-v2 — улучшенная модель',
        description: 'Новая версия модели детекции после fine-tuning на Gonka. FNR снижен с 0.12% до 0.07%. Обучение завершено, аудит прошёл.',
        type: 'ai_model',
        proposer: 'e5f6g7h8',
        status: 'voting',
        supporters: Array(100).fill('x'),
        votes: { yes: 1203, no: 89, abstain: 54, veto: 12 },
        created_at: Date.now() - 2 * 86400000,
        voting_end: Date.now() + 5 * 86400000,
      },
    ])
  }, [])

  const createProposal = async () => {
    if (!newTitle.trim()) return
    setCreating(true)
    try {
      const res = await fetch('/api/governance/proposals', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-HSI-DID-Token': 'demo-verified-token',
        },
        body: JSON.stringify({ title: newTitle, description: newDesc, proposal_type: newType }),
      })
      const data = await res.json()
      if (res.ok) {
        setProposals(prev => [data, ...prev])
        setShowCreate(false)
        setNewTitle('')
        setNewDesc('')
      }
    } catch {
      // Демо: добавляем локально
      const demo: Proposal = {
        id: Date.now().toString(),
        title: newTitle,
        description: newDesc,
        type: newType,
        proposer: 'demo',
        status: 'deposit',
        supporters: [],
        votes: { yes: 0, no: 0, abstain: 0, veto: 0 },
        created_at: Date.now(),
        voting_end: Date.now() + (TYPE_LABELS[newType]?.days || 7) * 86400000,
      }
      setProposals(prev => [demo, ...prev])
      setShowCreate(false)
      setNewTitle('')
      setNewDesc('')
    } finally {
      setCreating(false)
    }
  }

  const castVote = async (proposalId: string, option: string) => {
    try {
      const res = await fetch('/api/governance/vote', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-HSI-DID-Token': 'demo-token' },
        body: JSON.stringify({ proposal_id: proposalId, voter_did: 'demo', option }),
      })
      if (res.ok) {
        const data = await res.json()
        setProposals(prev =>
          prev.map(p => p.id === proposalId ? { ...p, votes: data.votes } : p)
        )
      }
    } catch {
      // Демо: обновляем локально
      setProposals(prev =>
        prev.map(p => {
          if (p.id !== proposalId) return p
          return { ...p, votes: { ...p.votes, [option]: p.votes[option as keyof typeof p.votes] + 1 } }
        })
      )
    }
    setVotingId(null)
  }

  const totalVotes = (p: Proposal) => Object.values(p.votes).reduce((a, b) => a + b, 0)
  const yesRatio = (p: Proposal) => {
    const t = totalVotes(p)
    return t ? p.votes.yes / (p.votes.yes + p.votes.no) : 0
  }

  return (
    <div className="min-h-screen px-4 py-8 max-w-3xl mx-auto">
      <div className="flex items-center justify-between mb-8">
        <div>
          <Link href="/" className="text-slate-500 hover:text-white text-sm block mb-1">{t('home_link')}</Link>
          <h1 className="text-3xl font-black text-white">Governance</h1>
          <p className="text-slate-400 text-sm">{t('subtitle')}</p>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white font-bold rounded-lg transition-colors"
        >
          {t('create_btn')}
        </button>
      </div>

      {/* Create form */}
      {showCreate && (
        <div className="bg-[#1a2235] rounded-2xl border border-blue-500/30 p-6 mb-6">
          <h2 className="font-bold text-white mb-4">{t('new_proposal')}</h2>
          <div className="space-y-4">
            <input
              value={newTitle}
              onChange={e => setNewTitle(e.target.value)}
              placeholder={t('title_placeholder')}
              className="w-full bg-[#0d1525] border border-slate-700 rounded-lg px-4 py-2 text-white placeholder-slate-500 focus:outline-none focus:border-blue-500"
            />
            <textarea
              value={newDesc}
              onChange={e => setNewDesc(e.target.value)}
              placeholder={t('desc_placeholder')}
              rows={3}
              className="w-full bg-[#0d1525] border border-slate-700 rounded-lg px-4 py-2 text-white placeholder-slate-500 focus:outline-none focus:border-blue-500 resize-none"
            />
            <div className="flex gap-2 flex-wrap">
              {Object.entries(TYPE_LABELS).map(([key, val]) => (
                <button
                  key={key}
                  onClick={() => setNewType(key)}
                  className={`px-3 py-1 rounded-lg text-xs font-bold border transition-colors ${
                    newType === key
                      ? 'bg-blue-600 border-blue-500 text-white'
                      : 'bg-transparent border-slate-700 text-slate-400 hover:border-slate-500'
                  }`}
                >
                  {val.label} · {val.days}{t('days_unit')}
                </button>
              ))}
            </div>
            <div className="flex gap-3">
              <button onClick={createProposal} disabled={creating || !newTitle.trim()}
                className="px-6 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white font-bold rounded-lg transition-colors">
                {creating ? t('creating') : t('create')}
              </button>
              <button onClick={() => setShowCreate(false)}
                className="px-6 py-2 text-slate-400 hover:text-white rounded-lg border border-slate-700 hover:border-slate-500 transition-colors">
                {t('cancel')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Proposals list */}
      <div className="space-y-4">
        {proposals.map(p => {
          const total = totalVotes(p)
          const yr = yesRatio(p)
          const vr = total ? p.votes.veto / total : 0
          const typeInfo = TYPE_LABELS[p.type] || TYPE_LABELS.text
          const daysLeft = Math.max(0, Math.ceil((p.voting_end - Date.now()) / 86400000))

          return (
            <div key={p.id} className="bg-[#1a2235] rounded-2xl border border-slate-700/50 p-6">
              <div className="flex items-start justify-between mb-3">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <span className={`text-xs font-bold uppercase tracking-wide ${typeInfo.color}`}>
                      {typeInfo.label}
                    </span>
                    <span className={`text-xs px-2 py-0.5 rounded font-medium ${
                      p.status === 'voting' ? 'bg-green-500/20 text-green-400'
                      : p.status === 'deposit' ? 'bg-orange-500/20 text-orange-400'
                      : 'bg-slate-700 text-slate-400'
                    }`}>
                      {p.status === 'voting' ? t('voting_status').replace('{days}', String(daysLeft)) : p.status}
                    </span>
                  </div>
                  <h3 className="font-bold text-white text-lg leading-tight">{p.title}</h3>
                  <p className="text-slate-400 text-sm mt-1">{p.description}</p>
                </div>
              </div>

              {p.status === 'voting' && (
                <>
                  {/* Vote bar */}
                  <div className="mb-3">
                    <div className="flex h-2 rounded-full overflow-hidden bg-slate-800 mb-1">
                      {total > 0 && <>
                        <div className="bg-green-500 transition-all" style={{ width: `${p.votes.yes / total * 100}%` }} />
                        <div className="bg-red-500 transition-all" style={{ width: `${p.votes.no / total * 100}%` }} />
                        <div className="bg-yellow-500 transition-all" style={{ width: `${p.votes.veto / total * 100}%` }} />
                      </>}
                    </div>
                    <div className="flex gap-4 text-xs">
                      <span className="text-green-400">{t('yes_label')}: {p.votes.yes} ({(yr * 100).toFixed(0)}%)</span>
                      <span className="text-red-400">{t('no_label')}: {p.votes.no}</span>
                      <span className="text-yellow-400">{t('veto_label')}: {p.votes.veto} ({(vr * 100).toFixed(0)}%)</span>
                      <span className="text-slate-500">{t('total_label')}: {total}</span>
                    </div>
                  </div>

                  {/* Vote buttons */}
                  {votingId === p.id ? (
                    <div className="flex gap-2 flex-wrap">
                      {[
                        { opt: 'yes',     label: t('vote_yes'),     cls: 'bg-green-600 hover:bg-green-500' },
                        { opt: 'no',      label: t('vote_no'),      cls: 'bg-red-600 hover:bg-red-500' },
                        { opt: 'abstain', label: t('vote_abstain'), cls: 'bg-slate-600 hover:bg-slate-500' },
                        { opt: 'veto',    label: t('vote_veto'),    cls: 'bg-yellow-600 hover:bg-yellow-500' },
                      ].map(v => (
                        <button key={v.opt} onClick={() => castVote(p.id, v.opt)}
                          className={`px-4 py-2 ${v.cls} text-white text-sm font-bold rounded-lg transition-colors`}>
                          {v.label}
                        </button>
                      ))}
                      <button onClick={() => setVotingId(null)}
                        className="px-4 py-2 text-slate-400 text-sm rounded-lg border border-slate-700 hover:border-slate-500 transition-colors">
                        {t('vote_cancel')}
                      </button>
                    </div>
                  ) : (
                    <button onClick={() => setVotingId(p.id)}
                      className="px-4 py-2 bg-[#0d1525] hover:bg-[#162030] text-blue-400 text-sm font-bold rounded-lg border border-blue-500/30 hover:border-blue-500/60 transition-colors">
                      {t('vote_btn')}
                    </button>
                  )}
                </>
              )}

              {p.status === 'deposit' && (
                <div className="text-sm text-slate-500">
                  {t('supporters_of').replace('{count}', String(p.supporters.length))}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
