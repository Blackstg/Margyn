'use client'

// Démarrage d'une marque, en missions : une question à la fois à gauche, et à droite
// « ton Steero » qui se débloque avec les vrais chiffres de la marque à chaque mission.
// Chaque mission se valide d'après les données réelles ; on peut en passer.
import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import {
  Check, Loader2, Lock, Store, Image as ImageIcon, Megaphone, Search, Package, Truck, Users, Upload, ExternalLink, PartyPopper,
} from 'lucide-react'
import { useBrand } from '@/context/BrandContext'

type StepKey = 'shopify' | 'identity' | 'meta' | 'google' | 'products' | 'shipping' | 'team'
type Step = { key: StepKey; done: boolean; skipped: boolean; detail: Record<string, unknown> }
type Missing = { productId: string; title: string; image: string | null; revenue: number }
type Preview = { sales30: number; orders30: number; cogs30: number; metaSpend30: number; googleSpend30: number }
type Status = { brand: string; name: string; logoUrl: string | null; steps: Step[]; doneCount: number; total: number; preview: Preview; missingCosts: Missing[] }
type Act = (body: Record<string, unknown> | FormData) => Promise<{ error?: string } & Record<string, unknown>>

const MISSIONS: Record<StepKey, { icon: typeof Store; short: string; question: string; why: string }> = {
  shopify:  { icon: Store,     short: 'Boutique', question: 'Branche ta boutique',                       why: 'Steero lit tes commandes et tes produits, sans jamais rien modifier.' },
  identity: { icon: ImageIcon, short: 'Logo',     question: 'À quoi ressemble ta marque ?',              why: 'Pour la reconnaître d’un coup d’œil dans Steero.' },
  meta:     { icon: Megaphone, short: 'Meta',     question: 'Tu fais de la pub sur Facebook ou Instagram ?', why: 'On compare ce que tu dépenses à ce que ça te rapporte.' },
  google:   { icon: Search,    short: 'Google',   question: 'Tu fais de la pub sur Google ?',            why: 'Même chose pour Google : dépense contre ventes.' },
  products: { icon: Package,   short: 'Coûts',    question: 'Combien te coûte chaque produit ?',         why: 'Le prix que tu paies pour un article. Sans lui, impossible de savoir si tu gagnes de l’argent. Il se renseigne dans Shopify, Steero le lit tout seul.' },
  shipping: { icon: Truck,     short: 'Envoi',    question: 'Combien te coûte l’envoi d’une commande ?', why: 'L’envoi et les frais de paiement mangent une partie de chaque vente.' },
  team:     { icon: Users,     short: 'Équipe',   question: 'Tu travailles avec quelqu’un ?',            why: 'Chaque personne ne voit que ce que tu lui ouvres.' },
}
const ORDER: StepKey[] = ['shopify', 'identity', 'meta', 'google', 'products', 'shipping', 'team']

const eur = (n: number) => new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(n)
const fmtDate = (d: string | null) => d ? new Date(d + 'T00:00:00').toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' }) : '—'

const btn = 'inline-flex items-center justify-center gap-2 rounded-2xl bg-[#1a1a2e] px-5 py-3 text-[15px] font-semibold text-white transition active:scale-[.98] disabled:opacity-40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1a1a2e]'
const btnSoft = 'inline-flex items-center justify-center gap-2 rounded-2xl border-2 border-[#e4e2dc] bg-white px-5 py-3 text-[15px] font-semibold text-[#1a1a2e] transition hover:border-[#1a1a2e] active:scale-[.98] disabled:opacity-40'
const field = 'rounded-2xl border-2 border-[#e4e2dc] bg-white px-4 py-3 text-[15px] text-[#1a1a18] placeholder:text-[#b5b3ab] focus:border-[#1a1a2e] focus:outline-none'

