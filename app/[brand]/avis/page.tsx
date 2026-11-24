'use client'

// Avis clients : réponses à la page /avis/[brand] (note avant Trustpilot).
// Retours négatifs à traiter en tête, puis répartition des notes et historique.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useParams } from 'next/navigation'
import { Check, Copy, ExternalLink, Loader2, Phone, Mail, Star } from 'lucide-react'
import type { ReviewRow } from '@/app/api/avis/[brand]/responses/route'
import { REVIEW_CATEGORY_LABEL } from '@/lib/reviews-shared'

const PERIODS = [{ d: 30, l: '30 jours' }, { d: 90, l: '90 jours' }, { d: 365, l: '12 mois' }]
const SOURCE_LABEL: Record<string, string> = { klaviyo: 'Mail Klaviyo', omnisend: 'Mail Omnisend', livraison: 'Mail de livraison', direct: 'Lien direct' }
const fmtDate = (iso: string) => new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' })

// Où le lien est utilisé, par marque (affiché pour pouvoir le recopier dans l'outil d'e-mail).
const LINKS: Record<string, { how: string; link: string }> = {
  moom: { how: 'Mail Klaviyo « Avis Trustpilot » (flow #4 - FULFILLED, 64 jours après l’expédition). Lien personnel par commande :', link: 'https://www.steero.io/avis/moom/{{ event.extra.id }}-{{ event.extra.token }}?s=klaviyo' },
  krom: { how: 'À coller dans le mail de demande d’avis Omnisend (lien commun à tous les clients) :', link: 'https://www.steero.io/avis/krom?s=omnisend' },
  bowa: { how: 'Envoyé automatiquement dans le mail « Votre commande est arrivée » au moment de la livraison (étoiles cliquables). Lien générique si besoin :', link: 'https://www.steero.io/avis/bowa' },
}

