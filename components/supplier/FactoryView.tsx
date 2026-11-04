// Vue « usine » partagée avec le fabricant (page publique /factory/[token]) et
// aperçu dans la page interne. Sans hooks → rendu serveur ou client.
// But : le rassurer (ventes en direct, progression, prévisions) et lui dire combien
// préparer par modèle. Unités seulement : jamais de prix, de CA ni de clients.
import type { Forecast, ItemForecast, Lang } from '@/lib/supplierForecast'

const T = {
  en: {
    live: 'Live sales', updated: 'updated', machinesSold: 'Machines sold',
    thisMonth: 'This month so far', last30: 'Last 30 days', nextMonthFc: (m: string) => `Forecast ${m}`,
    machines: 'Sparkling water makers', others: 'Bottles & accessories',
    stock: 'Stock Forrest', until: (d: string) => `until ~${d}`, enough: 'enough for 3+ months',
    sold30: 'Sold, last 30 days', vsPrev: 'vs previous 30 days', soFar: 'so far',
    prepare: 'Stock to prepare for us', covers: (d: string) => `covers our sales until ~${d}`,
    urgent: (q: string, d: string) => `${q} pcs needed as soon as possible — Forrest stock runs out ~${d}`,
    nothing: 'Nothing needed for now', pcs: 'pcs', fc: 'forecast',
    how: 'How it works',
    steps: (p: number, t: number, h: number) => [
      'Sales are live from our shop and update several times a day.',
      'Forecasts follow the recent sales trend, with a boost for Black Friday and Christmas.',
      `“Stock to prepare” = our sales during production (${p} days) + transport (${t} days) + ${h} months, minus our Forrest stock. We order from it every month.`,
    ],
  },
  zh: {
    live: '实时销量', updated: '更新于', machinesSold: '气泡水机销量',
    thisMonth: '本月至今', last30: '最近30天', nextMonthFc: (m: string) => `${m} 预测`,
    machines: '气泡水机', others: '水瓶及配件',
    stock: 'Forrest 仓库库存', until: (d: string) => `约可卖到 ${d}`, enough: '可卖3个月以上',
    sold30: '最近30天销量', vsPrev: '对比前30天', soFar: '至今',
    prepare: '请为我们准备的库存', covers: (d: string) => `可满足我们约到 ${d} 的销量`,
    urgent: (q: string, d: string) => `急需 ${q} 件 — Forrest 库存约 ${d} 售罄`,
    nothing: '暂时无需备货', pcs: '件', fc: '预测',
    how: '合作方式',
    steps: (p: number, t: number, h: number) => [
      '销量数据实时来自我们的网店，每天更新多次。',
      '预测基于近期销售趋势，并考虑黑色星期五和圣诞节的增长。',
      `“请准备的库存” = 生产期间（${p}天）+ 运输（${t}天）+ ${h}个月的销量，减去我们 Forrest 仓库的库存。我们每月从中下单。`,
    ],
  },
  fr: {
    live: 'Ventes en direct', updated: 'mis à jour', machinesSold: 'Machines vendues',
    thisMonth: 'Ce mois-ci', last30: '30 derniers jours', nextMonthFc: (m: string) => `Prévision ${m}`,
    machines: 'Machines', others: 'Bouteilles & accessoires',
    stock: 'Stock Forrest', until: (d: string) => `jusqu'au ~${d}`, enough: 'plus de 3 mois',
    sold30: 'Vendus, 30 derniers jours', vsPrev: 'vs 30 jours précédents', soFar: 'pour l’instant',
    prepare: 'Stock à nous préparer', covers: (d: string) => `couvre nos ventes jusqu'au ~${d}`,
    urgent: (q: string, d: string) => `${q} pcs à envoyer au plus vite — rupture Forrest vers le ${d}`,
    nothing: 'Rien à préparer pour l’instant', pcs: 'pcs', fc: 'prévision',
    how: 'Fonctionnement',
    steps: (p: number, t: number, h: number) => [
      'Les ventes viennent en direct de notre boutique et se mettent à jour plusieurs fois par jour.',
      'Les prévisions suivent la tendance récente, avec un coup de pouce pour le Black Friday et Noël.',
      `« Stock à préparer » = nos ventes pendant la fabrication (${p} j) + le transport (${t} j) + ${h} mois, moins notre stock Forrest. On commande dessus chaque mois.`,
    ],
  },
} as const

