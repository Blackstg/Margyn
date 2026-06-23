'use client'

export const dynamic = 'force-dynamic'

import { useEffect, useMemo, useState } from 'react'
import { Users, Check, Shield, Truck, Headphones, ClipboardList } from 'lucide-react'
import { BRANDS, BRAND_LABELS, FEATURES, type Brand, type FeatureKey } from '@/lib/access'

interface ApiUser {
  id: string
  email: string
  role: string
  brands: string[]
  features: string[] | null
}

const ROLE_OPTIONS: { value: string; label: string; hint: string; icon: React.ReactNode }[] = [
  { value: 'admin',       label: 'Admin',       hint: 'Accès complet à toutes les marques et fonctionnalités', icon: <Shield size={14} /> },
  { value: 'sav',         label: 'Staff / SAV', hint: 'Accès limité aux marques et fonctionnalités cochées',   icon: <Headphones size={14} /> },
  { value: 'delivery',    label: 'Livreur',     hint: 'Application livreur uniquement (Bowa)',                  icon: <Truck size={14} /> },
  { value: 'logistician', label: 'Logisticien', hint: 'Page de réconciliation uniquement',                     icon: <ClipboardList size={14} /> },
]

// Group features by section for display
const SECTIONS = [...new Set(FEATURES.map(f => f.section))]

export default function UsersAccessPage() {
  const [users, setUsers]   = useState<ApiUser[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError]   = useState('')

  useEffect(() => {
    fetch('/api/admin/users')
      .then(async r => {
        if (!r.ok) throw new Error((await r.json()).error ?? 'Erreur')
        return r.json()
      })
      .then(d => setUsers(d.users ?? []))
      .catch(e => setError(String(e.message ?? e)))
      .finally(() => setLoading(false))
  }, [])

  return (
    <div className="min-h-screen bg-[#f8f7f5] pl-[72px]">
      <div className="max-w-4xl mx-auto px-6 py-8 space-y-6">
        <div className="flex items-center gap-2.5">
          <Users size={20} className="text-[#1a1a2e]" />
          <div>
            <h1 className="text-xl font-bold text-[#1a1a2e]">Gestion des accès</h1>
            <p className="text-xs text-[#6b6b63] mt-0.5">Choisissez ce que chaque utilisateur voit, par marque et par fonctionnalité.</p>
          </div>
        </div>

        {error && <div className="rounded-xl bg-[#fff5f5] border border-[#f5d0d0] text-[#c7293a] text-sm px-4 py-3">{error}</div>}
        {loading ? (
          <div className="text-sm text-[#9b9b93] py-10 text-center">Chargement…</div>
        ) : (
          <div className="space-y-4">
            {users.map(u => <UserCard key={u.id} user={u} />)}
          </div>
        )}
      </div>
    </div>
  )
}

function UserCard({ user }: { user: ApiUser }) {
  const [role, setRole]         = useState(user.role)
  const [brands, setBrands]     = useState<string[]>(user.brands)
  const [features, setFeatures] = useState<string[]>(user.features ?? [])
  const [saving, setSaving]     = useState(false)
  const [saved, setSaved]       = useState(false)

  const initial = useMemo(() => JSON.stringify({
    role: user.role, brands: [...user.brands].sort(), features: [...(user.features ?? [])].sort(),
  }), [user])
  const current = JSON.stringify({ role, brands: [...brands].sort(), features: [...features].sort() })
  const dirty = current !== initial

  const restricted = role === 'sav'

  function toggleBrand(b: Brand) {
    setSaved(false)
    setBrands(prev => prev.includes(b) ? prev.filter(x => x !== b) : [...prev, b])
  }
  function toggleFeature(f: FeatureKey) {
    setSaved(false)
    setFeatures(prev => prev.includes(f) ? prev.filter(x => x !== f) : [...prev, f])
  }

  async function save() {
    setSaving(true); setSaved(false)
    try {
      const res = await fetch('/api/admin/users', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: user.id, role, brands, features }),
      })
      if (res.ok) { setSaved(true); user.role = role; user.brands = brands; user.features = features }
    } finally { setSaving(false) }
  }

  return (
    <div className="bg-white rounded-[18px] shadow-[0_2px_16px_rgba(0,0,0,0.06)] p-5">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <span className="font-semibold text-[#1a1a2e] text-sm">{user.email}</span>
        <div className="flex items-center gap-2">
          <select value={role} onChange={e => { setRole(e.target.value); setSaved(false) }}
            className="px-3 py-1.5 rounded-lg bg-[#f8f8f7] border border-[#e8e8e4] text-xs font-medium text-[#1a1a2e] cursor-pointer">
            {ROLE_OPTIONS.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
          </select>
          <button onClick={save} disabled={!dirty || saving}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
              dirty ? 'bg-[#1a1a2e] text-white hover:bg-[#2a2a3e]' : 'bg-[#f0f0ee] text-[#9b9b93]'
            } disabled:opacity-60`}>
            {saving ? '…' : saved ? '✓ Enregistré' : 'Enregistrer'}
          </button>
        </div>
      </div>

      <p className="text-[11px] text-[#9b9b93] mt-1">{ROLE_OPTIONS.find(r => r.value === role)?.hint}</p>

      {/* Brands + features (only for restricted staff) */}
      {restricted && (
        <div className="mt-4 space-y-4">
          {/* Brands */}
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[#9b9b93] mb-1.5">Marques</p>
            <div className="flex flex-wrap gap-1.5">
              {BRANDS.map(b => {
                const on = brands.includes(b)
                return (
                  <button key={b} onClick={() => toggleBrand(b)}
                    className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-all ${
                      on ? 'bg-[#1a1a2e] text-white border-[#1a1a2e]' : 'bg-white text-[#6b6b63] border-[#e8e8e4] hover:border-[#aeb0c9]'
                    }`}>
                    {on && <Check size={12} />} {BRAND_LABELS[b]}
                  </button>
                )
              })}
            </div>
          </div>

          {/* Features grouped by section */}
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[#9b9b93] mb-1.5">Fonctionnalités</p>
            <div className="space-y-2.5">
              {SECTIONS.map(section => (
                <div key={section}>
                  <p className="text-[10px] text-[#aeb0c9] font-medium mb-1">{section}</p>
                  <div className="flex flex-wrap gap-1.5">
                    {FEATURES.filter(f => f.section === section).map(f => {
                      const on = features.includes(f.key)
                      // A brand-locked feature is unusable unless its brand is selected
                      const lockedOut = !!f.brandLock && !brands.includes(f.brandLock)
                      return (
                        <button key={f.key} onClick={() => toggleFeature(f.key)} disabled={lockedOut}
                          title={lockedOut ? `Nécessite la marque ${BRAND_LABELS[f.brandLock as Brand]}` : ''}
                          className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-all ${
                            lockedOut ? 'bg-[#f8f8f7] text-[#cfcfc8] border-[#f0f0ee] cursor-not-allowed'
                            : on ? 'bg-[#1a7f4b] text-white border-[#1a7f4b]'
                            : 'bg-white text-[#6b6b63] border-[#e8e8e4] hover:border-[#aeb0c9]'
                          }`}>
                          {on && !lockedOut && <Check size={12} />} {f.label}
                          {f.brandLock && <span className="opacity-60">· {BRAND_LABELS[f.brandLock]}</span>}
                        </button>
                      )
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
