// Contrôle qualité de la prévision de livraison (page Coûts logisticien) : pour
// chaque mois clôturé et facturé, ce que le modèle (appris sur les 3 mois d'avant)
// aurait prévu, comparé au coût réel facturé.
// + les coûts anormaux à présenter au logisticien.
//   GET ?brand=moom → { months: BacktestMonth[], anomalies }
import { NextRequest, NextResponse } from 'next/server'
import { shippingBacktest, shippingAnomalies } from '@/lib/shippingCost'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

export async function GET(req: NextRequest) {
  const brand = req.nextUrl.searchParams.get('brand') ?? ''
  const [months, anomalies] = await Promise.all([shippingBacktest(brand), shippingAnomalies(brand)])
  return NextResponse.json({ months, anomalies })
}
