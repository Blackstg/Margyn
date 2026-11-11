// Page publique d'invitation : /join/<jeton> → la personne choisit son mot de passe
// et arrive sur la marque. Le lien est personnel, à usage unique, valable 7 jours.
import type { Metadata } from 'next'
import { invitePreview } from '@/lib/team'
import JoinForm from '@/components/team/JoinForm'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = { title: 'Rejoindre Steero', robots: { index: false, follow: false } }

export default async function JoinPage({ params }: { params: { token: string } }) {
  const inv = await invitePreview(decodeURIComponent(params.token))
  return (
    <main className="flex min-h-screen items-center justify-center bg-[#faf9f8] px-4 py-10">
      <div className="w-full max-w-md rounded-[28px] bg-white p-8 shadow-[0_1px_0_#e8e6e0,0_20px_60px_-30px_rgba(26,26,46,.35)]">
        {inv ? (
          <>
            <span className="flex h-16 w-16 items-center justify-center overflow-hidden rounded-2xl bg-[#f3f2ee] text-2xl font-extrabold text-[#1a1a2e]">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {inv.logoUrl ? <img src={inv.logoUrl} alt="" className="h-full w-full object-cover" /> : inv.brandName.slice(0, 1)}
            </span>
            <h1 className="mt-5 text-[28px] font-extrabold leading-[1.1] tracking-[-0.02em] text-[#1a1a2e]">Rejoins {inv.brandName} sur Steero</h1>
            <p className="mt-2 text-[15px] text-[#6b6b63]">Tu as été invité avec l’adresse <strong className="text-[#1a1a2e]">{inv.email}</strong>.</p>
            <JoinForm token={params.token} email={inv.email} brand={inv.brand} />
          </>
        ) : (
          <>
            <h1 className="text-[26px] font-extrabold tracking-[-0.02em] text-[#1a1a2e]">Ce lien ne marche plus</h1>
            <p className="mt-2 text-[15px] text-[#6b6b63]">Il a déjà servi ou il a expiré (7 jours). Demande une nouvelle invitation à la personne qui te l’a envoyé.</p>
          </>
        )}
      </div>
    </main>
  )
}
