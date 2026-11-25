// Logique d'affichage du suivi client (Krom, Moom) : grandes étapes, estimation,
// journal France uniquement, libellés FR. Pure (sans React) pour être partagée par
// la page /tracking/[brand] et l'audit quotidien (lib/tracking/audit.ts).
// ─── Types ────────────────────────────────────────────────────────────────────

export interface TrackingSettings {
  brand_name:           string
  brand_logo_url:       string
  brand_color:          string
  brand_website:        string
  contact_email:        string
  show_products:        boolean
  show_address:         boolean
  show_tracking_number: boolean
  show_tracking_link:   boolean
  estimated_days_min:   number
  estimated_days_max:   number
}

export interface Product {
  title:         string
  variant_title: string | null
  qty:           number
  image_url:     string | null
}

export interface TrackingEvent {
  label:    string
  message:  string | null
  date:     string
  location: string | null
  code:     string | null  // 17Track canonical sub_status/stage
}

export interface TrackingResult {
  order_name:      string
  created_at:      string
  customer_name:   string
  products:        Product[]
  address:         { address1: string; address2: string; city: string; zip: string } | null
  tracking_number: string | null
  tracking_events: TrackingEvent[]
  step:            number
  has_carrier_data?: boolean
  carrier_eta?:    { from: string | null; to: string | null } | null
  carrier_name?:   string | null
}

// Local (final-mile) carrier name = drop the cross-border consolidator (YunExpress)
export function localCarrier(name?: string | null): string | null {
  if (!name) return null
  // 17Track renvoie « Colis Prive(Colis Privé) » : on garde le nom entre parenthèses.
  const parts = name.split(/\s*\+\s*/).map(s => s.trim()).filter(s => s && !/yunexpress/i.test(s))
    .map(s => s.match(/\(([^)]+)\)\s*$/)?.[1]?.trim() || s)
  return parts.join(' / ') || null
}

// "En cours de livraison" — rendre l'étape concrète (transporteur local + ville)
export function deliveryDesc(result: TrackingResult): string {
  const city    = result.address?.city?.trim()
  const carrier = localCarrier(result.carrier_name)
  if (carrier && city) return `Votre colis est en cours de livraison par ${carrier} à ${city}.`
  if (city)            return `Votre colis est en cours de livraison à ${city} et arrivera très bientôt.`
  if (carrier)         return `Votre colis est en cours de livraison par ${carrier}.`
  return 'Votre colis est en tournée de livraison, il arrivera très bientôt.'
}

// ─── Timeline types ───────────────────────────────────────────────────────────

export type TLStatus = 'done' | 'current' | 'upcoming'

export interface TLEvent {
  status:  TLStatus
  title:   string
  time:    string | null   // real date only on 'done'
  est:     boolean         // amber "estimé" badge on 'upcoming'
  desc:    string
  place?:  string | null   // lieu réel (ville/pays) — affiché sur l'étape courante
  nextup?: string          // hint shown below 'current' dot only
}

