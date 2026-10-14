'use client'

import { useCallback, useEffect, useState } from 'react'

// Persiste un petit état d'onglet/vue dans l'URL (query param) pour que
// l'actualisation / le partage de lien conserve la sous-section affichée.
//
// - Lecture au montage côté client uniquement (via window.location) → pas de
//   mismatch d'hydratation : le 1er rendu serveur/client utilise `initial`,
//   puis un useEffect applique la valeur de l'URL si présente.
// - Écriture via window.history.replaceState → pas de navigation Next, pas de
//   rechargement, pas de boucle de rendu. Si la valeur == défaut, on retire le
//   paramètre pour garder des URLs propres.
export function useUrlState<T extends string>(
  key: string,
  initial: T,
): [T, (v: T) => void] {
  const [value, setValue] = useState<T>(initial)

  useEffect(() => {
    const p = new URLSearchParams(window.location.search).get(key)
    if (p) setValue(p as T)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  const set = useCallback((v: T) => {
    setValue(v)
    const url = new URL(window.location.href)
    if (v === initial) url.searchParams.delete(key)
    else url.searchParams.set(key, v)
    window.history.replaceState(window.history.state, '', url.toString())
  }, [key, initial])

  return [value, set]
}
