// Contrôle qualité de la prévision de livraison (page Coûts logisticien) : pour
// chaque mois clôturé et facturé, ce que le modèle (appris sur les 3 mois d'avant)
// aurait prévu, comparé au coût réel facturé.
//   GET ?brand=moom → { months: BacktestMonth[] }
import { NextRequest, NextResponse } from 'next/server'
import { shippingBacktest } from '@/lib/shippingCost'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

export async function GET(req: NextRequest) {
  const brand = req.nextUrl.searchParams.get('brand') ?? ''
  return NextResponse.json({ months: await shippingBacktest(brand) })
}