const LOCALE: Record<Lang, string> = { en: 'en-GB', zh: 'zh-CN', fr: 'fr-FR' }
const fmtShort = (day: string, lang: Lang) => new Date(day + 'T12:00:00Z').toLocaleDateString(LOCALE[lang], { day: 'numeric', month: 'short', timeZone: 'UTC' })
const fmtMonth = (month: string, lang: Lang) => new Date(month + '-15T12:00:00Z').toLocaleDateString(LOCALE[lang], { month: 'short', timeZone: 'UTC' }).replace('.', '')
const fmtMonthLong = (month: string, lang: Lang) => new Date(month + '-15T12:00:00Z').toLocaleDateString(LOCALE[lang], { month: 'long', timeZone: 'UTC' })
const n = (v: number) => Math.round(v).toLocaleString('fr-FR')
const nameOf = (i: ItemForecast, lang: Lang) => lang === 'zh' ? i.nameZh : lang === 'fr' ? i.nameFr : i.name
const pct = (g: number) => `${g >= 0 ? '+' : '−'}${Math.abs(Math.round(g * 100))} %`

function GrowthBadge({ g, label }: { g: number | null; label: string }) {
  if (g == null) return null
  const up = g >= 0.03, down = g <= -0.03
  return (
    <span title={label} className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${up ? 'bg-[#dcf5e7] text-[#1a7f4b]' : 'bg-[#eeede9] text-[#6b6b63]'}`}>
      {up ? '↗' : down ? '↘' : '→'} {pct(g)}
    </span>
  )
}

// Ventes par mois, valeur au-dessus de chaque barre ; mois en cours = vendu (plein) +
// reste estimé (hachuré) ; 2 mois de prévision hachurés.
function SalesBars({ item, lang }: { item: ItemForecast; lang: Lang }) {
  const t = T[lang]
  const bars = [
    ...item.history.slice(-7).map(h => ({ month: h.month, sold: h.units, total: h.partial ? Math.max(h.units, h.estimate ?? 0) : h.units, kind: h.partial ? 'current' as const : 'past' as const })),
    ...item.forecast.slice(0, 2).map(f => ({ month: f.month, sold: 0, total: f.units, kind: 'forecast' as const })),
  ]
  const W = 360, H = 130, top = 16, bottom = 16, gap = 6
  const max = Math.max(5, ...bars.map(b => b.total))
  const bw = (W - gap * (bars.length - 1)) / bars.length
  const hOf = (v: number) => (v / max) * (H - top - bottom)
  const pid = `hatch-${item.key}`
  const base = H - bottom
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label={nameOf(item, lang)}>
      <defs>
        <pattern id={pid} width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <rect width="5" height="5" fill="#e6e9f3" />
          <line x1="0" y1="0" x2="0" y2="5" stroke="#8b93b8" strokeWidth="2" />
        </pattern>
      </defs>
      <line x1="0" x2={W} y1={base} y2={base} stroke="#e8e8e4" />
      {bars.map((b, i) => {
        const x = i * (bw + gap)
        const hTotal = hOf(b.total), hSold = hOf(b.sold)
        const r = Math.min(4, bw / 2, hSold)
        const tip = b.kind === 'current' ? `${fmtMonth(b.month, lang)} : ${n(b.sold)} ${t.soFar} · ~${n(b.total)} ${t.fc}`
          : `${fmtMonth(b.month, lang)} : ${b.kind === 'forecast' ? '~' : ''}${n(b.total)}${b.kind === 'forecast' ? ` (${t.fc})` : ''}`
        return (
          <g key={b.month}>
            <title>{tip}</title>
            <rect x={x} y={0} width={bw} height={H} fill="transparent" />
            {b.kind !== 'past' && hTotal > 0 && <rect x={x} y={base - hTotal} width={bw} height={hTotal} rx={Math.min(4, bw / 2)} fill={`url(#${pid})`} />}
            {b.kind !== 'forecast' && hSold > 0 && (
              <path d={`M${x},${base}V${base - hSold + r}Q${x},${base - hSold} ${x + r},${base - hSold}H${x + bw - r}Q${x + bw},${base - hSold} ${x + bw},${base - hSold + r}V${base}Z`} fill="#2c3a66" />
            )}
            <text x={x + bw / 2} y={base - hTotal - 4} textAnchor="middle" fontSize="11" fontWeight="700" fill={b.kind === 'past' ? '#1a1a2e' : '#5b6488'}>
              {b.kind === 'past' ? n(b.total) : `~${n(b.total)}`}
            </text>
            {b.kind === 'current' && hSold >= 14 && <text x={x + bw / 2} y={base - 4} textAnchor="middle" fontSize="10" fontWeight="700" fill="#fff">{n(b.sold)}</text>}
            <text x={x + bw / 2} y={H - 3} textAnchor="middle" fontSize="10" fill={b.kind === 'past' ? '#9b9b93' : '#5b6488'}>{fmtMonth(b.month, lang)}</text>
          </g>
        )
      })}
    </svg>
  )
}

