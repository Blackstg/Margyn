'use client'

// Prévision usine (Krom) : lien à partager, aperçu de la page de l'usine
// (/factory/<jeton>) et réglages. Rien à faire chaque mois : les quantités se
// figent seules à la date limite de commande. Calcul : lib/supplierForecast.ts
import { useEffect, useState } from 'react'
import { Loader2, AlertCircle, Copy, Check, ExternalLink, RefreshCw, Settings2 } from 'lucide-react'
import { useBrand } from '@/context/BrandContext'
import FactoryView from '@/components/supplier/FactoryView'
import { BRAND_LABELS } from '@/lib/access'
import type { Forecast, ItemConfig, Lang, SupplierConfig } from '@/lib/supplierForecast'

type Data = { forecast: Forecast; canEdit: boolean; shareUrl: string | null }
type Settings = Pick<SupplierConfig, 'factoryName' | 'lang' | 'productionDays' | 'transitDays' | 'horizonMonths' | 'safetyDays' | 'showStock' | 'seasonality' | 'note' | 'items'>

const MONTHS = ['01', '02', '03', '04', '05', '06', '07', '08', '09', '10', '11', '12']
const MONTH_FR = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.']
const input = 'rounded-[10px] border border-[#e8e8e4] bg-white px-2.5 py-1.5 text-sm'
const n = (v: number) => Math.round(v).toLocaleString('fr-FR')

