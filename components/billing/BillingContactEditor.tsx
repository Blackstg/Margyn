'use client'

// Modale « Modifier le client » : contact de facturation propre à Steero, utilisé
// quand la commande Shopify n'est plus modifiable (ex. facture au nom d'une société).
import { useState } from 'react'
import { X, Loader2, RotateCcw } from 'lucide-react'

type Billing = Record<string, string | undefined>

const FIELDS: { key: string; label: string; placeholder?: string; full?: boolean }[] = [
  { key: 'company',    label: 'Société',              placeholder: 'Raison sociale', full: true },
  { key: 'name',       label: 'Nom du contact',       full: true },
  { key: 'vat_number', label: 'N° de TVA intracom.',  placeholder: 'FR…' },
  { key: 'country',    label: 'Pays' },
  { key: 'address1',   label: 'Adresse',              full: true },
  { key: 'address2',   label: "Complément d'adresse", full: true },
  { key: 'zip',        label: 'Code postal' },
  { key: 'city',       label: 'Ville' },
]

export function BillingContactEditor({ brand, orderId, current, shopify, hasOverride, onClose, onSaved }: {
  brand: string
  orderId: string
  current: Billing | null
  shopify: Billing | null
  hasOverride: boolean
  onClose: () => void
  onSaved: () => void
}) {
  const [form, setForm] = useState<Billing>(() => {
    const f: Billing = {}
    for (const { key } of FIELDS) f[key] = (current?.[key] as string) ?? ''
    return f
  })
  const [saving, setSaving] = useState(false)
  const [error, setError]   = useState<string | null>(null)

  async function call(method: 'PUT' | 'DELETE') {
    setSaving(true); setError(null)
    try {
      const res = await fetch(`/api/billing/orders/${orderId}?brand=${brand}`, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: method === 'PUT' ? JSON.stringify(form) : undefined,
      })
      const d = await res.json().catch(() => ({}))
      if (!res.ok || d.error) throw new Error(d.error ?? `Erreur ${res.status}`)
      onSaved()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" onClick={onClose}>
      <div className="w-full max-w-lg rounded-2xl bg-white shadow-xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-[#f0f0ee] px-5 py-4">
          <div>
            <h2 className="text-sm font-semibold text-[#1a1a2e]">Contact de facturation</h2>
            <p className="text-xs text-[#9b9b93]">Modifie uniquement la facture Steero, pas la commande Shopify.</p>
          </div>
          <button onClick={onClose} className="text-[#9b9b93] hover:text-[#1a1a2e]"><X size={16} /></button>
        </div>

        <div className="grid grid-cols-2 gap-3 px-5 py-4">
          {FIELDS.map(f => (
            <label key={f.key} className={f.full ? 'col-span-2' : 'col-span-1'}>
              <span className="mb-1 block text-xs font-medium text-[#6b6b63]">{f.label}</span>
              <input
                value={form[f.key] ?? ''}
                placeholder={f.placeholder ?? (shopify?.[f.key] as string) ?? ''}
                onChange={e => setForm(p => ({ ...p, [f.key]: e.target.value }))}
                className="w-full rounded-lg border border-[#e8e8e4] px-3 py-2 text-sm text-[#1a1a2e] outline-none focus:border-[#1a1a2e]"
              />
            </label>
          ))}
        </div>

        {error && <div className="mx-5 mb-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{error}</div>}

        <div className="flex items-center justify-between border-t border-[#f0f0ee] px-5 py-3">
          {hasOverride ? (
            <button
              onClick={() => call('DELETE')}
              disabled={saving}
              className="flex items-center gap-1.5 text-xs text-[#6b6b63] hover:text-[#c7293a] disabled:opacity-50"
            >
              <RotateCcw size={12} /> Revenir au contact Shopify
            </button>
          ) : <span />}
          <div className="flex gap-2">
            <button onClick={onClose} className="rounded-xl px-4 py-2 text-sm text-[#6b6b63] hover:bg-[#f3f3f1]">Annuler</button>
            <button
              onClick={() => call('PUT')}
              disabled={saving}
              className="flex items-center gap-2 rounded-xl bg-[#1a1a2e] px-4 py-2 text-sm font-medium text-white hover:bg-[#2d2d4a] disabled:opacity-50"
            >
              {saving && <Loader2 size={13} className="animate-spin" />} Enregistrer
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
