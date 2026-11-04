// Vue « usine » : plan de production partagé avec le fabricant (page publique
// /factory/[token]) et aperçu dans la page interne. Sans hooks → rendu serveur ou client.
// Uniquement des unités : jamais de prix, de CA ni de clients.
import type { Forecast, ItemForecast, Lang } from '@/lib/supplierForecast'

const T = {
  en: {
    plan: 'Production plan', updated: 'Updated', nextBatch: 'Next batch', ships: 'Ready to ship on',
    orderBy: 'Firm order confirmed by', arrives: 'arrives in France around', firm: 'Firm order', proposal: 'Proposal — to be confirmed',
    units: 'units', buffer: 'Buffer stock to keep ready', bufferHint: 'finished goods, ready to ship at any time',
    forecastHint: 'forecast, not a firm order', item: 'Item', avg: 'Sales / month', next: 'Next batch',
    b1: 'Batch +1', b2: 'Batch +2', stock: 'Stock in France', stockout: 'runs out around', monthly: 'Monthly sales (units)', sold: 'sold',
    forecastLbl: 'forecast', partial: 'month in progress', terms: 'How it works', history: 'Batches', status: 'Status',
    confirmed: 'Confirmed', shipped: 'Shipped', received: 'Received', total: 'Total', none: 'No batch yet.',
    method: (p: number, t: number, b: number) => `Forecast = recent daily sales (60 % last 30 days, 40 % last 90 days). Each batch covers one month of sales until the next batch arrives. Buffer = ${p} production days of sales + ${b} %. Transit to France: ~${t} days.`,
    lateWarn: 'Some items will run out before the next batch arrives: please ship them from the buffer stock as soon as possible.',
  },
  zh: {
    plan: '生产计划', updated: '更新于', nextBatch: '下一批货', ships: '发货日期',
    orderBy: '确认订单截止', arrives: '预计到达法国', firm: '确认订单', proposal: '建议数量 — 待确认',
    units: '件', buffer: '需常备的缓冲库存', bufferHint: '成品，随时可以发货',
    forecastHint: '预测，非正式订单', item: '产品', avg: '月销量', next: '下一批',
    b1: '第 +1 批', b2: '第 +2 批', stock: '法国库存', stockout: '预计售罄', monthly: '月销量（件）', sold: '已售',
    forecastLbl: '预测', partial: '本月进行中', terms: '合作方式', history: '批次记录', status: '状态',
    confirmed: '已确认', shipped: '已发货', received: '已收货', total: '合计', none: '暂无批次。',
    method: (p: number, t: number, b: number) => `预测 = 近期日均销量（最近30天占60%，最近90天占40%）。每批货覆盖到下一批到货前一个月的销量。缓冲库存 = ${p} 天生产期间的销量 + ${b}%。运往法国约 ${t} 天。`,
    lateWarn: '部分产品将在下一批到货前售罄：请尽快从缓冲库存中发货。',
  },
  fr: {
    plan: 'Plan de production', updated: 'Mis à jour le', nextBatch: 'Prochain batch', ships: 'Prêt à partir le',
    orderBy: 'Commande ferme confirmée avant le', arrives: 'arrivée en France vers le', firm: 'Commande ferme', proposal: 'Proposition — à confirmer',
    units: 'unités', buffer: 'Stock tampon à garder prêt', bufferHint: 'produits finis, prêts à partir à tout moment',
    forecastHint: 'prévision, pas une commande ferme', item: 'Article', avg: 'Ventes / mois', next: 'Prochain batch',
    b1: 'Batch +1', b2: 'Batch +2', stock: 'Stock France', stockout: 'rupture vers le', monthly: 'Ventes mensuelles (unités)', sold: 'vendu',
    forecastLbl: 'prévision', partial: 'mois en cours', terms: 'Fonctionnement', history: 'Batchs', status: 'Statut',
    confirmed: 'Confirmé', shipped: 'Expédié', received: 'Reçu', total: 'Total', none: 'Aucun batch pour l’instant.',
    method: (p: number, t: number, b: number) => `Prévision = ventes par jour récentes (60 % sur 30 jours, 40 % sur 90 jours). Chaque batch couvre un mois de ventes jusqu'à l'arrivée du suivant. Tampon = ${p} jours de fabrication de ventes + ${b} %. Transport vers la France : ~${t} jours.`,
    lateWarn: 'Certains articles seront en rupture avant l’arrivée du prochain batch : à expédier au plus vite depuis le stock tampon.',
  },
} as const

