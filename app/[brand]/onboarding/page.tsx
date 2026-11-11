'use client'

// Démarrage d'une marque : checklist guidée (Shopify, logo, pubs, coûts, équipe).
// Chaque étape se valide toute seule d'après les données réelles ; on peut en passer.
import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { Check, ChevronDown, Loader2, Upload } from 'lucide-react'
import { useBrand } from '@/context/BrandContext'

type StepKey = 'shopify' | 'identity' | 'meta' | 'google' | 'costs' | 'team'
type Step = { key: StepKey; done: boolean; skipped: boolean; detail: Record<string, unknown> }
type Status = { brand: string; name: string; logoUrl: string | null; steps: Step[]; doneCount: number; total: number }

const TITLES: Record<StepKey, { title: string; sub: string }> = {
  shopify:  { title: 'Boutique Shopify',  sub: 'Commandes, produits et stock, synchronisés 4 fois par jour' },
  identity: { title: 'Nom et logo',       sub: 'Pour reconnaître la marque dans Steero' },
  meta:     { title: 'Meta Ads',          sub: 'Dépenses et ROAS Facebook / Instagram' },
  google:   { title: 'Google Ads',        sub: 'Dépenses et ROAS Google' },
  costs:    { title: 'Coûts',             sub: 'Coût des produits, livraison et frais de paiement, pour des marges justes' },
  team:     { title: 'Équipe',            sub: 'Qui d’autre doit accéder à la marque' },
}

const input = 'rounded-[10px] border border-[#d9d9d3] bg-white px-3 py-2 text-sm text-[#1a1a18] focus:outline-none focus:border-[#1a1a2e]'
const primary = 'inline-flex items-center gap-2 rounded-xl bg-[#1a1a2e] px-4 py-2 text-sm font-semibold text-white disabled:opacity-40'
const ghost = 'text-xs text-[#6b6b63] underline underline-offset-2'

