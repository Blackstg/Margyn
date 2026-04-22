'use client'

export const dynamic = 'force-dynamic'

import React, { useState, useEffect, useCallback, useRef } from 'react'
import { createBrowserClient } from '@supabase/auth-helpers-nextjs'
import { Plus, Trash2, Check, Loader2, ChevronLeft, ChevronRight, Search, X, Pencil } from 'lucide-react'

// ─── Supabase ─────────────────────────────────────────────────────────────────

const supabase = createBrowserClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

// ─── Types ────────────────────────────────────────────────────────────────────

type BrandTab = 'bowa' | 'moom' | 'krom'
type SaveState = 'idle' | 'saving' | 'saved' | 'error'

interface CostRow {
  id: string
  dbId?: string
  label: string
  amount: string
}

interface Config {
  roasTarget: string
  stockThreshold: string
}

// ─── Constants ────────────────────────────────────────────────────────────────

const SENTINEL = '1900-01-01'

const BRAND_LABELS: Record<BrandTab, string> = {
  bowa: 'Bowa Concept',
  moom: 'Mōom Paris',
  krom: 'Krom',
}

const DEFAULT_BOWA_TEAM: Omit<CostRow, 'id'>[] = [
  { label: 'Léa',      amount: '1300' },
  { label: 'Clem',     amount: '900'  },
  { label: 'Marine',   amount: '850'  },
  { label: 'Flo',      amount: '800'  },
  { label: 'Lennie',   amount: '500'  },
  { label: 'Valentin', amount: '450'  },
  { label: 'Satiana',  amount: '450'  },
]

const DEFAULT_BOWA_INFRA: Omit<CostRow, 'id'>[] = [
  { label: 'Dépôt Bourges', amount: '1233' },
  { label: 'Crédit Camion', amount: '545'  },
  { label: 'Crédit WV',     amount: '1268' },
  { label: 'Dépôt Yvrac',   amount: '1440' },
  { label: 'Crédit Clark',  amount: '184'  },
  { label: 'Compa',         amount: '650'  },
]

const DEFAULT_BOWA_FULFILLMENT_FIXED: Omit<CostRow, 'id'>[] = [
  { label: 'Khalid (livraison)', amount: '5000' },
]

const DEFAULT_BOWA_VARIABLE: Omit<CostRow, 'id'>[] = [
  { label: 'CB Frais Khalid', amount: '' },
  { label: 'CB Frais Enzo',   amount: '' },
  { label: 'Facture Enzo',    amount: '' },
  { label: 'Total Energie',   amount: '' },
]

const DEFAULT_SUPPLEMENTARY: Omit<CostRow, 'id'>[] = [
  { label: 'B2B Pennylane',     amount: '' },
  { label: 'Leroy Merlin (Adeo)', amount: '' },
  { label: 'Zettle (TPE Khalid)', amount: '' },
]
const FIXED_SUPP_LABELS = new Set(DEFAULT_SUPPLEMENTARY.map((s) => s.label))

const DEFAULT_MOOM_TEAM: Omit<CostRow, 'id'>[] = [
  { label: 'Ghiles',   amount: '1000' },
  { label: 'Marine',   amount: '850'  },
  { label: 'Clem',     amount: '700'  },
  { label: 'Flo',      amount: '800'  },
  { label: 'Valentin', amount: '450'  },
  { label: 'Satiana',  amount: '450'  },
]

const DEFAULT_MOOM_APPS: Omit<CostRow, 'id'>[] = [
  { label: 'Trackr',             amount: '8'   },
  { label: 'Hey Low Stock',      amount: '5'   },
  { label: 'Hextom Sales Boost', amount: '9'   },
  { label: 'Rivo Loyalty',       amount: '45'  },
  { label: 'Stamped Reviews',    amount: '17'  },
  { label: 'Timesact Pre-order', amount: '9'   },
  { label: 'ZipChat AI Chatbot', amount: '119' },
  { label: 'Sufio Invoices',     amount: '45'  },
  { label: 'Buddha Mega Menu',   amount: '9'   },
]

const DEFAULT_KROM_TEAM: Omit<CostRow, 'id'>[] = [
  { label: 'Flo', amount: '500' },
]

const DEFAULT_KROM_APPS: Omit<CostRow, 'id'>[] = [
  { label: 'Rapi Tracking',   amount: '14' },
  { label: 'ZipChat',         amount: '45' },
  { label: 'Trackr',          amount: '5'  },
  { label: 'Stamped Reviews', amount: '21' },
]

const DEFAULT_BOWA_APPS: Omit<CostRow, 'id'>[] = [
  { label: 'Essential Countdown Timer', amount: '28'  },
  { label: 'Minmaxify',                 amount: '9'   },
  { label: 'Rivo Loyalty',              amount: '45'  },
  { label: 'Timesact Pre-order',        amount: '19'  },
  { label: 'WOD PreOrder',              amount: '55'  },
  { label: 'Buddha Mega Menu',          amount: '9'   },
  { label: 'ShipX',                     amount: '9'   },
  { label: 'Sufio Invoices',            amount: '45'  },
  { label: 'Essential Free Shipping',   amount: '14'  },
  { label: 'Stamped Reviews',           amount: '21'  },
]

// ─── Helpers ──────────────────────────────────────────────────────────────────

function uid() { return Math.random().toString(36).slice(2) }

function currentMonthStart(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`
}

function prevMonthStart(): string {
  const d = new Date()
  d.setDate(1)
  d.setMonth(d.getMonth() - 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`
}