const LOCALE: Record<Lang, string> = { en: 'en-GB', zh: 'zh-CN', fr: 'fr-FR' }
const fmtDay = (day: string, lang: Lang) => new Date(day + 'T12:00:00Z').toLocaleDateString(LOCALE[lang], { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })
const fmtMonth = (month: string, lang: Lang) => new Date(month + '-15T12:00:00Z').toLocaleDateString(LOCALE[lang], { month: 'short', timeZone: 'UTC' })
const n = (v: number) => Math.round(v).toLocaleString('fr-FR')
const nameOf = (i: ItemForecast, lang: Lang) => lang === 'zh' ? i.nameZh : lang === 'fr' ? i.nameFr : i.name

// Barre arrondie en haut seulement, posée sur la ligne de base
function barPath(x: number, y: number, w: number, h: number) {
  const r = Math.min(4, w / 2, h)
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`
}

function SalesChart({ item, lang }: { item: ItemForecast; lang: Lang }) {
  const t = T[lang]
  const bars = [
    ...item.history.map(h => ({ month: h.month, units: h.units, kind: h.partial ? 'partial' as const : 'actual' as const })),
    ...item.forecast.map(f => ({ month: f.month, units: f.units, kind: 'forecast' as const })),
  ].slice(-12)
  const W = 320, H = 120, top = 16, bottom = 18, gap = 2
  const max = Math.max(5, ...bars.map(b => b.units))   // évite qu'1 ou 2 unités remplissent le graphe
  const bw = (W - gap * (bars.length - 1)) / bars.length
  const lastActual = [...bars].reverse().find(b => b.kind === 'actual')
  const firstForecast = bars.find(b => b.kind === 'forecast')
  const pid = `hatch-${item.key}`
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" role="img" aria-label={`${t.monthly} — ${nameOf(item, lang)}`}>
      <defs>
        <pattern id={pid} width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <rect width="6" height="6" fill="#e3e6f0" />
          <line x1="0" y1="0" x2="0" y2="6" stroke="#5b6b9a" strokeWidth="2" />
        </pattern>
      </defs>
      <line x1="0" x2={W} y1={H - bottom} y2={H - bottom} stroke="#e8e8e4" />
      {bars.map((b, i) => {
        const h = (b.units / max) * (H - top - bottom)
        const x = i * (bw + gap), y = H - bottom - h
        const fill = b.kind === 'forecast' ? `url(#${pid})` : b.kind === 'partial' ? '#9aa3c2' : '#2c3a66'
        const label = b === lastActual || b === firstForecast
        return (
          <g key={b.month}>
            <title>{`${fmtMonth(b.month, lang)} : ${n(b.units)} ${t.units}${b.kind === 'forecast' ? ` (${t.forecastLbl})` : b.kind === 'partial' ? ` (${t.partial})` : ''}`}</title>
            <rect x={x} y={top - 4} width={bw} height={H - top - bottom + 4} fill="transparent" />
            {h > 0 && <path d={barPath(x, y, bw, h)} fill={fill} />}
            {label && <text x={x + bw / 2} y={y - 4} textAnchor="middle" fontSize="10" fontWeight="600" fill="#1a1a2e">{n(b.units)}</text>}
            <text x={x + bw / 2} y={H - 5} textAnchor="middle" fontSize="9" fill="#9b9b93">{fmtMonth(b.month, lang).replace('.', '')}</text>
          </g>
        )
      })}
    </svg>
  )
}

