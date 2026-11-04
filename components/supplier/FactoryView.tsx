// Vue « usine » : plan de production partagé avec le fabricant (page publique
// /factory/[token]) et aperçu dans la page interne. Sans hooks → rendu serveur ou client.
// Une carte par produit (photo + 2 chiffres ronds). Jamais de prix, de CA ni de clients.
import type { Forecast, ItemForecast, Lang } from '@/lib/supplierForecast'

const T = {
  en: {
    next: 'Next shipment', inDays: (d: number) => d <= 0 ? 'today' : d === 1 ? 'tomorrow' : `in ${d} days`,
    pcs: 'pcs', confirmed: 'Confirmed', forecastUntil: (d: string) => `Forecast · confirmed automatically on ${d}`,
    ship: 'Ship on', keep: 'Keep ready', perMonth: 'sold / month', then: 'Then', stockFr: 'Stock in France',
    urgent: 'Please ship as soon as possible from the ready stock:', how: 'How it works',
    steps: (day: number) => [
      `Every month on the ${day}${day === 1 ? 'st' : day === 2 ? 'nd' : day === 3 ? 'rd' : 'th'}, you ship the quantities shown in “Ship on”.`,
      'You always keep the “Keep ready” quantity finished, so a sales peak never waits for production.',
      'Quantities update by themselves with our sales and are confirmed automatically before production starts.',
    ],
    past: 'Previous shipments', updated: 'Updated',
  },
  zh: {
    next: '下一批发货', inDays: (d: number) => d <= 0 ? '今天' : d === 1 ? '明天' : `${d} 天后`,
    pcs: '件', confirmed: '已确认', forecastUntil: (d: string) => `预测 · 将于 ${d} 自动确认`,
    ship: '发货日期', keep: '常备库存', perMonth: '件 / 月销量', then: '之后', stockFr: '法国库存',
    urgent: '请尽快从常备库存中发货：', how: '合作方式',
    steps: (day: number) => [
      `每月 ${day} 日，请按“发货日期”下的数量发货。`,
      '请始终保持“常备库存”数量的成品，销量增加时无需等待生产。',
      '数量根据我们的销量自动更新，并在生产开始前自动确认。',
    ],
    past: '历史发货', updated: '更新于',
  },
  fr: {
    next: 'Prochain envoi', inDays: (d: number) => d <= 0 ? "aujourd'hui" : d === 1 ? 'demain' : `dans ${d} jours`,
    pcs: 'pcs', confirmed: 'Confirmé', forecastUntil: (d: string) => `Prévision · confirmée automatiquement le ${d}`,
    ship: 'À envoyer le', keep: 'À garder prêt', perMonth: 'vendus / mois', then: 'Ensuite', stockFr: 'Stock France',
    urgent: 'À envoyer au plus vite depuis le stock prêt :', how: 'Fonctionnement',
    steps: (day: number) => [
      `Chaque mois, le ${day}, l'usine envoie les quantités « À envoyer ».`,
      "Elle garde toujours la quantité « À garder prêt » finie : un pic de ventes n'attend jamais la fabrication.",
      'Les quantités se mettent à jour seules avec nos ventes et sont confirmées automatiquement avant la fabrication.',
    ],
    past: 'Envois précédents', updated: 'Mis à jour le',
  },
} as const

const LOCALE: Record<Lang, string> = { en: 'en-GB', zh: 'zh-CN', fr: 'fr-FR' }
const fmtDay = (day: string, lang: Lang) => new Date(day + 'T12:00:00Z').toLocaleDateString(LOCALE[lang], { day: 'numeric', month: 'long', timeZone: 'UTC' })
const fmtShort = (day: string, lang: Lang) => new Date(day + 'T12:00:00Z').toLocaleDateString(LOCALE[lang], { day: 'numeric', month: 'short', timeZone: 'UTC' })
const n = (v: number) => Math.round(v).toLocaleString('fr-FR')
const nameOf = (i: ItemForecast, lang: Lang) => lang === 'zh' ? i.nameZh : lang === 'fr' ? i.nameFr : i.name
const daysBetween = (a: string, b: string) => Math.round((new Date(b + 'T12:00:00Z').getTime() - new Date(a + 'T12:00:00Z').getTime()) / 86400_000)

// Mini-tendance : 6 derniers mois vendus + 2 mois prévus (hachurés), sans axes
function Trend({ item }: { item: ItemForecast }) {
  const bars = [
    ...item.history.filter(h => !h.partial).slice(-6).map(h => ({ v: h.units, f: false })),
    ...item.forecast.slice(0, 2).map(x => ({ v: x.units, f: true })),
  ]
  const max = Math.max(5, ...bars.map(b => b.v))
  return (
    <div className="flex h-8 items-end gap-[3px]" aria-hidden>
      {bars.map((b, i) => (
        <span key={i} className="w-2.5 rounded-t-[3px]"
          style={{ height: `${Math.max(6, (b.v / max) * 100)}%`, background: b.f ? 'repeating-linear-gradient(45deg,#8b93b8 0 2px,#e3e6f0 2px 4px)' : '#2c3a66' }} />
      ))}
    </div>
  )
}