export default function OnboardingPage() {
  const brand = useBrand()
  const [status, setStatus] = useState<Status | null>(null)
  const [current, setCurrent] = useState<StepKey | null>(null)
  const [fresh, setFresh] = useState<StepKey | null>(null)   // mission tout juste réussie → tuile animée
  const prevDone = useRef<Set<StepKey> | null>(null)

  const load = useCallback(async (advance: boolean) => {
    const r = await fetch(`/api/onboarding?brand=${brand}`)
    if (!r.ok) return
    const s: Status = await r.json()
    const doneNow = new Set(s.steps.filter(x => x.done).map(x => x.key))
    if (prevDone.current) {
      const unlocked = ORDER.find(k => doneNow.has(k) && !prevDone.current!.has(k))
      if (unlocked) { setFresh(unlocked); setTimeout(() => setFresh(null), 1600) }
    }
    prevDone.current = doneNow
    setStatus(s)
    if (advance) setCurrent(s.steps.find(x => !x.done)?.key ?? null)
  }, [brand])
  useEffect(() => { load(true) }, [load])

  // Boutique tout juste branchée sans aucune vente importée : on récupère l'historique
  // tout de suite (2 ans max, Shopify limite à 60 jours sans l'accès historique complet).
  const autoImport = useRef(false)
  const [importing, setImporting] = useState(false)
  useEffect(() => {
    const shop = status?.steps.find(x => x.key === 'shopify')
    if (!shop?.done || shop.detail.firstDate || autoImport.current) return
    autoImport.current = true
    setImporting(true)
    const from = new Date(Date.now() - 730 * 864e5).toISOString().slice(0, 10)
    fetch('/api/onboarding', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ brand, action: 'history', from }) })
      .finally(() => { setImporting(false); load(false) })
  }, [status, brand, load])

  const act: Act = async (body) => {
    const isForm = body instanceof FormData
    if (isForm) body.set('brand', brand)
    const r = await fetch('/api/onboarding', {
      method: 'POST',
      ...(isForm ? { body } : { headers: { 'content-type': 'application/json' }, body: JSON.stringify({ brand, ...body }) }),
    })
    const d = await r.json().catch(() => ({ error: 'Connexion perdue, réessaie' }))
    await load(!d.error && current !== 'shopify' && current !== 'identity')
    return d
  }

  if (!status) return <div className="min-h-screen bg-[#faf9f8] p-10"><Loader2 className="animate-spin text-[#6b6b63]" size={22} /></div>

  const byKey = Object.fromEntries(status.steps.map(s => [s.key, s])) as Record<StepKey, Step>
  const pct = Math.round((status.doneCount / status.total) * 100)
  const step = current ? byKey[current] : null

  return (
    <div className="min-h-screen bg-[#faf9f8]">
      <style>{`
        @keyframes onb-unlock { 0% { transform: scale(.94); box-shadow: 0 0 0 0 rgba(26,127,75,.55) } 60% { transform: scale(1.02); box-shadow: 0 0 0 10px rgba(26,127,75,0) } 100% { transform: scale(1) } }
        .onb-unlock { animation: onb-unlock 1.2s cubic-bezier(.2,.8,.2,1) }
        @keyframes onb-pulse { 0%,100% { box-shadow: 0 0 0 0 rgba(26,26,46,.25) } 50% { box-shadow: 0 0 0 6px rgba(26,26,46,0) } }
        .onb-here { animation: onb-pulse 2s ease-in-out infinite }
        @media (prefers-reduced-motion: reduce) { .onb-unlock, .onb-here { animation: none } }
        .onb-locked { background: repeating-linear-gradient(135deg, #f3f2ee 0 7px, #ecebe6 7px 14px) }
      `}</style>

      <main className="mx-auto max-w-6xl px-4 py-8 sm:px-8 sm:py-10">
        {/* En-tête : la jauge est l'enjeu */}
        <header className="mb-8">
          <p className="text-[15px] text-[#6b6b63]">{status.name}</p>
          <h1 className="mt-1 text-[clamp(28px,4vw,44px)] font-extrabold leading-[1.05] tracking-[-0.03em] text-[#1a1a2e]">
            {pct === 100 ? 'Steero voit tout ton business.' : <>Steero voit <span className="tabular-nums">{pct} %</span> de ton business.</>}
          </h1>
          {pct < 100 && <p className="mt-2 text-[15px] text-[#6b6b63]">Chaque mission débloque une partie de ton tableau de bord, avec tes vrais chiffres.</p>}
          {importing && <p className="mt-3 inline-flex items-center gap-2 rounded-full bg-white px-3 py-1.5 text-[14px] text-[#1a1a2e] shadow-[0_1px_0_#e8e6e0]"><Loader2 size={14} className="animate-spin" /> On récupère tes ventes passées, ça prend une minute…</p>}

          {/* Parcours des missions */}
          <ol className="mt-6 flex items-center overflow-x-auto pb-2" aria-label="Missions">
            {ORDER.map((k, i) => {
              const s = byKey[k]; const M = MISSIONS[k]; const here = current === k
              return (
                <li key={k} className="flex items-center">
                  {i > 0 && <span className={`h-[3px] w-6 sm:w-10 ${byKey[ORDER[i - 1]].done ? 'bg-[#1a7f4b]' : 'bg-[#e4e2dc]'}`} />}
                  <button onClick={() => setCurrent(k)} title={M.question}
                    className={`group flex flex-col items-center gap-1.5 rounded-xl px-1 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#1a1a2e]`}>
                    <span className={`flex h-11 w-11 items-center justify-center rounded-full transition
                      ${s.done && !s.skipped ? 'bg-[#1a7f4b] text-white' : s.skipped ? 'bg-[#e4e2dc] text-[#8a887f]' : here ? 'onb-here bg-[#1a1a2e] text-white' : 'border-2 border-[#e4e2dc] bg-white text-[#8a887f] group-hover:border-[#1a1a2e]'}`}>
                      {s.done && !s.skipped ? <Check size={18} strokeWidth={3} /> : <M.icon size={18} />}
                    </span>
                    <span className={`text-[12px] ${here ? 'font-semibold text-[#1a1a2e]' : 'text-[#8a887f]'}`}>{M.short}</span>
                  </button>
                </li>
              )
            })}
          </ol>
        </header>

        <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,440px)]">
          {/* Mission en cours */}
          <section className="rounded-[28px] bg-white p-6 shadow-[0_1px_0_#e8e6e0,0_12px_40px_-24px_rgba(26,26,46,.25)] sm:p-8">
            {step ? (
              <Mission key={step.key} step={step} status={status} act={act} onNext={() => {
                const next = ORDER.slice(ORDER.indexOf(step.key) + 1).find(k => !byKey[k].done) ?? ORDER.find(k => !byKey[k].done) ?? null
                setCurrent(next)
              }} />
            ) : (
              <div className="py-6">
                <PartyPopper size={40} className="text-[#1a7f4b]" />
                <h2 className="mt-4 text-[28px] font-extrabold tracking-[-0.02em] text-[#1a1a2e]">Tout est prêt.</h2>
                <p className="mt-2 max-w-md text-[15px] text-[#6b6b63]">Steero se met à jour tout seul plusieurs fois par jour. Tu n’as plus rien à faire, à part regarder tes chiffres.</p>
                <Link href={`/${brand}/dashboard`} className={`${btn} mt-6`}>Voir mon dashboard</Link>
              </div>
            )}
          </section>

          {/* Ton Steero, qui se débloque */}
          <aside className="lg:sticky lg:top-6 lg:self-start">
            <Unlocks status={status} byKey={byKey} fresh={fresh} onPick={setCurrent} />
          </aside>
        </div>
      </main>
    </div>
  )
}

