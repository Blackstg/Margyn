'use client'

import { useState, useEffect } from 'react'
import { createBrowserClient } from '@supabase/auth-helpers-nextjs'
import { useRouter } from 'next/navigation'
import { CheckCircle, LogOut, ChevronDown } from 'lucide-react'

interface Variant {
  shopify_variant_id: string
  product_title: string
  variant_title: string | null
  image_url: string | null
  stock_quantity: number
}

interface ProductGroup {
  product_title: string
  image_url: string | null
  variants: Variant[]
}

export default function ReconciliationPage() {
  const router = useRouter()
  const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )

  const [variants, setVariants]       = useState<Variant[]>([])
  const [groups, setGroups]           = useState<ProductGroup[]>([])
  const [openGroups, setOpenGroups]   = useState<Set<string>>(new Set())
  const [quantities, setQuantities]   = useState<Record<string, string>>({})
  const [cutoffDate, setCutoffDate]   = useState('')
  const [lastOrderNo, setLastOrderNo] = useState('')
  const [loading, setLoading]         = useState(true)
  const [submitting, setSubmitting]   = useState(false)
  const [submitted, setSubmitted]     = useState(false)
  const [error, setError]             = useState('')
  const [userEmail, setUserEmail]     = useState('')

  useEffect(() => {
    async function load() {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) { router.push('/login'); return }
      setUserEmail(session.user.email ?? '')

      const { data } = await supabase
        .from('product_variants')
        .select('shopify_variant_id, product_title, variant_title, image_url, stock_quantity')
        .eq('brand', 'moom')
        .eq('product_status', 'active')
        .not('product_title', 'ilike', '%bundle%')
        .not('product_title', 'ilike', '%carte cadeau%')
        .not('product_title', 'ilike', '%gift card%')
        .order('product_title')
        .order('variant_title')

      const filtered = (data ?? []).filter((v) => {
        const title = v.product_title.toLowerCase()
        if (/\+/.test(v.product_title)) return false
        if (title.includes('strap') && !title.includes('strapvelcro') && !title.includes('strap velcro')) return false
        return true
      })

      // Group by product_title
      const groupMap = new Map<string, ProductGroup>()
      for (const v of filtered) {
        if (!groupMap.has(v.product_title)) {
          groupMap.set(v.product_title, { product_title: v.product_title, image_url: v.image_url, variants: [] })
        }
        groupMap.get(v.product_title)!.variants.push(v)
      }
      setGroups(Array.from(groupMap.values()))
      setVariants(filtered)
      setLoading(false)
    }
    load()
  }, [])

  function toggleGroup(title: string) {
    setOpenGroups((prev) => {
      const next = new Set(prev)
      if (next.has(title)) next.delete(title)
      else next.add(title)
      return next
    })
  }

  async function handleSubmit() {
    if (!cutoffDate) { setError('Please enter the stock date.'); return }

    setSubmitting(true)
    setError('')

    // Empty field = logistician confirms Shopify stock is correct → use stock_quantity
    const items = variants.map((v) => ({
      shopify_variant_id: v.shopify_variant_id,
      product_title:      v.product_title,
      variant_title:      v.variant_title,
      image_url:          v.image_url,
      logistician_qty:    quantities[v.shopify_variant_id] !== undefined && quantities[v.shopify_variant_id] !== ''
        ? parseInt(quantities[v.shopify_variant_id], 10)
        : (v.stock_quantity ?? 0),
    }))

    const res = await fetch('/api/reconciliation/submit', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ cutoff_date: cutoffDate, last_order_number: lastOrderNo || null, items }),
    })

    if (!res.ok) {
      const { error: msg } = await res.json().catch(() => ({ error: 'Erreur serveur' }))
      setError(msg ?? 'Submission failed. Please try again.')
      setSubmitting(false)
      return
    }

    setSubmitted(true)
    setSubmitting(false)
  }

  async function handleLogout() {
    await supabase.auth.signOut()
    router.push('/login')
  }

  if (submitted) {
    return (
      <div className="min-h-screen bg-[#f8f7f5] flex items-center justify-center p-6">
        <div className="bg-white rounded-[20px] shadow-[0_2px_16px_rgba(0,0,0,0.08)] p-10 max-w-md w-full text-center space-y-4">
          <CheckCircle size={48} className="text-[#1a7f4b] mx-auto" />
          <h2 className="text-xl font-bold text-[#1a1a2e]">Submission received</h2>
          <p className="text-sm text-[#6b6b63]">
            Stock as of <strong>{new Date(cutoffDate + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}</strong> has been submitted.
            The Steero team has been notified.
          </p>
          <button
            onClick={() => { setSubmitted(false); setQuantities({}) }}
            className="mt-2 text-xs text-[#9b9b93] underline"
          >
            New submission
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-[#f8f7f5]">
      {/* Header */}
      <div className="bg-white border-b border-[#f0f0ee] px-6 py-4 flex items-center justify-between sticky top-0 z-10">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-[#aeb0c9]">Mōom</p>
          <h1 className="text-base font-bold text-[#1a1a2e]">Stock Reconciliation</h1>
        </div>
        <div className="flex items-center gap-4">
          <span className="text-xs text-[#9b9b93] hidden sm:block">{userEmail}</span>
          <button onClick={handleLogout} className="text-[#9b9b93] hover:text-[#1a1a2e] transition-colors">
            <LogOut size={18} />
          </button>
        </div>
      </div>

      <div className="max-w-2xl mx-auto px-4 py-6 space-y-5">

        {/* Date de coupure + numéro de commande */}
        <div className="bg-white rounded-[16px] shadow-[0_2px_12px_rgba(0,0,0,0.06)] p-5 space-y-4">
          <div>
            <label className="block text-[10px] font-semibold uppercase tracking-[0.1em] text-[#6b6b63] mb-3">
              Stock date *
            </label>
            <input
              type="date"
              value={cutoffDate}
              onChange={(e) => setCutoffDate(e.target.value)}
              max={new Date().toISOString().slice(0, 10)}
              className="w-full rounded-xl border border-[#e8e4e0] px-4 py-2.5 text-sm text-[#1a1a2e] focus:outline-none focus:ring-2 focus:ring-[#aeb0c9]/40"
            />
            <p className="mt-2 text-[11px] text-[#9b9b93]">Date up to which your count is accurate.</p>
          </div>
          <div>
            <label className="block text-[10px] font-semibold uppercase tracking-[0.1em] text-[#6b6b63] mb-3">
              Last order included
            </label>
            <input
              type="text"
              value={lastOrderNo}
              onChange={(e) => setLastOrderNo(e.target.value)}
              placeholder="e.g. #1042"
              className="w-full rounded-xl border border-[#e8e4e0] px-4 py-2.5 text-sm text-[#1a1a2e] focus:outline-none focus:ring-2 focus:ring-[#aeb0c9]/40"
            />
            <p className="mt-2 text-[11px] text-[#9b9b93]">Last order number included in this count.</p>
          </div>
        </div>

        {/* Accordéons par produit */}
        <div className="bg-white rounded-[16px] shadow-[0_2px_12px_rgba(0,0,0,0.06)] overflow-hidden">
          <div className="px-5 py-4 border-b border-[#f0f0ee] flex items-center justify-between">
            <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-[#6b6b63]">Stock quantities</p>
            <p className="text-[11px] text-[#9b9b93]">{groups.length} products · {variants.length} variants</p>
          </div>

          {loading ? (
            <div className="p-5 space-y-3">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="flex items-center gap-3 py-2">
                  <div className="w-10 h-10 bg-[#f0f0ee] rounded-xl animate-pulse shrink-0" />
                  <div className="flex-1 h-3 bg-[#f0f0ee] rounded animate-pulse" />
                  <div className="w-16 h-3 bg-[#f0f0ee] rounded animate-pulse" />
                </div>
              ))}
            </div>
          ) : (
            <div className="divide-y divide-[#f0f0ee]">
              {groups.map((group) => {
                const isOpen = openGroups.has(group.product_title)
                const modCount = group.variants.filter(
                  (v) => quantities[v.shopify_variant_id] !== undefined && quantities[v.shopify_variant_id] !== ''
                ).length

                return (
                  <div key={group.product_title}>
                    {/* Accordion header */}
                    <button
                      type="button"
                      onClick={() => toggleGroup(group.product_title)}
                      className="w-full flex items-center gap-3 px-5 py-3.5 text-left hover:bg-[#fafaf9] transition-colors"
                    >
                      {group.image_url ? (
                        <img src={group.image_url} alt={group.product_title} className="w-10 h-10 object-cover rounded-xl shrink-0 bg-[#f5f5f3]" />
                      ) : (
                        <div className="w-10 h-10 rounded-xl bg-[#f5f5f3] shrink-0 flex items-center justify-center text-[#c0c0b8] text-xs">?</div>
                      )}
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-[#1a1a2e] truncate">{group.product_title}</p>
                        <p className="text-[11px] text-[#9b9b93]">{group.variants.length} variant{group.variants.length > 1 ? 's' : ''} · tap to expand</p>
                      </div>
                      {modCount > 0 && (
                        <span className="shrink-0 px-2 py-0.5 rounded-full bg-[#fff3cd] text-[#b45309] text-[10px] font-semibold">
                          {modCount} change{modCount > 1 ? 's' : ''}
                        </span>
                      )}
                      <ChevronDown
                        size={16}
                        className={`shrink-0 text-[#9b9b93] transition-transform ${isOpen ? 'rotate-180' : ''}`}
                      />
                    </button>

                    {/* Accordion body */}
                    {isOpen && (
                      <div className="border-t border-[#f8f8f7] divide-y divide-[#f8f8f7] bg-[#fafaf9]">
                        {group.variants.map((v) => {
                          const filled = quantities[v.shopify_variant_id] !== undefined && quantities[v.shopify_variant_id] !== ''
                          return (
                            <div key={v.shopify_variant_id} className={`flex items-center gap-3 px-5 py-3 transition-colors ${filled ? 'bg-[#fff8e6]' : ''}`}>
                              <div className="flex-1 min-w-0">
                                <p className="text-sm text-[#1a1a2e]">
                                  {v.variant_title ?? <span className="text-[#9b9b93] italic">One size</span>}
                                </p>
                              </div>
                              {/* Shopify reference */}
                              <div className="text-center shrink-0 w-14">
                                <p className="text-[10px] text-[#9b9b93] uppercase tracking-wide">Shopify</p>
                                <p className="text-sm font-medium text-[#9b9b93]">{v.stock_quantity ?? 0}</p>
                              </div>
                              {/* Actual count input */}
                              <input
                                type="number"
                                min="0"
                                placeholder="—"
                                value={quantities[v.shopify_variant_id] ?? ''}
                                onChange={(e) => setQuantities((q) => ({ ...q, [v.shopify_variant_id]: e.target.value }))}
                                className={`w-20 rounded-xl border px-3 py-2 text-sm text-center text-[#1a1a2e] focus:outline-none focus:ring-2 focus:ring-[#aeb0c9]/40 shrink-0 ${
                                  filled ? 'border-[#f0a500] bg-white font-semibold' : 'border-[#e8e4e0] bg-white'
                                }`}
                              />
                            </div>
                          )
                        })}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* Error */}
        {error && (
          <p className="text-sm text-[#c7293a] bg-[#fce8ea] rounded-xl px-4 py-3">{error}</p>
        )}

        {/* Submit */}
        <button
          onClick={handleSubmit}
          disabled={submitting || loading || !cutoffDate}
          className="w-full py-3.5 rounded-xl bg-[#1a1a2e] text-white font-semibold text-sm disabled:opacity-40 disabled:cursor-not-allowed hover:bg-[#2a2a3e] transition-colors"
        >
          {submitting ? 'Submitting…' : 'Submit count'}
        </button>

      </div>
    </div>
  )
}