export default function OnboardingPage() {
  const brand = useBrand()
  const [status, setStatus] = useState<Status | null>(null)
  const [open, setOpen] = useState<StepKey | null>(null)

  const load = useCallback(async (keepOpen = false) => {
    const r = await fetch(`/api/onboarding?brand=${brand}`)
    if (!r.ok) return
    const s: Status = await r.json()
    setStatus(s)
    if (!keepOpen) setOpen(s.steps.find(x => !x.done)?.key ?? null)
  }, [brand])
  useEffect(() => { load() }, [load])

  async function act(body: Record<string, unknown> | FormData): Promise<{ error?: string } & Record<string, unknown>> {
    const isForm = body instanceof FormData
    if (isForm) body.set('brand', brand)
    const r = await fetch('/api/onboarding', {
      method: 'POST',
      ...(isForm ? { body } : { headers: { 'content-type': 'application/json' }, body: JSON.stringify({ brand, ...body }) }),
    })
    const d = await r.json().catch(() => ({ error: 'Erreur réseau' }))
    await load(true)
    return d
  }

  if (!status) return <div className="min-h-screen bg-[#faf9f8] p-10"><Loader2 className="animate-spin text-[#6b6b63]" size={20} /></div>
  const pct = Math.round((status.doneCount / status.total) * 100)
  const allDone = status.doneCount === status.total

  return (
    <div className="min-h-screen bg-[#faf9f8]">
      <main className="mx-auto max-w-2xl px-4 sm:px-6 py-10 space-y-6">
        <div className="flex items-center gap-4">
          <div className="h-14 w-14 shrink-0 overflow-hidden rounded-2xl border border-[#e8e8e4] bg-white flex items-center justify-center text-xl font-bold text-[#1a1a2e]">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {status.logoUrl ? <img src={status.logoUrl} alt="" className="h-full w-full object-cover" /> : status.name.slice(0, 1).toUpperCase()}
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-tight text-[#1a1a18]">
              {allDone ? `${status.name} est prête 🎉` : `Configurons ${status.name}`}
            </h1>
            <p className="text-sm text-[#6b6b63]">{status.doneCount} / {status.total} étapes · environ 5 minutes</p>
          </div>
        </div>
        <div className="h-2 rounded-full bg-[#ecebe7] overflow-hidden">
          <div className="h-full rounded-full bg-[#1a7f4b] transition-all" style={{ width: `${pct}%` }} />
        </div>

        <ol className="space-y-3">
          {status.steps.map((s, i) => (
            <li key={s.key} className="rounded-2xl border border-[#e8e8e4] bg-white">
              <button onClick={() => setOpen(open === s.key ? null : s.key)} className="flex w-full items-center gap-3 px-5 py-4 text-left">
                <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold ${s.done ? (s.skipped ? 'bg-[#ecebe7] text-[#6b6b63]' : 'bg-[#1a7f4b] text-white') : 'border border-[#d9d9d3] text-[#6b6b63]'}`}>
                  {s.done && !s.skipped ? <Check size={14} strokeWidth={3} /> : i + 1}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold text-[#1a1a18]">{TITLES[s.key].title}</span>
                  <span className="block text-xs text-[#6b6b63]">{s.skipped ? 'Passé — tu pourras y revenir' : summary(s)}</span>
                </span>
                <ChevronDown size={16} className={`text-[#6b6b63] transition-transform ${open === s.key ? 'rotate-180' : ''}`} />
              </button>
              {open === s.key && (
                <div className="border-t border-[#f0efeb] px-5 py-4 space-y-3">
                  <p className="text-xs text-[#6b6b63]">{TITLES[s.key].sub}</p>
                  <StepBody step={s} brand={brand} status={status} act={act} />
                  {s.key !== 'shopify' && s.key !== 'identity' && (
                    <button className={ghost} onClick={() => act({ action: 'skip', step: s.key, skip: !s.skipped })}>
                      {s.skipped ? 'Reprendre cette étape' : skipLabel(s.key)}
                    </button>
                  )}
                </div>
              )}
            </li>
          ))}
        </ol>

        <div className="flex justify-end">
          <Link href={`/${brand}/dashboard`} className={allDone ? primary : 'text-sm text-[#6b6b63] underline underline-offset-2'}>
            {allDone ? 'Ouvrir le dashboard →' : 'Terminer plus tard'}
          </Link>
        </div>
      </main>
    </div>
  )
}

function summary(s: Step): string {
  const d = s.detail
  switch (s.key) {
    case 'shopify':  return s.done ? `${d.shop} · données depuis le ${fmt(d.firstDate as string | null)}` : 'À connecter'
    case 'identity': return s.done ? String(d.name) : 'Logo manquant'
    case 'meta':     return s.done ? `Compte ${d.adAccount}` : 'Non connecté'
    case 'google':   return s.done ? `Compte ${d.customerId}` : 'Non connecté'
    case 'costs':    return `${d.costed}/${d.variants} articles avec coût · livraison ${Number(d.shipping) > 0 ? `${d.shipping} €/cmd` : 'à renseigner'}`
    case 'team':     return Number(d.members) > 0 ? `${d.members} membre${Number(d.members) > 1 ? 's' : ''}` : 'Personne d’autre pour l’instant'
  }
}

function skipLabel(k: StepKey) {
  return { meta: 'Je ne fais pas de pub Meta', google: 'Je ne fais pas de pub Google', costs: 'Plus tard', team: 'Je travaille seul', shopify: '', identity: '' }[k]
}

function fmt(d: string | null) {
  return d ? new Date(d + 'T00:00:00').toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' }) : '—'
}

type Act = (body: Record<string, unknown> | FormData) => Promise<{ error?: string } & Record<string, unknown>>

function useRun(act: Act) {
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const run = async (body: Record<string, unknown> | FormData, ok: (r: Record<string, unknown>) => string) => {
    setBusy(true); setMsg(null)
    const r = await act(body)
    setMsg(r.error ? { ok: false, text: String(r.error) } : { ok: true, text: ok(r) })
    setBusy(false)
  }
  const note = msg && <p className={`text-xs ${msg.ok ? 'text-[#1a7f4b]' : 'text-[#b42318]'}`}>{msg.text}</p>
  return { busy, run, note }
}

function StepBody({ step, brand, status, act }: { step: Step; brand: string; status: Status; act: Act }) {
  const d = step.detail
  const { busy, run, note } = useRun(act)
  const [a, setA] = useState('')
  const [b, setB] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (step.key === 'identity') setA(status.name)
    if (step.key === 'shopify') setA((d.firstDate as string) ?? '')
    if (step.key === 'costs') { setA(Number(d.shipping) > 0 ? String(d.shipping) : ''); setB(d.feeRate != null ? String(Math.round(Number(d.feeRate) * 1000) / 10) : '') }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step.key])

  switch (step.key) {
    case 'shopify':
      return step.done ? (
        <div className="space-y-3">
          <p className="text-sm text-[#1a1a18]">✓ Connectée à <strong>{String(d.shop)}</strong> · {String(d.variants)} articles</p>
          <div className="rounded-xl bg-[#faf9f8] p-3 space-y-2">
            <p className="text-xs text-[#6b6b63]">Données depuis le <strong>{fmt(d.firstDate as string | null)}</strong>. Ta première vente date d’avant ? Indique-la et on réimporte.
              Shopify limite à 60 jours tant que l’accès « historique complet » n’est pas accordé à l’app.</p>
            <div className="flex flex-wrap items-center gap-2">
              <input type="date" value={a} onChange={e => setA(e.target.value)} className={input} />
              <button disabled={busy || !a} className={primary} onClick={() => run({ action: 'history', from: a }, r => `Historique importé : ${r.days} jours avec ventes`)}>
                {busy && <Loader2 size={14} className="animate-spin" />} Importer l’historique
              </button>
            </div>
            {note}
          </div>
        </div>
      ) : (
        <Link href={`/${brand}/settings`} className={primary}>Connecter Shopify</Link>
      )

    case 'identity':
      return (
        <div className="space-y-3">
          <div className="flex flex-wrap gap-2">
            <button disabled={busy} className={primary} onClick={() => run({ action: 'importBranding' }, r => `Importé depuis Shopify : ${r.name}`)}>
              {busy && <Loader2 size={14} className="animate-spin" />} Récupérer depuis Shopify
            </button>
            <button className="inline-flex items-center gap-2 rounded-xl border border-[#d9d9d3] px-4 py-2 text-sm font-semibold text-[#1a1a2e]" onClick={() => fileRef.current?.click()}>
              <Upload size={14} /> Envoyer un logo
            </button>
            <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" hidden onChange={e => {
              const f = e.target.files?.[0]; if (!f) return
              const fd = new FormData(); fd.set('action', 'logo'); fd.set('file', f)
              run(fd, () => 'Logo enregistré')
            }} />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <input value={a} onChange={e => setA(e.target.value)} placeholder="Nom de la marque" className={`${input} w-64`} />
            <button disabled={busy || !a.trim()} className="rounded-xl border border-[#1a1a2e] px-3 py-2 text-sm font-semibold text-[#1a1a2e] disabled:opacity-40"
              onClick={() => run({ action: 'identity', name: a, logoUrl: status.logoUrl ?? '' }, () => 'Nom enregistré')}>Enregistrer le nom</button>
          </div>
          {note}
        </div>
      )

    case 'meta':
    case 'google': {
      const isMeta = step.key === 'meta'
      const current = (isMeta ? d.adAccount : d.customerId) as string | null
      return (
        <div className="space-y-2">
          {current && !step.skipped && <p className="text-sm text-[#1a1a18]">✓ Compte <strong>{current}</strong> connecté</p>}
          <p className="text-xs text-[#6b6b63]">
            {isMeta
              ? 'Dans le Business Manager de la marque, donne l’accès au compte pub à ton Business Manager Steero, puis colle son ID (act_… ou les chiffres).'
              : 'Dans Google Ads, accepte l’invitation du compte gestionnaire Steero, puis colle l’ID client (en haut à droite, 123-456-7890).'}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <input value={a} onChange={e => setA(e.target.value)} placeholder={isMeta ? 'act_1234567890' : '123-456-7890'} className={`${input} w-56 font-mono`} />
            <button disabled={busy || !a.trim()} className={primary}
              onClick={() => run(isMeta ? { action: 'meta', adAccount: a } : { action: 'google', customerId: a }, r => `Connecté : ${r.name}`)}>
              {busy && <Loader2 size={14} className="animate-spin" />} Vérifier et connecter
            </button>
          </div>
          {note}
        </div>
      )
    }

    case 'costs': {
      const missing = Number(d.variants) - Number(d.costed)
      return (
        <div className="space-y-3">
          <div className="rounded-xl bg-[#faf9f8] p-3 text-xs text-[#6b6b63]">
            <strong className="text-[#1a1a18]">Coût des produits : {String(d.costed)}/{String(d.variants)} articles.</strong>{' '}
            {missing > 0
              ? <>Steero lit le « Coût par article » de chaque produit dans Shopify (fiche produit → Prix). Renseigne-le pour les {missing} manquants, la synchro suivante le récupère.</>
              : 'Tout est renseigné dans Shopify.'}
          </div>
          <div className="flex flex-wrap items-end gap-3">
            <label className="text-xs text-[#6b6b63]">Livraison payée par commande (€)
              <input inputMode="decimal" value={a} onChange={e => setA(e.target.value)} placeholder="6,50" className={`${input} mt-1 block w-36`} />
            </label>
            <label className="text-xs text-[#6b6b63]">Frais de paiement (%)
              <input inputMode="decimal" value={b} onChange={e => setB(e.target.value)} placeholder="1,7" className={`${input} mt-1 block w-28`} />
            </label>
            <button disabled={busy || !a} className={primary} onClick={() => run({ action: 'costs', shipping: a, feeRate: b }, () => 'Coûts enregistrés')}>Enregistrer</button>
          </div>
          <p className="text-xs text-[#6b6b63]">Charges fixes (salaires, abonnements…) : <Link href={`/${brand}/settings`} className="underline">Paramètres</Link>.</p>
          {note}
        </div>
      )
    }

    case 'team':
      return (
        <div className="space-y-2">
          <p className="text-sm text-[#1a1a18]">{Number(d.members) > 0 ? `${d.members} personne(s) ont accès à ${status.name}.` : 'Invite un associé, un SAV ou un logisticien : chacun ne voit que ce que tu choisis.'}</p>
          <Link href={`/${brand}/users`} className={primary}>Gérer l’équipe</Link>
        </div>
      )
  }
}
