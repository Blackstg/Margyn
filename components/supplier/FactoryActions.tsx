'use client'

// Saisies de l'usine sur sa page (lien secret) : son stock prêt pour nous par modèle,
// et « I shipped » pour déclarer un envoi (compté en route jusqu'à la réception).
import { useState } from 'react'
import { useRouter } from 'next/navigation'

async function send(token: string, body: Record<string, unknown>) {
  const r = await fetch(`/api/factory/${encodeURIComponent(token)}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? 'Error')
}

const input = 'rounded-[10px] border border-[#d9d9d3] bg-white px-2.5 py-1.5 text-sm tabular-nums'

export function ReadyEditor({ token, itemKey, value, labels }: {
  token: string; itemKey: string; value: number | null
  labels: { edit: string; save: string; cancel: string; set: string }
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [qty, setQty] = useState(String(value ?? ''))
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  if (!open) return (
    <button onClick={() => { setQty(String(value ?? '')); setOpen(true) }}
      className="rounded-lg border border-[#d9d9d3] bg-white px-2 py-0.5 text-[11px] font-semibold text-[#1a1a2e] hover:border-[#1a1a2e]">
      ✎ {value == null ? labels.set : labels.edit}
    </button>
  )
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <input type="number" min={0} autoFocus value={qty} onChange={e => setQty(e.target.value)} className={`${input} w-24`} />
      <button disabled={busy} onClick={async () => {
        setBusy(true); setErr(null)
        try { await send(token, { action: 'ready', key: itemKey, qty: Number(qty) || 0 }); setOpen(false); router.refresh() }
        catch (e) { setErr(String(e instanceof Error ? e.message : e)) }
        setBusy(false)
      }} className="rounded-lg bg-[#1a1a2e] px-2.5 py-1 text-xs font-semibold text-white disabled:opacity-50">{labels.save}</button>
      <button onClick={() => setOpen(false)} className="text-xs text-[#6b6b63] underline">{labels.cancel}</button>
      {err && <span className="text-xs text-[#b42318]">{err}</span>}
    </span>
  )
}

export function ShipPanel({ token, today, items, recent, labels }: {
  token: string; today: string
  items: { key: string; name: string; image: string | null; urgent: number }[]
  recent: { id: string; date: string; text: string; canUndo: boolean }[]
  labels: { button: string; title: string; date: string; send: string; cancel: string; undo: string; recent: string; hint: string }
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [date, setDate] = useState(today)
  const [lines, setLines] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  async function submit() {
    setBusy(true); setErr(null)
    try {
      await send(token, { action: 'ship', date, lines: Object.fromEntries(Object.entries(lines).map(([k, v]) => [k, Number(v) || 0])) })
      setOpen(false); setLines({}); router.refresh()
    } catch (e) { setErr(String(e instanceof Error ? e.message : e)) }
    setBusy(false)
  }

  return (
    <div className="rounded-3xl border border-[#e8e8e4] bg-white px-5 py-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-[#6b6b63]">{labels.hint}</p>
        {!open && (
          <button onClick={() => setOpen(true)} className="rounded-2xl bg-[#1a1a2e] px-4 py-2.5 text-sm font-semibold text-white shadow-sm">🚚 {labels.button}</button>
        )}
      </div>

      {open && (
        <div className="mt-4 space-y-3">
          <p className="font-semibold text-[#1a1a2e]">{labels.title}</p>
          <div className="grid gap-2 sm:grid-cols-2">
            {items.map(i => (
              <label key={i.key} className="flex items-center gap-3 rounded-2xl border border-[#f0f0ec] px-3 py-2">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-[#f3f3f1]">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  {i.image ? <img src={i.image} alt="" className="h-full w-full object-contain p-0.5" /> : '📦'}
                </span>
                <span className="min-w-0 flex-1 text-sm text-[#1a1a2e]">{i.name}</span>
                <input type="number" min={0} placeholder={i.urgent ? String(i.urgent) : '0'} value={lines[i.key] ?? ''}
                  onChange={e => setLines(prev => ({ ...prev, [i.key]: e.target.value }))} className={`${input} w-20 text-right`} />
              </label>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <label className="text-xs text-[#6b6b63]">{labels.date} <input type="date" value={date} onChange={e => setDate(e.target.value)} className={`${input} ml-1`} /></label>
            <button disabled={busy} onClick={submit} className="rounded-xl bg-[#1a1a2e] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{labels.send}</button>
            <button onClick={() => setOpen(false)} className="text-sm text-[#6b6b63] underline">{labels.cancel}</button>
            {err && <span className="text-sm text-[#b42318]">{err}</span>}
          </div>
        </div>
      )}

      {recent.length > 0 && (
        <div className="mt-4 border-t border-[#f3f3f1] pt-3">
          <p className="text-xs font-semibold text-[#6b6b63]">{labels.recent}</p>
          {recent.map(r => (
            <p key={r.id} className="mt-1 flex flex-wrap items-center gap-2 text-sm text-[#4a4a44]">
              <span className="font-semibold text-[#1a1a2e]">{r.date}</span> {r.text}
              {r.canUndo && (
                <button onClick={async () => { try { await send(token, { action: 'unship', id: r.id }); router.refresh() } catch (e) { setErr(String(e)) } }}
                  className="text-xs text-[#6b6b63] underline">{labels.undo}</button>
              )}
            </p>
          ))}
        </div>
      )}
    </div>
  )
}