export default function FactoryView({ forecast, lang, brandLabel }: { forecast: Forecast; lang: Lang; brandLabel: string }) {
  const t = T[lang]
  const c = forecast.config
  const s = forecast.schedule
  const items = forecast.items.filter(i => i.include)
  const isFirm = items.some(i => i.confirmed != null)
  const qty = (i: ItemForecast) => i.confirmed ?? i.nextBatch
  const total = items.reduce((a, i) => a + qty(i), 0)
  const urgent = items.filter(i => i.stockoutDate && i.stockoutDate < s.arrival)
  const past = c.batches.filter(b => b.date < s.batchDate).slice(0, 6)

  return (
    <div className="space-y-5">
      <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#9b9b93]">
        {brandLabel}{c.factoryName ? ` × ${c.factoryName}` : ''} · {t.updated} {fmtShort(forecast.today, lang)}
      </p>

      <div className="rounded-3xl bg-[#1a1a2e] px-6 py-5 text-white">
        <p className="text-sm text-white/60">📦 {t.next}</p>
        <div className="mt-1 flex flex-wrap items-end gap-x-4 gap-y-1">
          <p className="text-4xl font-bold">{fmtDay(s.batchDate, lang)}</p>
          <p className="pb-1 text-lg text-white/70">{t.inDays(daysBetween(forecast.today, s.batchDate))}</p>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className="rounded-full bg-white/10 px-3 py-1 text-sm font-semibold">{n(total)} {t.pcs}</span>
          <span className={`rounded-full px-3 py-1 text-xs font-semibold ${isFirm ? 'bg-[#22c55e] text-white' : 'bg-white/10 text-white/70'}`}>
            {isFirm ? `✓ ${t.confirmed}` : t.forecastUntil(fmtShort(s.orderBy, lang))}
          </span>
        </div>
      </div>

      {urgent.length > 0 && (
        <div className="rounded-2xl border border-[#fcd9b6] bg-[#fff7ed] px-5 py-3 text-sm text-[#9a3412]">
          ⚡ {t.urgent} <b>{urgent.map(i => nameOf(i, lang)).join(', ')}</b>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {items.map(i => (
          <div key={i.key} className="overflow-hidden rounded-3xl border border-[#e8e8e4] bg-white">
            <div className="flex h-44 items-center justify-center bg-[#f3f3f1]">
              {i.image
                // eslint-disable-next-line @next/next/no-img-element
                ? <img src={i.image} alt="" className="h-full w-full object-contain p-3" loading="lazy" />
                : <span className="text-5xl">📦</span>}
            </div>
            <div className="px-5 py-4">
              <p className="font-semibold leading-snug text-[#1a1a2e]">{nameOf(i, lang)}</p>
              {i.sku && <p className="font-mono text-[11px] text-[#9b9b93]">{i.sku}</p>}
              <div className="mt-3 grid grid-cols-2 gap-2">
                <div className="rounded-2xl bg-[#1a1a2e] px-3 py-2.5 text-white">
                  <p className="text-[11px] text-white/60">{t.ship} {fmtShort(s.batchDate, lang)}</p>
                  <p className="text-2xl font-bold tabular-nums">{n(qty(i))}</p>
                </div>
                <div className="rounded-2xl border-2 border-dashed border-[#c9cde0] px-3 py-2.5">
                  <p className="text-[11px] text-[#6b6b63]">{t.keep}</p>
                  <p className="text-2xl font-bold tabular-nums text-[#1a1a2e]">{n(i.buffer)}</p>
                </div>
              </div>
              <div className="mt-3 flex items-end justify-between gap-3">
                <div>
                  <p className="text-xs text-[#6b6b63]"><b className="text-[#1a1a2e]">≈ {n(i.perMonth)}</b> {t.perMonth}</p>
                  <p className="text-[11px] text-[#9b9b93]">{t.then}{lang === 'fr' ? ' : ' : lang === 'zh' ? '：' : ': '}~{n(i.following[0])} ({fmtShort(s.following[0].batchDate, lang)}) · ~{n(i.following[1])} ({fmtShort(s.following[1].batchDate, lang)})</p>
                  {c.showStock && <p className="text-[11px] text-[#9b9b93]">{t.stockFr}{lang === 'fr' ? ' : ' : lang === 'zh' ? '：' : ': '}{n(i.stock)}</p>}
                </div>
                <Trend item={i} />
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="rounded-3xl border border-[#e8e8e4] bg-white px-6 py-5">
        <h2 className="font-semibold text-[#1a1a2e]">{t.how}</h2>
        <ol className="mt-3 grid gap-3 sm:grid-cols-3">
          {t.steps(c.batchDay).map((step, k) => (
            <li key={k} className="flex gap-3 text-sm text-[#4a4a44]">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#1a1a2e] text-xs font-bold text-white">{k + 1}</span>
              {step}
            </li>
          ))}
        </ol>
        {c.note && !c.note.startsWith('Proposal: one batch per month.') && <p className="mt-4 whitespace-pre-line border-t border-[#f3f3f1] pt-3 text-sm text-[#4a4a44]">{c.note}</p>}
      </div>

      {past.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-semibold text-[#6b6b63]">{t.past}</span>
          {past.map(b => (
            <span key={b.id} className="rounded-full border border-[#e8e8e4] bg-white px-3 py-1 text-xs text-[#4a4a44]">
              ✓ {fmtShort(b.date, lang)} · {n(Object.values(b.lines).reduce((a, q) => a + q, 0))} {t.pcs}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}
