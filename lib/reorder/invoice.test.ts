// npm test — import de facture : rapprochement des lignes avec les variantes.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { matchVariant, aliasKey } from './invoice'
import { DEFAULT_SETTINGS } from './plan'

const v = (id: string, title: string, variantTitle: string) => ({ id, title, variantTitle })
const variants = [
  v('mat-beige', 'MatExplorer™ Tapis à Langer', 'Beige'),
  v('mat-kaki', 'MatExplorer™ Tapis à Langer', 'Kaki'),
  v('mat-mm-kaki', 'MatExplorer™ Tapis à Langer', 'MumMoot Kaki'),
  v('mat-mm-creme', 'MatExplorer™ Tapis à Langer', 'MumMoot Crème'),
  v('me-brown', 'MumExplorer™ Sac à Langer', 'Brown Aubergine'),
  v('me-denim', 'MumExplorer™ Sac à Langer', 'Denim brut'),
  v('me-creme', 'MumExplorer™ Sac à Langer', 'Crème'),
  v('strap-creme', 'Strap MumExplorer™ Attaches poussette', 'Crème'),
]
const s = { colorAliases: DEFAULT_SETTINGS.colorAliases, invoiceAliases: {} as Record<string, string> }
const m = (product: string, color: string, kind: 'product' | 'other' = 'product') => matchVariant({ product, color, kind }, variants, s)

test('produit et couleur, sans confondre « Kaki » et « MumMoot Kaki »', () => {
  assert.equal(m('tapis a langer', 'Beige'), 'mat-beige')
  assert.equal(m('tapis a langer', 'Kaki'), 'mat-kaki')
  assert.equal(m('MatMoot™ tapis a langer', 'Creme'), 'mat-mm-creme')
})

test('synonymes de couleurs : marron, jean, cream ; jamais une attache', () => {
  assert.equal(m('mumexplorer', 'marron'), 'me-brown')
  assert.equal(m('mumexplorer', 'jean'), 'me-denim')
  assert.equal(m('mumexplorer', 'cream'), 'me-creme')
})

test('emballages et lignes inconnues : pas de variante', () => {
  assert.equal(m('package tote bag', '', 'other'), null)
  assert.equal(m('poussette', 'rouge'), null)
})

test('un rapprochement validé est réutilisé', () => {
  const remembered = { ...s, invoiceAliases: { [aliasKey({ product: 'tote', color: 'x' })]: 'me-denim' } }
  assert.equal(matchVariant({ product: 'Tote', color: 'X', kind: 'other' }, variants, remembered), 'me-denim')
})
