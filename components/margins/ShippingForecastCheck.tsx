'use client'

// Contrôle qualité de la prévision de livraison (Coûts logisticien) : pour chaque
// mois clôturé et facturé, ce que le modèle (appris sur les 3 mois précédents)
// aurait prévu « à l'aveugle », comparé au coût réel facturé.
import { useEffect, useRef, useState } from 'react'
import { read, utils } from 'xlsx'
import { Loader2, AlertTriangle, Upload, Check } from 'lucide-react'

type Row = { size: number; orders: number; real: number; predicted: number; errorPct: number | null }
type Month = { month: string; invoicedShare: number; bySize: Row[]; total: Omit<Row, 'size'> }
type Anomaly = { kind: 'poids' | 'léger' | 'préparation'; product: string; compared: string | null; detail: string; perParcel: number; parcelsPerMonth: number; perMonth: number }
type Anomalies = { anomalies: Anomaly[]; window: { from: string; to: string } | null; missingWeights: string[] }
type GridStatus = { grid: { importedAt: string; rows: number; prepPerOrder: number } | null; missingWeights: { title: string; perMonth: number }[]; products: number }

const eur2 = (n: number) => new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n)
const KIND_LABEL: Record<Anomaly['kind'], string> = { poids: 'Transport', léger: 'Poids', préparation: 'Préparation' }

const eur = (n: number) => new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(n)
const monthLabel = (ym: string) => new Date(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)) - 1, 15).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' })
const SIZES = ['1 article', '2 articles', '3 articles', '4 et +']

function Err({ r }: { r: { orders: number; errorPct: number | null } }) {
  if (!r.orders || r.errorPct == null) return <span className="text-[#c8c8c0]">—</span>
  const v = r.errorPct * 100
  const color = Math.abs(v) <= 10 ? '#1a7f4b' : Math.abs(v) <= 20 ? '#b45309' : '#c7293a'
  return (
    <span title={`${r.orders} commande${r.orders > 1 ? 's' : ''}`} style={{ color }} className={r.orders < 20 ? 'opacity-60' : ''}>
      {v > 0 ? '+' : ''}{v.toFixed(1)} %<span className="text-[10px] text-[#9b9b93] ml-1">({r.orders})</span>
    </span>
  )
}

// Coûts anormaux à présenter au logisticien, avec le surcoût estimé par mois.
function AnomaliesCard({ data }: { data: Anomalies | null }) {
  const total = (data?.anomalies ?? []).reduce((s, a) => s + a.perMonth, 0)
  return (
    <div className="bg-white rounded-[20px] shadow-[0_2px_16px_rgba(0,0,0,0.06)] overflow-hidden">
      <div className="px-5 py-4 border-b border-[#f0f0ee] flex items-start justify-between gap-4 flex-wrap">
        <div>
          <p className="text-sm font-semibold text-[#1a1a2e]">Coûts anormaux à vérifier avec le logisticien</p>
          <p className="text-xs text-[#6b6b63] mt-1">
            Comparaison des colis envoyés en France avec un seul produit{data?.window ? `, ventes du ${new Date(data.window.from).toLocaleDateString('fr-FR')} au ${new Date(data.window.to).toLocaleDateString('fr-FR')}` : ''}.
            Surcoût par mois = écart par colis × colis du mois contenant le produit.
          </p>
        </div>
        {total > 0 && (
          <div className="text-right">
            <p className="text-[10px] text-[#9b9b93]">Surcoût total estimé</p>
            <p className="text-lg font-bold tabular-nums text-[#c7293a]">{eur2(total)} / mois</p>
          </div>
        )}
      </div>
      {data == null ? (
        <div className="p-8 flex items-center justify-center gap-2 text-sm text-[#9b9b93]"><Loader2 size={16} className="animate-spin" /> Analyse des factures…</div>
      ) : data.anomalies.length === 0 ? (
        <div className="p-8 text-center text-sm text-[#9b9b93]">Aucun coût anormal repéré.</div>
      ) : (
        <div className="divide-y divide-[#f6f6f4]">
          {data.anomalies.map((a, i) => (
            <div key={i} className="px-5 py-3 flex items-start justify-between gap-4">
              <div className="min-w-0">
                <p className="text-xs font-semibold text-[#1a1a2e]">
                  <span className="inline-block rounded-full px-1.5 py-px text-[9px] font-semibold bg-[#fde8ea] text-[#c7293a] mr-1.5 align-middle">{KIND_LABEL[a.kind]}</span>
                  {a.product}
                </p>
                <p className="text-[11px] text-[#6b6b63] mt-0.5">{a.detail}</p>
              </div>
              <div className="text-right shrink-0">
                <p className="text-sm font-bold tabular-nums text-[#c7293a]">+{eur2(a.perMonth)}<span className="text-[10px] font-medium text-[#9b9b93]"> / mois</span></p>
                <p className="text-[10px] text-[#9b9b93] tabular-nums">{eur2(a.perParcel)} × {Math.round(a.parcelsPerMonth)} colis</p>
              </div>
            </div>
          ))}
        </div>
      )}
      {data && data.missingWeights.length > 0 && (
        <p className="px-5 py-3 border-t border-[#f0f0ee] text-[11px] text-[#b45309]">
          Impossible de comparer au poids : {data.missingWeights.join(', ')} (poids à saisir dans Produits).
        </p>
      )}
    </div>
  )
}