// ─── Aperçu débloquable ───────────────────────────────────────────────────────

function Unlocks({ status, byKey, fresh, onPick }: { status: Status; byKey: Record<StepKey, Step>; fresh: StepKey | null; onPick: (k: StepKey) => void }) {
  const p = status.preview
  const shipping = Number(byKey.shipping.detail.shipping ?? 0)
  const fee = byKey.shipping.detail.feeRate != null ? Number(byKey.shipping.detail.feeRate) : 0.017
  const margin = p.sales30 - p.cogs30 - shipping * p.orders30 - fee * p.sales30 - p.metaSpend30 - p.googleSpend30
  const marginReady = byKey.products.done && !byKey.products.skipped && byKey.shipping.done && !byKey.shipping.skipped

  const tiles: { key: StepKey; label: string; render: () => React.ReactNode; wide?: boolean; ready?: boolean }[] = [
    { key: 'shopify', label: 'Ventes · 30 jours', wide: true, render: () => (
      <><Big>{eur(p.sales30)}</Big><Small>{p.orders30} commande{p.orders30 > 1 ? 's' : ''}</Small></>) },
    { key: 'meta', label: 'Pub Meta', render: () => byKey.meta.skipped ? <Small>Pas de pub Meta</Small> : (
      <><Big>{eur(p.metaSpend30)}</Big><Small>{p.metaSpend30 ? 'dépensés en 30 jours' : 'Chiffres d’ici la prochaine synchro'}</Small></>) },
    { key: 'google', label: 'Pub Google', render: () => byKey.google.skipped ? <Small>Pas de pub Google</Small> : (
      <><Big>{eur(p.googleSpend30)}</Big><Small>{p.googleSpend30 ? 'dépensés en 30 jours' : 'Chiffres d’ici la prochaine synchro'}</Small></>) },
    { key: 'products', label: 'Ce qu’il te reste · 30 jours', wide: true, ready: marginReady, render: () => (
      <><Big tone={margin >= 0 ? 'good' : 'bad'}>{eur(margin)}</Big>
        <Small>après produits, envois, frais et pub{p.sales30 > 0 ? ` · ${Math.round((margin / p.sales30) * 100)} % des ventes` : ''}</Small></>) },
    { key: 'team', label: 'Équipe', render: () => byKey.team.skipped ? <Small>Seul·e pour l’instant</Small> : (
      <><Big>{Number(byKey.team.detail.members)}</Big><Small>personne{Number(byKey.team.detail.members) > 1 ? 's' : ''} avec accès</Small></>) },
  ]

  return (
    <div className="rounded-[28px] bg-[#1a1a2e] p-5 text-white sm:p-6">
      <div className="mb-5 flex items-center gap-3">
        <span className="flex h-11 w-11 items-center justify-center overflow-hidden rounded-xl bg-white/10 text-lg font-bold">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {status.logoUrl ? <img src={status.logoUrl} alt="" className="h-full w-full object-cover" /> : <Lock size={16} className="text-white/40" />}
        </span>
        <div>
          <p className="font-bold leading-tight">{status.logoUrl ? status.name : 'Ton Steero'}</p>
          <p className="text-[13px] text-white/50">{status.logoUrl ? 'Tableau de bord' : 'Ajoute ton logo pour l’afficher ici'}</p>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2.5">
        {tiles.map(t => {
          const s = byKey[t.key]
          const open = t.ready ?? s.done
          const unlockBy = t.key === 'products' ? (!byKey.products.done ? 'products' : 'shipping') : t.key
          return open ? (
            <div key={t.key} className={`rounded-2xl bg-white p-4 text-[#1a1a2e] ${t.wide ? 'col-span-2' : ''} ${fresh === t.key || (t.key === 'products' && (fresh === 'products' || fresh === 'shipping')) ? 'onb-unlock' : ''}`}>
              <p className="text-[12px] font-medium text-[#8a887f]">{t.label}</p>
              <div className="mt-1">{t.render()}</div>
            </div>
          ) : (
            <button key={t.key} onClick={() => onPick(unlockBy)}
              className={`onb-locked rounded-2xl p-4 text-left text-[#8a887f] transition hover:brightness-[.98] ${t.wide ? 'col-span-2' : ''}`}>
              <p className="flex items-center gap-1.5 text-[12px] font-medium"><Lock size={12} /> {t.label}</p>
              <p className="mt-2 text-[13px] leading-snug text-[#6b6b63]">Débloque avec la mission <span className="font-semibold text-[#1a1a2e]">{MISSIONS[unlockBy].short}</span></p>
            </button>
          )
        })}
      </div>
    </div>
  )
}

