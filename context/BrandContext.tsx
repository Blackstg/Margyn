'use client'

import { createContext, useContext } from 'react'

export type Brand = 'bowa' | 'moom' | 'krom'

const BrandContext = createContext<Brand>('bowa')

export function BrandProvider({ brand, children }: { brand: Brand; children: React.ReactNode }) {
  return <BrandContext.Provider value={brand}>{children}</BrandContext.Provider>
}

export function useBrand(): Brand {
  return useContext(BrandContext)
}
