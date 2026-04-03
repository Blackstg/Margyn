'use client'

export const dynamic = 'force-dynamic'

import React, { useState, useEffect, useCallback, useRef } from 'react'
import { createBrowserClient } from '@supabase/auth-helpers-nextjs'
import { Plus, Trash2, Check, Loader2, ChevronLeft, ChevronRight, Search, X } from 'lucide-react'

// ─── Supabase ─────────────────────────────────────────────────────────────────

const supabase = createBrowserClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

// ─── Types ────────────────────────────────────────────────────────────────────

type BrandTab = 'bowa' | 'moom' | 'krom'
type Category = 'team' | 'app' | 'infra' | 'variable'
type SaveState = 'idle' | 'saving' | 'saved' | 'error'
type StateKey = 'bowaTeam' | 'bowaApp' | 'bowaInfra' | 'bowaVariable' | 'moomTeam' | 'moomApp' | 'kromTeam' | 'kromApp'

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

// ─── Per-brand defaults ───────────────────────────────────────────────────────

const DEFAULT_BOWA_TEAM: Omit<CostRow, 'id'>[] = [
  { label: 'Khalid',   amount: '5000' },
  { label: 'Léa',      amount: '1300' },
  { label: 'Clem',     amount: '900'  },
  { label: 'Marine',   amount: '850'  },
  { label: 'Flo',      amount: '800'  },
  { label: 'Lennie',   amount: '500'  },
  { label: 'Valentin', amount: '450'  },
  { label: 'Satiana',  amount: '450'  },
]

const DEFAULT_MOOM_TEAM: Omit<CostRow, 'id'>[] = [
  { label: 'Ghiles',   amount: '1000' },
  { label: 'Marine',   amount: '850'  },
  { label: 'Clem',     amount: '700'  },
  { label: 'Flo',      amount: '800'  },
  { label: 'Valentin', amount: '450'  },
  { label: 'Satiana',  amount: '450'  },
]

const DEFAULT_BOWA_INFRA: Omit<CostRow, 'id'>[] = [
  { label: 'Dépôt Bourges',   amount: '1233' },
  { label: 'Crédit Camion',   amount: '545'  },
  { label: 'Crédit WV',       amount: '1268' },
  { label: 'Livraison Hao',   amount: '430'  },
  { label: 'Total Energie',   amount: '3300' },
]

