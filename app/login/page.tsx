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

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')

    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) {
      setError('Email ou mot de passe incorrect')
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
            <label className="text-sm font-medium text-[#1a1a2e]">Email</label>
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              required
              autoFocus
              className="px-3 py-2.5 rounded-lg border border-[#e8e8e4] text-sm focus:outline-none focus:ring-2 focus:ring-[#1a1a2e]/20 bg-[#fafaf8]"
              placeholder="email@exemple.com"
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