export default function AvisPage() {
  const { brand } = useParams<{ brand: string }>()
  const [days, setDays] = useState(90)
  const [rows, setRows] = useState<ReviewRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  const load = useCallback(async () => {
    setError(null)
    const res = await fetch(`/api/avis/${brand}/responses?days=${days}`, { cache: 'no-store' })
    if (!res.ok) { setError(res.status === 404 ? 'Les avis ne sont pas disponibles pour cette marque.' : 'Impossible de charger les avis.'); setRows([]); return }
    setRows((await res.json()).responses)
  }, [brand, days])
  useEffect(() => { setRows(null); void load() }, [load])

  async function toggleHandled(r: ReviewRow) {
    const handled = !r.handled_at
    setRows(p => p?.map(x => x.id === r.id ? { ...x, handled_at: handled ? new Date().toISOString() : null } : x) ?? p)
    const res = await fetch(`/api/avis/${brand}/responses`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: r.id, handled }) })
    if (!res.ok) void load()
  }

  const stats = useMemo(() => {
    const all = rows ?? []
    const dist = [1, 2, 3, 4, 5].map(n => all.filter(r => r.rating === n).length)
    const happy = all.filter(r => r.rating >= 4)
    return {
      n: all.length,
      avg: all.length ? all.reduce((a, r) => a + r.rating, 0) / all.length : 0,
      dist, max: Math.max(1, ...dist),
      happyPct: all.length ? Math.round(happy.length / all.length * 100) : 0,
      tp: all.filter(r => r.trustpilot_clicked).length,
      happy: happy.length,
      todo: all.filter(r => r.rating <= 3 && r.completed && !r.handled_at),
      done: all.filter(r => r.rating <= 3 && r.completed && r.handled_at),
    }
  }, [rows])

  const link = LINKS[brand]

  return (
    <div className="mx-auto max-w-[1100px] px-4 sm:px-6 py-6 space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="flex items-center gap-2 text-xl font-semibold text-[#1a1a2e]"><Star size={20} /> Avis clients</h1>
        <div className="flex rounded-xl border border-[#e8e8e4] bg-white p-1 text-sm">
          {PERIODS.map(p => (
            <button key={p.d} onClick={() => setDays(p.d)}
              className={`rounded-[10px] px-3.5 py-1.5 font-medium transition-colors ${days === p.d ? 'bg-[#1a1a2e] text-white' : 'text-[#6b6b63] hover:text-[#1a1a2e]'}`}>{p.l}</button>
          ))}
        </div>
      </div>

      {error && <p className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}
      {rows === null ? (
        <div className="flex items-center gap-2 py-16 justify-center text-sm text-[#6b6b63]"><Loader2 size={16} className="animate-spin" /> Chargement…</div>
      ) : (
        <>
          <section className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <Kpi label="Réponses" value={String(stats.n)} />
            <Kpi label="Note moyenne" value={stats.n ? `${stats.avg.toLocaleString('fr-FR', { maximumFractionDigits: 1 })} / 5` : '—'} />
            <Kpi label="Satisfaits (4-5★)" value={stats.n ? `${stats.happyPct} %` : '—'} />
            <Kpi label="Envoyés sur Trustpilot" value={String(stats.tp)} sub={stats.happy ? `${Math.round(stats.tp / stats.happy * 100)} % des satisfaits ont cliqué` : undefined} />
          </section>

          <section className="grid gap-4 lg:grid-cols-[1fr_1.4fr]">
            <div className="rounded-2xl border border-[#e8e8e4] bg-white p-5">
              <h2 className="text-sm font-semibold text-[#1a1a2e]">Répartition des notes</h2>
              <div className="mt-4 space-y-2.5">
                {[5, 4, 3, 2, 1].map(n => (
                  <div key={n} className="flex items-center gap-3 text-sm">
                    <span className="w-8 tabular-nums text-[#6b6b63]">{n} ★</span>
                    <div className="h-2.5 flex-1 rounded-full bg-[#f0f0ec] overflow-hidden">
                      <div className="h-full rounded-full bg-[#1a1a2e]" style={{ width: `${stats.dist[n - 1] / stats.max * 100}%` }} />
                    </div>
                    <span className="w-8 text-right tabular-nums text-[#1a1a2e]">{stats.dist[n - 1]}</span>
                  </div>
                ))}
              </div>
            </div>
            {link && (
              <div className="rounded-2xl border border-[#e8e8e4] bg-white p-5">
                <h2 className="text-sm font-semibold text-[#1a1a2e]">Lien envoyé aux clients</h2>
                <p className="mt-2 text-sm text-[#6b6b63] leading-relaxed">{link.how}</p>
                <div className="mt-3 flex items-stretch gap-2">
                  <code className="flex-1 min-w-0 overflow-x-auto whitespace-nowrap rounded-lg bg-[#f7f7f5] px-3 py-2 text-xs text-[#1a1a2e]">{link.link}</code>
                  <button onClick={() => { void navigator.clipboard.writeText(link.link); setCopied(true); setTimeout(() => setCopied(false), 1500) }}
                    className="flex items-center gap-1.5 rounded-lg border border-[#e8e8e4] px-3 text-xs font-medium text-[#1a1a2e] hover:bg-[#f7f7f5]">
                    {copied ? <Check size={14} /> : <Copy size={14} />}{copied ? 'Copié' : 'Copier'}
                  </button>
                </div>
                <a href={`/avis/${brand}`} target="_blank" rel="noopener noreferrer" className="mt-3 inline-flex items-center gap-1.5 text-xs text-[#6b6b63] hover:text-[#1a1a2e]">
                  Voir la page client <ExternalLink size={12} />
                </a>
              </div>
            )}
          </section>

          <section>
            <h2 className="mb-3 text-sm font-semibold text-[#1a1a2e]">Retours à traiter <span className="font-normal text-[#9b9b93]">· {stats.todo.length}</span></h2>
            {stats.todo.length === 0
              ? <p className="rounded-2xl border border-dashed border-[#e8e8e4] px-5 py-6 text-sm text-[#6b6b63]">Aucun retour négatif en attente sur la période.</p>
              : <div className="space-y-3">{stats.todo.map(r => <Feedback key={r.id} r={r} onToggle={() => toggleHandled(r)} />)}</div>}
            {stats.done.length > 0 && (
              <details className="mt-3">
                <summary className="cursor-pointer text-sm text-[#6b6b63]">Retours déjà traités ({stats.done.length})</summary>
                <div className="mt-3 space-y-3">{stats.done.map(r => <Feedback key={r.id} r={r} onToggle={() => toggleHandled(r)} />)}</div>
              </details>
            )}
          </section>

          <section className="overflow-x-auto rounded-2xl border border-[#e8e8e4] bg-white">
            <table className="w-full min-w-[640px] text-sm">
              <thead><tr className="border-b border-[#e8e8e4] text-left text-xs text-[#9b9b93]">
                <th className="px-5 py-3 font-medium">Date</th><th className="px-3 py-3 font-medium">Note</th><th className="px-3 py-3 font-medium">Commande</th>
                <th className="px-3 py-3 font-medium">Provenance</th><th className="px-5 py-3 font-medium">Suite</th>
              </tr></thead>
              <tbody>
                {(rows ?? []).length === 0 && <tr><td colSpan={5} className="px-5 py-8 text-center text-[#6b6b63]">Aucune réponse sur la période.</td></tr>}
                {(rows ?? []).map(r => (
                  <tr key={r.id} className="border-b border-[#f0f0ec] last:border-0">
                    <td className="px-5 py-3 text-[#6b6b63] whitespace-nowrap">{fmtDate(r.created_at)}</td>
                    <td className="px-3 py-3"><Stars n={r.rating} /></td>
                    <td className="px-3 py-3 text-[#1a1a2e]">{r.order_name ?? <span className="text-[#9b9b93]">—</span>}</td>
                    <td className="px-3 py-3 text-[#6b6b63]">{SOURCE_LABEL[r.source ?? ''] ?? '—'}</td>
                    <td className="px-5 py-3 text-[#6b6b63]">
                      {r.rating >= 4 ? (r.trustpilot_clicked ? 'Envoyé sur Trustpilot' : r.completed ? 'A décliné Trustpilot' : 'Note seule')
                        : r.completed ? (r.handled_at ? 'Retour traité' : 'Retour à traiter') : 'Note seule'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        </>
      )}
    </div>
  )
}

function Kpi({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-2xl border border-[#e8e8e4] bg-white px-5 py-4">
      <p className="text-xs text-[#6b6b63]">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums text-[#1a1a2e]">{value}</p>
      {sub && <p className="mt-1 text-xs text-[#9b9b93]">{sub}</p>}
    </div>
  )
}

function Stars({ n }: { n: number }) {
  return <span className="whitespace-nowrap tracking-[1px] text-[#1a1a2e]" aria-label={`${n} sur 5`}>{'★'.repeat(n)}<span className="text-[#d8d8d2]">{'★'.repeat(5 - n)}</span></span>
}

function Feedback({ r, onToggle }: { r: ReviewRow; onToggle: () => void }) {
  const email = r.contact_email || r.customer_email
  return (
    <article className={`rounded-2xl border bg-white p-5 ${r.handled_at ? 'border-[#e8e8e4] opacity-70' : 'border-[#e8d9b8]'}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
            <Stars n={r.rating} />
            <span className="font-medium text-[#1a1a2e]">{r.customer_name || 'Client anonyme'}</span>
            {r.order_name && <span className="text-[#6b6b63]">{r.order_name}</span>}
            <span className="text-[#9b9b93]">{fmtDate(r.updated_at)}</span>
          </p>
          {r.categories.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {r.categories.map(c => <span key={c} className="rounded-full bg-[#f7f7f5] px-2.5 py-0.5 text-xs text-[#1a1a2e]">{REVIEW_CATEGORY_LABEL[c] ?? c}</span>)}
            </div>
          )}
        </div>
        <button onClick={onToggle}
          className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium ${r.handled_at ? 'border-[#e8e8e4] text-[#6b6b63] hover:text-[#1a1a2e]' : 'border-[#1a1a2e] bg-[#1a1a2e] text-white'}`}>
          <Check size={13} /> {r.handled_at ? 'Rouvrir' : 'Marquer traité'}
        </button>
      </div>
      {r.comment && <p className="mt-3 whitespace-pre-line text-sm leading-relaxed text-[#1a1a2e]">{r.comment}</p>}
      <p className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-[#6b6b63]">
        {r.contact_requested ? <span className="font-medium text-[#8a5a00]">Souhaite être recontacté(e)</span> : <span>Pas de rappel demandé</span>}
        {r.contact_phone && <span className="flex items-center gap-1"><Phone size={12} />{r.contact_phone}</span>}
        {email && <span className="flex items-center gap-1"><Mail size={12} />{email}</span>}
        {r.handled_at && <span>Traité{r.handled_by ? ` par ${r.handled_by}` : ''} le {fmtDate(r.handled_at)}</span>}
      </p>
    </article>
  )
}
