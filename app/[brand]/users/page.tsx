'use client'

export const dynamic = 'force-dynamic'

// Équipe de la marque courante : ses membres seulement (jamais ceux des autres
// marques), invitations par lien personnel, accès complet ou limité à certaines pages.
import { useCallback, useEffect, useState } from 'react'
import { Check, Copy, Link2, Loader2, Trash2, UserPlus, X } from 'lucide-react'
import { useBrand } from '@/context/BrandContext'

type Member = { id: string; email: string; role: string; features: string[] | null; otherBrands: boolean; editable: boolean; you: boolean }
type Invite = { token: string; email: string; role: string; features: string[]; expiresAt: string }
type Feature = { key: string; label: string; section: string }
type Data = { members: Member[]; invites: Invite[]; roles: string[]; features: Feature[] }

const ROLE_LABEL: Record<string, { label: string; hint: string }> = {
  admin:       { label: 'Accès complet', hint: 'Voit et gère tout sur cette marque' },
  sav:         { label: 'Accès limité',  hint: 'Ne voit que les pages que tu coches' },
  delivery:    { label: 'Livreur',       hint: 'Application livreur uniquement' },
  logistician: { label: 'Logisticien',   hint: 'Page de réconciliation uniquement' },
}

const btn = 'inline-flex items-center justify-center gap-2 rounded-2xl bg-[#1a1a2e] px-5 py-3 text-[15px] font-semibold text-white transition active:scale-[.98] disabled:opacity-40'
const field = 'rounded-2xl border-2 border-[#e4e2dc] bg-white px-4 py-3 text-[15px] text-[#1a1a18] placeholder:text-[#b5b3ab] focus:border-[#1a1a2e] focus:outline-none'

export default function TeamPage() {
  const brand = useBrand()
  const [data, setData] = useState<Data | null>(null)
  const [brandName, setBrandName] = useState('')
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    const r = await fetch(`/api/team?brand=${brand}`)
    const d = await r.json().catch(() => ({}))
    if (!r.ok) { setError(d.error ?? 'Erreur'); return }
    setData(d)
  }, [brand])
  useEffect(() => { load() }, [load])
  useEffect(() => {
    fetch('/api/branding').then(r => (r.ok ? r.json() : {})).then((b: Record<string, { name?: string }>) => setBrandName(b[brand]?.name ?? brand)).catch(() => {})
  }, [brand])

  async function post(body: Record<string, unknown>) {
    const r = await fetch('/api/team', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ brand, ...body }) })
    const d = await r.json().catch(() => ({ error: 'Connexion perdue' }))
    await load()
    return d as { error?: string; url?: string }
  }

  return (
    <div className="min-h-screen bg-[#faf9f8]">
      <main className="mx-auto max-w-3xl px-4 py-10 sm:px-8 space-y-8">
        <header>
          <h1 className="text-[clamp(26px,3.5vw,38px)] font-extrabold leading-[1.05] tracking-[-0.03em] text-[#1a1a2e]">L’équipe de {brandName || '…'}</h1>
          <p className="mt-2 text-[15px] text-[#6b6b63]">Les personnes ici ne voient que {brandName || 'cette marque'}, rien d’autre.</p>
        </header>

        {error && <p className="rounded-2xl bg-[#fff5f5] px-4 py-3 text-[14px] text-[#b42318]">{error}</p>}
        {!data && !error && <Loader2 className="animate-spin text-[#6b6b63]" size={22} />}
        {data && (
          <>
            <InviteCard data={data} post={post} />

            {data.invites.length > 0 && (
              <section>
                <h2 className="mb-3 text-[17px] font-bold text-[#1a1a2e]">En attente</h2>
                <ul className="space-y-2">
                  {data.invites.map(i => <PendingRow key={i.token} inv={i} post={post} />)}
                </ul>
              </section>
            )}

            <section>
              <h2 className="mb-3 text-[17px] font-bold text-[#1a1a2e]">Membres</h2>
              {data.members.length === 0
                ? <p className="rounded-2xl border-2 border-dashed border-[#e4e2dc] px-5 py-6 text-[15px] text-[#6b6b63]">Personne pour l’instant. Invite ton premier coéquipier ci-dessus.</p>
                : <ul className="space-y-2">{data.members.map(m => <MemberRow key={m.id} m={m} data={data} post={post} />)}</ul>}
            </section>
          </>
        )}
      </main>
    </div>
  )
}

