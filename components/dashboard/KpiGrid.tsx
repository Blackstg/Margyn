'use client'

export interface SupplementaryItem {
  source: string
  amount: number
}

export interface KpiData {
  total_sales: number
  gross_profit: number
  net_profit: number | null
  order_count: number
  marketing: number
  cogs: number
  fulfillment: number
  op_expenses: number
  returns: number
  transaction_fees: number
  app_charges: number
  supplementary_ca?: number
  supplementary_breakdown?: SupplementaryItem[]
}

export interface SparklineData {
  sales: number[]
  gross: number[]
}

interface Props {
  current:    KpiData | null
  previous:   KpiData | null
  loading:    boolean
  brand:      'bowa' | 'moom' | 'krom'
  sparklines?: SparklineData
}

const fmtEur = (n: number) =>
  new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(n)

const fmtNum = (n: number) => n.toLocaleString('fr-FR')

// ─── Sparkline ────────────────────────────────────────────────────────────────

function Sparkline({ data, stroke }: { data: number[]; stroke: string }) {
  if (data.length < 2) return null
  const min   = Math.min(...data)
  const max   = Math.max(...data)
  const range = max - min || 1
  const W = 60, H = 28
  const pts = data
    .map((v, i) => `${(i / (data.length - 1)) * W},${H - 2 - ((v - min) / range) * (H - 6)}`)
    .join(' ')
  return (
    <svg width={W} height={H} className="shrink-0 opacity-70">
      <polyline
        points={pts}
        fill="none"
        stroke={stroke}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

// ─── Badge ────────────────────────────────────────────────────────────────────

function Badge({ current, previous, inverse = false, onGradient = false }: {
  current: number
  previous: number
  inverse?: boolean
  onGradient?: boolean
}) {
  if (previous === 0) return null
  const pct       = ((current - previous) / Math.abs(previous)) * 100
  const isGood    = inverse ? pct < 0 : pct > 0
  const isNeutral = Math.abs(pct) < 0.5
  const sign      = pct > 0 ? '+' : ''
  const label     = isNeutral ? '0%' : `${sign}${Math.abs(pct).toFixed(1)}%`

  if (onGradient) {
    return (
      <span className={`inline-flex px-2 py-0.5 rounded-full text-[11px] font-semibold ${
        isNeutral ? 'bg-white/15 text-white/70'
        : isGood  ? 'bg-[#dcf5e7]/30 text-white'
                  : 'bg-white/10 text-white/70'
      }`}>
        {label}
      </span>
    )
  }

  return (
    <span className={`inline-flex px-2 py-0.5 rounded-full text-[11px] font-semibold ${
      isNeutral ? 'bg-[#f0f0ee] text-[#6b6b63]'
      : isGood  ? 'bg-[#dcf5e7] text-[#1a7f4b]'
                : 'bg-[#fce8ea] text-[#c7293a]'
    }`}>
      {label}
    </span>
  )
}

// ─── KpiCard ─────────────────────────────────────────────────────────────────

function KpiCard({
  label, value, formatted, prevValue, loading,
  inverse = false, note, gradient, gradientText = false,
  isEmpty = false, sparkline, detail,
}: {
  label: string
  value: number
  formatted: string
  prevValue: number
  loading: boolean
  inverse?: boolean
  note?: string
  gradient?: string        // gradient bg (Total Sales)
  gradientText?: boolean   // gradient text on white bg (Gross Profit, Net Profit)
  isEmpty?: boolean
  sparkline?: number[]
  detail?: string          // breakdown sub-line (e.g. "dont Shopify X€ + LM X€")
}) {
  const isGradient = !!gradient

  const valueEl = isEmpty && value === 0 ? (
    <p className="text-base font-medium text-[#6b6b63]">À configurer</p>
  ) : gradientText ? (
    <p
      className="text-2xl sm:text-[1.75rem] font-bold tracking-tight leading-none"
      style={{
        background: 'linear-gradient(90deg, #8a8db8, #c4788a)',
        WebkitBackgroundClip: 'text',
        WebkitTextFillColor: 'transparent',
        backgroundClip: 'text',
      }}
    >
      {formatted}
    </p>
  ) : (
    <p className={`text-2xl sm:text-[1.75rem] font-bold tracking-tight leading-none ${
      isGradient ? 'text-white' : 'text-[#1a1a2e]'
    }`}>
      {formatted}
    </p>
  )

  return (
    <div
      className="rounded-[20px] shadow-[0_2px_16px_rgba(0,0,0,0.06)] p-5 flex flex-col gap-3"
      style={isGradient ? { background: gradient } : { background: '#ffffff' }}
    >
      {/* Label */}
      <p className={`text-[10px] font-semibold uppercase tracking-[0.1em] ${
        isGradient   ? 'text-white/75'
        : gradientText ? 'text-[#4a4a6a]'
        :                'text-[#6b6b63]'
      }`}>
        {label}
      </p>

      {loading ? (
        <div className="space-y-2">
          <div className={`h-8 w-28 rounded-full animate-pulse ${isGradient ? 'bg-white/20' : 'bg-[#f0f0ee]'}`} />
          <div className={`h-3 w-20 rounded-full animate-pulse ${isGradient ? 'bg-white/15' : 'bg-[#f0f0ee]'}`} />
        </div>
      ) : (
        <>
          {/* Value + Sparkline */}
          <div className="flex items-start justify-between gap-2">
            {valueEl}
            {sparkline && sparkline.length >= 2 && (
              <Sparkline
                data={sparkline}
                stroke={isGradient ? 'rgba(255,255,255,0.6)' : '#aeb0c9'}
              />
            )}
          </div>

          {/* Badge + sub-text + note */}
          <div className="flex items-center gap-2 flex-wrap">
            <Badge current={value} previous={prevValue} inverse={inverse} onGradient={isGradient} />
            {prevValue !== 0 && (
              <span className={`text-[11px] ${
                isGradient    ? 'text-white/55'
                : gradientText ? 'text-[#6b6b8a]'
                :                'text-[#9b9b93]'
              }`}>
                vs période précédente
              </span>
            )}
            {note && (
              <span className={`text-[11px] ml-auto ${
                isGradient    ? 'text-white/65'
                : gradientText ? 'text-[#4a4a6a]'
                :                'text-[#6b6b63]'
              }`}>
                {note}
              </span>
            )}
          </div>
          {detail && (
            <p className={`text-[11px] leading-snug mt-0.5 ${
              isGradient ? 'text-white/55' : 'text-[#9b9b93]'
            }`}>
              {detail}
            </p>
          )}
        </>
      )}
    </div>
  )
}

// ─── KpiGrid ─────────────────────────────────────────────────────────────────

export default function KpiGrid({ current, previous, loading, brand, sparklines }: Props) {
  const c = current ?? {
    total_sales: 0, gross_profit: 0, net_profit: null,
    order_count: 0, marketing: 0, cogs: 0, fulfillment: 0, op_expenses: 0,
    returns: 0, transaction_fees: 0, app_charges: 0,
  }
  const p = previous ?? {
    total_sales: 0, gross_profit: 0, net_profit: null,
    order_count: 0, marketing: 0, cogs: 0, fulfillment: 0, op_expenses: 0,
    returns: 0, transaction_fees: 0, app_charges: 0,
  }

  // For Bowa: Shopify stores TTC → convert to HT (× 5/6)
  const tva            = brand === 'bowa' ? Math.round(c.total_sales / 6) : 0
  const prevTva        = brand === 'bowa' ? Math.round(p.total_sales / 6) : 0
  const shopifyHT      = c.total_sales - tva
  const supplementaryHT = c.supplementary_ca ?? 0
  const totalSalesHT   = shopifyHT + supplementaryHT
  const grossProfitHT  = c.gross_profit - tva
  const prevShopifyHT  = p.total_sales - prevTva
  const prevSupplHT    = p.supplementary_ca ?? 0
  const prevSalesHT    = prevShopifyHT + prevSupplHT
  const prevGrossHT    = p.gross_profit - prevTva
  const netProfit      = grossProfitHT  - c.marketing - c.fulfillment - c.transaction_fees - c.app_charges - c.op_expenses
  const prevNetProfit  = prevGrossHT    - p.marketing - p.fulfillment - p.transaction_fees - p.app_charges - p.op_expenses

  const roasReel     = c.marketing > 0 ? totalSalesHT / c.marketing : 0
  const prevRoasReel = p.marketing > 0 ? prevSalesHT  / p.marketing : 0

  const tvaCollectee     = Math.round(c.total_sales / 6)
  const prevTvaCollectee = Math.round(p.total_sales / 6)

  // Breakdown detail line for Total Sales card
  const fmtShort = (n: number) => n >= 1000
    ? `${(n / 1000).toFixed(1).replace(/\.0$/, '')}k€`
    : `${Math.round(n)}€`
  const suppBreakdown = c.supplementary_breakdown?.filter(i => i.amount > 0)
  const salesDetailText = supplementaryHT > 0 && suppBreakdown?.length
    ? `dont Shopify ${fmtShort(shopifyHT)}${suppBreakdown.map(i => ` + ${i.source} ${fmtShort(i.amount)}`).join('')}`
    : undefined

  return (
    <div className="space-y-3">

      {/* ── Top 3 cards ─────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">

        {/* Total Sales — mesh radial gradient bg */}
        <KpiCard
          label="Total Sales"
          value={totalSalesHT}
          formatted={fmtEur(totalSalesHT)}
          prevValue={prevSalesHT}
          loading={loading}
          gradient="radial-gradient(ellipse at top left, #8a8db8 0%, transparent 60%), radial-gradient(ellipse at bottom right, #c4788a 0%, transparent 60%), radial-gradient(ellipse at top right, #c9a8b8 0%, transparent 50%), #3d3b5e"
          sparkline={sparklines?.sales}
          detail={salesDetailText}
        />

        {/* Gross Profit — white bg + gradient text */}
        <KpiCard
          label="Gross Profit"
          value={grossProfitHT}
          formatted={fmtEur(grossProfitHT)}
          prevValue={prevGrossHT}
          loading={loading}
          gradientText
          note={shopifyHT > 0 ? `${((grossProfitHT / shopifyHT) * 100).toFixed(1)}% marge` : undefined}
          sparkline={sparklines?.gross}
        />

        {/* Net Profit — white bg + gradient text */}
        <KpiCard
          label="Net Profit"
          value={netProfit}
          formatted={fmtEur(netProfit)}
          prevValue={prevNetProfit}
          loading={loading}
          gradientText
          note={shopifyHT > 0 ? `${((netProfit / shopifyHT) * 100).toFixed(1)}% du CA` : undefined}
          sparkline={sparklines?.gross}
        />
      </div>

      {/* ── Secondary white cards ────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard label="Commandes"       value={c.order_count}      formatted={fmtNum(c.order_count)}   prevValue={p.order_count}      loading={loading} />
        <KpiCard label="Marketing"       value={c.marketing}        formatted={fmtEur(c.marketing)}     prevValue={p.marketing}        loading={loading} inverse />
        <KpiCard label="ROAS réel"       value={roasReel}           formatted={`${roasReel.toFixed(2)}x`}  prevValue={prevRoasReel}    loading={loading} note="CA Shopify / dépense pub" />
        <KpiCard label="COGS"            value={c.cogs}             formatted={fmtEur(c.cogs)}          prevValue={p.cogs}             loading={loading} inverse />
        <KpiCard label="Retours"         value={c.returns}          formatted={fmtEur(c.returns)}       prevValue={p.returns}          loading={loading} inverse />
        <KpiCard label="Transaction Fees" value={c.transaction_fees} formatted={fmtEur(c.transaction_fees)} prevValue={p.transaction_fees} loading={loading} inverse note={totalSalesHT > 0 ? `${((c.transaction_fees / totalSalesHT) * 100).toFixed(1)}% du CA` : undefined} />
        <KpiCard label="Fulfillment"     value={c.fulfillment}      formatted={fmtEur(c.fulfillment)}   prevValue={p.fulfillment}      loading={loading} inverse note={c.order_count > 0 ? `${fmtEur(Math.round(c.fulfillment / c.order_count))}/cmd` : undefined} />
        <KpiCard label="Apps Shopify"    value={c.app_charges}      formatted={fmtEur(c.app_charges)}   prevValue={p.app_charges}      loading={loading} inverse isEmpty />
        <KpiCard label="Op. Expenses"    value={c.op_expenses}      formatted={fmtEur(c.op_expenses)}   prevValue={p.op_expenses}      loading={loading} inverse isEmpty />
        {brand === 'bowa' && (
          <KpiCard
            label="TVA collectée"
            value={tvaCollectee}
            formatted={fmtEur(tvaCollectee)}
            prevValue={prevTvaCollectee}
            loading={loading}
            note="CA TTC ÷ 6"
          />
        )}
      </div>

    </div>
  )
}