// Import de la grille tarifaire du logisticien (poids × pays). Fichier CSV/Excel avec
// les colonnes : pays (code ISO, ou * pour tous), poids max (kg), prix (€).
function GridCard({ brand }: { brand: string }) {
  const [status, setStatus] = useState<GridStatus | null>(null)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const load = () => fetch(`/api/margins/shipping-grid?brand=${brand}`).then(r => r.ok ? r.json() : null).then(setStatus).catch(() => setStatus(null))
  useEffect(() => { load() }, [brand]) // eslint-disable-line react-hooks/exhaustive-deps

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setBusy(true); setMsg(null)
    try {
      const wb = read(await file.arrayBuffer())
      const raw = utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[wb.SheetNames[0]], { defval: '' })
      const pick = (r: Record<string, unknown>, re: RegExp) => { const k = Object.keys(r).find(k => re.test(k.toLowerCase())); return k ? r[k] : '' }
      const num = (v: unknown) => Number(String(v).replace(/\s/g, '').replace(',', '.').replace(/[^0-9.]/g, ''))
      const rows = raw.map(r => ({ country: String(pick(r, /pays|country|zone/) || '*'), maxKg: num(pick(r, /poids|weight|kg/)), price: num(pick(r, /prix|price|tarif|€/)) }))
      const res = await fetch(`/api/margins/shipping-grid?brand=${brand}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ rows }) })
      const d = await res.json()
      setMsg(res.ok ? { ok: true, text: `Grille importée : ${d.rows} tranches.` } : { ok: false, text: d.error ?? 'Import impossible' })
      await load()
    } catch { setMsg({ ok: false, text: 'Fichier illisible : attendu un CSV ou Excel avec les colonnes pays, poids max (kg), prix (€).' }) }
    finally { setBusy(false); if (fileRef.current) fileRef.current.value = '' }
  }

  const missing = status?.missingWeights ?? []
  const active = !!status?.grid && missing.length === 0
  return (
    <div className="bg-white rounded-[20px] shadow-[0_2px_16px_rgba(0,0,0,0.06)] overflow-hidden">
      <div className="px-5 py-4 border-b border-[#f0f0ee] flex items-start justify-between gap-4 flex-wrap">
        <div>
          <p className="text-sm font-semibold text-[#1a1a2e]">Grille tarifaire du logisticien</p>
          <p className="text-xs text-[#6b6b63] mt-1">
            Avec la grille (prix selon le poids et le pays) et le poids de chaque produit, les commandes pas encore facturées sont estimées à la grille.
            Sans grille, ou si un produit du colis n&apos;a pas de poids, Steero garde l&apos;estimation d&apos;après les factures passées.
          </p>
        </div>
        <button onClick={() => fileRef.current?.click()} disabled={busy}
          className="flex items-center gap-2 px-3.5 py-2 rounded-xl bg-[#1a1a2e] text-white text-xs font-semibold hover:bg-[#2a2a3e] disabled:opacity-40 shrink-0">
          {busy ? <Loader2 size={13} className="animate-spin" /> : <Upload size={13} />}
          {status?.grid ? 'Remplacer la grille' : 'Importer la grille'}
        </button>
        <input ref={fileRef} type="file" accept=".csv,.xlsx,.xls" className="hidden" onChange={onFile} />
      </div>
      <div className="px-5 py-3 space-y-2 text-xs">
        <p className="flex items-center gap-1.5">
          {status?.grid
            ? <><Check size={13} className="text-[#1a7f4b]" /> Grille importée le {new Date(status.grid.importedAt).toLocaleDateString('fr-FR')} ({status.grid.rows} tranches, préparation comptée {eur2(status.grid.prepPerOrder)} par colis).</>
            : <span className="text-[#9b9b93]">Aucune grille importée. Colonnes attendues : pays (FR, BE… ou * pour tous), poids max en kg, prix en €.</span>}
        </p>
        {missing.length > 0 ? (
          <p className="flex items-start gap-1.5 text-[#b45309]">
            <AlertTriangle size={13} className="shrink-0 mt-0.5" />
            <span>Poids manquant dans Produits pour {missing.length} produit{missing.length > 1 ? 's' : ''} vendu{missing.length > 1 ? 's' : ''} : {missing.map(m => `${m.title.split('™')[0]} (${m.perMonth} colis/mois)`).join(', ')}.</span>
          </p>
        ) : status && <p className="text-[#1a7f4b]">Tous les produits vendus ont un poids.</p>}
        <p className={`font-medium ${active ? 'text-[#1a7f4b]' : 'text-[#6b6b63]'}`}>
          {active ? 'Estimation à la grille active.' : 'Estimation actuelle : d’après les factures passées.'}
        </p>
        {msg && <p className={msg.ok ? 'text-[#1a7f4b]' : 'text-[#c7293a]'}>{msg.text}</p>}
      </div>
    </div>
  )
}

export default function ShippingForecastCheck({ brand }: { brand: string }) {
  const [months, setMonths] = useState<Month[] | null>(null)
  const [anomalies, setAnomalies] = useState<Anomalies | null>(null)
  useEffect(() => {
    fetch(`/api/margins/shipping-check?brand=${brand}`).then(r => r.json())
      .then(d => { setMonths(d.months ?? []); setAnomalies(d.anomalies ?? { anomalies: [], window: null, missingWeights: [] }) })
      .catch(() => { setMonths([]); setAnomalies({ anomalies: [], window: null, missingWeights: [] }) })
  }, [brand])

  return (
    <div className="space-y-6">
    <AnomaliesCard data={anomalies} />
    <div className="bg-white rounded-[20px] shadow-[0_2px_16px_rgba(0,0,0,0.06)] overflow-hidden">
      <div className="px-5 py-4 border-b border-[#f0f0ee]">
        <p className="text-sm font-semibold text-[#1a1a2e]">Fiabilité de l&apos;estimation de livraison</p>
        <p className="text-xs text-[#6b6b63] mt-1">
          Tant qu&apos;une commande n&apos;est pas facturée, Steero estime son coût d&apos;après les produits du colis (Marges, tableau de bord).
          Ici, pour chaque mois déjà facturé, ce que l&apos;estimation aurait donné sans connaître la facture (calculée sur les 3 mois d&apos;avant), face au coût réel.
          Écart positif = estimation trop haute.
        </p>
      </div>
      {months == null ? (
        <div className="p-10 flex items-center justify-center gap-2 text-sm text-[#9b9b93]"><Loader2 size={16} className="animate-spin" /> Calcul en cours (première fois : jusqu&apos;à une minute)…</div>
      ) : months.length === 0 ? (
        <div className="p-10 text-center text-sm text-[#9b9b93]">Pas encore assez de mois facturés pour contrôler la prévision.</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-[#9b9b93] border-b border-[#f0f0ee]">
                <th className="text-left font-medium py-2 pl-5">Mois vendu</th>
                <th className="text-right font-medium py-2">Réel facturé</th>
                <th className="text-right font-medium py-2">Prévu</th>
                <th className="text-right font-medium py-2">Écart total</th>
                {SIZES.map(s => <th key={s} className="text-right font-medium py-2 last:pr-5">{s}</th>)}
              </tr>
            </thead>
            <tbody>
              {[...months].reverse().map(m => (
                <tr key={m.month} className="border-b border-[#f6f6f4]">
                  <td className="py-2.5 pl-5 text-[#1a1a2e] font-medium capitalize whitespace-nowrap">
                    {monthLabel(m.month)}
                    {m.invoicedShare < 0.995 && <span className="ml-1.5 text-[10px] font-normal text-[#9b9b93] normal-case">{Math.round(m.invoicedShare * 100)} % facturé</span>}
                  </td>
                  <td className="text-right tabular-nums text-[#6b6b63]">{eur(m.total.real)}</td>
                  <td className="text-right tabular-nums text-[#6b6b63]">{eur(m.total.predicted)}</td>
                  <td className="text-right tabular-nums font-semibold"><Err r={m.total} /></td>
                  {m.bySize.map(r => <td key={r.size} className="text-right tabular-nums last:pr-5"><Err r={r} /></td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="px-5 py-3 border-t border-[#f0f0ee] text-[11px] text-[#9b9b93]">
        Vert : écart ≤ 10 % · orange : ≤ 20 % · rouge : au-delà. Entre parenthèses, le nombre de commandes ; en dessous de 20, l&apos;écart est peu significatif (grisé).
      </p>
    </div>
    <GridCard brand={brand} />
    </div>
  )
}