function RolePicker({ roles, role, setRole }: { roles: string[]; role: string; setRole: (r: string) => void }) {
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {roles.map(r => (
        <button key={r} type="button" onClick={() => setRole(r)}
          className={`rounded-2xl border-2 p-4 text-left transition ${role === r ? 'border-[#1a1a2e] bg-[#1a1a2e] text-white' : 'border-[#e4e2dc] bg-white text-[#1a1a2e] hover:border-[#1a1a2e]'}`}>
          <span className="block text-[15px] font-semibold">{ROLE_LABEL[r]?.label ?? r}</span>
          <span className={`block text-[13px] ${role === r ? 'text-white/70' : 'text-[#6b6b63]'}`}>{ROLE_LABEL[r]?.hint}</span>
        </button>
      ))}
    </div>
  )
}

function FeaturePicker({ features, picked, toggle }: { features: Feature[]; picked: string[]; toggle: (k: string) => void }) {
  return (
    <div>
      <p className="mb-2 text-[14px] font-semibold text-[#1a1a2e]">Pages visibles</p>
      <div className="flex flex-wrap gap-2">
        {features.map(f => {
          const on = picked.includes(f.key)
          return (
            <button key={f.key} type="button" onClick={() => toggle(f.key)}
              className={`inline-flex items-center gap-1.5 rounded-xl border-2 px-3 py-2 text-[14px] font-medium transition ${on ? 'border-[#1a7f4b] bg-[#1a7f4b] text-white' : 'border-[#e4e2dc] bg-white text-[#6b6b63] hover:border-[#1a1a2e]'}`}>
              {on && <Check size={14} strokeWidth={3} />} {f.label}
            </button>
          )
        })}
      </div>
    </div>
  )
}

function CopyLink({ url }: { url: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <button type="button" onClick={async () => { try { await navigator.clipboard.writeText(url); setCopied(true); setTimeout(() => setCopied(false), 2000) } catch {} }}
      className="inline-flex items-center gap-1.5 rounded-xl border-2 border-[#e4e2dc] bg-white px-3 py-2 text-[14px] font-semibold text-[#1a1a2e] hover:border-[#1a1a2e]">
      {copied ? <><Check size={14} strokeWidth={3} /> Copié</> : <><Copy size={14} /> Copier le lien</>}
    </button>
  )
}

