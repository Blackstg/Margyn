'use client'

// Prévision usine (Krom) : réglages, validation des batchs et aperçu de la page
// partagée avec l'usine (/factory/<jeton>). Calcul : lib/supplierForecast.ts
import { useEffect, useMemo, useState } from 'react'
import { Loader2, AlertCircle, Copy, Check, ExternalLink, RefreshCw } from 'lucide-react'
import { useBrand } from '@/context/BrandContext'
import FactoryView from '@/components/supplier/FactoryView'
import { BRAND_LABELS } from '@/lib/access'
import type { Forecast, ItemConfig, Lang, SupplierConfig } from '@/lib/supplierForecast'

type Data = { forecast: Forecast; canEdit: boolean; shareUrl: string | null }
type Settings = Pick<SupplierConfig, 'factoryName' | 'lang' | 'productionDays' | 'transitDays' | 'batchDay' | 'nextBatchDate' | 'safetyDays' | 'bufferPct' | 'showStock' | 'seasonality' | 'note' | 'items'>

const MONTHS = ['01', '02', '03', '04', '05', '06', '07', '08', '09', '10', '11', '12']
const MONTH_FR = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.']
const input = 'rounded-[10px] border border-[#e8e8e4] bg-white px-2.5 py-1.5 text-sm'
const card = 'rounded-2xl border border-[#e8e8e4] bg-white px-5 py-4'
const fmtDay = (d: string) => new Date(d + 'T12:00:00Z').toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', timeZone: 'UTC' })
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
  const [lines, setLines] = useState<Record<string, number>>({})
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
          batchDay: c.batchDay, nextBatchDate: c.nextBatchDate ?? '', safetyDays: c.safetyDays, bufferPct: c.bufferPct, showStock: c.showStock,
          seasonality: c.seasonality, note: c.note,
          items: Object.fromEntries(d.forecast.items.map(i => [i.key, {
            include: i.include, name: c.items[i.key]?.name ?? '', nameZh: c.items[i.key]?.nameZh ?? '',
            sku: c.items[i.key]?.sku ?? '', pack: i.pack, moq: i.moq,
          } satisfies ItemConfig])),
        })
        setLines(Object.fromEntries(d.forecast.items.filter(i => i.include).map(i => [i.key, i.confirmed ?? i.nextBatch])))
        setDirty(false)
      })
      .catch(e => setError(String(e)))
  }, [brand, reload])

  const set = (patch: Partial<Settings>) => { setS(prev => prev ? { ...prev, ...patch } : prev); setDirty(true) }
  const setItem = (key: string, patch: Partial<ItemConfig>) =>
    set({ items: { ...s!.items, [key]: { ...s!.items[key], ...patch } } })

  async function save() {
    if (!s) return
    setSaving(true)
    const r = await fetch('/api/supplier', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ brand, ...s }) })
    setSaving(false)
    if (!r.ok) { setError((await r.json().catch(() => ({}))).error ?? 'Erreur'); return }
    setReload(x => x + 1)
  }

  async function post(body: Record<string, unknown>) {
    const r = await fetch('/api/supplier', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ brand, ...body }) })
    if (!r.ok) { setError((await r.json().catch(() => ({}))).error ?? 'Erreur'); return }
    setReload(x => x + 1)
  }

  const f = data?.forecast
  const shown = useMemo(() => f?.items.filter(i => i.include) ?? [], [f])
  const thisBatch = f?.config.batches.find(b => b.date === f.schedule.batchDate && b.status !== 'received')

  if (error) return <div className="p-6"><div className="flex items-center gap-2 rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-700"><AlertCircle size={15} />{error}</div></div>
  if (!data || !f || !s) return <div className="flex justify-center py-24"><Loader2 size={22} className="animate-spin text-[#9b9b93]" /></div>

  return (
    <div className="mx-auto max-w-6xl space-y-5 px-4 py-6 sm:px-6">
      <div>
        <h1 className="text-xl font-bold text-[#1a1a2e]">Usine — un batch par mois + stock tampon</h1>
        <p className="mt-1 max-w-3xl text-sm text-[#6b6b63]">
          L&apos;usine garde un stock tampon prêt (≈ {s.productionDays} jours de ventes) que tu ne paies qu&apos;à l&apos;expédition.
          Chaque mois tu valides un batch ferme ; les deux suivants sont des prévisions pour qu&apos;elle planifie. Elle voit tout sur sa page, mise à jour avec les ventes Shopify.
        </p>
      </div>

      {data.shareUrl && (
        <div className={`${card} flex flex-wrap items-center gap-2`}>
          <p className="w-full text-[10px] font-semibold uppercase tracking-[0.1em] text-[#9b9b93]">Lien à envoyer à l&apos;usine (sans connexion, uniquement des quantités : ni prix, ni CA, ni clients)</p>
          <input readOnly value={data.shareUrl} className={`${input} min-w-0 flex-1 font-mono text-xs`} onFocus={e => e.target.select()} />
          <button onClick={() => { navigator.clipboard.writeText(data.shareUrl!); setCopied(true); setTimeout(() => setCopied(false), 1500) }}
            className="inline-flex items-center gap-1 rounded-[10px] bg-[#1a1a2e] px-3 py-1.5 text-sm font-semibold text-white">
            {copied ? <Check size={14} /> : <Copy size={14} />} {copied ? 'Copié' : 'Copier'}
          </button>
          <a href={data.shareUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-[10px] border border-[#e8e8e4] px-3 py-1.5 text-sm text-[#1a1a2e]"><ExternalLink size={14} /> Ouvrir</a>
          <button onClick={() => post({ action: 'rotate' })} title="L'ancien lien ne marchera plus"
            className="inline-flex items-center gap-1 rounded-[10px] border border-[#e8e8e4] px-3 py-1.5 text-sm text-[#6b6b63]"><RefreshCw size={14} /> Nouveau lien</button>
        </div>
      )}

      {data.canEdit && (
        <div className={card}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-[#1a1a2e]">Batch du {fmtDay(f.schedule.batchDate)} {thisBatch ? '· validé' : '· à valider'}</h2>
            <p className="text-xs text-[#6b6b63]">Commande ferme à envoyer avant le <b>{fmtDay(f.schedule.orderBy)}</b> · arrivée vers le {fmtDay(f.schedule.arrival)}</p>
          </div>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="text-left text-[11px] text-[#9b9b93]">
                <th className="py-1.5 font-semibold">Article</th>
                <th className="px-2 py-1.5 text-right font-semibold">Ventes / mois</th>
                <th className="px-2 py-1.5 text-right font-semibold">Stock France</th>
                <th className="px-2 py-1.5 text-right font-semibold">Rupture</th>
                <th className="px-2 py-1.5 text-right font-semibold">Calcul</th>
                <th className="px-2 py-1.5 text-right font-semibold">Quantité du batch</th>
              </tr></thead>
              <tbody>
                {shown.map(i => (
                  <tr key={i.key} className="border-t border-[#f3f3f1]">
                    <td className="py-1.5 text-[#1a1a2e]">{i.nameFr}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums text-[#6b6b63]">{n(i.perMonth)}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums text-[#6b6b63]">{n(i.stock)}{i.incoming > 0 && ` + ${n(i.incoming)} en route`}</td>
                    <td className={`px-2 py-1.5 text-right tabular-nums ${i.stockoutDate && i.stockoutDate < f.schedule.arrival ? 'font-semibold text-[#c2410c]' : 'text-[#6b6b63]'}`}>{i.stockoutDate ? fmtDay(i.stockoutDate) : '—'}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums text-[#9b9b93]">{n(i.nextBatch)}</td>
                    <td className="px-2 py-1.5 text-right">
                      <input type="number" min={0} value={lines[i.key] ?? 0} className={`${input} w-24 text-right tabular-nums`}
                        onChange={e => setLines(prev => ({ ...prev, [i.key]: Math.max(0, Number(e.target.value) || 0) }))} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button onClick={() => post({ action: 'confirm', date: f.schedule.batchDate, lines })}
              className="rounded-[10px] bg-[#1a1a2e] px-3 py-1.5 text-sm font-semibold text-white">
              {thisBatch ? 'Mettre à jour le batch validé' : 'Valider ce batch (commande ferme)'}
            </button>
            <p className="text-xs text-[#9b9b93]">Une fois validé, l&apos;usine voit « Commande ferme ». Passe-le en « Expédié » au départ : il compte alors comme stock en route. « Reçu » quand le stock est dans Shopify.</p>
          </div>

          {f.config.batches.length > 0 && (
            <div className="mt-4 border-t border-[#f3f3f1] pt-3">
              <h3 className="text-xs font-semibold text-[#6b6b63]">Batchs</h3>
              {f.config.batches.map(b => (
                <div key={b.id} className="flex flex-wrap items-center gap-2 py-1.5 text-sm">
                  <span className="w-20 font-semibold text-[#1a1a2e]">{fmtDay(b.date)}</span>
                  <span className="text-xs text-[#6b6b63]">{Object.values(b.lines).reduce((a, q) => a + q, 0)} unités</span>
                  <select value={b.status} onChange={e => post({ action: 'status', id: b.id, status: e.target.value })} className={`${input} py-1 text-xs`}>
                    <option value="confirmed">Confirmé</option>
                    <option value="shipped">Expédié</option>
                    <option value="received">Reçu</option>
                  </select>
                  <button onClick={() => post({ action: 'delete', id: b.id })} className="text-xs text-[#c7293a] underline">Supprimer</button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {data.canEdit && (
        <div className={card}>
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-[#1a1a2e]">Réglages</h2>
            <button disabled={!dirty || saving} onClick={save}
              className="rounded-[10px] bg-[#1a1a2e] px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-40">
              {saving ? 'Enregistrement…' : 'Enregistrer'}
            </button>
          </div>
          <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <label className="text-xs text-[#6b6b63]">Nom de l&apos;usine<input className={`${input} mt-1 w-full`} value={s.factoryName} onChange={e => set({ factoryName: e.target.value })} /></label>
            <label className="text-xs text-[#6b6b63]">Langue de sa page
              <select className={`${input} mt-1 w-full`} value={s.lang} onChange={e => set({ lang: e.target.value as Lang })}>
                <option value="en">English</option><option value="zh">中文</option><option value="fr">Français</option>
              </select>
            </label>
            <label className="text-xs text-[#6b6b63]">Fabrication (jours)<input type="number" className={`${input} mt-1 w-full`} value={s.productionDays} onChange={e => set({ productionDays: Number(e.target.value) })} /></label>
            <label className="text-xs text-[#6b6b63]">Transport usine → France (jours)<input type="number" className={`${input} mt-1 w-full`} value={s.transitDays} onChange={e => set({ transitDays: Number(e.target.value) })} /></label>
            <label className="text-xs text-[#6b6b63]">Départ du batch le (jour du mois)<input type="number" min={1} max={28} className={`${input} mt-1 w-full`} value={s.batchDay} onChange={e => set({ batchDay: Number(e.target.value) })} /></label>
            <label className="text-xs text-[#6b6b63]" title="Pour un batch d'amorçage plus tôt (ex. rupture avant le batch mensuel). Vide = calendrier mensuel.">Date forcée du prochain batch
              <input type="date" className={`${input} mt-1 w-full`} value={s.nextBatchDate ?? ''} onChange={e => set({ nextBatchDate: e.target.value })} />
            </label>
            <label className="text-xs text-[#6b6b63]">Sécurité côté Krom (jours)<input type="number" className={`${input} mt-1 w-full`} value={s.safetyDays} onChange={e => set({ safetyDays: Number(e.target.value) })} /></label>
            <label className="text-xs text-[#6b6b63]">Marge sur le tampon usine (%)<input type="number" className={`${input} mt-1 w-full`} value={s.bufferPct} onChange={e => set({ bufferPct: Number(e.target.value) })} /></label>
            <label className="flex items-center gap-2 pt-5 text-xs text-[#6b6b63]"><input type="checkbox" checked={s.showStock} onChange={e => set({ showStock: e.target.checked })} /> Montrer le stock France à l&apos;usine</label>
          </div>

          <p className="mt-4 text-xs font-semibold text-[#6b6b63]">Saisonnalité (1 = normal, 1,5 = +50 %). Pas encore d&apos;historique de Noël pour Krom : à régler pour nov./déc.</p>
          <div className="mt-1 grid grid-cols-4 gap-2 sm:grid-cols-6 lg:grid-cols-12">
            {MONTHS.map((m, i) => (
              <label key={m} className="text-[11px] text-[#9b9b93]">{MONTH_FR[i]}
                <input type="number" step="0.1" min={0} className={`${input} mt-0.5 w-full px-1.5 text-right`} value={s.seasonality[m] ?? 1}
                  onChange={e => set({ seasonality: { ...s.seasonality, [m]: Number(e.target.value) } })} />
              </label>
            ))}
          </div>

          <p className="mt-4 text-xs font-semibold text-[#6b6b63]">Articles fabriqués par l&apos;usine</p>
          <div className="mt-1 overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="text-left text-[11px] text-[#9b9b93]">
                <th className="py-1.5 font-semibold">Inclus</th>
                <th className="px-2 py-1.5 font-semibold">Article (variantes Shopify regroupées)</th>
                <th className="px-2 py-1.5 font-semibold">Nom pour l&apos;usine</th>
                <th className="px-2 py-1.5 font-semibold">中文</th>
                <th className="px-2 py-1.5 font-semibold">Réf. usine</th>
                <th className="px-2 py-1.5 font-semibold">Carton</th>
                <th className="px-2 py-1.5 font-semibold">MOQ</th>
              </tr></thead>
              <tbody>
                {f.items.map(i => {
                  const it = s.items[i.key]
                  return (
                    <tr key={i.key} className="border-t border-[#f3f3f1] align-top">
                      <td className="py-1.5"><input type="checkbox" checked={!!it?.include} onChange={e => setItem(i.key, { include: e.target.checked })} /></td>
                      <td className="px-2 py-1.5">
                        <p className="text-[#1a1a2e]">{i.nameFr}</p>
                        <p className="text-[11px] text-[#9b9b93]">{i.composition.map(c => `${c.mult > 1 ? `${c.mult} × ` : ''}${c.title}${c.variant ? ` (${c.variant})` : ''}`).join(' · ')}</p>
                      </td>
                      <td className="px-2 py-1.5"><input className={`${input} w-56`} placeholder={i.name} value={it?.name ?? ''} onChange={e => setItem(i.key, { name: e.target.value })} /></td>
                      <td className="px-2 py-1.5"><input className={`${input} w-36`} placeholder={i.nameZh} value={it?.nameZh ?? ''} onChange={e => setItem(i.key, { nameZh: e.target.value })} /></td>
                      <td className="px-2 py-1.5"><input className={`${input} w-32 font-mono text-xs`} placeholder={i.sku ?? ''} value={it?.sku ?? ''} onChange={e => setItem(i.key, { sku: e.target.value })} /></td>
                      <td className="px-2 py-1.5"><input type="number" min={1} className={`${input} w-16`} value={it?.pack ?? 1} onChange={e => setItem(i.key, { pack: Number(e.target.value) })} /></td>
                      <td className="px-2 py-1.5"><input type="number" min={0} className={`${input} w-20`} value={it?.moq ?? 0} onChange={e => setItem(i.key, { moq: Number(e.target.value) })} /></td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          <label className="mt-4 block text-xs font-semibold text-[#6b6b63]">Conditions du deal (affichées à l&apos;usine, dans sa langue de préférence)
            <textarea rows={4} className={`${input} mt-1 w-full font-normal`} value={s.note} onChange={e => set({ note: e.target.value })} />
          </label>
        </div>
      )}

      <div>
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-[#1a1a2e]">Aperçu de la page usine {dirty && <span className="font-normal text-[#b45309]">(enregistre pour mettre à jour)</span>}</h2>
          <div className="flex gap-1">
            {(['fr', 'en', 'zh'] as Lang[]).map(l => (
              <button key={l} onClick={() => setPreviewLang(l)}
                className={`rounded-full px-3 py-1 text-xs font-semibold ${previewLang === l ? 'bg-[#1a1a2e] text-white' : 'border border-[#e8e8e4] bg-white text-[#6b6b63]'}`}>
                {l === 'fr' ? 'Français' : l === 'en' ? 'English' : '中文'}
              </button>
            ))}
          </div>
        </div>
        <div className="rounded-3xl bg-[#f7f7f5] p-4 sm:p-6">
          <FactoryView forecast={f} lang={previewLang} brandLabel={BRAND_LABELS[brand]} />
        </div>
      </div>
    </div>
  )
}