export default function SupplierPage() {
  const brand = useBrand()
  const [data, setData] = useState<Data | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [reload, setReload] = useState(0)
  const [s, setS] = useState<Settings | null>(null)
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [copied, setCopied] = useState(false)
  const [previewLang, setPreviewLang] = useState<Lang>('fr')

  useEffect(() => {
    setError(null)
    fetch(`/api/supplier?brand=${brand}`, { cache: 'no-store' })
      .then(r => r.json())
      .then((d: Data & { error?: string }) => {
        if (d.error) { setError(d.error); return }
        setData(d)
        const c = d.forecast.config
        setS({
          factoryName: c.factoryName, lang: c.lang, productionDays: c.productionDays, transitDays: c.transitDays,
          horizonMonths: c.horizonMonths, safetyDays: c.safetyDays, showStock: c.showStock, seasonality: c.seasonality, note: c.note,
          items: Object.fromEntries(d.forecast.items.map(i => [i.key, {
            include: i.include, name: c.items[i.key]?.name ?? '', nameZh: c.items[i.key]?.nameZh ?? '',
            sku: c.items[i.key]?.sku ?? '', pack: i.pack,
          } satisfies ItemConfig])),
        })
        setDirty(false)
      })
      .catch(e => setError(String(e)))
  }, [brand, reload])

  const set = (patch: Partial<Settings>) => { setS(prev => prev ? { ...prev, ...patch } : prev); setDirty(true) }
  const setItem = (key: string, patch: Partial<ItemConfig>) => set({ items: { ...s!.items, [key]: { ...s!.items[key], ...patch } } })

  async function save() {
    if (!s) return
    setSaving(true)
    const r = await fetch('/api/supplier', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ brand, ...s }) })
    setSaving(false)
    if (!r.ok) { setError((await r.json().catch(() => ({}))).error ?? 'Erreur'); return }
    setReload(x => x + 1)
  }

  async function rotate() {
    const r = await fetch('/api/supplier', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ brand, action: 'rotate' }) })
    if (!r.ok) { setError((await r.json().catch(() => ({}))).error ?? 'Erreur'); return }
    setReload(x => x + 1)
  }

  const f = data?.forecast
  if (error) return <div className="p-6"><div className="flex items-center gap-2 rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-700"><AlertCircle size={15} />{error}</div></div>
  if (!data || !f || !s) return <div className="flex justify-center py-24"><Loader2 size={22} className="animate-spin text-[#9b9b93]" /></div>

  return (
    <div className="mx-auto max-w-6xl space-y-5 px-4 py-6 sm:px-6">
      <div>
        <h1 className="text-xl font-bold text-[#1a1a2e]">Usine</h1>
        <p className="mt-1 max-w-3xl text-sm text-[#6b6b63]">
          Envoie le lien une fois à l&apos;usine : elle suit tes ventes en direct, la tendance par modèle et le stock à te préparer.
          Rien à gérer : tout se met à jour avec Shopify.
        </p>
      </div>

      {data.shareUrl && (
        <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-[#e8e8e4] bg-white px-4 py-3">
          <input readOnly value={data.shareUrl} className={`${input} min-w-0 flex-1 font-mono text-xs`} onFocus={e => e.target.select()} />
          <button onClick={() => { navigator.clipboard.writeText(data.shareUrl!); setCopied(true); setTimeout(() => setCopied(false), 1500) }}
            className="inline-flex items-center gap-1 rounded-[10px] bg-[#1a1a2e] px-3 py-1.5 text-sm font-semibold text-white">
            {copied ? <Check size={14} /> : <Copy size={14} />} {copied ? 'Copié' : 'Copier le lien'}
          </button>
          <a href={data.shareUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-[10px] border border-[#e8e8e4] px-3 py-1.5 text-sm text-[#1a1a2e]"><ExternalLink size={14} /> Ouvrir</a>
        </div>
      )}

      <div>
        <div className="mb-2 flex justify-end gap-1">
          {(['fr', 'en', 'zh'] as Lang[]).map(l => (
            <button key={l} onClick={() => setPreviewLang(l)}
              className={`rounded-full px-3 py-1 text-xs font-semibold ${previewLang === l ? 'bg-[#1a1a2e] text-white' : 'border border-[#e8e8e4] bg-white text-[#6b6b63]'}`}>
              {l === 'fr' ? 'Français' : l === 'en' ? 'English' : '中文'}
            </button>
          ))}
        </div>
        <div className="rounded-3xl bg-[#f7f7f5] p-4 sm:p-6">
          <FactoryView forecast={f} lang={previewLang} brandLabel={BRAND_LABELS[brand]} />
        </div>
      </div>

      {data.canEdit && (
        <details className="rounded-2xl border border-[#e8e8e4] bg-white px-5 py-4">
          <summary className="flex cursor-pointer items-center gap-2 text-sm font-semibold text-[#1a1a2e]"><Settings2 size={15} /> Réglages</summary>

          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <label className="text-xs text-[#6b6b63]">Nom de l&apos;usine<input className={`${input} mt-1 w-full`} value={s.factoryName} onChange={e => set({ factoryName: e.target.value })} /></label>
            <label className="text-xs text-[#6b6b63]">Langue de sa page
              <select className={`${input} mt-1 w-full`} value={s.lang} onChange={e => set({ lang: e.target.value as Lang })}>
                <option value="en">English</option><option value="zh">中文</option><option value="fr">Français</option>
              </select>
            </label>
            <label className="text-xs text-[#6b6b63]" title="Le « stock à préparer » couvre la fabrication + le transport + ce nombre de mois de ventes">Stock à préparer : mois de ventes<input type="number" step="0.5" min={0.5} max={6} className={`${input} mt-1 w-full`} value={s.horizonMonths} onChange={e => set({ horizonMonths: Number(e.target.value) })} /></label>
            <label className="text-xs text-[#6b6b63]">Sécurité (jours de ventes)<input type="number" className={`${input} mt-1 w-full`} value={s.safetyDays} onChange={e => set({ safetyDays: Number(e.target.value) })} /></label>
            <label className="text-xs text-[#6b6b63]">Fabrication (jours)<input type="number" className={`${input} mt-1 w-full`} value={s.productionDays} onChange={e => set({ productionDays: Number(e.target.value) })} /></label>
            <label className="text-xs text-[#6b6b63]">Transport usine → Forrest (jours)<input type="number" className={`${input} mt-1 w-full`} value={s.transitDays} onChange={e => set({ transitDays: Number(e.target.value) })} /></label>
            <label className="flex items-center gap-2 pt-5 text-xs text-[#6b6b63]"><input type="checkbox" checked={s.showStock} onChange={e => set({ showStock: e.target.checked })} /> Montrer le stock Forrest</label>
          </div>

          <p className="mt-5 text-xs font-semibold text-[#6b6b63]">Saisonnalité (1 = normal, 1,3 = +30 % ; Black Friday / Noël à 1,3 par défaut)</p>
          <div className="mt-1 grid grid-cols-4 gap-2 sm:grid-cols-6 lg:grid-cols-12">
            {MONTHS.map((m, i) => (
              <label key={m} className="text-[11px] text-[#9b9b93]">{MONTH_FR[i]}
                <input type="number" step="0.1" min={0} className={`${input} mt-0.5 w-full px-1.5 text-right`} value={s.seasonality[m] ?? 1}
                  onChange={e => set({ seasonality: { ...s.seasonality, [m]: Number(e.target.value) } })} />
              </label>
            ))}
          </div>

          <p className="mt-5 text-xs font-semibold text-[#6b6b63]">Produits (les petits vendeurs, moins de 5 / mois, sont exclus par défaut)</p>
          <div className="mt-1 overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="text-left text-[11px] text-[#9b9b93]">
                <th className="py-1.5 font-semibold">Dans le plan</th>
                <th className="px-2 py-1.5 font-semibold">Produit</th>
                <th className="px-2 py-1.5 font-semibold">Nom pour l&apos;usine</th>
                <th className="px-2 py-1.5 font-semibold">中文</th>
                <th className="px-2 py-1.5 font-semibold" title="Les quantités sont arrondies à ce multiple">Carton</th>
              </tr></thead>
              <tbody>
                {f.items.map(i => {
                  const it = s.items[i.key]
                  return (
                    <tr key={i.key} className="border-t border-[#f3f3f1] align-top">
                      <td className="py-2"><input type="checkbox" checked={!!it?.include} onChange={e => setItem(i.key, { include: e.target.checked })} /></td>
                      <td className="px-2 py-2">
                        <p className="text-[#1a1a2e]">{i.nameFr} <span className="text-xs text-[#9b9b93]">· ≈ {n(i.perMonth)} / mois</span></p>
                        {i.composition.length > 1 && <p className="text-[11px] text-[#9b9b93]">{i.composition.map(c => `${c.mult > 1 ? `${c.mult} × ` : ''}${c.title}`).join(' · ')}</p>}
                      </td>
                      <td className="px-2 py-2"><input className={`${input} w-56`} placeholder={i.name} value={it?.name ?? ''} onChange={e => setItem(i.key, { name: e.target.value })} /></td>
                      <td className="px-2 py-2"><input className={`${input} w-36`} placeholder={i.nameZh} value={it?.nameZh ?? ''} onChange={e => setItem(i.key, { nameZh: e.target.value })} /></td>
                      <td className="px-2 py-2"><input type="number" min={1} className={`${input} w-20`} value={it?.pack ?? 1} onChange={e => setItem(i.key, { pack: Number(e.target.value) })} /></td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          <label className="mt-5 block text-xs font-semibold text-[#6b6b63]">Message à l&apos;usine (optionnel, sous les 3 étapes)
            <textarea rows={3} className={`${input} mt-1 w-full font-normal`} value={s.note} onChange={e => set({ note: e.target.value })} />
          </label>

          <div className="mt-4 flex flex-wrap items-center gap-2">
            <button disabled={!dirty || saving} onClick={save} className="rounded-[10px] bg-[#1a1a2e] px-4 py-1.5 text-sm font-semibold text-white disabled:opacity-40">
              {saving ? 'Enregistrement…' : 'Enregistrer'}
            </button>
            <button onClick={rotate} title="L'ancien lien ne marchera plus" className="inline-flex items-center gap-1 rounded-[10px] border border-[#e8e8e4] px-3 py-1.5 text-sm text-[#6b6b63]">
              <RefreshCw size={14} /> Changer le lien
            </button>
          </div>
        </details>
      )}
    </div>
  )
}