const DEFAULT_BOWA_VARIABLE: Omit<CostRow, 'id'>[] = [
  { label: 'Enzo (livraison extra)', amount: '0' },
  { label: 'Intérimaires',           amount: '0' },
  { label: 'CB Frais Khalid',        amount: '0' },
  { label: 'Autres',                 amount: '0' },
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

const DEFAULT_MOOM_APPS: Omit<CostRow, 'id'>[] = [
  { label: 'Trackr',                amount: '8'   },
  { label: 'Hey Low Stock',         amount: '5'   },
  { label: 'Hextom Sales Boost',    amount: '9'   },
  { label: 'Rivo Loyalty',          amount: '45'  },
  { label: 'Stamped Reviews',       amount: '17'  },
  { label: 'Timesact Pre-order',    amount: '9'   },
  { label: 'ZipChat AI Chatbot',    amount: '119' },
  { label: 'Sufio Invoices',        amount: '45'  },
  { label: 'Buddha Mega Menu',      amount: '9'   },
]

const DEFAULT_SUPPLEMENTARY_SOURCES: Omit<CostRow, 'id'>[] = [
  { label: 'Leroy Merlin (Adeo)', amount: '0' },
  { label: 'B2B (Pennylane)',     amount: '0' },
  { label: 'Zettle',             amount: '0' },
]
const FIXED_SUPP_LABELS = new Set(DEFAULT_SUPPLEMENTARY_SOURCES.map((s) => s.label))

const DEFAULT_KROM_TEAM: Omit<CostRow, 'id'>[] = [
  { label: 'Flo', amount: '500' },
]

const DEFAULT_KROM_APPS: Omit<CostRow, 'id'>[] = [
  { label: 'Rapi Tracking',   amount: '14' },
  { label: 'ZipChat',         amount: '45' },
  { label: 'Trackr',          amount: '5'  },
  { label: 'Stamped Reviews', amount: '21' },
]

const BRAND_LABELS: Record<BrandTab, string> = {
  bowa: 'Bowa Concept',
  moom: 'Mōom Paris',
  krom: 'Krom',
}

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
  return rows.map((r) => ({ id: uid(), dbId: r.id, label: r.label, amount: String(r.amount ?? '0') }))
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

// ─── ExclusionSection ─────────────────────────────────────────────────────────

function ExclusionSection({ brand }: { brand: BrandTab }) {
  const [excluded, setExcluded] = useState<string[]>([])
  const [query, setQuery]       = useState('')
  const [results, setResults]   = useState<string[]>([])
  const [open, setOpen]         = useState(false)
  const [searching, setSearching] = useState(false)
  const wrapperRef = useRef<HTMLDivElement>(null)

  // Load exclusions + auto-exclude "Strap" products
  useEffect(() => {
    async function init() {
      const [{ data: excl }, { data: strapProducts }] = await Promise.all([
        supabase.from('product_exclusions').select('product_title').eq('brand', brand),
        supabase.from('products').select('title').eq('brand', brand).ilike('title', '%Strap%'),
      ])
      const currentExcluded = (excl ?? []).map((r) => r.product_title)
      // Deduplicate Strap titles before inserting
      const strapTitles = [...new Set((strapProducts ?? []).map((r) => r.title))]
      const toAdd = strapTitles.filter((t) => !currentExcluded.includes(t))
      if (toAdd.length > 0) {
        const { error } = await supabase.from('product_exclusions').upsert(
          toAdd.map((product_title) => ({ brand, product_title })),
          { onConflict: 'brand,product_title' }
        )
        // Only update state with newly added items if DB write succeeded
        setExcluded(error ? currentExcluded : [...currentExcluded, ...toAdd])
      } else {
        setExcluded(currentExcluded)
      }
    }
    init()
  }, [brand])

  // Search with debounce
  useEffect(() => {
    if (!query.trim()) { setResults([]); setOpen(false); return }
    const timer = setTimeout(async () => {
      setSearching(true)
      const { data } = await supabase
        .from('products')
        .select('title')
        .eq('brand', brand)
        .ilike('title', `%${query}%`)
        .limit(8)
      setResults((data ?? []).map((r) => r.title))
      setOpen(true)
      setSearching(false)
    }, 300)
    return () => clearTimeout(timer)
  }, [query, brand])

  // Close dropdown on outside click
  useEffect(() => {
    function handle(e: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handle)
    return () => document.removeEventListener('mousedown', handle)
  }, [])

  async function addExclusion(title: string) {
    const { error } = await supabase
      .from('product_exclusions')
      .upsert({ brand, product_title: title }, { onConflict: 'brand,product_title' })
    if (!error) setExcluded((prev) => [...prev, title])
    setQuery('')
    setResults([])
    setOpen(false)
  }

  async function removeExclusion(title: string) {
    const { error } = await supabase
      .from('product_exclusions')
      .delete()
      .eq('brand', brand)
      .eq('product_title', title)
    if (!error) setExcluded((prev) => prev.filter((t) => t !== title))
  }

  const available = results.filter((t) => !excluded.includes(t))

  return (
    // No overflow-hidden here — the dropdown must escape the card
    <div className="bg-white rounded-[20px] shadow-[0_2px_16px_rgba(0,0,0,0.06)]">
      {/* Header */}
      <div className="px-6 py-4 border-b border-[#f0f0ee] rounded-t-[20px]">
        <h3 className="text-sm font-semibold text-[#1a1a2e]">Produits exclus du suivi</h3>
        <p className="text-xs text-[#6b6b63] mt-0.5">
          Ces produits n&apos;apparaissent pas dans Meilleures ventes ni Stock critique
        </p>
      </div>

      {/* Search + dropdown */}
      <div ref={wrapperRef} className="px-6 py-4 border-b border-[#f0f0ee] relative">
        <div className="relative">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#9b9b93]" />
          {searching && (
            <Loader2 size={13} className="absolute right-3 top-1/2 -translate-y-1/2 text-[#9b9b93] animate-spin" />
          )}
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onFocus={() => available.length > 0 && setOpen(true)}
            placeholder="Rechercher un produit à exclure…"
            className="w-full pl-8 pr-8 py-2 text-sm border border-[#e8e8e4] rounded-lg focus:border-[#1a1a2e] outline-none transition-colors bg-[#faf9f8]"
          />
        </div>

        {/* Dropdown — positioned outside overflow context */}
        {open && available.length > 0 && (
          <div className="absolute left-6 right-6 top-[calc(100%-8px)] mt-1 bg-white border border-[#e8e8e4] rounded-xl shadow-[0_8px_24px_rgba(0,0,0,0.12)] z-50 max-h-[240px] overflow-y-auto">
            {available.map((title) => (
              <button
                key={title}
                onMouseDown={(e) => e.preventDefault()} // prevent input blur before click
                onClick={() => addExclusion(title)}
                className="w-full text-left px-4 py-2.5 text-sm text-[#1a1a2e] hover:bg-[#faf9f8] transition-colors flex items-center justify-between gap-2 border-b border-[#f0f0ee] last:border-0"
              >
                <span className="truncate">{title}</span>
                <span className="text-[10px] text-[#aeb0c9] font-medium shrink-0">Exclure</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Excluded tags */}
      <div className="px-6 py-4 rounded-b-[20px]">
        {excluded.length === 0 ? (
          <p className="text-sm text-[#9b9b93]">Aucun produit exclu.</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {excluded.map((title) => (
              <span
                key={title}
                className="inline-flex items-center gap-1.5 pl-3 pr-1.5 py-1 rounded-full bg-[#f5f0f2] text-xs font-medium text-[#1a1a2e] max-w-[260px]"
              >
                <span className="truncate">{title}</span>
                <button
                  onClick={() => removeExclusion(title)}
                  className="shrink-0 w-4 h-4 rounded-full flex items-center justify-center text-[#9b9b93] hover:text-[#c7293a] hover:bg-[#fde8ea] transition-all"
                >
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

// ─── CostSection ─────────────────────────────────────────────────────────────

function CostSection({ title, note, rows, onRowChange, onAdd, onDelete, saveState, onSave, headerSlot }: {
  title: string
  note?: string
  rows: CostRow[]
  onRowChange: (id: string, field: 'label' | 'amount', value: string) => void
  onAdd: () => void
  onDelete: (id: string) => void
  saveState: SaveState
  onSave: () => void
  headerSlot?: React.ReactNode
}) {
  return (
    <div className="bg-white rounded-[20px] shadow-[0_2px_16px_rgba(0,0,0,0.06)] overflow-hidden">
      <div className="flex items-center justify-between px-6 py-4 border-b border-[#f0f0ee]">
        {headerSlot ?? (
          <div>
            <h3 className="text-sm font-semibold text-[#1a1a2e]">{title}</h3>
            {note && <p className="text-xs text-[#6b6b63] mt-0.5">{note}</p>}
          </div>
        )}
        <button
          onClick={onAdd}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-[#6b6b63] border border-[#e8e8e4] hover:border-[#1a1a2e] hover:text-[#1a1a2e] transition-all"
        >
          <Plus size={12} strokeWidth={2} />
          Ajouter
        </button>
      </div>

      <div className="divide-y divide-[#f0f0ee]">
        {rows.length === 0 && (
          <p className="px-6 py-4 text-sm text-[#6b6b63]">Aucun poste.</p>
        )}
        {rows.map((row) => (
          <div key={row.id} className="flex items-center gap-3 px-6 py-3">
            <input
              type="text"
              value={row.label}
              onChange={(e) => onRowChange(row.id, 'label', e.target.value)}
              placeholder="Label"
              className="flex-1 text-sm text-[#1a1a18] bg-transparent border-b border-transparent hover:border-[#e8e8e4] focus:border-[#1a1a18] outline-none transition-colors py-0.5"
            />
            <div className="flex items-center gap-1 text-sm">
              <input
                type="number"
                value={row.amount}
                onChange={(e) => onRowChange(row.id, 'amount', e.target.value)}
                min="0"
                step="50"
                className="w-24 text-right text-[#1a1a18] bg-transparent border-b border-transparent hover:border-[#e8e8e4] focus:border-[#1a1a18] outline-none transition-colors py-0.5"
              />
              <span className="text-[#6b6b63] text-xs">€/mois</span>
            </div>
            <button
              onClick={() => onDelete(row.id)}
              className="p-1.5 rounded-md text-[#6b6b63] hover:text-[#c7293a] hover:bg-[#fde8ea] transition-all"
            >
              <Trash2 size={13} strokeWidth={1.8} />
            </button>
          </div>
        ))}
      </div>

      <div className="flex items-center justify-between px-6 py-4 border-t border-[#f0f0ee] bg-[#F0F0EE]">
        <span className="text-xs text-[#6b6b63]">
          Total :{' '}
          <span className="font-semibold text-[#1a1a18]">{fmtEur(totalOf(rows))}</span>
          <span className="text-[#6b6b63]">/mois</span>
        </span>
        <SaveButton state={saveState} onClick={onSave} />
      </div>
    </div>
  )
}

// ─── State key helpers ────────────────────────────────────────────────────────

function stateKey(brand: BrandTab, category: Category): StateKey {
  const suffix = category === 'team' ? 'Team' : category === 'infra' ? 'Infra' : category === 'variable' ? 'Variable' : 'App'
  return `${brand}${suffix}` as StateKey
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function SettingsPage() {
  const [activeBrand, setActiveBrand] = useState<BrandTab>('bowa')
  const [allowedBrands, setAllowedBrands] = useState<BrandTab[]>(['bowa', 'moom', 'krom'])

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

  const [rows, setRows] = useState<Record<StateKey, CostRow[]>>({
    bowaTeam: [], bowaApp: [], bowaInfra: [], bowaVariable: [], moomTeam: [], moomApp: [], kromTeam: [], kromApp: [],
  })
  const [saveStates, setSaveStates] = useState<Record<StateKey, SaveState>>({
    bowaTeam: 'idle', bowaApp: 'idle', bowaInfra: 'idle', bowaVariable: 'idle', moomTeam: 'idle', moomApp: 'idle', kromTeam: 'idle', kromApp: 'idle',
  })

  const [shippingCosts, setShippingCosts] = useState<Record<BrandTab, string>>({ bowa: '17', moom: '17', krom: '27.21' })
  const [shippingSaveStates, setShippingSaveStates] = useState<Record<BrandTab, SaveState>>({ bowa: 'idle', moom: 'idle', krom: 'idle' })

  const [variableMonth, setVariableMonth] = useState<string>(prevMonthStart)
  const [variableLoading, setVariableLoading] = useState(false)

  const [extraRevMonth, setExtraRevMonth]       = useState<string>(prevMonthStart)
  const [extraRevRows, setExtraRevRows]         = useState<CostRow[]>(rowsFromDefaults(DEFAULT_SUPPLEMENTARY_SOURCES))
  const [extraRevSaveState, setExtraRevSaveState] = useState<SaveState>('idle')
  const [extraRevLoading, setExtraRevLoading]   = useState(false)

  const [config, setConfig] = useState<Config>({ roasTarget: '3.0', stockThreshold: '20' })
  const [configSave, setConfigSave] = useState<SaveState>('idle')
  const [loading, setLoading] = useState(true)

  // ─── Load ───────────────────────────────────────────────────────────────

  const loadCosts = useCallback(async () => {
    setLoading(true)
    const month = currentMonthStart()

    const [{ data }, { data: shippingData }] = await Promise.all([
      supabase.from('fixed_costs').select('id, label, amount, category, brand').eq('month', month),
      supabase.from('brand_settings').select('brand, shipping_cost_per_order'),
    ])

    const get = (brand: string, category: string) =>
      (data ?? []).filter((r) => r.brand === brand && r.category === category)

    const bowaTeamDb  = get('bowa', 'team')
    const bowaAppDb   = get('bowa', 'app')
    const bowaInfraDb = get('bowa', 'infra')
    const moomTeamDb  = get('moom', 'team')
    const moomAppDb   = get('moom', 'app')
    const kromTeamDb  = get('krom', 'team')
    const kromAppDb   = get('krom', 'app')

    setRows((prev) => ({
      ...prev,
      bowaTeam:  bowaTeamDb.length  > 0 ? rowsFromDb(bowaTeamDb)  : rowsFromDefaults(DEFAULT_BOWA_TEAM),
      bowaApp:   bowaAppDb.length   > 0 ? rowsFromDb(bowaAppDb)   : rowsFromDefaults(DEFAULT_BOWA_APPS),
      bowaInfra: bowaInfraDb.length > 0 ? rowsFromDb(bowaInfraDb) : rowsFromDefaults(DEFAULT_BOWA_INFRA),
      moomTeam:  moomTeamDb.length  > 0 ? rowsFromDb(moomTeamDb)  : rowsFromDefaults(DEFAULT_MOOM_TEAM),
      moomApp:   moomAppDb.length   > 0 ? rowsFromDb(moomAppDb)   : rowsFromDefaults(DEFAULT_MOOM_APPS),
      kromTeam:  kromTeamDb.length  > 0 ? rowsFromDb(kromTeamDb)  : rowsFromDefaults(DEFAULT_KROM_TEAM),
      kromApp:   kromAppDb.length   > 0 ? rowsFromDb(kromAppDb)   : rowsFromDefaults(DEFAULT_KROM_APPS),
    }))

    if (shippingData) {
      const shippingMap = Object.fromEntries(
        shippingData.map((r) => [r.brand, String(r.shipping_cost_per_order ?? 17)])
      ) as Partial<Record<BrandTab, string>>
      setShippingCosts((prev) => ({ ...prev, ...shippingMap }))
    }

    setLoading(false)
  }, [])

  const loadVariable = useCallback(async (month: string) => {
    setVariableLoading(true)
    const { data } = await supabase
      .from('fixed_costs')
      .select('id, label, amount')
      .eq('month', month)
      .eq('brand', 'bowa')
      .eq('category', 'variable')
    setRows((prev) => ({
      ...prev,
      bowaVariable: (data ?? []).length > 0
        ? rowsFromDb(data as DbCostRow[])
        : rowsFromDefaults(DEFAULT_BOWA_VARIABLE),
    }))
    setVariableLoading(false)
  }, [])

  const loadExtraRevenue = useCallback(async (month: string) => {
    setExtraRevLoading(true)
    const { data } = await supabase
      .from('supplementary_revenue')
      .select('id, source, amount')
      .eq('brand', 'bowa')
      .eq('month', month)
    if (!data || data.length === 0) {
      setExtraRevRows(rowsFromDefaults(DEFAULT_SUPPLEMENTARY_SOURCES))
    } else {
      const dbLabels = new Set(data.map((r) => r.source))
      const dbRows: CostRow[] = data.map((r) => ({ id: uid(), dbId: r.id, label: r.source, amount: String(r.amount ?? 0) }))
      const missing = DEFAULT_SUPPLEMENTARY_SOURCES.filter((s) => !dbLabels.has(s.label))
      setExtraRevRows([...dbRows, ...missing.map((d) => ({ ...d, id: uid() }))])
    }
    setExtraRevLoading(false)
  }, [])

  useEffect(() => {
    loadCosts()
    const stored = localStorage.getItem('steero_config')
    if (stored) { try { setConfig(JSON.parse(stored)) } catch {} }
  }, [loadCosts])

  useEffect(() => { loadVariable(variableMonth) }, [variableMonth, loadVariable])
  useEffect(() => { loadExtraRevenue(extraRevMonth) }, [extraRevMonth, loadExtraRevenue])

  // ─── Row mutations ───────────────────────────────────────────────────────

  function makeHandlers(key: StateKey) {
    return {
      onChange: (id: string, field: 'label' | 'amount', value: string) => {
        setRows((prev) => ({
          ...prev,
          [key]: prev[key].map((r) => (r.id === id ? { ...r, [field]: value } : r)),
        }))
      },
      onAdd: () => {
        setRows((prev) => ({
          ...prev,
          [key]: [...prev[key], { id: uid(), label: '', amount: '' }],
        }))
      },
      onDelete: (id: string) => {
        setRows((prev) => ({
          ...prev,
          [key]: prev[key].filter((r) => r.id !== id),
        }))
      },
    }
  }

  // ─── Save costs ──────────────────────────────────────────────────────────

  async function saveCosts(brand: BrandTab, category: Category) {
    const key = stateKey(brand, category)
    const currentRows = rows[key]

    setSaveStates((prev) => ({ ...prev, [key]: 'saving' }))
    const month = category === 'variable' ? variableMonth : currentMonthStart()
    const valid = currentRows.filter((r) => r.label.trim() && parseFloat(r.amount) > 0)

    try {
      const { error: delError } = await supabase
        .from('fixed_costs')
        .delete()
        .eq('month', month)
        .eq('category', category)
        .eq('brand', brand)

      if (delError) throw delError

      if (valid.length > 0) {
        const { error: insError } = await supabase.from('fixed_costs').insert(
          valid.map((r) => ({
            month,
            category,
            brand,
            label: r.label.trim(),
            amount: parseFloat(r.amount),
          }))
        )
        if (insError) throw insError
      }

      setSaveStates((prev) => ({ ...prev, [key]: 'saved' }))
      setTimeout(() => setSaveStates((prev) => ({ ...prev, [key]: 'idle' })), 2500)
      if (category === 'variable') loadVariable(variableMonth)
      else loadCosts()
    } catch {
      setSaveStates((prev) => ({ ...prev, [key]: 'error' }))
      setTimeout(() => setSaveStates((prev) => ({ ...prev, [key]: 'idle' })), 3000)
    }
  }

  // ─── Save shipping rate ──────────────────────────────────────────────────

  async function saveShipping(brand: BrandTab) {
    const rate = parseFloat(shippingCosts[brand])
    if (isNaN(rate) || rate < 0) return
    setShippingSaveStates((prev) => ({ ...prev, [brand]: 'saving' }))
    try {
      const { error } = await supabase
        .from('brand_settings')
        .upsert({ brand, shipping_cost_per_order: rate }, { onConflict: 'brand' })
      if (error) throw error
      setShippingSaveStates((prev) => ({ ...prev, [brand]: 'saved' }))
      setTimeout(() => setShippingSaveStates((prev) => ({ ...prev, [brand]: 'idle' })), 2500)
    } catch {
      setShippingSaveStates((prev) => ({ ...prev, [brand]: 'error' }))
      setTimeout(() => setShippingSaveStates((prev) => ({ ...prev, [brand]: 'idle' })), 3000)
    }
  }

  // ─── Save supplementary revenue ──────────────────────────────────────────

  async function saveExtraRevenue() {
    setExtraRevSaveState('saving')
    const month = extraRevMonth
    const valid = extraRevRows.filter((r) => r.label.trim() && parseFloat(r.amount) > 0)
    try {
      await supabase.from('supplementary_revenue').delete().eq('brand', 'bowa').eq('month', month)
      if (valid.length > 0) {
        const { error } = await supabase.from('supplementary_revenue').insert(
          valid.map((r) => ({ brand: 'bowa', month, source: r.label.trim(), amount: parseFloat(r.amount) }))
        )
        if (error) throw error
      }
      setExtraRevSaveState('saved')
      setTimeout(() => setExtraRevSaveState('idle'), 2500)
      loadExtraRevenue(month)
    } catch {
      setExtraRevSaveState('error')
      setTimeout(() => setExtraRevSaveState('idle'), 3000)
    }
  }

  // ─── Save config ─────────────────────────────────────────────────────────

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

  // ─── Render ──────────────────────────────────────────────────────────────

  const b           = activeBrand
  const teamKey     = stateKey(b, 'team')
  const appKey      = stateKey(b, 'app')
  const h           = {
    team:     makeHandlers(teamKey),
    app:      makeHandlers(appKey),
    infra:    makeHandlers('bowaInfra'),
    variable: makeHandlers('bowaVariable'),
  }
  const totalFixed =
    totalOf(rows[teamKey]) +
    totalOf(rows[appKey]) +
    (b === 'bowa' ? totalOf(rows.bowaInfra) + totalOf(rows.bowaVariable) : 0) +
    (b === 'moom' || b === 'krom' ? (parseFloat(shippingCosts[b]) || 0) * 500 : 0)

  return (
    <div className="min-h-screen bg-[#faf9f8]">
      <main className="max-w-3xl mx-auto px-6 py-8 space-y-6">

        {/* Page title */}
        <div>
          <h1 className="text-xl font-bold text-[#1a1a18] tracking-tight">Paramètres</h1>
          <p className="text-sm text-[#6b6b63] mt-1">
            Mois en cours — {new Date().toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' })}
          </p>
        </div>

        {/* Brand selector */}
        <div className="flex items-center gap-3">
          <div className="inline-flex items-center bg-white shadow-[0_2px_16px_rgba(0,0,0,0.06)] rounded-xl p-1 gap-0.5">
            {(['bowa', 'moom', 'krom'] as BrandTab[]).filter(b => allowedBrands.includes(b)).map((brand) => (
              <button
                key={brand}
                onClick={() => setActiveBrand(brand)}
                className={`px-5 py-2 rounded-lg text-sm font-semibold transition-all ${
                  activeBrand === brand
                    ? 'bg-[#1a1a2e] text-white'
                    : 'text-[#6b6b63] hover:text-[#1a1a2e]'
                }`}
              >
                {BRAND_LABELS[brand]}
              </button>
            ))}
          </div>
          {!loading && (
            <span className="text-xs text-[#6b6b63]">
              Total {BRAND_LABELS[b]} : <span className="font-semibold text-[#1a1a18]">{fmtEur(totalFixed)}/mois</span>
            </span>
          )}
        </div>

        {loading ? (
          <div className="space-y-3">
            {[1, 2].map((i) => (
              <div key={i} className="bg-white rounded-[20px] shadow-[0_2px_16px_rgba(0,0,0,0.06)] h-48 animate-pulse" />
            ))}
          </div>
        ) : (
          <div className="space-y-4">
            {/* Team costs */}
            <CostSection
              title={`Équipe — ${BRAND_LABELS[b]}`}
              note="Salaires et rémunérations mensuels"
              rows={rows[teamKey]}
              onRowChange={h.team.onChange}
              onAdd={h.team.onAdd}
              onDelete={h.team.onDelete}
              saveState={saveStates[teamKey]}
              onSave={() => saveCosts(b, 'team')}
            />

            {/* App costs */}
            <CostSection
              title={`Apps & outils — ${BRAND_LABELS[b]}`}
              note="Abonnements SaaS et outils tiers"
              rows={rows[appKey]}
              onRowChange={h.app.onChange}
              onAdd={h.app.onAdd}
              onDelete={h.app.onDelete}
              saveState={saveStates[appKey]}
              onSave={() => saveCosts(b, 'app')}
            />

            {/* Infrastructure (Bowa only) */}
            {b === 'bowa' && (
              <CostSection
                title="Infrastructure — Bowa Concept"
                note="Loyers, crédits véhicules et charges fixes opérationnelles"
                rows={rows.bowaInfra}
                onRowChange={h.infra.onChange}
                onAdd={h.infra.onAdd}
                onDelete={h.infra.onDelete}
                saveState={saveStates.bowaInfra}
                onSave={() => saveCosts('bowa', 'infra')}
              />
            )}

            {/* Shipping cost — Mōom & Krom */}
            {(b === 'moom' || b === 'krom') && (
              <div className="bg-white rounded-[20px] shadow-[0_2px_16px_rgba(0,0,0,0.06)] overflow-hidden">
                <div className="px-6 py-4 border-b border-[#f0f0ee]">
                  <h3 className="text-sm font-semibold text-[#1a1a2e]">Livraison — {BRAND_LABELS[b]}</h3>
                  <p className="text-xs text-[#6b6b63] mt-0.5">
                    Coût moyen par commande · Calculé sur la période affichée (taux × nb commandes)
                  </p>
                </div>
                <div className="flex items-center justify-between px-6 py-4">
                  <div>
                    <p className="text-sm font-medium text-[#1a1a2e]">Coût moyen de livraison</p>
                    <p className="text-xs text-[#6b6b63] mt-0.5">Par commande expédiée</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      value={shippingCosts[b]}
                      onChange={(e) => setShippingCosts((prev) => ({ ...prev, [b]: e.target.value }))}
                      min="0"
                      step="0.01"
                      className="w-24 text-right text-sm text-[#1a1a2e] border border-[#e8e8e4] rounded-lg px-3 py-1.5 focus:border-[#1a1a2e] focus:outline-none transition-colors"
                    />
                    <span className="text-xs text-[#6b6b63]">€ / commande</span>
                  </div>
                </div>
                <div className="flex items-center justify-between px-6 py-4 border-t border-[#f0f0ee] bg-[#faf9f8]">
                  <span className="text-xs text-[#6b6b63]">
                    Exemple 7j · 500 commandes →{' '}
                    <span className="font-semibold text-[#1a1a2e]">
                      {new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 })
                        .format((parseFloat(shippingCosts[b]) || 0) * 500)}
                    </span>
                  </span>
                  <SaveButton state={shippingSaveStates[b]} onClick={() => saveShipping(b)} />
                </div>
              </div>
            )}

            {/* Charges variables du mois — Bowa only */}
            {b === 'bowa' && (
              <CostSection
                title="Charges variables"
                note="Saisies manuellement · Proratisées sur la période affichée"
                rows={variableLoading ? [] : rows.bowaVariable}
                onRowChange={h.variable.onChange}
                onAdd={h.variable.onAdd}
                onDelete={h.variable.onDelete}
                saveState={saveStates.bowaVariable}
                onSave={() => saveCosts('bowa', 'variable')}
                headerSlot={
                  <div className="flex flex-col gap-1 min-w-0">
                    <h3 className="text-sm font-semibold text-[#1a1a2e]">Charges variables</h3>
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => setVariableMonth((m) => shiftMonth(m, -1))}
                        className="p-1 rounded-md text-[#6b6b63] hover:text-[#1a1a2e] hover:bg-[#f0f0ee] transition-all"
                      >
                        <ChevronLeft size={14} strokeWidth={2} />
                      </button>
                      <span className="text-xs font-semibold text-[#1a1a2e] w-28 text-center capitalize">
                        {fmtMonthLabel(variableMonth)}
                      </span>
                      <button
                        onClick={() => setVariableMonth((m) => shiftMonth(m, 1))}
                        disabled={variableMonth >= currentMonthStart()}
                        className="p-1 rounded-md text-[#6b6b63] hover:text-[#1a1a2e] hover:bg-[#f0f0ee] transition-all disabled:opacity-30 disabled:cursor-not-allowed"
                      >
                        <ChevronRight size={14} strokeWidth={2} />
                      </button>
                    </div>
                  </div>
                }
              />
            )}

            {/* CA complémentaire — Bowa only */}
            {b === 'bowa' && (
              <div className="bg-white rounded-[20px] shadow-[0_2px_16px_rgba(0,0,0,0.06)] overflow-hidden">
                {/* Header */}
                <div className="flex items-center justify-between px-6 py-4 border-b border-[#f0f0ee]">
                  <div className="flex flex-col gap-1 min-w-0">
                    <h3 className="text-sm font-semibold text-[#1a1a2e]">CA complémentaire</h3>
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => setExtraRevMonth((m) => shiftMonth(m, -1))}
                        className="p-1 rounded-md text-[#6b6b63] hover:text-[#1a1a2e] hover:bg-[#f0f0ee] transition-all"
                      >
                        <ChevronLeft size={14} strokeWidth={2} />
                      </button>
                      <span className="text-xs font-semibold text-[#1a1a2e] w-28 text-center capitalize">
                        {fmtMonthLabel(extraRevMonth)}
                      </span>
                      <button
                        onClick={() => setExtraRevMonth((m) => shiftMonth(m, 1))}
                        disabled={extraRevMonth >= currentMonthStart()}
                        className="p-1 rounded-md text-[#6b6b63] hover:text-[#1a1a2e] hover:bg-[#f0f0ee] transition-all disabled:opacity-30 disabled:cursor-not-allowed"
                      >
                        <ChevronRight size={14} strokeWidth={2} />
                      </button>
                    </div>
                  </div>
                  <button
                    onClick={() => setExtraRevRows((prev) => [...prev, { id: uid(), label: '', amount: '0' }])}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-[#6b6b63] border border-[#e8e8e4] hover:border-[#1a1a2e] hover:text-[#1a1a2e] transition-all"
                  >
                    <Plus size={12} strokeWidth={2} />
                    Ajouter
                  </button>
                </div>

                {/* Rows */}
                <div className="divide-y divide-[#f0f0ee]">
                  {extraRevLoading ? (
                    <div className="px-6 py-4 space-y-2">
                      {[1, 2, 3].map((i) => (
                        <div key={i} className="h-5 bg-[#f0f0ee] rounded-full animate-pulse" />
                      ))}
                    </div>
                  ) : extraRevRows.map((row) => (
                    <div key={row.id} className="flex items-center gap-3 px-6 py-3">
                      {FIXED_SUPP_LABELS.has(row.label) ? (
                        <span className="flex-1 text-sm text-[#1a1a18] font-medium">{row.label}</span>
                      ) : (
                        <input
                          type="text"
                          value={row.label}
                          onChange={(e) => setExtraRevRows((prev) => prev.map((r) => r.id === row.id ? { ...r, label: e.target.value } : r))}
                          placeholder="Nom de la source"
                          className="flex-1 text-sm text-[#1a1a18] bg-transparent border-b border-transparent hover:border-[#e8e8e4] focus:border-[#1a1a18] outline-none transition-colors py-0.5"
                        />
                      )}
                      <div className="flex items-center gap-1 text-sm">
                        <input
                          type="number"
                          value={row.amount}
                          onChange={(e) => setExtraRevRows((prev) => prev.map((r) => r.id === row.id ? { ...r, amount: e.target.value } : r))}
                          min="0"
                          step="100"
                          className="w-24 text-right text-[#1a1a18] bg-transparent border-b border-transparent hover:border-[#e8e8e4] focus:border-[#1a1a18] outline-none transition-colors py-0.5"
                        />
                        <span className="text-[#6b6b63] text-xs">€/mois</span>
                      </div>
                      {!FIXED_SUPP_LABELS.has(row.label) ? (
                        <button
                          onClick={() => setExtraRevRows((prev) => prev.filter((r) => r.id !== row.id))}
                          className="p-1.5 rounded-md text-[#6b6b63] hover:text-[#c7293a] hover:bg-[#fde8ea] transition-all"
                        >
                          <Trash2 size={13} strokeWidth={1.8} />
                        </button>
                      ) : (
                        <div className="w-7" />
                      )}
                    </div>
                  ))}
                </div>

                {/* Footer */}
                <div className="flex items-center justify-between px-6 py-4 border-t border-[#f0f0ee] bg-[#F0F0EE]">
                  <span className="text-xs text-[#6b6b63]">
                    Total :{' '}
                    <span className="font-semibold text-[#1a1a18]">{fmtEur(totalOf(extraRevRows))}</span>
                    <span className="text-[#6b6b63]">/mois · proratisé sur la période affichée</span>
                  </span>
                  <SaveButton state={extraRevSaveState} onClick={saveExtraRevenue} />
                </div>
              </div>
            )}
          </div>
        )}

        {/* Produits exclus */}
        <ExclusionSection brand={activeBrand} />

        {/* Configuration (global) */}
        <div className="bg-white rounded-[20px] shadow-[0_2px_16px_rgba(0,0,0,0.06)] overflow-hidden">
          <div className="px-6 py-4 border-b border-[#f0f0ee]">
            <h2 className="text-sm font-semibold text-[#1a1a18]">Configuration</h2>
            <p className="text-xs text-[#6b6b63] mt-0.5">Seuils et objectifs globaux</p>
          </div>

          <div className="divide-y divide-[#f0f0ee]">
            <div className="flex items-center justify-between px-6 py-4">
              <div>
                <p className="text-sm font-medium text-[#1a1a18]">ROAS cible</p>
                <p className="text-xs text-[#6b6b63] mt-0.5">Retour sur dépenses publicitaires minimum</p>
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  value={config.roasTarget}
                  onChange={(e) => setConfig((c) => ({ ...c, roasTarget: e.target.value }))}
                  min="0.1"
                  step="0.1"
                  className="w-20 text-right text-sm text-[#1a1a18] border border-[#e8e8e4] rounded-lg px-3 py-1.5 focus:border-[#1a1a18] focus:outline-none transition-colors"
                />
                <span className="text-xs text-[#6b6b63] w-6">×</span>
              </div>
            </div>

            <div className="flex items-center justify-between px-6 py-4">
              <div>
                <p className="text-sm font-medium text-[#1a1a18]">Seuil d&apos;alerte stock</p>
                <p className="text-xs text-[#6b6b63] mt-0.5">Alerte quand le stock descend sous ce niveau</p>
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  value={config.stockThreshold}
                  onChange={(e) => setConfig((c) => ({ ...c, stockThreshold: e.target.value }))}
                  min="0"
                  step="5"
                  className="w-20 text-right text-sm text-[#1a1a18] border border-[#e8e8e4] rounded-lg px-3 py-1.5 focus:border-[#1a1a18] focus:outline-none transition-colors"
                />
                <span className="text-xs text-[#6b6b63] w-6">uté</span>
              </div>
            </div>
          </div>

          <div className="flex justify-end px-6 py-4 border-t border-[#f0f0ee] bg-[#F0F0EE]">
            <SaveButton state={configSave} onClick={saveConfig} />
          </div>
        </div>

        <p className="text-xs text-[#6b6b63] text-center pb-4">
          Les modifications nécessitent des politiques RLS Supabase autorisant INSERT et DELETE.
        </p>
      </main>
    </div>
  )
}
