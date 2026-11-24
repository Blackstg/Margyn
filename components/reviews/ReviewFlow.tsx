'use client'

// Parcours d'avis client : note 1-5 → 4-5 : invitation Trustpilot ; 1-3 : retour
// interne (le lien Trustpilot reste accessible en bas : pas de « review gating »,
// conforme aux règles Trustpilot). Couleurs = celles de la marque (REVIEW_CONFIG).
import { useEffect, useRef, useState, type FormEvent } from 'react'
import type { ReviewBranding } from '@/lib/reviews'
import { REVIEW_CATEGORIES } from '@/lib/reviews-shared'

type Step = 'rate' | 'positive' | 'negative' | 'thanks-positive' | 'thanks-negative' | 'already'

const WORDS = ['', 'Très déçu(e)', 'Déçu(e)', 'Correct, sans plus', 'Bien', 'Parfait']

export default function ReviewFlow({ brand, branding, refCode, firstName, hasOrderEmail, source, initialRating, alreadyDone }: {
  brand: string
  branding: ReviewBranding
  refCode: string | null
  firstName: string | null
  hasOrderEmail: boolean
  source: string | null
  initialRating: number | null
  alreadyDone: number | null
}) {
  const { ink, bg, soft } = branding
  const [step, setStep] = useState<Step>(alreadyDone && !initialRating ? 'already' : 'rate')
  const [rating, setRating] = useState<number | null>(null)
  const [hover, setHover] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const ids = useRef<{ id: string; key: string } | null>(null)
  const autoRated = useRef(false)

  async function post(payload: Record<string, unknown>) {
    const res = await fetch(`/api/avis/${brand}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(ids.current ? { ...ids.current, ...payload } : { ref: refCode, source, ...payload }),
    })
    if (!res.ok) throw new Error(String(res.status))
    const j = await res.json() as { id: string; key: string }
    ids.current = { id: j.id, key: j.key }
  }

  async function rate(n: number) {
    if (busy) return
    setRating(n); setBusy(true); setError(null)
    try {
      await post({ rating: n })
      setStep(n >= 4 ? 'positive' : 'negative')
    } catch {
      setError('Votre note n’a pas pu être enregistrée. Vérifiez votre connexion et réessayez.')
    } finally { setBusy(false) }
  }

  // Note choisie directement dans le mail (?note=4) : on l'enregistre d'office.
  useEffect(() => {
    if (initialRating && !autoRated.current) { autoRated.current = true; void rate(initialRating) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function finish(extra: Record<string, unknown>, next: Step) {
    setBusy(true); setError(null)
    try {
      await post({ ...extra, completed: true })
      setStep(next)
    } catch {
      setError('Votre réponse n’a pas pu être envoyée. Réessayez dans un instant.')
    } finally { setBusy(false) }
  }

  const hello = firstName ? `Bonjour ${firstName},` : 'Bonjour,'

  return (
    <main className="min-h-[100dvh] w-full flex flex-col" style={{ background: bg, color: ink }}>
      <header className="px-5 pt-8 pb-4 flex justify-center">
        <a href={branding.site} target="_blank" rel="noopener noreferrer" aria-label={branding.name}>
          {branding.logo
            // eslint-disable-next-line @next/next/no-img-element
            ? <img src={branding.logo} alt={branding.name} className="h-8 w-auto object-contain" />
            : <span className="text-lg font-semibold">{branding.name}</span>}
        </a>
      </header>

      <section className="flex-1 flex items-start sm:items-center justify-center px-5 pb-16 pt-6">
        <div className="w-full max-w-[26rem]">
          {error && (
            <p role="alert" className="mb-6 rounded-xl px-4 py-3 text-sm" style={{ background: '#fdecec', color: '#8a1c1c' }}>{error}</p>
          )}

          {step === 'rate' && (
            <div className="text-center">
              <h1 className="text-[1.7rem] leading-tight font-semibold">{hello}</h1>
              <p className="mt-3 text-base opacity-70">Comment s’est passée votre expérience avec {branding.name}&nbsp;?</p>

              <div className="mt-10 flex justify-center gap-1.5" role="radiogroup" aria-label="Votre note sur 5" onMouseLeave={() => setHover(null)}>
                {[1, 2, 3, 4, 5].map(n => {
                  const lit = (hover ?? rating ?? 0) >= n
                  return (
                    <button key={n} type="button" role="radio" aria-checked={rating === n} aria-label={`${n} sur 5 — ${WORDS[n]}`}
                      disabled={busy} onClick={() => rate(n)} onMouseEnter={() => setHover(n)} onFocus={() => setHover(n)} onBlur={() => setHover(null)}
                      className="p-1 rounded-lg transition-transform duration-150 hover:scale-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:cursor-wait"
                      style={{ ['--tw-ring-color' as string]: ink, ['--tw-ring-offset-color' as string]: bg }}>
                      <Star filled={lit} color={ink} />
                    </button>
                  )
                })}
              </div>
              <p className="mt-4 h-5 text-sm font-medium" aria-live="polite">
                {busy ? 'Enregistrement…' : WORDS[hover ?? rating ?? 0] || <span className="opacity-40">Touchez une étoile</span>}
              </p>
            </div>
          )}

          {step === 'positive' && (
            <div className="text-center">
              <h1 className="text-[1.7rem] leading-tight font-semibold">Merci{firstName ? ` ${firstName}` : ''}, ça nous fait très plaisir&nbsp;!</h1>
              <p className="mt-3 opacity-70 leading-relaxed">
                Pourriez-vous le dire en quelques mots sur Trustpilot&nbsp;? C’est ce qui aide le plus les futurs clients à nous faire confiance.
              </p>
              <a href={branding.trustpilot} target="_blank" rel="noopener noreferrer"
                onClick={() => { void finish({ trustpilot_clicked: true }, 'thanks-positive') }}
                className="mt-8 flex items-center justify-center gap-2.5 w-full rounded-2xl py-4 px-6 font-semibold text-white transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2"
                style={{ background: '#00B67A', ['--tw-ring-color' as string]: '#00B67A', ['--tw-ring-offset-color' as string]: bg }}>
                <TrustpilotMark /> Laisser mon avis sur Trustpilot
              </a>
              <p className="mt-3 text-xs opacity-50">Ouvre Trustpilot dans un nouvel onglet</p>
              <button type="button" disabled={busy} onClick={() => finish({}, 'thanks-positive')}
                className="mt-8 text-sm underline underline-offset-4 opacity-60 hover:opacity-100 transition-opacity">
                Non merci
              </button>
              <BackLink onClick={() => setStep('rate')} />
            </div>
          )}

          {step === 'negative' && (
            <NegativeForm ink={ink} bg={bg} soft={soft} busy={busy} askEmail={!hasOrderEmail}
              onSubmit={d => finish(d, 'thanks-negative')} onBack={() => setStep('rate')} trustpilot={branding.trustpilot} />
          )}

          {step === 'thanks-positive' && (
            <Thanks title={`Merci${firstName ? ` ${firstName}` : ''} !`}
              text={`Toute l’équipe ${branding.name} vous remercie pour votre confiance.`} site={branding.site} ink={ink} />
          )}

          {step === 'thanks-negative' && (
            <Thanks title="Message bien reçu"
              text={`L’équipe ${branding.name} lit chaque retour. Si vous avez demandé à être recontacté(e), nous revenons vers vous très vite pour trouver une solution.`} site={branding.site} ink={ink} />
          )}

          {step === 'already' && (
            <div className="text-center">
              <h1 className="text-[1.7rem] leading-tight font-semibold">Vous nous avez déjà donné votre avis</h1>
              <p className="mt-3 opacity-70">Merci{firstName ? ` ${firstName}` : ''}&nbsp;! Vous pouvez le modifier si vous le souhaitez.</p>
              {alreadyDone && alreadyDone >= 4 && (
                <a href={branding.trustpilot} target="_blank" rel="noopener noreferrer"
                  className="mt-8 flex items-center justify-center gap-2.5 w-full rounded-2xl py-4 px-6 font-semibold text-white" style={{ background: '#00B67A' }}>
                  <TrustpilotMark /> Laisser mon avis sur Trustpilot
                </a>
              )}
              <button type="button" onClick={() => setStep('rate')} className="mt-6 text-sm underline underline-offset-4 opacity-60 hover:opacity-100">
                Changer ma note
              </button>
            </div>
          )}
        </div>
      </section>
    </main>
  )
}

function NegativeForm({ ink, bg, soft, busy, askEmail, onSubmit, onBack, trustpilot }: {
  ink: string; bg: string; soft: string; busy: boolean; askEmail: boolean; trustpilot: string
  onSubmit: (d: Record<string, unknown>) => void; onBack: () => void
}) {
  const [cats, setCats] = useState<string[]>([])
  const [comment, setComment] = useState('')
  const [contact, setContact] = useState(false)
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const [err, setErr] = useState<string | null>(null)

  function submit(e: FormEvent) {
    e.preventDefault()
    if (!cats.length && !comment.trim()) { setErr('Choisissez ce qui n’a pas été, ou écrivez-nous quelques mots.'); return }
    if (contact && askEmail && !phone.trim() && !email.trim()) { setErr('Laissez un téléphone ou un e-mail pour qu’on puisse vous recontacter.'); return }
    setErr(null)
    onSubmit({ categories: cats, comment, contact_requested: contact, contact_phone: contact ? phone : '', contact_email: contact ? email : '' })
  }

  const field = 'w-full rounded-xl px-4 py-3 text-[15px] bg-white border outline-none focus:ring-2 transition-shadow'
  const fieldStyle = { borderColor: soft, ['--tw-ring-color' as string]: ink } as React.CSSProperties

  return (
    <form onSubmit={submit} noValidate>
      <h1 className="text-[1.7rem] leading-tight font-semibold text-center">Désolés, ce n’était pas à la hauteur</h1>
      <p className="mt-3 opacity-70 text-center leading-relaxed">Dites-nous ce qui s’est passé&nbsp;: votre message arrive directement à l’équipe.</p>

      <fieldset className="mt-8">
        <legend className="text-sm font-semibold mb-3">Qu’est-ce qui n’a pas été&nbsp;?</legend>
        <div className="flex flex-wrap gap-2">
          {REVIEW_CATEGORIES.map(c => {
            const on = cats.includes(c.id)
            return (
              <button key={c.id} type="button" aria-pressed={on}
                onClick={() => setCats(p => on ? p.filter(x => x !== c.id) : [...p, c.id])}
                className="rounded-full px-4 py-2 text-sm font-medium border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2"
                style={{ background: on ? ink : 'transparent', color: on ? bg : ink, borderColor: on ? ink : soft, ['--tw-ring-color' as string]: ink, ['--tw-ring-offset-color' as string]: bg }}>
                {c.label}
              </button>
            )
          })}
        </div>
      </fieldset>

      <label className="block mt-6">
        <span className="text-sm font-semibold">Racontez-nous <span className="font-normal opacity-50">(facultatif)</span></span>
        <textarea value={comment} onChange={e => setComment(e.target.value)} rows={4} maxLength={2000}
          placeholder="Ce qui s’est passé, ce qu’on aurait pu mieux faire…" className={`${field} mt-2 resize-none`} style={fieldStyle} />
      </label>

      <label className="mt-5 flex items-start gap-3 cursor-pointer">
        <input type="checkbox" checked={contact} onChange={e => setContact(e.target.checked)} className="mt-1 h-4 w-4" style={{ accentColor: ink }} />
        <span className="text-[15px]">Je souhaite être recontacté(e)</span>
      </label>
      {contact && (
        <div className="mt-3 space-y-3">
          <input type="tel" value={phone} onChange={e => setPhone(e.target.value)} maxLength={30} autoComplete="tel"
            placeholder={askEmail ? 'Téléphone' : 'Téléphone (facultatif, sinon on vous répond par e-mail)'} className={field} style={fieldStyle} />
          {askEmail && (
            <input type="email" value={email} onChange={e => setEmail(e.target.value)} maxLength={200} autoComplete="email"
              placeholder="E-mail" className={field} style={fieldStyle} />
          )}
        </div>
      )}

      {err && <p role="alert" className="mt-4 text-sm" style={{ color: '#8a1c1c' }}>{err}</p>}

      <button type="submit" disabled={busy}
        className="mt-7 w-full rounded-2xl py-4 font-semibold transition-opacity disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2"
        style={{ background: ink, color: bg, ['--tw-ring-color' as string]: ink, ['--tw-ring-offset-color' as string]: bg }}>
        {busy ? 'Envoi…' : 'Envoyer à l’équipe'}
      </button>

      <BackLink onClick={onBack} />
      <p className="mt-10 text-center text-xs opacity-40">
        Vous préférez laisser un avis public&nbsp;? <a href={trustpilot} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2">Trustpilot</a>
      </p>
    </form>
  )
}

function Thanks({ title, text, site, ink }: { title: string; text: string; site: string; ink: string }) {
  return (
    <div className="text-center">
      <svg className="mx-auto" width="56" height="56" viewBox="0 0 56 56" fill="none" aria-hidden>
        <circle cx="28" cy="28" r="27" stroke={ink} strokeOpacity=".15" strokeWidth="2" />
        <path d="M18 29l7 7 13-15" stroke={ink} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <h1 className="mt-6 text-[1.7rem] leading-tight font-semibold">{title}</h1>
      <p className="mt-3 opacity-70 leading-relaxed">{text}</p>
      <a href={site} className="mt-8 inline-block text-sm underline underline-offset-4 opacity-60 hover:opacity-100">Retour sur le site</a>
    </div>
  )
}

function BackLink({ onClick }: { onClick: () => void }) {
  return (
    <p className="mt-6 text-center">
      <button type="button" onClick={onClick} className="text-sm opacity-50 hover:opacity-90 transition-opacity">‹ Modifier ma note</button>
    </p>
  )
}

function Star({ filled, color }: { filled: boolean; color: string }) {
  return (
    <svg width="46" height="46" viewBox="0 0 24 24" aria-hidden>
      <path d="M12 2.8l2.75 5.6 6.15.9-4.45 4.33 1.05 6.12L12 16.87l-5.5 2.88 1.05-6.12L3.1 9.3l6.15-.9L12 2.8z"
        fill={filled ? color : 'transparent'} stroke={color} strokeOpacity={filled ? 1 : 0.35} strokeWidth="1.4" strokeLinejoin="round"
        style={{ transition: 'fill .15s, stroke-opacity .15s' }} />
    </svg>
  )
}

function TrustpilotMark() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M12 2l2.4 7.4H22l-6.2 4.5 2.4 7.4L12 17l-6.2 3.9 2.4-7.4L2 9.4h7.6L12 2z" />
    </svg>
  )
}