export default function FactoryView({ forecast, lang, brandLabel }: { forecast: Forecast; lang: Lang; brandLabel: string }) {
  const t = T[lang]
  const c = forecast.config
  const items = forecast.items.filter(i => i.include)
  const s = forecast.schedule
  const isFirm = items.some(i => i.confirmed != null)
  const qtyNext = (i: ItemForecast) => i.confirmed ?? i.nextBatch
  const totalNext = items.reduce((a, i) => a + qtyNext(i), 0)
  const totalBuffer = items.reduce((a, i) => a + i.buffer, 0)
  const statusLbl = { confirmed: t.confirmed, shipped: t.shipped, received: t.received }
  const nameByKey = new Map(forecast.items.map(i => [i.key, nameOf(i, lang)]))

  return (
    <div className="space-y-5">
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[#9b9b93]">{brandLabel}{c.factoryName ? ` × ${c.factoryName}` : ''}</p>
        <h1 className="text-2xl font-bold text-[#1a1a2e]">{t.plan}</h1>
        <p className="text-xs text-[#9b9b93]">{t.updated} {fmtDay(forecast.today, lang)}</p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-2xl bg-[#1a1a2e] px-5 py-4 text-white">
          <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-white/50">{t.nextBatch} · {isFirm ? t.firm : t.proposal}</p>
          <p className="mt-1 text-3xl font-bold tabular-nums">{n(totalNext)} <span className="text-sm font-medium text-white/50">{t.units}</span></p>
          <p className="mt-1 text-xs text-white/70">{t.ships} <b className="text-white">{fmtDay(s.batchDate, lang)}</b></p>
          <p className="text-[11px] text-white/50">{t.orderBy} {fmtDay(s.orderBy, lang)} · {t.arrives} {fmtDay(s.arrival, lang)}</p>
        </div>
        <div className="rounded-2xl border border-[#e8e8e4] bg-white px-5 py-4">
          <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-[#9b9b93]">{t.buffer}</p>
          <p className="mt-1 text-3xl font-bold tabular-nums text-[#1a1a2e]">{n(totalBuffer)} <span className="text-sm font-medium text-[#9b9b93]">{t.units}</span></p>
          <p className="mt-1 text-xs text-[#6b6b63]">{t.bufferHint}</p>
        </div>
      </div>

      {forecast.lateWarning && (
        <p className="rounded-xl border border-[#fcd9b6] bg-[#fff7ed] px-4 py-3 text-sm text-[#9a3412]">⚠ {t.lateWarn}</p>
      )}

      <div className="overflow-x-auto rounded-2xl border border-[#e8e8e4] bg-white">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-[11px] text-[#9b9b93]">
              <th className="px-4 py-2.5 font-semibold">{t.item}</th>
              <th className="px-3 py-2.5 text-right font-semibold">{t.avg}</th>
              <th className="px-3 py-2.5 text-right font-semibold text-[#1a1a2e]">{t.next}<span className="block font-normal">{fmtDay(s.batchDate, lang)}</span></th>
              <th className="px-3 py-2.5 text-right font-semibold">{t.buffer}</th>
              <th className="px-3 py-2.5 text-right font-semibold">{t.b1}<span className="block font-normal">{fmtDay(s.following[0].batchDate, lang)}</span></th>
              <th className="px-3 py-2.5 text-right font-semibold">{t.b2}<span className="block font-normal">{fmtDay(s.following[1].batchDate, lang)}</span></th>
              {c.showStock && <th className="px-4 py-2.5 text-right font-semibold">{t.stock}</th>}
            </tr>
          </thead>
          <tbody>
            {items.map(i => (
              <tr key={i.key} className="border-t border-[#f3f3f1]">
                <td className="px-4 py-2.5">
                  <p className="font-semibold text-[#1a1a2e]">{nameOf(i, lang)}</p>
                  {i.sku && <p className="font-mono text-[11px] text-[#9b9b93]">{i.sku}</p>}
                </td>
                <td className="px-3 py-2.5 text-right tabular-nums text-[#6b6b63]">{n(i.perMonth)}</td>
                <td className="px-3 py-2.5 text-right text-base font-bold tabular-nums text-[#1a1a2e]">{n(qtyNext(i))}</td>
                <td className="px-3 py-2.5 text-right font-semibold tabular-nums text-[#1a1a2e]">{n(i.buffer)}</td>
                <td className="px-3 py-2.5 text-right tabular-nums text-[#6b6b63]">~{n(i.following[0])}</td>
                <td className="px-3 py-2.5 text-right tabular-nums text-[#6b6b63]">~{n(i.following[1])}</td>
                {c.showStock && (
                  <td className="px-4 py-2.5 text-right tabular-nums text-[#6b6b63]">
                    {n(i.stock)}{i.incoming > 0 && <span className="text-[11px]"> +{n(i.incoming)}</span>}
                    {i.stockoutDate && <span className={`block whitespace-nowrap text-[11px] ${i.stockoutDate < s.arrival ? 'font-semibold text-[#c2410c]' : 'text-[#9b9b93]'}`}>{t.stockout} {fmtDay(i.stockoutDate, lang)}</span>}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-[#e8e8e4] font-semibold">
              <td className="px-4 py-2.5 text-[#6b6b63]">{t.total}</td>
              <td className="px-3 py-2.5 text-right tabular-nums text-[#6b6b63]">{n(items.reduce((a, i) => a + i.perMonth, 0))}</td>
              <td className="px-3 py-2.5 text-right tabular-nums text-[#1a1a2e]">{n(totalNext)}</td>
              <td className="px-3 py-2.5 text-right tabular-nums text-[#1a1a2e]">{n(totalBuffer)}</td>
              <td className="px-3 py-2.5 text-right tabular-nums text-[#6b6b63]">~{n(items.reduce((a, i) => a + i.following[0], 0))}</td>
              <td className="px-3 py-2.5 text-right tabular-nums text-[#6b6b63]">~{n(items.reduce((a, i) => a + i.following[1], 0))}</td>
              {c.showStock && <td className="px-4 py-2.5 text-right tabular-nums text-[#6b6b63]">{n(items.reduce((a, i) => a + i.stock, 0))}</td>}
            </tr>
          </tfoot>
        </table>
        <p className="border-t border-[#f3f3f1] px-4 py-2 text-[11px] text-[#9b9b93]">{t.b1} / {t.b2} : {t.forecastHint}</p>
      </div>

      <div>
        <div className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-1">
          <h2 className="text-sm font-semibold text-[#1a1a2e]">{t.monthly}</h2>
          <span className="flex items-center gap-1.5 text-[11px] text-[#6b6b63]"><span className="inline-block h-2.5 w-2.5 rounded-sm bg-[#2c3a66]" />{t.sold}</span>
          <span className="flex items-center gap-1.5 text-[11px] text-[#6b6b63]"><span className="inline-block h-2.5 w-2.5 rounded-sm bg-[#9aa3c2]" />{t.partial}</span>
          <span className="flex items-center gap-1.5 text-[11px] text-[#6b6b63]"><span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: 'repeating-linear-gradient(45deg,#5b6b9a 0 2px,#e3e6f0 2px 5px)' }} />{t.forecastLbl}</span>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {items.map(i => (
            <div key={i.key} className="rounded-2xl border border-[#e8e8e4] bg-white px-4 py-3">
              <p className="truncate text-xs font-semibold text-[#1a1a2e]" title={nameOf(i, lang)}>{nameOf(i, lang)}</p>
              <SalesChart item={i} lang={lang} />
            </div>
          ))}
        </div>
      </div>

      {c.note && (
        <div className="rounded-2xl border border-[#e8e8e4] bg-white px-5 py-4">
          <h2 className="text-sm font-semibold text-[#1a1a2e]">{t.terms}</h2>
          <p className="mt-1 whitespace-pre-line text-sm text-[#4a4a44]">{c.note}</p>
          <p className="mt-2 text-[11px] text-[#9b9b93]">{t.method(c.productionDays, c.transitDays, c.bufferPct)}</p>
        </div>
      )}

      <div className="rounded-2xl border border-[#e8e8e4] bg-white">
        <h2 className="px-5 pt-4 text-sm font-semibold text-[#1a1a2e]">{t.history}</h2>
        {c.batches.length === 0 ? <p className="px-5 py-3 text-sm text-[#9b9b93]">{t.none}</p> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <tbody>
                {c.batches.map(b => (
                  <tr key={b.id} className="border-t border-[#f3f3f1] align-top first:border-t-0">
                    <td className="whitespace-nowrap px-5 py-2.5 font-semibold text-[#1a1a2e]">{fmtDay(b.date, lang)}</td>
                    <td className="px-3 py-2.5">
                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${b.status === 'received' ? 'bg-[#dcf5e7] text-[#1a7f4b]' : b.status === 'shipped' ? 'bg-[#e0ecff] text-[#1d4ed8]' : 'bg-[#fef3c7] text-[#b45309]'}`}>{statusLbl[b.status]}</span>
                    </td>
                    <td className="px-5 py-2.5 text-xs text-[#4a4a44]">
                      {Object.entries(b.lines).map(([k, q]) => <span key={k} className="mr-3 inline-block">{n(q)} × {nameByKey.get(k) ?? k}</span>)}
                      {b.note && <p className="mt-0.5 text-[11px] text-[#9b9b93]">{b.note}</p>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