function Big({ children, tone }: { children: React.ReactNode; tone?: 'good' | 'bad' }) {
  return <p className={`text-[26px] font-extrabold leading-none tracking-[-0.02em] tabular-nums ${tone === 'good' ? 'text-[#1a7f4b]' : tone === 'bad' ? 'text-[#b42318]' : ''}`}>{children}</p>
}
function Small({ children }: { children: React.ReactNode }) {
  return <p className="mt-1.5 text-[13px] text-[#6b6b63]">{children}</p>
}

// ─── Une mission ──────────────────────────────────────────────────────────────

function Mission({ step, status, act, onNext }: { step: Step; status: Status; act: Act; onNext: () => void }) {
  const M = MISSIONS[step.key]
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const run = async (body: Record<string, unknown> | FormData, ok: (r: Record<string, unknown>) => string) => {
    setBusy(true); setMsg(null)
    const r = await act(body)
    setMsg(r.error ? { ok: false, text: String(r.error) } : { ok: true, text: ok(r) })
    setBusy(false)
  }
  const skip = (label: string) => (
    <button disabled={busy} className={btnSoft} onClick={() => run({ action: 'skip', step: step.key, skip: true }, () => 'C’est noté')}>{label}</button>
  )

  return (
    <div>
      <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-[#f1f0fb] text-[#1a1a2e]"><M.icon size={26} /></span>
      <h2 className="mt-5 text-[clamp(24px,3vw,32px)] font-extrabold leading-[1.1] tracking-[-0.02em] text-[#1a1a2e]">{M.question}</h2>
      <p className="mt-2 max-w-[52ch] text-[15px] leading-relaxed text-[#6b6b63]">{M.why}</p>

      {step.done && !step.skipped && step.key !== 'shopify' && step.key !== 'identity' && (
        <p className="mt-5 inline-flex items-center gap-2 rounded-full bg-[#e8f4ee] px-3 py-1.5 text-[14px] font-semibold text-[#1a7f4b]"><Check size={15} strokeWidth={3} /> Mission réussie</p>
      )}
      {step.skipped && (
        <p className="mt-5 text-[14px] text-[#6b6b63]">Tu as passé cette mission.{' '}
          <button className="font-semibold text-[#1a1a2e] underline underline-offset-2" onClick={() => run({ action: 'skip', step: step.key, skip: false }, () => 'Mission reprise')}>La reprendre</button>
        </p>
      )}

      <div className="mt-7">
        <Body step={step} status={status} run={run} busy={busy} skip={skip} />
      </div>

      {msg && <p role="status" className={`mt-4 text-[14px] font-medium ${msg.ok ? 'text-[#1a7f4b]' : 'text-[#b42318]'}`}>{msg.text}</p>}

      {step.done && (
        <div className="mt-8 border-t border-[#f0efeb] pt-5">
          <button className={btn} onClick={onNext}>Mission suivante</button>
        </div>
      )}
    </div>
  )
}

function HowTo({ items }: { items: React.ReactNode[] }) {
  return (
    <ol className="mb-6 space-y-3">
      {items.map((it, i) => (
        <li key={i} className="flex gap-3 text-[15px] leading-snug text-[#1a1a18]">
          <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#1a1a2e] text-[12px] font-bold text-white">{i + 1}</span>
          <span>{it}</span>
        </li>
      ))}
    </ol>
  )
}

function OutLink({ href, children }: { href: string; children: React.ReactNode }) {
  return <a href={href} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-semibold text-[#1a1a2e] underline underline-offset-2">{children}<ExternalLink size={13} /></a>
}

type Run = (body: Record<string, unknown> | FormData, ok: (r: Record<string, unknown>) => string) => Promise<void>

function Body({ step, status, run, busy, skip }: { step: Step; status: Status; run: Run; busy: boolean; skip: (l: string) => React.ReactNode }) {
  const d = step.detail
  const [a, setA] = useState('')
  const [yes, setYes] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const spin = busy && <Loader2 size={16} className="animate-spin" />

  switch (step.key) {
    case 'shopify':
      if (!step.done) return <Link href={`/${status.brand}/settings`} className={btn}>Connecter ma boutique Shopify</Link>
      return (
        <div className="space-y-5">
          <p className="inline-flex items-center gap-2 rounded-full bg-[#e8f4ee] px-3 py-1.5 text-[14px] font-semibold text-[#1a7f4b]"><Check size={15} strokeWidth={3} /> {String(d.shop)} est branchée</p>
          <div className="rounded-2xl bg-[#faf9f8] p-5">
            <p className="text-[15px] font-semibold text-[#1a1a2e]">Steero a tes ventes depuis le {fmtDate(d.firstDate as string | null)}.</p>
            <p className="mt-1 text-[14px] text-[#6b6b63]">Tu as commencé avant ? Choisis le jour de ta toute première vente.</p>
            <div className="mt-4 flex flex-wrap gap-2">
              <input type="date" value={a} onChange={e => setA(e.target.value)} className={`${field} w-auto`} aria-label="Date de la première vente" />
              <button disabled={busy || !a} className={btn} onClick={() => run({ action: 'history', from: a }, r => `C’est fait : ${r.days} jours de ventes récupérés`)}>{spin} Récupérer mes ventes</button>
            </div>
          </div>
        </div>
      )

    case 'identity':
      return (
        <div className="space-y-4">
          <div className="flex items-center gap-4">
            <span className="flex h-20 w-20 items-center justify-center overflow-hidden rounded-3xl border-2 border-dashed border-[#e4e2dc] bg-[#faf9f8]">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {status.logoUrl ? <img src={status.logoUrl} alt="Logo" className="h-full w-full object-cover" /> : <ImageIcon size={24} className="text-[#b5b3ab]" />}
            </span>
            <p className="text-[15px] text-[#6b6b63]">{status.logoUrl ? 'Joli. Tu peux le changer quand tu veux.' : 'Le plus simple : on le prend sur ton site.'}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button disabled={busy} className={btn} onClick={() => run({ action: 'importBranding' }, () => 'Logo récupéré sur ton site')}>{spin} Prendre le logo de mon site</button>
            <button disabled={busy} className={btnSoft} onClick={() => fileRef.current?.click()}><Upload size={16} /> Envoyer une image</button>
            <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" hidden onChange={e => {
              const f = e.target.files?.[0]; if (!f) return
              const fd = new FormData(); fd.set('action', 'logo'); fd.set('file', f)
              run(fd, () => 'Logo enregistré')
            }} />
          </div>
        </div>
      )

    case 'meta':
    case 'google': {
      const isMeta = step.key === 'meta'
      const connected = (isMeta ? d.adAccount : d.customerId) as string | null
      if (step.done && !step.skipped) return <p className="text-[15px] text-[#1a1a18]">Compte <strong className="tabular-nums">{connected}</strong> connecté, avec tes dépenses depuis ta première vente.</p>
      if (!yes && !step.skipped) return (
        <div className="flex flex-wrap gap-2">
          <button className={btn} onClick={() => setYes(true)}>Oui</button>
          {skip('Non, pas pour l’instant')}
        </div>
      )
      return (
        <div>
          <HowTo items={isMeta ? [
            <>Ouvre ton <OutLink href="https://adsmanager.facebook.com/">Gestionnaire de publicités</OutLink>.</>,
            <>En haut à gauche, sous le nom de ton compte, copie son numéro (une suite de chiffres).</>,
            <>Colle-le ici.</>,
          ] : [
            <>Ouvre <OutLink href="https://ads.google.com/">Google Ads</OutLink>.</>,
            <>En haut à droite, copie le numéro de ton compte : il ressemble à 123-456-7890.</>,
            <>Colle-le ici.</>,
          ]} />
          <div className="flex flex-wrap gap-2">
            <input value={a} onChange={e => setA(e.target.value)} placeholder={isMeta ? '1234567890' : '123-456-7890'} inputMode="numeric"
              className={`${field} w-full max-w-[260px] tabular-nums`} aria-label="Numéro du compte publicitaire" />
            <button disabled={busy || !a.trim()} className={btn}
              onClick={() => run(isMeta ? { action: 'meta', adAccount: a } : { action: 'google', customerId: a }, r => `Connecté : ${r.name}. Dépenses passées récupérées.`)}>{spin} Connecter</button>
          </div>
        </div>
      )
    }

    case 'products':
      return <CostsInShopify step={step} missing={status.missingCosts} run={run} busy={busy} />

    case 'shipping':
      return <ShippingChoice step={step} run={run} busy={busy} />

    case 'team':
      if (step.done && !step.skipped) return <Link href={`/${status.brand}/users`} className={btnSoft}>Gérer l’équipe</Link>
      return (
        <div className="flex flex-wrap gap-2">
          <Link href={`/${status.brand}/users`} className={btn}>Inviter quelqu’un</Link>
          {skip('Seul·e pour l’instant')}
        </div>
      )
  }
}

