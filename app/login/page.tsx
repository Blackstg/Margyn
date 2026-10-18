'use client'

import { useState } from 'react'
import { createBrowserClient } from '@supabase/auth-helpers-nextjs'
import { useRouter } from 'next/navigation'

export default function LoginPage() {
  const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )
  const router   = useRouter()

  const [email,    setEmail]    = useState('')
  const [password, setPassword] = useState('')
  const [error,    setError]    = useState('')
  const [loading,  setLoading]  = useState(false)

  // Identifiant = email OU téléphone. Un numéro FR (06…/07…) est converti en E.164
  // (+336…/+337…) pour le login par téléphone (Supabase phone+password).
  function toCreds(id: string, pwd: string): { password: string; email?: string; phone?: string } {
    const v = id.trim()
    if (v.includes('@')) return { email: v, password: pwd }
    let d = v.replace(/[\s.\-()]/g, '')
    if (d.startsWith('0')) d = '+33' + d.slice(1)
    else if (!d.startsWith('+')) d = '+' + d
    return { phone: d, password: pwd }
  }

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')

    const { error } = await supabase.auth.signInWithPassword(toCreds(email, password))
    if (error) {
      setError('Identifiant ou mot de passe incorrect')
      setLoading(false)
    } else {
      router.push('/dashboard')
      router.refresh()
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#f5f4f0]">
      <div className="w-full max-w-sm px-4">
        <div className="mb-8 text-center">
          <span
            className="text-[#1a1a2e] select-none"
            style={{ fontSize: 36, fontWeight: 800, letterSpacing: '-2px', fontFamily: 'var(--font-bricolage)' }}
          >
            Steero
          </span>
        </div>

        <form
          onSubmit={handleLogin}
          className="bg-white rounded-2xl shadow-sm border border-[#e8e8e4] p-8 flex flex-col gap-4"
        >
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium text-[#1a1a2e]">Email ou téléphone</label>
            <input
              type="text"
              inputMode="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              required
              autoFocus
              className="px-3 py-2.5 rounded-lg border border-[#e8e8e4] text-sm focus:outline-none focus:ring-2 focus:ring-[#1a1a2e]/20 bg-[#fafaf8]"
              placeholder="email@exemple.com ou 06 12 34 56 78"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium text-[#1a1a2e]">Mot de passe</label>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              required
              className="px-3 py-2.5 rounded-lg border border-[#e8e8e4] text-sm focus:outline-none focus:ring-2 focus:ring-[#1a1a2e]/20 bg-[#fafaf8]"
              placeholder="••••••••"
            />
          </div>

          {error && (
            <p className="text-red-500 text-sm text-center">{error}</p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="mt-2 w-full py-2.5 bg-[#1a1a2e] text-white rounded-lg text-sm font-medium hover:bg-[#1a1a2e]/90 transition-colors disabled:opacity-50 cursor-pointer"
          >
            {loading ? 'Connexion…' : 'Se connecter'}
          </button>
        </form>
      </div>
    </div>
  )
}
