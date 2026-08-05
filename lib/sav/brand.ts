import type { NextRequest } from 'next/server'
import type { SavBrand } from './zendesk'

// Marque du SAV pour une requête API (?brand=moom|bowa, défaut moom).
export function savBrandFromRequest(req: NextRequest): SavBrand {
  return req.nextUrl.searchParams.get('brand') === 'bowa' ? 'bowa' : 'moom'
}
