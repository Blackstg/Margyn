// Partagé client / serveur (aucune dépendance serveur) : catégories de problème
// proposées aux clients insatisfaits sur /avis/[brand].
export const REVIEW_CATEGORIES = [
  { id: 'livraison',  label: 'Livraison' },
  { id: 'produit',    label: 'Produit abîmé ou défectueux' },
  { id: 'conformite', label: 'Différent de ce que j’attendais' },
  { id: 'sav',        label: 'Service client' },
  { id: 'autre',      label: 'Autre chose' },
] as const

export const REVIEW_CATEGORY_LABEL: Record<string, string> = Object.fromEntries(REVIEW_CATEGORIES.map(c => [c.id, c.label]))