function CostsInShopify({ step, missing, run, busy }: { step: Step; missing: Missing[]; run: Run; busy: boolean }) {
  const d = step.detail
  const handle = d.shopHandle as string | null
  const admin = handle ? `https://admin.shopify.com/store/${handle}` : 'https://admin.shopify.com'
  const coverage = Number(d.coverage ?? 0)
  const many = Number(d.variants) > 50

  return (
    <div className="space-y-6">
      {/* Jauge : part des ventes dont on connaît le coût */}
      <div>
        <div className="flex items-baseline justify-between">
          <p className="text-[15px] font-semibold text-[#1a1a2e]">{coverage} % de tes ventes ont un coût</p>
          <p className="text-[13px] text-[#8a887f]">objectif 90 %</p>
        </div>
        <div className="relative mt-2 h-3 overflow-hidden rounded-full bg-[#ecebe7]">
          <div className={`h-full rounded-full transition-all ${coverage >= 90 ? 'bg-[#1a7f4b]' : 'bg-[#1a1a2e]'}`} style={{ width: `${Math.min(100, coverage)}%` }} />
          <span className="absolute inset-y-0 left-[90%] w-0.5 bg-white" aria-hidden />
        </div>
        <p className="mt-1.5 text-[13px] text-[#6b6b63]">{String(d.costed)} produit{Number(d.costed) > 1 ? 's' : ''} sur {String(d.variants)} ont déjà un coût dans Shopify. On compte surtout ceux qui se vendent.</p>
      </div>

      {missing.length > 0 && (
        <div>
          <p className="mb-2 text-[15px] font-semibold text-[#1a1a2e]">Commence par {missing.length > 1 ? `ces ${missing.length}` : 'celui-ci'}, ce sont tes meilleures ventes</p>
          <ul className="divide-y divide-[#f0efeb] rounded-2xl border-2 border-[#f0efeb]">
            {missing.map(m => (
              <li key={m.productId}>
                <a href={`${admin}/products/${m.productId}`} target="_blank" rel="noreferrer" className="flex items-center gap-3 px-3 py-2.5 transition hover:bg-[#faf9f8]">
                  <span className="h-11 w-11 shrink-0 overflow-hidden rounded-xl bg-[#f3f2ee]">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    {m.image && <img src={m.image} alt="" className="h-full w-full object-cover" />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[15px] font-semibold text-[#1a1a18]">{m.title}</span>
                    <span className="text-[13px] text-[#6b6b63]">{eur(m.revenue)} de ventes sur 3 mois</span>
                  </span>
                  <span className="inline-flex shrink-0 items-center gap-1 text-[14px] font-semibold text-[#1a1a2e]">Ajouter le coût <ExternalLink size={13} /></span>
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}

      <HowTo items={many ? [
        <>Dans Shopify, ouvre <OutLink href={`${admin}/products`}>Produits</OutLink>, coche tout, puis <strong>Modifier les produits</strong>.</>,
        <>Ajoute la colonne <strong>Coût par article</strong> et remplis-la comme un tableur.</>,
        <>Gros catalogue ? <strong>Exporter</strong> les produits en CSV, remplis la colonne <em>Cost per item</em>, puis <strong>Importer</strong>.</>,
        <>Reviens ici et clique sur Vérifier.</>,
      ] : [
        <>Clique sur un produit ci-dessus (ou ouvre <OutLink href={`${admin}/products`}>tes produits</OutLink>).</>,
        <>Dans <strong>Prix</strong>, remplis <strong>Coût par article</strong> et enregistre.</>,
        <>Reviens ici et clique sur Vérifier.</>,
      ]} />

      <button disabled={busy} className={btn}
        onClick={() => run({ action: 'refreshCosts' }, r => Number(r.added) > 0 ? `${r.added} nouveau${Number(r.added) > 1 ? 'x' : ''} coût${Number(r.added) > 1 ? 's' : ''} récupéré${Number(r.added) > 1 ? 's' : ''}, marges recalculées` : 'Aucun nouveau coût trouvé dans Shopify pour l’instant')}>
        {busy && <Loader2 size={16} className="animate-spin" />} Vérifier mes coûts Shopify
      </button>
    </div>
  )
}

const SHIP = [4, 6, 8, 10]
const FEES = [{ label: 'Shopify Payments', hint: '≈ 1,7 %', v: 1.7 }, { label: 'PayPal', hint: '≈ 2,9 %', v: 2.9 }, { label: 'Je ne sais pas', hint: 'on met 1,7 %', v: 1.7 }]

function ShippingChoice({ step, run, busy }: { step: Step; run: Run; busy: boolean }) {
  const cur = Number(step.detail.shipping ?? 0)
  const [ship, setShip] = useState<number | null>(cur > 0 ? cur : null)
  const [other, setOther] = useState(cur > 0 && !SHIP.includes(cur) ? String(cur).replace('.', ',') : '')
  const saved = step.detail.feeRate != null ? Math.round(Number(step.detail.feeRate) * 1000) / 10 : null
  const [feeLabel, setFeeLabel] = useState<string | null>(saved == null ? null : FEES.find(f => f.v === saved)?.label ?? null)
  const fee = FEES.find(f => f.label === feeLabel)?.v ?? saved
  const chip = (on: boolean) => `rounded-2xl border-2 px-4 py-3 text-[15px] font-semibold transition active:scale-[.98] ${on ? 'border-[#1a1a2e] bg-[#1a1a2e] text-white' : 'border-[#e4e2dc] bg-white text-[#1a1a2e] hover:border-[#1a1a2e]'}`
  const shipValue = other ? Number(other.replace(',', '.')) : ship

  return (
    <div className="space-y-7">
      <div>
        <p className="mb-3 text-[15px] font-semibold text-[#1a1a2e]">En moyenne, pour une commande</p>
        <div className="flex flex-wrap gap-2">
          {SHIP.map(v => <button key={v} className={chip(!other && ship === v)} onClick={() => { setShip(v); setOther('') }}>{v} €</button>)}
          <label className="relative">
            <span className="sr-only">Autre montant</span>
            <input inputMode="decimal" value={other} placeholder="Autre" onChange={e => setOther(e.target.value)}
              className={`${field} w-28 pr-8 ${other ? 'border-[#1a1a2e]' : ''}`} />
            <span className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 text-[#8a887f]">€</span>
          </label>
        </div>
      </div>
      <div>
        <p className="mb-3 text-[15px] font-semibold text-[#1a1a2e]">Tes clients paient surtout avec</p>
        <div className="flex flex-wrap gap-2">
          {FEES.map(f => (
            <button key={f.label} className={chip(feeLabel === f.label)} onClick={() => setFeeLabel(f.label)}>
              {f.label} <span className="font-normal opacity-70">{f.hint}</span>
            </button>
          ))}
        </div>
      </div>
      <button disabled={busy || !(shipValue && shipValue > 0)} className={btn}
        onClick={() => run({ action: 'costs', shipping: shipValue, feeRate: fee ?? 1.7 }, () => 'C’est noté')}>
        {busy && <Loader2 size={16} className="animate-spin" />} Valider
      </button>
    </div>
  )
}
