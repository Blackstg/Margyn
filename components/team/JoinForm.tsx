'use client'

import { useState } from 'react'
import { createBrowserClient } from '@supabase/auth-helpers-nextjs'
import { Loader2 } from 'lucide-react'

export default function JoinForm({ token, email, brand }: { token: string; email: string; brand: string }) {
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [needLogin, setNeedLogin] = useState(false)

  async function join() {
    setBusy(true); setErr('')
    const r = await fetch('/api/team/accept', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token, password }) })
    const d = await r.json().catch(() => ({ error: 'Connexion perdue, réessaie' }))
    if (d.needLogin) { setNeedLogin(true); setBusy(false); return }
    if (!r.ok) { setErr(d.error ?? 'Erreur'); setBusy(false); return }
    if (password) {
      const sb = createBrowserClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!)
      await sb.auth.signInWithPassword({ email, password })
    }
    window.location.href = `/${d.brand ?? brand}/dashboard`
  }

  if (needLogin) return (
    <div className="mt-6 rounded-2xl bg-[#faf9f8] p-4 text-[15px] text-[#1a1a2e]">
      Tu as déjà un compte Steero avec cette adresse. <a href="/login" className="font-semibold underline">Connecte-toi</a>, puis rouvre ce lien pour rejoindre l’équipe.
    </div>
  )
  return (
    <form className="mt-6 space-y-4" onSubmit={e => { e.preventDefault(); join() }}>
      <label className="block">
        <span className="mb-1.5 block text-[14px] font-semibold text-[#1a1a2e]">Choisis ton mot de passe</span>
        <input type="password" autoComplete="new-password" value={password} onChange={e => setPassword(e.target.value)} minLength={8}
          placeholder="8 caractères minimum"
          className="w-full rounded-2xl border-2 border-[#e4e2dc] bg-white px-4 py-3 text-[15px] focus:border-[#1a1a2e] focus:outline-none" />
      </label>
      <button disabled={busy || password.length < 8}
        className="inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-[#1a1a2e] px-5 py-3.5 text-[15px] font-semibold text-white disabled:opacity-40">
        {busy && <Loader2 size={16} className="animate-spin" />} Rejoindre l’équipe
      </button>
      <p className="text-center text-[13px] text-[#8a887f]">Déjà un compte avec cette adresse ? <button type="button" className="underline" onClick={join}>Rejoindre avec mon compte</button></p>
      {err && <p className="text-[14px] text-[#b42318]">{err}</p>}
    </form>
  )
}
