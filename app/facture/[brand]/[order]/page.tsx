'use client'

export const dynamic = 'force-dynamic'

import { useState, useEffect } from 'react'
import { Invoice, type ShopifyOrder, type InvoiceSettings } from '@/components/billing/Invoice'
import { invoiceText, type InvoiceLang } from '@/lib/billing/invoiceI18n'

export default function FacturePubliquePage({ params, searchParams }: { params: { brand: string; order: string }; searchParams: { lang?: string } }) {
  const [order, setOrder]       = useState<ShopifyOrder | null>(null)
  const [settings, setSettings] = useState<InvoiceSettings | null>(null)
  const [loading, setLoading]   = useState(true)
  const [error, setError]       = useState<string | null>(null)
  const [lang, setLang]         = useState<InvoiceLang>(searchParams.lang === 'en' ? 'en' : 'fr')
  const t = invoiceText(lang)

  useEffect(() => {
    fetch(`/api/facture/data?brand=${encodeURIComponent(params.brand)}&order=${encodeURIComponent(params.order)}`)
      .then(async r => {
        const d = await r.json()
        if (!r.ok || d.error) { setError(d.error ?? 'Facture indisponible'); return }
        setOrder(d.order); setSettings(d.settings ?? null)
      })
      .catch(() => setError('Facture indisponible'))
      .finally(() => setLoading(false))
  }, [params.brand, params.order])

  const pdfUrl = `/api/facture/pdf?brand=${encodeURIComponent(params.brand)}&order=${encodeURIComponent(params.order)}${lang === 'en' ? '&lang=en' : ''}`

  return (
    <div style={{ minHeight: '100vh', background: '#f0f0ee' }}>
      {/* Barre d'action (masquée à l'impression) */}
      <div className="no-print" style={{ position: 'sticky', top: 0, zIndex: 10, background: '#fff', borderBottom: '1px solid #e8e8e4', padding: '12px 16px', display: 'flex', justifyContent: 'center', gap: 12 }}>
        {/* Vrai PDF téléchargeable en 1 clic (généré côté serveur, pas d'impression navigateur) */}
        <a
          href={order ? pdfUrl : undefined}
          download={`${t.filePrefix}${params.order.replace('#', '')}.pdf`}
          style={{ background: '#1a1a2e', color: '#fff', borderRadius: 12, padding: '11px 22px', fontSize: 14, fontWeight: 600, textDecoration: 'none', opacity: order ? 1 : 0.4, pointerEvents: order ? 'auto' : 'none' }}
        >
          {lang === 'en' ? '⬇︎ Download invoice (PDF)' : '⬇︎ Télécharger la facture (PDF)'}
        </a>
        <div style={{ display: 'flex', borderRadius: 12, border: '1px solid #e8e8e4', background: '#f3f3f1', padding: 2 }}>
          {(['fr', 'en'] as const).map(l => (
            <button key={l} onClick={() => setLang(l)}
              style={{ border: 0, borderRadius: 10, padding: '8px 14px', fontSize: 13, fontWeight: 600, cursor: 'pointer', background: lang === l ? '#fff' : 'transparent', color: lang === l ? '#1a1a2e' : '#6b6b63' }}>
              {l.toUpperCase()}
            </button>
          ))}
        </div>
      </div>

      <div style={{ padding: '24px 12px' }}>
        {loading ? (
          <p style={{ textAlign: 'center', color: '#6b6b63', fontSize: 14, padding: 60 }}>Chargement de votre facture…</p>
        ) : error ? (
          <div style={{ maxWidth: 460, margin: '60px auto', textAlign: 'center', color: '#6b6b63' }}>
            <p style={{ fontSize: 15, fontWeight: 600, color: '#c7293a' }}>Facture indisponible</p>
            <p style={{ fontSize: 13, marginTop: 8 }}>Nous n&apos;avons pas pu charger cette facture. Contactez-nous et nous vous l&apos;enverrons.</p>
          </div>
        ) : order ? (
          <div style={{ maxWidth: 820, margin: '0 auto', boxShadow: '0 4px 24px rgba(0,0,0,0.08)' }}>
            <Invoice order={order} settings={settings} mode="facture" lang={lang} />
          </div>
        ) : null}
      </div>

      <style>{`
        /* Force le format portrait A4 (par défaut certains navigateurs ouvrent en paysage). */
        @page { size: A4 portrait; margin: 12mm; }
        @media print {
          /* globals.css masque tout sauf .print-summary → on RÉTABLIT la visibilité
             ici pour que la facture s'imprime (sinon page blanche pour le client). */
          body * { visibility: visible !important; }
          .no-print { display: none !important; }
          body { background: #fff !important; }
          html, body { margin: 0 !important; padding: 0 !important; }
        }
      `}</style>
    </div>
  )
}
