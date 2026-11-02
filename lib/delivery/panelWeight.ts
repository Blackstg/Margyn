// Équivalent « panneau » d'un article pour la facturation Terence : convenu avec lui,
// 4 Akupanel 60×60 = 1 panneau classique (240) — ils sont 4 fois plus petits ;
// 2 feuilles de pierre = 1 panneau.
export const isSmallPanel = (title?: string | null, variant?: string | null) =>
  /akupanel\W{0,3}60\b/i.test(title ?? '') || /60\s*x\s*60/i.test(variant ?? '')

export const panelWeight = (title?: string | null, variant?: string | null) => isSmallPanel(title, variant) ? 0.25 : 1

// Panneaux facturés d'une ligne d'articles : comme la capacité camion (Extpanel par
// cartons de 4), sauf l'Akupanel 60×60 compté ¼ (au lieu de ½ place camion)
export const billedPanelsOfItem = (title: string, variant: string | null | undefined, qty: number) =>
  /extpanel|ext[_\s-]?panel/i.test(title) ? Math.ceil(qty / 4) : qty * panelWeight(title, variant)

// Feuille de pierre (Stonepanel) : ½ panneau classique (accord Terence)
export const STONE_WEIGHT = 0.5

// Tranche de prix : un panneau entamé compte (2 × 60×60 = 0,5 → 1 panneau)
export const billedPanels = (equivalent: number) => Math.ceil(equivalent - 1e-9)