// Pays (codes ISO) → nom FR, pour afficher un lieu lisible sur l'étape courante
export const COUNTRY_FR: Record<string, string> = {
  FR: 'France', BE: 'Belgique', DE: 'Allemagne', NL: 'Pays-Bas', ES: 'Espagne',
  IT: 'Italie', LU: 'Luxembourg', GB: 'Royaume-Uni', CH: 'Suisse', CN: 'Chine',
  PT: 'Portugal',
}
export const titleCase = (s: string) => s.toLowerCase().replace(/(^|[\s'-])([a-zà-ÿ])/g, (_, sep, c) => sep + c.toUpperCase())
// "PARIS, PARIS, FR" → "Paris, France" ; "HOOFDDORP, NORTH HOLLAND, NL" → "Hoofddorp, Pays-Bas" ; "FR" → "France"
// Ne pas révéler l'origine (Chine) au client : on masque toute localisation chinoise.
export function isChinaLoc(loc: string | null | undefined): boolean {
  if (!loc) return false
  return countryOf(loc) === 'CN' || /china|chine|mainland/i.test(loc)
}
export function prettyPlace(loc: string | null | undefined): string | null {
  if (!loc || isChinaLoc(loc)) return null
  let parts = loc.split(',').map(s => s.trim()).filter(Boolean)
  parts = parts.filter((p, i) => i === 0 || p.toUpperCase() !== parts[i - 1].toUpperCase()) // dédoublonne
  if (!parts.length) return null
  const last = parts[parts.length - 1]
  const country = /^[A-Za-z]{2}$/.test(last) ? (COUNTRY_FR[last.toUpperCase()] ?? last) : titleCase(last)
  const cityTok = parts[0]
  const city = /^[A-Za-z]{2}$/.test(cityTok) ? (COUNTRY_FR[cityTok.toUpperCase()] ?? cityTok) : titleCase(cityTok)
  return parts.length === 1 || city === country ? city : `${city}, ${country}`
}

// ─── Carrier detection ────────────────────────────────────────────────────────

export type CarrierId = 'colissimo' | 'colis-prive' | 'gofo'

export const CARRIER_NAMES: Record<CarrierId, string> = {
  colissimo:     'Colissimo',
  'colis-prive': 'Colis Privé',
  gofo:          'Gofo',
}


export function detectCarrier(tracking: string): CarrierId | null {
  const t = tracking.toUpperCase().trim()

  // Colissimo (La Poste) — 13 chars, specific 2-letter prefixes
  if (/^(6[A-Z]|8[LQ]|9V)\d{11}$/.test(t)) return 'colissimo'
  // Colissimo international
  if (/^(CW|GR|EE|RR)\d{9}FR$/.test(t)) return 'colissimo'

  // Colis Privé — plusieurs formats connus
  if (/^37\d{11}$/.test(t))   return 'colis-prive'
  if (/^FCCE\d+$/.test(t))    return 'colis-prive'
  if (/^S\d{15,16}$/.test(t)) return 'colis-prive'  // ex: S6230116917912320

  // Gofo — GF or GOF prefix
  if (/^(GF|GOF)\d+/i.test(t)) return 'gofo'

  return null
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

export function addDays(iso: string, days: number) {
  const d = new Date(iso)
  d.setDate(d.getDate() + days)
  return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' })
}

export function fmtDate(iso: string | null | undefined): string | null {
  if (!iso) return null
  return new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' })
}

export function fmtDateTime(iso: string | null | undefined): string | null {
  if (!iso) return null
  const d = new Date(iso)
  return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' }) + ', ' +
         d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
}

// Grandes étapes claires (rassurantes) qui suivent le vrai trajet d'un colis
// cross-border (entrepôt → vol international → dédouanement → centre de tri du
// pays → livraison). Assez d'étapes pour qu'il n'y ait jamais de grand vide qui
// inquiète le client. Le journal complet reste dans « voir le détail ».
export const RT_PHASES: { key: string; title: string; desc: string }[] = [
  { key: 'confirmed', title: 'Commande confirmée',      desc: 'Nous avons bien reçu votre commande.' },
  { key: 'prepared',  title: 'Commande en préparation', desc: 'Votre commande est préparée avec soin. La préparation peut prendre quelques jours avant l’expédition.' },
  { key: 'shipped',   title: 'Colis expédié',           desc: 'Votre colis a quitté notre entrepôt et est en route.' },
  { key: 'transit',   title: 'En transit international', desc: 'Votre colis voyage vers votre pays. Cette étape peut prendre plusieurs jours, c’est tout à fait normal.' },
  { key: 'customs',   title: 'Dédouanement',            desc: 'Votre colis passe les formalités douanières d’importation.' },
  { key: 'sorting',   title: 'Au centre de tri',        desc: 'Votre colis est arrivé dans votre pays et est en cours de tri.' },
  // Après la remise au transporteur local (ex. GOFO) : le colis traverse le pays
  // jusqu'à l'agence de livraison, souvent SANS scan pendant plusieurs jours. Sans
  // cette étape, le client restait bloqué sur « Au centre de tri · Paris » et
  // s'inquiétait (cas Krom #1368, livraison en Charente-Maritime).
  { key: 'domestic',  title: 'Acheminement vers chez vous', desc: 'Votre colis est en France, pris en charge par notre transporteur. Il est acheminé vers votre région : cette étape prend généralement 2 à 4 jours ouvrés, parfois sans nouveau scan entre-temps.' },
  { key: 'delivery',  title: 'En cours de livraison',   desc: 'Votre colis est en tournée de livraison.' },
  { key: 'delivered', title: 'Livré',                   desc: 'Votre colis a été livré. Bonne réception !' },
]
export const PHASE_IDX: Record<string, number> = Object.fromEntries(RT_PHASES.map((p, i) => [p.key, i]))

// Code pays (dernier token ISO de la localisation), ex. "PARIS, PARIS, FR" → "FR"
export function countryOf(loc: string | null | undefined): string | null {
  if (!loc) return null
  const parts = loc.split(',').map(s => s.trim()).filter(Boolean)
  const last = parts[parts.length - 1]
  return last && /^[A-Za-z]{2}$/.test(last) ? last.toUpperCase() : null
}

// Phase d'un événement. Hybride : sub_status canonique pour les statuts fiables
// (livré / en livraison / douane / info reçue), puis libellé + pays pour la
// granularité du transit (presque tous les events sont "InTransit_Other").
// `country` = pays de l'event. Le colis part de Chine (CN) ; dès qu'il est en
// Europe (hors CN) c'est le côté destination — le hub de dédouanement + tri
// YunExpress est en Belgique (Liège) MÊME pour une livraison en France, donc on
// ne peut pas exiger le pays de destination exact, seulement « hors origine ».
const EUROPE = new Set(['FR', 'BE', 'LU', 'CH', 'MC', 'DE', 'NL', 'ES', 'IT', 'PT', 'AT', 'IE'])
export function phaseFromEvent(label: string, code: string | null, country: string | null): number | null {
  const c = (code ?? '').toLowerCase()
  if (c.startsWith('delivered'))                                            return PHASE_IDX.delivered
  if (c.startsWith('outfordelivery') || c.startsWith('availableforpickup')) return PHASE_IDX.delivery
  if (c.startsWith('inforeceived'))                                         return PHASE_IDX.prepared

  const L = label.toLowerCase()
  const isOrigin = /origine|départ|export|origin/.test(L) // event côté départ (Chine)
  // Étapes qui n'existent QUE côté destination (hub local, cargo terminal, remise
  // au transporteur) → on les considère « en France » même si la localisation n'a
  // pas de code pays (ex. "PARIS, VALEDWAZ" sans "FR").
  const localHub = /cargo terminal|arrived at hub|\bhub\b|remis au transporteur local|ready for outbound|centre de tri \(destination\)/.test(L)
  const destSide = (!!country && country !== 'CN') || localHub

  // Livraison finale (tournée du transporteur local)
  if (/en cours de livraison|out for delivery/.test(L)) return PHASE_IDX.delivery

  // Avis d'arrivée (NOA = Notice of Arrival) → le colis est arrivé dans le pays de
  // destination et un avis a été émis : il est forcément POST-dédouanement/transit.
  // Idem « vol international arrivé » côté destination (country ≠ CN). Sinon ces
  // events (sub_status générique InTransit_Other) retombent sur « transit » (idx 3)
  // et le dédouanement en cours (idx 4) les masque → le suivi reste bloqué sur
  // « Dédouanement » alors que 17Track montre le colis déjà arrivé. On mappe donc
  // sur « Au centre de tri » (arrivé dans le pays).
  if (/avis d.?arriv[ée]|noa received/.test(L)) return PHASE_IDX.sorting
  if (destSide && /vol international arriv[ée]|international flight has arrived/.test(L)) return PHASE_IDX.sorting

  // Dédouanement à l'import (surtout pas l'export/déclaration au départ).
  // Une fois le dédouanement TERMINÉ (import completed/released), le colis a quitté
  // la douane et est dans le pays → on affiche « Au centre de tri » (dernière étape
  // réelle), pas « Dédouanement » (qui donnerait l'impression que c'est encore bloqué).
  if (!isOrigin && (/dédouanement|douane|customs clear/.test(L) || c.includes('customs'))) {
    const cleared = c.includes('customsrel') || /import terminé|termin[ée]|completed|released|lib[ée]r/.test(L)
    return cleared ? PHASE_IDX.sorting : PHASE_IDX.customs
  }

  // Tri / arrivée dans la région de destination / remise au transporteur local.
  // NB : « Transmis au transporteur local » (pré-généré « will be delivered to X »)
  // est du bruit et NE compte pas — seul « remis au transporteur local » (réel) compte.
  // "acheminement / agence (régionale) de destination / arrivé en France" = étapes
  // domestiques (destination) → « Au centre de tri », pas transit international.
  // Colissimo : « disponible / vous attend dans votre point de retrait » = colis à
  // récupérer (comme AvailableForPickup), pas un simple transit.
  if (destSide && /disponible dans votre point|vous attend dans votre point/.test(L)) return PHASE_IDX.delivery
  if (destSide && /centre de tri|sort facility|arrived at hub|\bhub\b|départ du centre|ready for outbound|outbound|remis au transporteur local|pris en charge|cargo terminal|livr|\btri\b|achemin|agence|arriv[ée] en france|plate-?forme|site de distribution|point de retrait|relais|consigne|point postal/.test(L))
    return PHASE_IDX.sorting

  // Départ de l'entrepôt d'origine (Chine) — UNIQUEMENT côté origine. Un « pris en
  // charge par le transporteur local » à Paris ne doit PLUS être classé « Colis
  // expédié » (bug : statut de départ affiché alors que le colis est déjà en France).
  if (!destSide && /centre de tri \((départ|origine)\)|origin facility|pris en charge/.test(L)) return PHASE_IDX.shipped
  if (/informations d’expédition|information received|préparation/.test(L)) return PHASE_IDX.prepared
  // Scan en Europe non reconnu (Colissimo : incident, nouvelle tentative, retour…) :
  // le colis est déjà dans le pays, jamais « en transit international » (cas Mōom
  // #33691 : « en transit sur nos plateformes logistiques » en France).
  if (country && EUROPE.has(country)) return PHASE_IDX.sorting
  // Tout le reste du voyage = transit international
  if (c.startsWith('intransit') || c.startsWith('exception') || L.length > 0)  return PHASE_IDX.transit
  return null
}

// Instant de la remise au transporteur local (dernier kilomètre) ; les scans de
// tri qui suivent appartiennent à l'acheminement domestique, pas à l'arrivée.
export function handoverTime(events: TrackingResult['tracking_events']): number | null {
  let ms: number | null = null
  for (const e of events ?? []) {
    if (!/remis au transporteur local|handed over to (the )?local|last.?mile/i.test(e.label || '')) continue
    const t = new Date(e.date).getTime()
    if (!isNaN(t) && (ms == null || t < ms)) ms = t
  }
  return ms
}
export function phaseOf(e: TrackingResult['tracking_events'][number], handoverMs: number | null): number | null {
  const idx = phaseFromEvent(e.label, e.code, countryOf(e.location))
  // Tout scan postérieur à la remise au transporteur local est domestique (même
  // « Arrived at sorting center · Paris » sans code pays, qui retombait sinon en
  // « transit international »), sauf la tournée et la livraison.
  if (handoverMs != null && idx != null && idx < PHASE_IDX.delivery && new Date(e.date).getTime() >= handoverMs) return PHASE_IDX.domestic
  return idx
}

// Libellés transporteur restés en anglais → français (journal « voir le détail »)
export const EN_LABELS: [RegExp, string][] = [
  [/^arrived at (the )?sorting cent(er|re)/i, 'Arrivé au centre de tri'],
  [/^shipment is ready for outbound/i, 'Prêt à partir du centre de tri'],
  [/^collected at cargo terminal/i, 'Réceptionné au terminal de fret'],
  [/^departed (from )?(the )?(sorting )?(facility|cent(er|re))/i, 'Départ du centre de tri'],
  [/^arrived at (the )?local delivery (round|office|station)/i, 'Arrivé à l’agence de livraison'],
  [/^arrived at (the )?(delivery )?hub/i, 'Arrivé au centre de distribution'],
  [/^arrived at (the )?(gofo )?regional destination facility/i, 'Arrivé au centre de distribution régional'],
  [/^the package left (the )?sorting cent(er|re)/i, 'Départ du centre de tri'],
  [/^arrived at the warehouse of customs broker/i, 'Arrivé chez le transitaire en douane'],
  [/^in transit$/i, 'En transit'],
  [/^out for delivery/i, 'En cours de livraison'],
  [/^delivered/i, 'Livré'],
]
// Libellé resté en anglais (transporteurs variés : Evri, DPD, GOFO…) → plutôt que
// d'ajouter une traduction à chaque nouveau cas, on retombe sur un libellé FR
// générique selon le sens. Le client ne voit jamais d'anglais.
export const looksEnglish = (l: string) =>
  // Mots uniquement anglais (pas « transit », « hub »… communs au français).
  /\b(the|at|by|to|for|your|this|has|been|is|was|arrived|departed|shipment|parcel|package|sorting|sorted|processed|processing|collected|received|handed|courier|agency|depot|facility|release|inbound|outbound|delivery|warehouse)\b/i.test(l)

const EN_FALLBACK: [RegExp, string][] = [
  [/out for delivery|on (its|the) way to (you|the recipient)|with (the )?(courier|driver) for delivery/i, 'En cours de livraison'],
  [/\bdelivered\b/i, 'Livré'],
  [/back to the sorting|returned to (the )?(sort|depot)|failed|unsuccessful|attempt|deliver(y)? again/i, 'Nouvelle tentative de livraison prévue'],
  [/agency|depot|delivery (cent(er|re)|office|station|round)|courier/i, 'Arrivé à l’agence de livraison'],
  [/customs|import|export|release/i, 'Formalités douanières'],
  [/sort|hub|facility|processed|processing|warehouse/i, 'Au centre de tri'],
  [/collected|received|first scan|handed|picked up|pick-?up|accepted|drop(ped)? off/i, 'Pris en charge par le transporteur'],
]

export function frLabel(label: string): string {
  const l = label.trim()
  for (const [re, fr] of EN_LABELS) if (re.test(l)) return fr
  if (!looksEnglish(l)) return label
  for (const [re, fr] of EN_FALLBACK) if (re.test(l)) return fr
  return 'Colis en transit'
}

// Ajoute n jours ouvrés (ni samedi, ni dimanche, ni férié) — délais transporteur.
export function addWorkingDays(d: Date, n: number): Date {
  let r = new Date(d)
  let left = n, guard = 0
  while (left > 0 && guard++ < 40) {
    r = new Date(r.getTime() + 86_400_000)
    if (r.getUTCDay() !== 0 && r.getUTCDay() !== 6 && !isFrenchHoliday(r)) left--
  }
  return r
}

// Date de livraison estimée, TOUJOURS dans le futur (rassurant) :
// ETA transporteur si dispo → sinon commande + délai → si dépassée, glissante depuis le dernier event.
// Dimanche de Pâques (algorithme de Meeus/Butcher, grégorien) — base des fériés mobiles.
export function easterSunday(year: number): Date {
  const a = year % 19
  const b = Math.floor(year / 100), c = year % 100
  const d = Math.floor(b / 4), e = b % 4
  const f = Math.floor((b + 8) / 25)
  const g = Math.floor((b - f + 1) / 3)
  const h = (19 * a + b - d - g + 15) % 30
  const i = Math.floor(c / 4), k = c % 4
  const l = (32 + 2 * e + 2 * i - h - k) % 7
  const m = Math.floor((a + 11 * h + 22 * l) / 451)
  const month = Math.floor((h + l - 7 * m + 114) / 31) // 3 = mars, 4 = avril
  const day = ((h + l - 7 * m + 114) % 31) + 1
  return new Date(Date.UTC(year, month - 1, day))
}

// Jour férié français (fixes + mobiles : lundi de Pâques, Ascension, lundi de Pentecôte).
export function isFrenchHoliday(d: Date): boolean {
  const md = `${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`
  if (['01-01', '05-01', '05-08', '07-14', '08-15', '11-01', '11-11', '12-25'].includes(md)) return true
  const e = easterSunday(d.getUTCFullYear())
  return [1, 39, 50].some(off => {
    const h = new Date(e.getTime() + off * 86_400_000)
    return h.getUTCMonth() === d.getUTCMonth() && h.getUTCDate() === d.getUTCDate()
  })
}

// Pas de livraison le dimanche ni les jours fériés (France) → prochain jour livrable.
export function nextDeliveryDay(d: Date): Date {
  let r = new Date(d)
  let guard = 0
  while ((r.getUTCDay() === 0 || isFrenchHoliday(r)) && guard++ < 12) {
    r = new Date(r.getTime() + 86_400_000)
  }
  return r
}

export function estimatedDeliveryDate(result: TrackingResult, settings: TrackingSettings | null): Date | null {
  const now = Date.now()
  const DAY = 24 * 3600 * 1000
  let d: Date | null = null
  if (result.carrier_eta?.to) d = new Date(result.carrier_eta.to)
  else if (settings) { d = new Date(result.created_at); d.setDate(d.getDate() + settings.estimated_days_max) }
  if (!d) return null

  // Resserre selon l'AVANCEMENT réel : une fois le colis arrivé au centre de tri de
  // destination (≈ 2 j du domicile) ou en cours de livraison (≈ 1 j), l'estimation
  // « commande + délai max » devient trop large → on plafonne au dernier scan + délai court.
  const delivered = result.step === 5
  const lastScan = result.tracking_events?.[0]?.date
  if (!delivered && lastScan) {
    let phase = 0
    const handoverMs = handoverTime(result.tracking_events)
    for (const e of result.tracking_events ?? []) {
      const idx = phaseOf(e, handoverMs)
      if (idx != null && idx > phase) phase = idx
    }
    const capDays = phase >= PHASE_IDX.delivery ? 1 : phase >= PHASE_IDX.sorting ? 2 : null
    if (capDays != null) {
      let cap = new Date(new Date(lastScan).getTime() + capDays * DAY)
      if (cap.getTime() < now) cap = new Date(now + DAY) // imminent
      if (cap.getTime() < d.getTime()) d = cap
    }
  }

  if (d.getTime() < now) {
    d = lastScan ? new Date(lastScan) : new Date()
    d.setDate(d.getDate() + 3)
    if (d.getTime() < now) { d = new Date(); d.setDate(d.getDate() + 2) }
  }
  return nextDeliveryDay(d)
}

// Fourchette affichée au client une fois le colis en France : ancrée sur le
// DERNIER SCAN (+2 à +4 jours ouvrés) et non sur « aujourd'hui », pour que la date
// ne recule pas d'un jour chaque matin (« ça fait que bouger »). Ne glisse que si
// la fourchette est dépassée.
export function estimatedDeliveryRange(result: TrackingResult, settings: TrackingSettings | null): { from: Date; to: Date } | null {
  const single = estimatedDeliveryDate(result, settings)
  const lastScan = result.tracking_events?.[0]?.date
  if (result.step === 5 || !lastScan || result.carrier_eta?.to) return single ? { from: single, to: single } : null
  const handoverMs = handoverTime(result.tracking_events)
  let phase = 0
  for (const e of result.tracking_events ?? []) {
    const idx = phaseOf(e, handoverMs)
    if (idx != null && idx > phase) phase = idx
  }
  if (phase < PHASE_IDX.sorting) return single ? { from: single, to: single } : null
  // En tournée aujourd'hui (dernier scan = « en cours de livraison » du jour) →
  // livraison prévue aujourd'hui, pas « J+1 à J+2 » (cas Krom #1422).
  const latest = result.tracking_events?.[0]
  const parisDay = (d: Date) => d.toLocaleDateString('fr-CA', { timeZone: 'Europe/Paris' })
  if (latest && phaseOf(latest, handoverMs) === PHASE_IDX.delivery && parisDay(new Date(lastScan)) === parisDay(new Date())) {
    const today = new Date()
    return { from: today, to: today }
  }
  const anchor = new Date(lastScan)
  const [a, b] = phase >= PHASE_IDX.delivery ? [1, 2] : [2, 4]
  let from = addWorkingDays(anchor, a), to = addWorkingDays(anchor, b)
  const now = new Date()
  if (to.getTime() < now.getTime()) { from = addWorkingDays(now, 1); to = addWorkingDays(now, 3) }
  else if (from.getTime() < now.getTime()) { const next = addWorkingDays(now, 1); from = next < to ? next : to }
  return { from, to }
}

export function fmtRange(r: { from: Date; to: Date }): string {
  const day = (d: Date) => d.toLocaleDateString('fr-FR', { day: 'numeric' })
  const full = (d: Date) => d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' })
  if (r.from.toDateString() === r.to.toDateString()) return r.to.toDateString() === new Date().toDateString() ? 'Aujourd’hui' : full(r.to)
  return r.from.getMonth() === r.to.getMonth() ? `${day(r.from)} – ${full(r.to)}` : `${full(r.from)} – ${full(r.to)}`
}

// Dernier scan CÔTÉ ORIGINE (encore en Chine / en train de quitter l'origine).
export function latestOriginTime(events: TrackingResult['tracking_events']): number {
  let latest = 0
  for (const e of events) {
    const c = countryOf(e.location)
    const L = (e.label || '').toLowerCase()
    const isOrigin = c === 'CN' || /export|vol international parti|international flight has departed|origin facility|origine|centre de tri \((départ|origine)\)/.test(L)
    if (!isOrigin) continue
    const t = new Date(e.date).getTime()
    if (!isNaN(t) && t > latest) latest = t
  }
  return latest
}

// Journal « voir le détail » : uniquement la partie France (après le dernier scan
// côté origine). Le trajet YunExpress au départ de Chine n'est pas montré au client,
// les grandes étapes de la frise suffisent.
export function localEvents(events: TrackingResult['tracking_events']): TrackingResult['tracking_events'] {
  const cut = latestOriginTime(events)
  return events.filter(e => { const t = new Date(e.date).getTime(); return !isNaN(t) && t > cut && countryOf(e.location) !== 'CN' })
}

export function buildRealTimeline(result: TrackingResult, settings: TrackingSettings | null): TLEvent[] {
  const delivered = result.step === 5
  const estDate = estimatedDeliveryRange(result, settings)?.to ?? null
  const handoverMs = handoverTime(result.tracking_events)

  // On affiche TOUTES les étapes franchies du trajet (chacune avec sa date) pour
  // qu'il n'y ait pas de grand vide qui inquiète. Les events sont triés du + récent
  // au + ancien : en écrasant dateFor, on garde la date d'ENTRÉE (la plus ancienne)
  // dans chaque phase → dates croissantes. placeByIdx garde le lieu le + récent.
  // Dernier scan CÔTÉ ORIGINE (encore en Chine / en train de quitter l'origine).
  // Sert à ignorer les events destination PRÉMATURÉS : CIRRO/YunExpress émettent
  // parfois une pré-déclaration douanière en France AVANT que l'avion ait quitté la
  // Chine → sans ça, on saute à « Dédouanement » alors que le colis est encore en
  // transit international (désaccord avec 17Track, qui reflète le dernier scan réel).
  const latestOriginMs = latestOriginTime(result.tracking_events)

  const dateFor: Record<string, string> = {}
  const latestDateByIdx: Record<number, string> = {}  // date du scan le + RÉCENT de la phase
  const placeByIdx: Record<number, string | null> = {}
  const datesByIdx: Record<number, string[]> = {}
  let maxIdx = 0
  for (const e of result.tracking_events) {  // du + récent au + ancien
    const idx = phaseOf(e, handoverMs)
    if (idx == null) continue
    // Garde-fou chronologique : un event CÔTÉ DESTINATION (dédouanement import,
    // arrivée dans le pays, tri, livraison) plus ANCIEN que le dernier scan d'origine
    // est une donnée transporteur en avance/désordre → on l'ignore.
    if (idx >= PHASE_IDX.customs && latestOriginMs > 0) {
      const t = new Date(e.date).getTime()
      if (!isNaN(t) && t < latestOriginMs) continue
    }
    if (idx > maxIdx) maxIdx = idx
    dateFor[RT_PHASES[idx].key] = e.date          // écrasé → garde la date d'ENTRÉE (la + ancienne)
    ;(datesByIdx[idx] ??= []).push(e.date)
    if (latestDateByIdx[idx] == null) latestDateByIdx[idx] = e.date  // 1re vue = la + récente
    if (placeByIdx[idx] == null) placeByIdx[idx] = prettyPlace(e.location)
  }
  // Dates d'entrée croissantes : un scan d'une étape antérieur à l'entrée dans
  // l'étape précédente (ex. « avis d'arrivée » 19/10 classé « centre de tri » avant
  // le dédouanement du 20/10) donnerait un fil en désordre → on prend le 1er scan
  // de l'étape postérieur à l'étape précédente.
  let prevMs = 0
  for (let i = 0; i < RT_PHASES.length; i++) {
    const ds = datesByIdx[i]
    if (!ds?.length) continue
    const ms = ds.map(d => new Date(d).getTime()).filter(t => !isNaN(t)).sort((a, b) => a - b)
    const pick = ms.find(t => t >= prevMs) ?? ms[ms.length - 1]
    const iso = ds.find(d => new Date(d).getTime() === pick)
    if (iso) dateFor[RT_PHASES[i].key] = iso
    prevMs = Math.max(prevMs, pick)
  }
  // "Livré" UNIQUEMENT si le transporteur confirme le statut Delivered (step 5),
  // sinon on plafonne à "En cours de livraison".
  const lastReached = delivered ? PHASE_IDX.delivered : Math.min(maxIdx, PHASE_IDX.delivery)
  const currentPlace = placeByIdx[lastReached] ?? null

  // Date estimée pour CHAQUE étape non encore atteinte : on répartit les étapes à
  // venir entre maintenant (ou la dernière étape franchie) et la livraison estimée.
  const estForIdx: Record<number, string> = {}
  const upcoming = RT_PHASES.map((_, i) => i).filter(i => i > lastReached)
  if (upcoming.length && estDate) {
    const lastDate = dateFor[RT_PHASES[lastReached].key] ?? result.created_at
    const startMs  = Math.max(Date.now(), new Date(lastDate).getTime())
    const endMs    = Math.max(estDate.getTime(), startMs)
    const DAY = 24 * 3600 * 1000
    let prevMs = startMs
    upcoming.forEach((idx, k) => {
      // Réparti entre maintenant et la livraison estimée, mais avec AU MOINS 1 jour
      // d'écart entre chaque étape (sinon plusieurs étapes tombent le même jour),
      // et jamais un dimanche (pas de livraison).
      // La 1re étape à venir peut tomber aujourd'hui (colis en tournée du jour).
      const ms = Math.max(startMs + (endMs - startMs) * ((k + 1) / upcoming.length), k === 0 ? startMs : prevMs + DAY)
      const dt = nextDeliveryDay(new Date(ms))
      prevMs = dt.getTime()
      estForIdx[idx] = dt.toDateString() === new Date().toDateString() ? 'aujourd’hui' : dt.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' })
    })
  }

  return RT_PHASES.map((p, i): TLEvent => {
    const status: TLStatus = i < lastReached ? 'done' : i === lastReached ? (delivered ? 'done' : 'current') : 'upcoming'
    const desc = p.key === 'delivery' ? deliveryDesc(result) : p.desc
    const rawDate = p.key === 'confirmed'
      ? result.created_at
      : p.key === 'delivered'
        ? (dateFor.delivered ?? (delivered ? result.tracking_events?.[0]?.date : undefined))
        // Étape COURANTE : date du dernier scan (cohérente avec le lieu affiché, le + récent).
        // Étapes passées : date d'entrée (pour un fil de dates croissantes).
        : (i === lastReached ? (latestDateByIdx[i] ?? dateFor[p.key]) : dateFor[p.key])
    // Étapes à venir : date estimée sur CHACUNE, badge "estimé"
    if (status === 'upcoming') {
      const est = estForIdx[i] ?? null
      return { status, title: p.title, time: est, est: !!est, desc }
    }
    const time = p.key === 'confirmed' ? fmtDate(rawDate) : (rawDate ? fmtDateTime(rawDate) : null)
    const place = status === 'current' ? currentPlace : null
    // Pas de nouveau scan depuis > 48 h une fois en France : on explique que c'est
    // normal (le transporteur ne scanne qu'aux grandes étapes).
    let nextup: string | undefined
    const lastScan = result.tracking_events?.[0]?.date
    if (status === 'current' && i >= PHASE_IDX.sorting && lastScan && Date.now() - new Date(lastScan).getTime() > 48 * 3600 * 1000) {
      const since = new Date(lastScan).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })
      nextup = `Pas de nouveau scan depuis ${since} : c'est normal pendant le transport en France. Le colis sera scanné à nouveau à son arrivée près de chez vous, puis livré.`
    }
    return { status, title: p.title, time, est: false, desc, place, nextup }
  })
}

// ─── buildTimeline ────────────────────────────────────────────────────────────

// Offsets (in days from created_at) for each of the 10 logical steps.
// Upcoming steps use these to compute estimated dates.
export const STEP_OFFSETS = [0, 1, 2, 3, 5, 8, 9, 10, 11, 12]

export function buildTimeline(result: TrackingResult, settings: TrackingSettings | null): TLEvent[] {
  const s    = result.step
  const evts = result.tracking_events   // newest first
  const min  = settings?.estimated_days_min ?? 12
  const max  = settings?.estimated_days_max ?? 20

  // Scale the fixed offsets to the actual delivery window
  // Steps 0-3 are early (fixed), steps 4-9 spread across the delivery window
  function estDate(idx: number): string {
    const fraction = STEP_OFFSETS[idx] / 12  // 12 = max fixed offset
    const days = Math.round(min + fraction * (max - min))
    const d = new Date(result.created_at); d.setDate(d.getDate() + days)
    if (d.getTime() < Date.now()) return idx === 9 ? 'très prochainement' : 'à venir'
    const date = addDays(result.created_at, days)
    return idx === 9 ? `au plus tard le ${date}` : `~ ${date}`
  }

  // Extract key timestamps from carrier events
  const labelEvt      = evts.find(e => ['Étiquette créée', 'Étiquette achetée'].includes(e.label))
  const firstScanEvt  = [...evts].reverse().find(e =>
    ['Expédition confirmée', 'Pris en charge', 'En transit'].includes(e.label)
  )
  const transitEvt    = [...evts].reverse().find(e => e.label === 'En transit')
  const outEvt        = evts.find(e => e.label === 'En cours de livraison')
  const delivEvt      = evts.find(e => e.label === 'Livré')

  // Minimum result.step for each logical step (0-indexed) to be "done"
  const doneAt = [1, 2, 3, 3, 4, 4, 4, 4, 5, 5]

  // Which logical step index is "current" per result.step
  const curLogical: Record<number, number> = { 1: 1, 2: 2, 3: 4, 4: 8 }
  const cur = curLogical[s] ?? -1

  type Raw = { title: string; realTime?: string | null; desc: string; nextup?: string }

  const raw: Raw[] = [
    {
      title:    'Commande confirmée',
      realTime: fmtDate(result.created_at),
      desc:     'Votre commande a bien été enregistrée et validée.',
    },
    {
      title:    'Préparation en entrepôt',
      realTime: s >= 2 ? fmtDate(labelEvt?.date ?? result.created_at) : null,
      desc:     'Votre commande a été préparée et soigneusement emballée.',
      nextup:   'Votre colis sera bientôt pris en charge pour l\'expédition.',
    },
    {
      title:    'Colis expédié',
      realTime: s >= 3 ? fmtDate(firstScanEvt?.date ?? labelEvt?.date ?? result.created_at) : null,
      desc:     'Votre colis a quitté notre entrepôt et est en route.',
    },
    {
      title:    'Départ du centre logistique',
      realTime: s >= 3 ? fmtDate(firstScanEvt?.date ?? labelEvt?.date ?? result.created_at) : null,
      desc:     'Votre colis a quitté le centre logistique de départ.',
    },
    {
      title:    'Acheminement en cours',
      realTime: s >= 4 ? fmtDate(transitEvt?.date ?? firstScanEvt?.date ?? null) : null,
      desc:     s === 3
        ? 'C\'est l\'étape la plus longue du trajet — votre colis avance chaque jour. Tout se passe normalement.'
        : 'Votre colis a été acheminé avec succès vers la France.',
      nextup: 'Votre colis sera pris en charge par le transporteur local pour la livraison finale.',
    },
    {
      title:    'Arrivée au centre de tri',
      realTime: s >= 4 ? fmtDate(transitEvt?.date ?? firstScanEvt?.date ?? null) : null,
      desc:     'Votre colis est arrivé au centre de tri régional.',
    },
    {
      title:    'Contrôle & traitement',
      realTime: s >= 4 ? fmtDate(transitEvt?.date ?? firstScanEvt?.date ?? null) : null,
      desc:     'Votre colis est en cours de traitement et d\'orientation.',
    },
    {
      title:    'Remis au transporteur',
      realTime: s >= 4 ? fmtDate(outEvt?.date ?? transitEvt?.date ?? null) : null,
      desc:     'Votre colis a été confié au transporteur final.',
    },
    {
      title:    'En cours de livraison',
      realTime: s >= 5 ? fmtDate(outEvt?.date ?? null) : null,
      desc:     'Le livreur est en chemin — il passera très bientôt à votre adresse.',
      nextup:   'Le livreur passera à votre adresse dans la journée.',
    },
    {
      title:    'Livré',
      realTime: s >= 5 ? fmtDate(delivEvt?.date ?? null) : null,
      desc:     'Votre commande est arrivée à destination. Merci de votre confiance !',
    },
  ]

  return raw.map((r, i): TLEvent => {
    const status: TLStatus =
      s >= doneAt[i]  ? 'done'    :
      i === cur       ? 'current' :
      'upcoming'

    // done → real timestamp | current → no time | upcoming → estimated date
    const time =
      status === 'done'     ? (r.realTime ?? null) :
      status === 'upcoming' ? estDate(i)            :
      null

    return {
      status,
      title:  r.title,
      time,
      est:    status === 'upcoming',
      desc:   r.desc,
      nextup: status === 'current' ? r.nextup : undefined,
    }
  })
}

// ─── VerticalTimeline ─────────────────────────────────────────────────────────

