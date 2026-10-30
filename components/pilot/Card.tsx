// Carte de la page Pilote (titre en petites capitales + contenu)
export function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-[#e8e8e4] bg-white px-5 py-4">
      <p className="mb-3 text-[11px] font-semibold uppercase tracking-[0.1em] text-[#6b6b63]">{title}</p>
      {children}
    </div>
  )
}