function shiftMonth(monthStr: string, delta: number): string {
  const d = new Date(monthStr + 'T00:00:00')
  d.setMonth(d.getMonth() + delta)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`
}

function fmtMonthLabel(monthStr: string): string {
  const d = new Date(monthStr + 'T00:00:00')
  return d.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' })
}

function rowsFromDefaults(defs: Omit<CostRow, 'id'>[]): CostRow[] {
  return defs.map((d) => ({ ...d, id: uid() }))
}

interface DbCostRow { id: string; label: string; amount: number | null }

function rowsFromDb(rows: DbCostRow[]): CostRow[] {
  return rows.map((r) => ({ id: uid(), dbId: r.id, label: r.label, amount: String(r.amount ?? '') }))
}

function totalOf(rows: CostRow[]): number {
  return rows.reduce((sum, r) => sum + (parseFloat(r.amount) || 0), 0)
}

const fmtEur = (n: number) =>
  new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(n)

// ─── SaveButton ───────────────────────────────────────────────────────────────

function SaveButton({ state, onClick }: { state: SaveState; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      disabled={state === 'saving' || state === 'saved'}
      className={`inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
        state === 'saved'  ? 'bg-[#f0edf8] text-[#6d6e8a] border border-[#c9b8d8]' :
        state === 'error'  ? 'bg-[#fde8ea] text-[#c7293a] border border-[#f5b8be]' :
        'bg-[#1a1a2e] text-white hover:bg-[#2d2d4a] border border-transparent'
      }`}
    >
      {state === 'saving' && <Loader2 size={14} className="animate-spin" />}
      {state === 'saved'  && <Check size={14} />}
      {state === 'saving' ? 'Enregistrement…' : state === 'saved' ? 'Enregistré' : state === 'error' ? 'Erreur' : 'Enregistrer'}
    </button>
  )
}

// ─── MonthNav ─────────────────────────────────────────────────────────────────

function MonthNav({ month, onChange, maxMonth }: { month: string; onChange: (m: string) => void; maxMonth?: string }) {
  const max = maxMonth ?? currentMonthStart()
  return (
    <div className="flex items-center gap-1">
      <button
        onClick={() => onChange(shiftMonth(month, -1))}
        className="p-1.5 rounded-lg text-[#6b6b63] hover:text-[#1a1a2e] hover:bg-[#f0f0ee] transition-all"
      >
        <ChevronLeft size={15} strokeWidth={2} />
      </button>
      <span className="text-sm font-semibold text-[#1a1a2e] w-36 text-center capitalize">
        {fmtMonthLabel(month)}
      </span>
      <button
        onClick={() => onChange(shiftMonth(month, 1))}
        disabled={month >= max}
        className="p-1.5 rounded-lg text-[#6b6b63] hover:text-[#1a1a2e] hover:bg-[#f0f0ee] transition-all disabled:opacity-30 disabled:cursor-not-allowed"
      >
        <ChevronRight size={15} strokeWidth={2} />
      </button>
    </div>
  )
}

// ─── FixedSubSection — read-only with inline edit toggle ─────────────────────

function FixedSubSection({
  title,
  note,
  rows,
  onRowChange,
  onAdd,
  onDelete,
  saveState,
  onSave,
}: {
  title: string
  note?: string
  rows: CostRow[]
  onRowChange: (id: string, field: 'label' | 'amount', value: string) => void
  onAdd: () => void
  onDelete: (id: string) => void
  saveState: SaveState
  onSave: () => void
}) {
  const [editing, setEditing] = useState(false)
  const total = totalOf(rows)

  return (
    <div className="border-b border-[#f0f0ee] last:border-0">
      <div className="flex items-center justify-between px-6 py-3">
        <div>
          <p className="text-sm font-medium text-[#1a1a2e]">{title}</p>
          {note && <p className="text-xs text-[#9b9b93] mt-0.5">{note}</p>}
        </div>
        <div className="flex items-center gap-3">
          <span className="text-sm font-semibold text-[#1a1a2e]">{fmtEur(total)}<span className="text-xs font-normal text-[#9b9b93]">/mois</span></span>
          {!editing && (
            <button
              onClick={() => setEditing(true)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-[#6b6b63] border border-[#e8e8e4] hover:border-[#1a1a2e] hover:text-[#1a1a2e] transition-all"
            >
              <Pencil size={11} strokeWidth={2} />
              Modifier
            </button>
          )}
        </div>
      </div>

      {/* Compact view */}
      {!editing && (
        <div className="px-6 pb-3 flex flex-wrap gap-x-4 gap-y-1">
          {rows.map((r) => (
            <span key={r.id} className="text-xs text-[#6b6b63]">
              {r.label} <span className="font-medium text-[#1a1a2e]">{fmtEur(parseFloat(r.amount) || 0)}</span>
            </span>
          ))}
        </div>
      )}

      {/* Edit mode */}
      {editing && (
        <div className="px-6 pb-4 space-y-2">
          {rows.map((row) => (
            <div key={row.id} className="flex items-center gap-3">
              <input
                type="text"
                value={row.label}
                onChange={(e) => onRowChange(row.id, 'label', e.target.value)}
                placeholder="Label"
                className="flex-1 text-sm text-[#1a1a18] bg-[#faf9f8] border border-[#e8e8e4] rounded-lg px-3 py-1.5 focus:border-[#1a1a2e] outline-none transition-colors"
              />
              <input
                type="number"
                value={row.amount}
                onChange={(e) => onRowChange(row.id, 'amount', e.target.value)}
                min="0"
                step="50"
                className="w-24 text-right text-sm text-[#1a1a18] bg-[#faf9f8] border border-[#e8e8e4] rounded-lg px-3 py-1.5 focus:border-[#1a1a2e] outline-none transition-colors"
              />
              <span className="text-xs text-[#6b6b63] shrink-0">€/mois</span>
              <button
                onClick={() => onDelete(row.id)}
                className="p-1.5 rounded-md text-[#6b6b63] hover:text-[#c7293a] hover:bg-[#fde8ea] transition-all"
              >
                <Trash2 size={13} strokeWidth={1.8} />
              </button>
            </div>
          ))}
          <button
            onClick={onAdd}
            className="inline-flex items-center gap-1.5 text-xs text-[#6b6b63] hover:text-[#1a1a2e] transition-colors mt-1"
          >
            <Plus size={12} strokeWidth={2} /> Ajouter une ligne
          </button>
          <div className="flex items-center justify-end gap-3 mt-3 pt-3 border-t border-[#f0f0ee]">
            <button
              onClick={() => setEditing(false)}
              className="text-sm text-[#6b6b63] hover:text-[#1a1a2e] transition-colors"
            >
              Annuler
            </button>
            <SaveButton
              state={saveState}
              onClick={() => { onSave(); if (saveState !== 'error') setTimeout(() => setEditing(false), 800) }}
            />
          </div>
        </div>
      )}
    </div>
  )
}

// ─── VariableSection — monthly inputs with fixed defaults + free rows ─────────

function VariableSection({
  title,
  note,
  rows,
  fixedLabels,
  onRowChange,
  onAdd,
  onDelete,
  saveState,
  onSave,
  loading,
  unit = '€',
}: {
  title: string
  note?: string
  rows: CostRow[]
  fixedLabels?: Set<string>
  onRowChange: (id: string, field: 'label' | 'amount', value: string) => void
  onAdd: () => void
  onDelete: (id: string) => void
  saveState: SaveState
  onSave: () => void
  loading?: boolean
  unit?: string
}) {
  const total = totalOf(rows)

  return (
    <div className="bg-white rounded-[20px] shadow-[0_2px_16px_rgba(0,0,0,0.06)] overflow-hidden">
      <div className="px-6 py-4 border-b border-[#f0f0ee]">
        <h3 className="text-sm font-semibold text-[#1a1a2e]">{title}</h3>
        {note && <p className="text-xs text-[#6b6b63] mt-0.5">{note}</p>}
      </div>

      <div className="divide-y divide-[#f0f0ee]">
        {loading ? (
          <div className="px-6 py-4 space-y-2">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="h-8 bg-[#f5f5f3] rounded-lg animate-pulse" />
            ))}
          </div>
        ) : rows.map((row) => (
          <div key={row.id} className="flex items-center gap-3 px-6 py-3">
            {fixedLabels?.has(row.label) ? (
              <span className="flex-1 text-sm text-[#1a1a18] font-medium">{row.label}</span>
            ) : (
              <input
                type="text"
                value={row.label}
                onChange={(e) => onRowChange(row.id, 'label', e.target.value)}
                placeholder="Libellé"
                className="flex-1 text-sm text-[#1a1a18] bg-transparent border-b border-transparent hover:border-[#e8e8e4] focus:border-[#1a1a18] outline-none transition-colors py-0.5"
              />
            )}
            <div className="flex items-center gap-1.5">
              <input
                type="number"
                value={row.amount}
                onChange={(e) => onRowChange(row.id, 'amount', e.target.value)}
                min="0"
                step="50"
                placeholder="0"
                className="w-28 text-right text-sm text-[#1a1a18] bg-[#faf9f8] border border-[#e8e8e4] rounded-lg px-3 py-1.5 focus:border-[#1a1a2e] outline-none transition-colors"
              />
              <span className="text-xs text-[#6b6b63] shrink-0">{unit}</span>
            </div>
            {!fixedLabels?.has(row.label) && (
              <button
                onClick={() => onDelete(row.id)}
                className="p-1.5 rounded-md text-[#6b6b63] hover:text-[#c7293a] hover:bg-[#fde8ea] transition-all"
              >
                <Trash2 size={13} strokeWidth={1.8} />
              </button>
            )}
            {fixedLabels?.has(row.label) && <div className="w-7" />}
          </div>
        ))}
      </div>

      <div className="flex items-center justify-between px-6 py-4 border-t border-[#f0f0ee] bg-[#f8f8f6]">
        <div className="flex items-center gap-3">
          <button
            onClick={onAdd}
            className="inline-flex items-center gap-1.5 text-xs text-[#6b6b63] hover:text-[#1a1a2e] transition-colors"
          >
            <Plus size={12} strokeWidth={2} /> Ajouter une ligne
          </button>
          {total > 0 && (
            <span className="text-xs text-[#6b6b63]">
              Total : <span className="font-semibold text-[#1a1a18]">{fmtEur(total)}</span>
            </span>
          )}
        </div>
        <SaveButton state={saveState} onClick={onSave} />
      </div>
    </div>
  )
}

// ─── ExclusionSection ─────────────────────────────────────────────────────────

function ExclusionSection({ brand }: { brand: BrandTab }) {
  const [excluded, setExcluded]     = useState<string[]>([])
  const [query, setQuery]           = useState('')
  const [results, setResults]       = useState<string[]>([])
  const [open, setOpen]             = useState(false)
  const [searching, setSearching]   = useState(false)
  const wrapperRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    async function init() {
      const [{ data: excl }, { data: strapProducts }] = await Promise.all([
        supabase.from('product_exclusions').select('product_title').eq('brand', brand),
        supabase.from('products').select('title').eq('brand', brand).ilike('title', '%Strap%'),
      ])
      const currentExcluded = (excl ?? []).map((r) => r.product_title)
      const strapTitles = [...new Set((strapProducts ?? []).map((r) => r.title))]
      const toAdd = strapTitles.filter((t) => !currentExcluded.includes(t))
      if (toAdd.length > 0) {
        const { error } = await supabase.from('product_exclusions').upsert(
          toAdd.map((product_title) => ({ brand, product_title })),
          { onConflict: 'brand,product_title' }
        )
        setExcluded(error ? currentExcluded : [...currentExcluded, ...toAdd])
      } else {
        setExcluded(currentExcluded)
      }
    }
    init()
  }, [brand])

  useEffect(() => {
    if (!query.trim()) { setResults([]); setOpen(false); return }
    const timer = setTimeout(async () => {
      setSearching(true)
      const { data } = await supabase
        .from('products').select('title').eq('brand', brand).ilike('title', `%${query}%`).limit(8)
      setResults((data ?? []).map((r) => r.title))
      setOpen(true)
      setSearching(false)
    }, 300)
    return () => clearTimeout(timer)
  }, [query, brand])

  useEffect(() => {
    function handle(e: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handle)
    return () => document.removeEventListener('mousedown', handle)
  }, [])

  async function addExclusion(title: string) {
    const { error } = await supabase.from('product_exclusions').upsert({ brand, product_title: title }, { onConflict: 'brand,product_title' })
    if (!error) setExcluded((prev) => [...prev, title])
    setQuery(''); setResults([]); setOpen(false)
  }

  async function removeExclusion(title: string) {
    const { error } = await supabase.from('product_exclusions').delete().eq('brand', brand).eq('product_title', title)
    if (!error) setExcluded((prev) => prev.filter((t) => t !== title))
  }

  const available = results.filter((t) => !excluded.includes(t))

  return (
    <div className="bg-white rounded-[20px] shadow-[0_2px_16px_rgba(0,0,0,0.06)]">
      <div className="px-6 py-4 border-b border-[#f0f0ee] rounded-t-[20px]">
        <h3 className="text-sm font-semibold text-[#1a1a2e]">Produits exclus du suivi</h3>
        <p className="text-xs text-[#6b6b63] mt-0.5">Ces produits n&apos;apparaissent pas dans Meilleures ventes ni Stock critique</p>
      </div>
      <div ref={wrapperRef} className="px-6 py-4 border-b border-[#f0f0ee] relative">
        <div className="relative">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#9b9b93]" />
          {searching && <Loader2 size={13} className="absolute right-3 top-1/2 -translate-y-1/2 text-[#9b9b93] animate-spin" />}
          <input
            type="text" value={query}
            onChange={(e) => setQuery(e.target.value)}
            onFocus={() => available.length > 0 && setOpen(true)}
            placeholder="Rechercher un produit à exclure…"
            className="w-full pl-8 pr-8 py-2 text-sm border border-[#e8e8e4] rounded-lg focus:border-[#1a1a2e] outline-none transition-colors bg-[#faf9f8]"
          />
        </div>
        {open && available.length > 0 && (
          <div className="absolute left-6 right-6 top-[calc(100%-8px)] mt-1 bg-white border border-[#e8e8e4] rounded-xl shadow-[0_8px_24px_rgba(0,0,0,0.12)] z-50 max-h-[240px] overflow-y-auto">
            {available.map((title) => (
              <button key={title} onMouseDown={(e) => e.preventDefault()} onClick={() => addExclusion(title)}
                className="w-full text-left px-4 py-2.5 text-sm text-[#1a1a2e] hover:bg-[#faf9f8] transition-colors flex items-center justify-between gap-2 border-b border-[#f0f0ee] last:border-0">
                <span className="truncate">{title}</span>
                <span className="text-[10px] text-[#aeb0c9] font-medium shrink-0">Exclure</span>
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="px-6 py-4 rounded-b-[20px]">
        {excluded.length === 0 ? (
          <p className="text-sm text-[#9b9b93]">Aucun produit exclu.</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {excluded.map((title) => (
              <span key={title} className="inline-flex items-center gap-1.5 pl-3 pr-1.5 py-1 rounded-full bg-[#f5f0f2] text-xs font-medium text-[#1a1a2e] max-w-[260px]">
                <span className="truncate">{title}</span>
                <button onClick={() => removeExclusion(title)} className="shrink-0 w-4 h-4 rounded-full flex items-center justify-center text-[#9b9b93] hover:text-[#c7293a] hover:bg-[#fde8ea] transition-all">
                  <X size={10} strokeWidth={2.5} />
                </button>
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

type FixedKey = 'bowaTeam' | 'bowaInfra' | 'bowaFulfillmentFixed'
type AppKey   = 'bowaApp' | 'moomTeam' | 'moomApp' | 'kromTeam' | 'kromApp'
type AllKey   = FixedKey | AppKey

export default function SettingsPage() {
  const [activeBrand, setActiveBrand]       = useState<BrandTab>('bowa')
  const [allowedBrands, setAllowedBrands]   = useState<BrandTab[] | null>(null)

  // ── Fixed sentinel rows ──────────────────────────────────────────────────
  const [fixedRows, setFixedRows] = useState<Record<AllKey, CostRow[]>>({
    bowaTeam:            rowsFromDefaults(DEFAULT_BOWA_TEAM),
    bowaInfra:           rowsFromDefaults(DEFAULT_BOWA_INFRA),
    bowaFulfillmentFixed:rowsFromDefaults(DEFAULT_BOWA_FULFILLMENT_FIXED),
    bowaApp:             rowsFromDefaults(DEFAULT_BOWA_APPS),
    moomTeam:            rowsFromDefaults(DEFAULT_MOOM_TEAM),
    moomApp:             rowsFromDefaults(DEFAULT_MOOM_APPS),
    kromTeam:            rowsFromDefaults(DEFAULT_KROM_TEAM),
    kromApp:             rowsFromDefaults(DEFAULT_KROM_APPS),
  })
  const [fixedSave, setFixedSave] = useState<Record<AllKey, SaveState>>({
    bowaTeam: 'idle', bowaInfra: 'idle', bowaFulfillmentFixed: 'idle',
    bowaApp: 'idle', moomTeam: 'idle', moomApp: 'idle', kromTeam: 'idle', kromApp: 'idle',
  })

  // ── Monthly variable charges (bowa only) ─────────────────────────────────
  const [selectedMonth, setSelectedMonth]   = useState<string>(prevMonthStart)
  const [varRows, setVarRows]               = useState<CostRow[]>(rowsFromDefaults(DEFAULT_BOWA_VARIABLE))
  const [varSave, setVarSave]               = useState<SaveState>('idle')
  const [varLoading, setVarLoading]         = useState(false)

  // ── Monthly supplementary CA (bowa only) ─────────────────────────────────
  const [suppRows, setSuppRows]             = useState<CostRow[]>(rowsFromDefaults(DEFAULT_SUPPLEMENTARY))
  const [suppSave, setSuppSave]             = useState<SaveState>('idle')
  const [suppLoading, setSuppLoading]       = useState(false)

  // ── Shipping (moom / krom) ───────────────────────────────────────────────
  const [shippingCosts, setShippingCosts]   = useState<Record<BrandTab, string>>({ bowa: '17', moom: '17', krom: '27.21' })
  const [shippingSave, setShippingSave]     = useState<Record<BrandTab, SaveState>>({ bowa: 'idle', moom: 'idle', krom: 'idle' })

  // ── Config ───────────────────────────────────────────────────────────────
  const [config, setConfig]                 = useState<Config>({ roasTarget: '3.0', stockThreshold: '20' })
  const [configSave, setConfigSave]         = useState<SaveState>('idle')
  const [loading, setLoading]               = useState(true)

  // ─── Load sentinel costs ──────────────────────────────────────────────────

  const loadFixed = useCallback(async () => {
    setLoading(true)
    const [{ data }, { data: shippingData }] = await Promise.all([
      supabase.from('fixed_costs').select('id, label, amount, category, brand').eq('month', SENTINEL),
      supabase.from('brand_settings').select('brand, shipping_cost_per_order'),
    ])

    const get = (brand: string, category: string) =>
      (data ?? []).filter((r) => r.brand === brand && r.category === category)

    const bowaTeamDb        = get('bowa', 'team')
    const bowaInfraDb       = get('bowa', 'infra')
    const bowaFulfillmentDb = get('bowa', 'fulfillment')
    const bowaAppDb         = get('bowa', 'app')
    const moomTeamDb        = get('moom', 'team')
    const moomAppDb         = get('moom', 'app')
    const kromTeamDb        = get('krom', 'team')
    const kromAppDb         = get('krom', 'app')

    setFixedRows((prev) => ({
      ...prev,
      bowaTeam:             bowaTeamDb.length        > 0 ? rowsFromDb(bowaTeamDb)        : rowsFromDefaults(DEFAULT_BOWA_TEAM),
      bowaInfra:            bowaInfraDb.length       > 0 ? rowsFromDb(bowaInfraDb)       : rowsFromDefaults(DEFAULT_BOWA_INFRA),
      bowaFulfillmentFixed: bowaFulfillmentDb.length > 0 ? rowsFromDb(bowaFulfillmentDb) : rowsFromDefaults(DEFAULT_BOWA_FULFILLMENT_FIXED),
      bowaApp:              bowaAppDb.length         > 0 ? rowsFromDb(bowaAppDb)         : rowsFromDefaults(DEFAULT_BOWA_APPS),
      moomTeam:             moomTeamDb.length        > 0 ? rowsFromDb(moomTeamDb)        : rowsFromDefaults(DEFAULT_MOOM_TEAM),
      moomApp:              moomAppDb.length         > 0 ? rowsFromDb(moomAppDb)         : rowsFromDefaults(DEFAULT_MOOM_APPS),
      kromTeam:             kromTeamDb.length        > 0 ? rowsFromDb(kromTeamDb)        : rowsFromDefaults(DEFAULT_KROM_TEAM),
      kromApp:              kromAppDb.length         > 0 ? rowsFromDb(kromAppDb)         : rowsFromDefaults(DEFAULT_KROM_APPS),
    }))

    if (shippingData) {
      const map = Object.fromEntries(shippingData.map((r) => [r.brand, String(r.shipping_cost_per_order ?? 17)])) as Partial<Record<BrandTab, string>>
      setShippingCosts((prev) => ({ ...prev, ...map }))
    }
    setLoading(false)
  }, [])

  // ─── Load monthly variable fulfillment charges ────────────────────────────

  const loadVar = useCallback(async (month: string) => {
    setVarLoading(true)
    const { data } = await supabase
      .from('fixed_costs').select('id, label, amount')
      .eq('month', month).eq('brand', 'bowa').eq('category', 'fulfillment')
      .neq('month', SENTINEL)

    if (data && data.length > 0) {
      // Merge DB rows with defaults: show defaults first, then extra rows
      const dbMap = new Map<string, DbCostRow>(data.map((r) => [r.label, r as DbCostRow]))
      const defaultLabels = DEFAULT_BOWA_VARIABLE.map((d) => d.label)
      const merged: CostRow[] = DEFAULT_BOWA_VARIABLE.map((d) => {
        const dbRow = dbMap.get(d.label)
        if (dbRow) {
          return { id: uid(), dbId: dbRow.id, label: dbRow.label, amount: String(dbRow.amount ?? '') }
        }
        return { id: uid(), label: d.label, amount: '' }
      })
      // Extra rows not in defaults
      const extras = data.filter((r) => !defaultLabels.includes(r.label))
      setVarRows([...merged, ...rowsFromDb(extras as DbCostRow[])])
    } else {
      setVarRows(rowsFromDefaults(DEFAULT_BOWA_VARIABLE))
    }
    setVarLoading(false)
  }, [])

  // ─── Load monthly supplementary CA ───────────────────────────────────────

  const loadSupp = useCallback(async (month: string) => {
    setSuppLoading(true)
    const { data } = await supabase
      .from('supplementary_revenue').select('id, source, amount')
      .eq('brand', 'bowa').eq('month', month)

    if (!data || data.length === 0) {
      setSuppRows(rowsFromDefaults(DEFAULT_SUPPLEMENTARY))
    } else {
      const dbMap = new Map(data.map((r) => [r.source, r]))
      const defaultLabels = DEFAULT_SUPPLEMENTARY.map((d) => d.label)
      const merged: CostRow[] = DEFAULT_SUPPLEMENTARY.map((d) => {
        const dbRow = dbMap.get(d.label)
        if (dbRow) return { id: uid(), dbId: String(dbRow.id), label: dbRow.source, amount: String(dbRow.amount ?? '') }
        return { id: uid(), label: d.label, amount: '' }
      })
      const extras = data.filter((r) => !defaultLabels.includes(r.source))
      setSuppRows([...merged, ...extras.map((r) => ({ id: uid(), dbId: String(r.id), label: r.source, amount: String(r.amount ?? '') }))])
    }
    setSuppLoading(false)
  }, [])

  // ─── Effects ──────────────────────────────────────────────────────────────

  useEffect(() => {
    supabase.from('user_brands').select('brand').then(({ data }) => {
      if (data && data.length > 0) {
        const brands = data.map((r: { brand: string }) => r.brand) as BrandTab[]
        setAllowedBrands(brands)
        if (!brands.includes(activeBrand)) setActiveBrand(brands[0])
      }
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    loadFixed()
    const stored = localStorage.getItem('steero_config')
    if (stored) { try { setConfig(JSON.parse(stored)) } catch {} }
  }, [loadFixed])

  useEffect(() => { loadVar(selectedMonth) }, [selectedMonth, loadVar])
  useEffect(() => { loadSupp(selectedMonth) }, [selectedMonth, loadSupp])

  // ─── Fixed rows helpers ───────────────────────────────────────────────────

  function makeFixedHandlers(key: AllKey) {
    return {
      onRowChange: (id: string, field: 'label' | 'amount', value: string) =>
        setFixedRows((prev) => ({ ...prev, [key]: prev[key].map((r) => r.id === id ? { ...r, [field]: value } : r) })),
      onAdd: () =>
        setFixedRows((prev) => ({ ...prev, [key]: [...prev[key], { id: uid(), label: '', amount: '' }] })),
      onDelete: (id: string) =>
        setFixedRows((prev) => ({ ...prev, [key]: prev[key].filter((r) => r.id !== id) })),
    }
  }

  // ─── Save fixed sentinel ──────────────────────────────────────────────────

  async function saveFixed(key: AllKey, brand: string, category: string) {
    const currentRows = fixedRows[key]
    setFixedSave((prev) => ({ ...prev, [key]: 'saving' }))
    const valid = currentRows.filter((r) => r.label.trim() && parseFloat(r.amount) > 0)
    try {
      const { error: delError } = await supabase.from('fixed_costs').delete()
        .eq('month', SENTINEL).eq('category', category).eq('brand', brand)
      if (delError) throw delError
      if (valid.length > 0) {
        const { error: insError } = await supabase.from('fixed_costs').insert(
          valid.map((r) => ({ month: SENTINEL, category, brand, label: r.label.trim(), amount: parseFloat(r.amount) }))
        )
        if (insError) throw insError
      }
      setFixedSave((prev) => ({ ...prev, [key]: 'saved' }))
      setTimeout(() => setFixedSave((prev) => ({ ...prev, [key]: 'idle' })), 2500)
      loadFixed()
    } catch {
      setFixedSave((prev) => ({ ...prev, [key]: 'error' }))
      setTimeout(() => setFixedSave((prev) => ({ ...prev, [key]: 'idle' })), 3000)
    }
  }

  // ─── Save monthly variable fulfillment charges ────────────────────────────

  async function saveVar() {
    setVarSave('saving')
    const valid = varRows.filter((r) => r.label.trim() && parseFloat(r.amount) > 0)
    try {
      await supabase.from('fixed_costs').delete()
        .eq('month', selectedMonth).eq('brand', 'bowa').eq('category', 'fulfillment')
      if (valid.length > 0) {
        const { error } = await supabase.from('fixed_costs').insert(
          valid.map((r) => ({ month: selectedMonth, brand: 'bowa', category: 'fulfillment', label: r.label.trim(), amount: parseFloat(r.amount) }))
        )
        if (error) throw error
      }
      setVarSave('saved')
      setTimeout(() => setVarSave('idle'), 2500)
      loadVar(selectedMonth)
    } catch {
      setVarSave('error')
      setTimeout(() => setVarSave('idle'), 3000)
    }
  }

  // ─── Save monthly supplementary CA ───────────────────────────────────────

  async function saveSupp() {
    setSuppSave('saving')
    const valid = suppRows.filter((r) => r.label.trim() && parseFloat(r.amount) > 0)
    try {
      await supabase.from('supplementary_revenue').delete().eq('brand', 'bowa').eq('month', selectedMonth)
      if (valid.length > 0) {
        const { error } = await supabase.from('supplementary_revenue').insert(
          valid.map((r) => ({ brand: 'bowa', month: selectedMonth, source: r.label.trim(), amount: parseFloat(r.amount) }))
        )
        if (error) throw error
      }
      setSuppSave('saved')
      setTimeout(() => setSuppSave('idle'), 2500)
      loadSupp(selectedMonth)
    } catch {
      setSuppSave('error')
      setTimeout(() => setSuppSave('idle'), 3000)
    }
  }

  // ─── Save shipping ────────────────────────────────────────────────────────

  async function saveShipping(brand: BrandTab) {
    const rate = parseFloat(shippingCosts[brand])
    if (isNaN(rate) || rate < 0) return
    setShippingSave((prev) => ({ ...prev, [brand]: 'saving' }))
    try {
      const { error } = await supabase.from('brand_settings').upsert({ brand, shipping_cost_per_order: rate }, { onConflict: 'brand' })
      if (error) throw error
      setShippingSave((prev) => ({ ...prev, [brand]: 'saved' }))
      setTimeout(() => setShippingSave((prev) => ({ ...prev, [brand]: 'idle' })), 2500)
    } catch {
      setShippingSave((prev) => ({ ...prev, [brand]: 'error' }))
      setTimeout(() => setShippingSave((prev) => ({ ...prev, [brand]: 'idle' })), 3000)
    }
  }

  // ─── Save config ──────────────────────────────────────────────────────────

  function saveConfig() {
    setConfigSave('saving')
    try {
      localStorage.setItem('steero_config', JSON.stringify(config))
      setConfigSave('saved')
      setTimeout(() => setConfigSave('idle'), 2500)
    } catch {
      setConfigSave('error')
      setTimeout(() => setConfigSave('idle'), 3000)
    }
  }

  // ─── Var row helpers ──────────────────────────────────────────────────────

  const varFixedLabels = new Set(DEFAULT_BOWA_VARIABLE.map((d) => d.label))

  function varChange(id: string, field: 'label' | 'amount', value: string) {
    setVarRows((prev) => prev.map((r) => r.id === id ? { ...r, [field]: value } : r))
  }
  function varAdd() { setVarRows((prev) => [...prev, { id: uid(), label: '', amount: '' }]) }
  function varDelete(id: string) { setVarRows((prev) => prev.filter((r) => r.id !== id)) }

  function suppChange(id: string, field: 'label' | 'amount', value: string) {
    setSuppRows((prev) => prev.map((r) => r.id === id ? { ...r, [field]: value } : r))
  }
  function suppAdd() { setSuppRows((prev) => [...prev, { id: uid(), label: '', amount: '' }]) }
  function suppDelete(id: string) { setSuppRows((prev) => prev.filter((r) => r.id !== id)) }

  // ─── Totals ───────────────────────────────────────────────────────────────

  const b = activeBrand
  const totalFixed = b === 'bowa'
    ? totalOf(fixedRows.bowaTeam) + totalOf(fixedRows.bowaInfra) + totalOf(fixedRows.bowaFulfillmentFixed)
    : b === 'moom'
    ? totalOf(fixedRows.moomTeam) + totalOf(fixedRows.moomApp)
    : totalOf(fixedRows.kromTeam) + totalOf(fixedRows.kromApp)

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-[#faf9f8]">
      <main className="max-w-3xl mx-auto px-6 py-8 space-y-6">

        {/* Header */}
        <div>
          <h1 className="text-xl font-bold text-[#1a1a18] tracking-tight">Paramètres</h1>
          <p className="text-sm text-[#6b6b63] mt-1">Charges et revenus par marque</p>
        </div>

        {/* Brand selector */}
        <div className="flex items-center gap-3">
          <div className="inline-flex items-center bg-white shadow-[0_2px_16px_rgba(0,0,0,0.06)] rounded-xl p-1 gap-0.5">
            {(['bowa', 'moom', 'krom'] as BrandTab[]).filter((brand) => allowedBrands?.includes(brand) ?? false).map((brand) => (
              <button key={brand} onClick={() => setActiveBrand(brand)}
                className={`px-5 py-2 rounded-lg text-sm font-semibold transition-all ${activeBrand === brand ? 'bg-[#1a1a2e] text-white' : 'text-[#6b6b63] hover:text-[#1a1a2e]'}`}>
                {BRAND_LABELS[brand]}
              </button>
            ))}
          </div>
          {!loading && (
            <span className="text-xs text-[#6b6b63]">
              Fixes : <span className="font-semibold text-[#1a1a18]">{fmtEur(totalFixed)}/mois</span>
            </span>
          )}
        </div>

        {loading ? (
          <div className="space-y-3">
            {[1, 2, 3].map((i) => <div key={i} className="bg-white rounded-[20px] h-40 animate-pulse shadow-[0_2px_16px_rgba(0,0,0,0.06)]" />)}
          </div>
        ) : (
          <div className="space-y-5">

            {/* ── BOWA SECTION ───────────────────────────────────────────── */}
            {b === 'bowa' && (
              <>
                {/* Charges fixes */}
                <div>
                  <p className="text-xs font-semibold text-[#6b6b63] uppercase tracking-wider mb-3">Charges fixes — reconduites automatiquement</p>
                  <div className="bg-white rounded-[20px] shadow-[0_2px_16px_rgba(0,0,0,0.06)] overflow-hidden">
                    <FixedSubSection
                      title="Salaires équipe"
                      rows={fixedRows.bowaTeam}
                      {...makeFixedHandlers('bowaTeam')}
                      saveState={fixedSave.bowaTeam}
                      onSave={() => saveFixed('bowaTeam', 'bowa', 'team')}
                    />
                    <FixedSubSection
                      title="Loyers & crédits"
                      note="Dépôts, crédits véhicules, charges fixes"
                      rows={fixedRows.bowaInfra}
                      {...makeFixedHandlers('bowaInfra')}
                      saveState={fixedSave.bowaInfra}
                      onSave={() => saveFixed('bowaInfra', 'bowa', 'infra')}
                    />
                    <FixedSubSection
                      title="Fulfillment fixe"
                      note="Khalid — proratisé sur la période"
                      rows={fixedRows.bowaFulfillmentFixed}
                      {...makeFixedHandlers('bowaFulfillmentFixed')}
                      saveState={fixedSave.bowaFulfillmentFixed}
                      onSave={() => saveFixed('bowaFulfillmentFixed', 'bowa', 'fulfillment')}
                    />
                  </div>
                </div>

                {/* Month selector — shared between Variable + CA */}
                <div>
                  <div className="flex items-center justify-between mb-3">
                    <p className="text-xs font-semibold text-[#6b6b63] uppercase tracking-wider">Données mensuelles</p>
                    <MonthNav month={selectedMonth} onChange={setSelectedMonth} />
                  </div>

                  <div className="space-y-4">

                    {/* Charges variables */}
                    <VariableSection
                      title="Charges variables fulfillment"
                      note="Coûts de livraison variables du mois · Intégrés dans Fulfillment sur le dashboard"
                      rows={varRows}
                      fixedLabels={varFixedLabels}
                      onRowChange={varChange}
                      onAdd={varAdd}
                      onDelete={varDelete}
                      saveState={varSave}
                      onSave={saveVar}
                      loading={varLoading}
                    />

                    {/* CA complémentaire */}
                    <VariableSection
                      title="CA complémentaire"
                      note="Revenus hors Shopify — ajoutés au Total Sales sur le dashboard"
                      rows={suppRows}
                      fixedLabels={FIXED_SUPP_LABELS}
                      onRowChange={suppChange}
                      onAdd={suppAdd}
                      onDelete={suppDelete}
                      saveState={suppSave}
                      onSave={saveSupp}
                      loading={suppLoading}
                      unit="€"
                    />

                  </div>
                </div>

                {/* Apps (secondary, collapsed feel) */}
                <div>
                  <p className="text-xs font-semibold text-[#6b6b63] uppercase tracking-wider mb-3">Apps & outils Shopify</p>
                  <div className="bg-white rounded-[20px] shadow-[0_2px_16px_rgba(0,0,0,0.06)] overflow-hidden">
                    <FixedSubSection
                      title="Abonnements apps"
                      note="Apparaissent sous 'Apps Shopify' sur le dashboard"
                      rows={fixedRows.bowaApp}
                      {...makeFixedHandlers('bowaApp')}
                      saveState={fixedSave.bowaApp}
                      onSave={() => saveFixed('bowaApp', 'bowa', 'app')}
                    />
                  </div>
                </div>
              </>
            )}

            {/* ── MOOM / KROM SECTION ────────────────────────────────────── */}
            {(b === 'moom' || b === 'krom') && (
              <>
                <div>
                  <p className="text-xs font-semibold text-[#6b6b63] uppercase tracking-wider mb-3">Charges fixes</p>
                  <div className="bg-white rounded-[20px] shadow-[0_2px_16px_rgba(0,0,0,0.06)] overflow-hidden">
                    {b === 'moom' && (
                      <>
                        <FixedSubSection
                          title="Salaires équipe"
                          rows={fixedRows.moomTeam}
                          {...makeFixedHandlers('moomTeam')}
                          saveState={fixedSave.moomTeam}
                          onSave={() => saveFixed('moomTeam', 'moom', 'team')}
                        />
                        <FixedSubSection
                          title="Apps & outils"
                          rows={fixedRows.moomApp}
                          {...makeFixedHandlers('moomApp')}
                          saveState={fixedSave.moomApp}
                          onSave={() => saveFixed('moomApp', 'moom', 'app')}
                        />
                      </>
                    )}
                    {b === 'krom' && (
                      <>
                        <FixedSubSection
                          title="Salaires équipe"
                          rows={fixedRows.kromTeam}
                          {...makeFixedHandlers('kromTeam')}
                          saveState={fixedSave.kromTeam}
                          onSave={() => saveFixed('kromTeam', 'krom', 'team')}
                        />
                        <FixedSubSection
                          title="Apps & outils"
                          rows={fixedRows.kromApp}
                          {...makeFixedHandlers('kromApp')}
                          saveState={fixedSave.kromApp}
                          onSave={() => saveFixed('kromApp', 'krom', 'app')}
                        />
                      </>
                    )}
                  </div>
                </div>

                {/* Shipping */}
                <div className="bg-white rounded-[20px] shadow-[0_2px_16px_rgba(0,0,0,0.06)] overflow-hidden">
                  <div className="px-6 py-4 border-b border-[#f0f0ee]">
                    <h3 className="text-sm font-semibold text-[#1a1a2e]">Livraison — {BRAND_LABELS[b]}</h3>
                    <p className="text-xs text-[#6b6b63] mt-0.5">Coût moyen par commande · Calculé sur la période (taux × nb commandes)</p>
                  </div>
                  <div className="flex items-center justify-between px-6 py-4">
                    <p className="text-sm font-medium text-[#1a1a2e]">Coût moyen de livraison</p>
                    <div className="flex items-center gap-2">
                      <input type="number" value={shippingCosts[b]}
                        onChange={(e) => setShippingCosts((prev) => ({ ...prev, [b]: e.target.value }))}
                        min="0" step="0.01"
                        className="w-24 text-right text-sm text-[#1a1a18] border border-[#e8e8e4] rounded-lg px-3 py-1.5 focus:border-[#1a1a2e] focus:outline-none transition-colors"
                      />
                      <span className="text-xs text-[#6b6b63]">€ / commande</span>
                    </div>
                  </div>
                  <div className="flex items-center justify-end px-6 py-4 border-t border-[#f0f0ee] bg-[#faf9f8]">
                    <SaveButton state={shippingSave[b]} onClick={() => saveShipping(b)} />
                  </div>
                </div>
              </>
            )}

            {/* ── Configuration (global) ─────────────────────────────────── */}
            <div className="bg-white rounded-[20px] shadow-[0_2px_16px_rgba(0,0,0,0.06)] overflow-hidden">
              <div className="px-6 py-4 border-b border-[#f0f0ee]">
                <h2 className="text-sm font-semibold text-[#1a1a18]">Configuration</h2>
              </div>
              <div className="divide-y divide-[#f0f0ee]">
                <div className="flex items-center justify-between px-6 py-4">
                  <div>
                    <p className="text-sm font-medium text-[#1a1a2e]">ROAS cible</p>
                    <p className="text-xs text-[#6b6b63] mt-0.5">Retour sur dépenses publicitaires minimum</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <input type="number" value={config.roasTarget}
                      onChange={(e) => setConfig((c) => ({ ...c, roasTarget: e.target.value }))}
                      min="0.1" step="0.1"
                      className="w-20 text-right text-sm text-[#1a1a18] border border-[#e8e8e4] rounded-lg px-3 py-1.5 focus:border-[#1a1a2e] focus:outline-none transition-colors"
                    />
                    <span className="text-xs text-[#6b6b63] w-6">×</span>
                  </div>
                </div>
                <div className="flex items-center justify-between px-6 py-4">
                  <div>
                    <p className="text-sm font-medium text-[#1a1a2e]">Seuil d&apos;alerte stock</p>
                    <p className="text-xs text-[#6b6b63] mt-0.5">Alerte quand le stock descend sous ce niveau</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <input type="number" value={config.stockThreshold}
                      onChange={(e) => setConfig((c) => ({ ...c, stockThreshold: e.target.value }))}
                      min="0" step="5"
                      className="w-20 text-right text-sm text-[#1a1a18] border border-[#e8e8e4] rounded-lg px-3 py-1.5 focus:border-[#1a1a2e] focus:outline-none transition-colors"
                    />
                    <span className="text-xs text-[#6b6b63] w-6">uté</span>
                  </div>
                </div>
              </div>
              <div className="flex justify-end px-6 py-4 border-t border-[#f0f0ee] bg-[#F0F0EE]">
                <SaveButton state={configSave} onClick={saveConfig} />
              </div>
            </div>

          </div>
        )}

        {/* Produits exclus */}
        <ExclusionSection brand={activeBrand} />

      </main>
    </div>
  )
}