function ProductCard({ i, forecast, lang }: { i: ItemForecast; forecast: Forecast; lang: Lang }) {
  const t = T[lang]
  const c = forecast.config
  const tone = i.urgent > 0 ? 'red' : i.stockoutDate && i.stockoutDate < forecast.coverUntil ? 'amber' : 'green'
  const toneCls = { red: 'bg-[#fdecec] text-[#b42318]', amber: 'bg-[#fff4e0] text-[#a15c07]', green: 'bg-[#e7f6ee] text-[#1a7f4b]' }[tone]
  return (
    <div className="overflow-hidden rounded-3xl border border-[#e8e8e4] bg-white">
      <div className="flex gap-4 px-5 pt-5">
        <div className="flex h-24 w-24 shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-[#f3f3f1]">
          {i.image
            // eslint-disable-next-line @next/next/no-img-element
            ? <img src={i.image} alt="" className="h-full w-full object-contain p-1.5" loading="lazy" />
            : <span className="text-4xl">📦</span>}
        </div>
        <div className="min-w-0 flex-1">
          <p className="font-semibold leading-snug text-[#1a1a2e]">{nameOf(i, lang)}</p>
          {i.sku && <p className="font-mono text-[11px] text-[#9b9b93]">{i.sku}</p>}
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <span className="text-2xl font-bold tabular-nums text-[#1a1a2e]">{n(i.last30)}</span>
            <span className="text-xs text-[#6b6b63]">{t.sold30}</span>
            <GrowthBadge g={i.growth} label={t.vsPrev} />
          </div>
          <p className="text-[11px] text-[#9b9b93]">{t.thisMonth}{lang === 'fr' ? ' : ' : lang === 'zh' ? '：' : ': '}{n(i.monthToDate)}</p>
        </div>
      </div>

      {c.showStock && (
        <div className={`mx-5 mt-4 flex items-center justify-between rounded-2xl px-4 py-2.5 ${toneCls}`}>
          <span className="text-sm font-semibold">{t.stock}</span>
          <span className="text-right">
            <span className="text-xl font-bold tabular-nums">{n(i.stock)}</span> <span className="text-xs">{t.pcs}</span>
            <span className="block text-[11px] opacity-80">{i.stockoutDate ? t.until(fmtShort(i.stockoutDate, lang)) : t.enough}</span>
          </span>
        </div>
      )}

      <div className="px-5 pt-3"><SalesBars item={i} lang={lang} /></div>

      <div className="mt-2 border-t border-[#f3f3f1] bg-[#fafaf8] px-5 py-3.5">
        {i.suggested > 0 ? (
          <>
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-sm font-semibold text-[#1a1a2e]">📦 {t.prepare}</span>
              <span className="text-2xl font-bold tabular-nums text-[#1a1a2e]">{n(i.suggested)} <span className="text-sm font-medium text-[#6b6b63]">{t.pcs}</span></span>
            </div>
            <p className="text-[11px] text-[#9b9b93]">{t.covers(fmtShort(forecast.coverUntil, lang))}</p>
            {i.urgent > 0 && i.stockoutDate && (
              <p className="mt-2 rounded-xl bg-[#fdecec] px-3 py-1.5 text-xs font-semibold text-[#b42318]">⚡ {t.urgent(n(i.urgent), fmtShort(i.stockoutDate, lang))}</p>
            )}
          </>
        ) : <p className="text-sm text-[#1a7f4b]">✓ {t.nothing}</p>}
      </div>
    </div>
  )
}

export default function FactoryView({ forecast, lang, brandLabel }: { forecast: Forecast; lang: Lang; brandLabel: string }) {
  const t = T[lang]
  const c = forecast.config
  const items = forecast.items.filter(i => i.include)
  const machines = items.filter(i => i.machine)
  const others = items.filter(i => !i.machine)
  const sum = (k: (i: ItemForecast) => number) => machines.reduce((a, i) => a + k(i), 0)
  const last30 = sum(i => i.last30)
  const prev30 = sum(i => i.growth != null ? i.last30 / (1 + i.growth) : 0)
  const g = prev30 >= 3 ? last30 / prev30 - 1 : null
  const nextMonth = machines[0]?.forecast[0]?.month
  const updated = new Date(forecast.generatedAt).toLocaleString(LOCALE[lang], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Paris' })

  return (
    <div className="space-y-6">
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#9b9b93]">{brandLabel}{c.factoryName ? ` × ${c.factoryName}` : ''}</p>
        <h1 className="flex items-center gap-2 text-2xl font-bold text-[#1a1a2e]">
          <span className="relative flex h-2.5 w-2.5"><span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#22c55e] opacity-60" /><span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-[#22c55e]" /></span>
          {t.live}
        </h1>
        <p className="text-xs text-[#9b9b93]">{t.updated} {updated}</p>
      </div>

      {machines.length > 0 && (
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-2xl bg-[#1a1a2e] px-5 py-4 text-white">
            <p className="text-[11px] text-white/60">{t.machinesSold} · {t.thisMonth}</p>
            <p className="mt-1 text-3xl font-bold tabular-nums">{n(sum(i => i.monthToDate))}</p>
          </div>
          <div className="rounded-2xl border border-[#e8e8e4] bg-white px-5 py-4">
            <p className="text-[11px] text-[#6b6b63]">{t.machinesSold} · {t.last30}</p>
            <p className="mt-1 flex items-center gap-2 text-3xl font-bold tabular-nums text-[#1a1a2e]">{n(last30)} <GrowthBadge g={g} label={t.vsPrev} /></p>
          </div>
          {nextMonth && (
            <div className="rounded-2xl border border-[#e8e8e4] bg-white px-5 py-4">
              <p className="text-[11px] text-[#6b6b63]">{t.machinesSold} · {t.nextMonthFc(fmtMonthLong(nextMonth, lang))}</p>
              <p className="mt-1 text-3xl font-bold tabular-nums text-[#1a1a2e]">~{n(sum(i => i.forecast[0].units))}</p>
            </div>
          )}
        </div>
      )}

      {[{ label: t.machines, list: machines }, { label: t.others, list: others }].filter(sct => sct.list.length > 0).map(sct => (
        <section key={sct.label}>
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-[0.08em] text-[#6b6b63]">{sct.label}</h2>
          <div className="grid gap-4 lg:grid-cols-2">
            {sct.list.map(i => <ProductCard key={i.key} i={i} forecast={forecast} lang={lang} />)}
          </div>
        </section>
      ))}

      <div className="rounded-3xl border border-[#e8e8e4] bg-white px-6 py-5">
        <h2 className="font-semibold text-[#1a1a2e]">{t.how}</h2>
        <ol className="mt-3 grid gap-3 sm:grid-cols-3">
          {t.steps(c.productionDays, c.transitDays, c.horizonMonths).map((step, k) => (
            <li key={k} className="flex gap-3 text-sm text-[#4a4a44]">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#1a1a2e] text-xs font-bold text-white">{k + 1}</span>
              {step}
            </li>
          ))}
        </ol>
        {c.note && !c.note.startsWith('Proposal: one batch per month.') && <p className="mt-4 whitespace-pre-line border-t border-[#f3f3f1] pt-3 text-sm text-[#4a4a44]">{c.note}</p>}
      </div>
    </div>
  )
}