function InviteCard({ data, post }: { data: Data; post: (b: Record<string, unknown>) => Promise<{ error?: string; url?: string }> }) {
  const [email, setEmail] = useState('')
  const [role, setRole] = useState('admin')
  const [features, setFeatures] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [res, setRes] = useState<{ error?: string; url?: string; email?: string } | null>(null)

  return (
    <section className="rounded-[28px] bg-white p-6 shadow-[0_1px_0_#e8e6e0,0_12px_40px_-24px_rgba(26,26,46,.25)] sm:p-8">
      <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[#f1f0fb] text-[#1a1a2e]"><UserPlus size={22} /></span>
      <h2 className="mt-4 text-[22px] font-extrabold tracking-[-0.02em] text-[#1a1a2e]">Inviter quelqu’un</h2>
      <p className="mt-1 text-[15px] text-[#6b6b63]">Tu reçois un lien personnel à lui envoyer, par WhatsApp ou par e-mail. Il choisit son mot de passe et arrive directement ici.</p>

      {res?.url ? (
        <div className="mt-6 rounded-2xl bg-[#e8f4ee] p-5">
          <p className="text-[15px] font-semibold text-[#1a7f4b]">Invitation prête pour {res.email}</p>
          <p className="mt-1 break-all text-[13px] text-[#1a1a2e]">{res.url}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <CopyLink url={res.url} />
            <button type="button" className="text-[14px] text-[#6b6b63] underline underline-offset-2" onClick={() => { setRes(null); setEmail(''); setFeatures([]) }}>Inviter quelqu’un d’autre</button>
          </div>
          <p className="mt-3 text-[13px] text-[#6b6b63]">Le lien marche une seule fois, pendant 7 jours.</p>
        </div>
      ) : (
        <div className="mt-6 space-y-5">
          <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="son-adresse@email.com" className={`${field} w-full`} aria-label="Adresse e-mail" />
          <RolePicker roles={data.roles} role={role} setRole={setRole} />
          {role === 'sav' && <FeaturePicker features={data.features} picked={features} toggle={k => setFeatures(p => p.includes(k) ? p.filter(x => x !== k) : [...p, k])} />}
          <button disabled={busy || !email.trim() || (role === 'sav' && features.length === 0)} className={btn}
            onClick={async () => { setBusy(true); const r = await post({ action: 'invite', email, role, features }); setRes({ ...r, email }); setBusy(false) }}>
            {busy ? <Loader2 size={16} className="animate-spin" /> : <Link2 size={16} />} Créer le lien d’invitation
          </button>
          {res?.error && <p className="text-[14px] text-[#b42318]">{res.error}</p>}
        </div>
      )}
    </section>
  )
}

function PendingRow({ inv, post }: { inv: Invite; post: (b: Record<string, unknown>) => Promise<unknown> }) {
  const url = typeof window !== 'undefined' ? `${window.location.origin}/join/${inv.token}` : ''
  const days = Math.max(0, Math.ceil((new Date(inv.expiresAt).getTime() - Date.now()) / 864e5))
  return (
    <li className="flex flex-wrap items-center gap-3 rounded-2xl border-2 border-dashed border-[#e4e2dc] bg-white px-4 py-3">
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[15px] font-semibold text-[#1a1a2e]">{inv.email}</span>
        <span className="text-[13px] text-[#6b6b63]">{ROLE_LABEL[inv.role]?.label ?? inv.role}, lien valable encore {days} jour{days > 1 ? 's' : ''}</span>
      </span>
      <CopyLink url={url} />
      <button type="button" title="Annuler l’invitation" onClick={() => post({ action: 'cancel', token: inv.token })}
        className="rounded-xl p-2 text-[#8a887f] hover:bg-[#f3f2ee] hover:text-[#b42318]"><X size={16} /></button>
    </li>
  )
}

function MemberRow({ m, data, post }: { m: Member; data: Data; post: (b: Record<string, unknown>) => Promise<{ error?: string }> }) {
  const [open, setOpen] = useState(false)
  const [role, setRole] = useState(m.role)
  const [features, setFeatures] = useState<string[]>((m.features ?? []).filter(f => data.features.some(x => x.key === f)))
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [confirmRemove, setConfirmRemove] = useState(false)
  const initial = (m.email[0] ?? '?').toUpperCase()

  return (
    <li className="rounded-2xl bg-white px-4 py-3 shadow-[0_1px_0_#e8e6e0]">
      <div className="flex flex-wrap items-center gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#1a1a2e] text-[15px] font-bold text-white">{initial}</span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[15px] font-semibold text-[#1a1a2e]">{m.email}{m.you && <span className="ml-2 font-normal text-[#8a887f]">(toi)</span>}</span>
          <span className="text-[13px] text-[#6b6b63]">
            {ROLE_LABEL[m.role]?.label ?? m.role}
            {m.role === 'sav' && m.features && `, ${m.features.filter(f => data.features.some(x => x.key === f)).length} page(s)`}
            {!m.editable && !m.you && ', géré par le propriétaire'}
          </span>
        </span>
        {m.editable && !open && (
          <button type="button" onClick={() => setOpen(true)} className="rounded-xl border-2 border-[#e4e2dc] px-3 py-2 text-[14px] font-semibold text-[#1a1a2e] hover:border-[#1a1a2e]">Modifier</button>
        )}
        {!m.you && (confirmRemove ? (
          <span className="flex items-center gap-2 text-[14px]">
            Retirer de l’équipe ?
            <button type="button" className="font-semibold text-[#b42318] underline" onClick={async () => { const r = await post({ action: 'remove', id: m.id }); if (r.error) setErr(r.error) }}>Oui</button>
            <button type="button" className="text-[#6b6b63] underline" onClick={() => setConfirmRemove(false)}>Non</button>
          </span>
        ) : (
          <button type="button" title="Retirer de l’équipe" onClick={() => setConfirmRemove(true)} className="rounded-xl p-2 text-[#8a887f] hover:bg-[#f3f2ee] hover:text-[#b42318]"><Trash2 size={16} /></button>
        ))}
      </div>
      {open && (
        <div className="mt-4 space-y-4 border-t border-[#f0efeb] pt-4">
          <RolePicker roles={data.roles} role={role} setRole={setRole} />
          {role === 'sav' && <FeaturePicker features={data.features} picked={features} toggle={k => setFeatures(p => p.includes(k) ? p.filter(x => x !== k) : [...p, k])} />}
          <div className="flex gap-2">
            <button disabled={busy} className={btn} onClick={async () => {
              setBusy(true); setErr('')
              const r = await post({ action: 'update', id: m.id, role, features })
              if (r.error) setErr(r.error); else setOpen(false)
              setBusy(false)
            }}>{busy && <Loader2 size={16} className="animate-spin" />} Enregistrer</button>
            <button type="button" className="px-3 text-[14px] text-[#6b6b63] underline" onClick={() => setOpen(false)}>Annuler</button>
          </div>
        </div>
      )}
      {err && <p className="mt-2 text-[14px] text-[#b42318]">{err}</p>}
    </li>
  )
}
