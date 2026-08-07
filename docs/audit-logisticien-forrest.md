# Audit coût logisticien (Forrest) — Mōom · jan→juil 2026

> Vérification reproductible à partir des données Steero + enrichissement Shopify.
> Aucune conclusion n'est affirmée sans chiffre. Sources : table Supabase
> `logistician_invoice_summaries` (7 mois, 5 714 commandes non-FW, 116 273 $ facturés)
> jointe aux commandes Shopify Mōom (poids, pays, nb articles, port payé client).

---

## Étape 0 — Cartographie des données (ce qu'on a / ce qu'on n'a PAS)

**Ce que le logisticien nous facture réellement (par commande, table `logistician_invoice_summaries.invoice_rows`) :**

| Champ | Présent ? |
|---|---|
| N° commande (`order_name`) | ✅ |
| Date | ✅ |
| Shipping facturé (`shipping_price`, USD) | ✅ |
| Service fee (`service_price`, USD) | ✅ |
| Total facturé (`total_price`, USD) | ✅ |
| SKU | ⚠️ quasi toujours vide |

**Ce qui N'EST PAS dans la facture logisticien :**

| Champ nécessaire pour vérifier son argument | Présent ? | Où je l'ai trouvé sinon |
|---|---|---|
| **Poids réel du colis** | ❌ absent de la facture | Poids **produit** Shopify (`total_weight`) — dispo sur **66 %** des commandes seulement |
| **Poids volumétrique / dimensions / type de carton** | ❌ **nulle part** | Introuvable → **argument "carton/volumétrique" invérifiable** |
| Pays de destination | ❌ pas stocké | Shopify (`shipping_address.country_code`) |
| Nb d'articles | ❌ pas stocké | Shopify (`line_items`) |
| Port payé par le client | ❌ pas stocké | Shopify (`shipping_lines`) |
| Taux de change USD/EUR appliqué | ❌ non stocké par commande | Défaut fixe **0,92** dans l'app |
| Grille tarifaire poids→prix | ❌ jamais fournie | à réclamer |
| Détail de calcul du service fee | ❌ jamais fourni | à réclamer |

> ⚠️ **Point critique** : le poids **d'emballage** et les **dimensions** ne sont nulle part
> dans nos données. L'affirmation « le shipping est au poids » n'est vérifiable que
> partiellement (via le poids *produit* Shopify), et l'affirmation « le service fee est
> tiré par le carton / le volumétrique » est **totalement invérifiable de notre côté**.
> Tant que Forrest ne fournit pas poids pesé + dimensions + grille, sa justification
> reste une **affirmation non prouvée**.

---

## Étape 2 — Test quantitatif des affirmations de Forrest

Régressions sur les commandes jointes (facturé USD × poids produit Shopify).

### « Le shipping est calculé au poids »  → tient à moitié seulement
- `shipping = 8,28 $ + 6,66 $/kg`, **R² = 0,31** (n = 3 754).
  → le poids explique **31 %** de la variation. Il y a un **socle fixe de ~8 $**
    indépendant du poids, et 69 % de la variation vient d'autre chose.
- **$/kg implicite incohérent** : médiane **11,2 $/kg**, mais s'étale de **2 $/kg à 149 $/kg**
  d'une commande à l'autre. Un vrai tarif au poids donnerait un $/kg ~constant.
  → **la facturation n'est pas un simple barème au poids.**

### « Le service fee est tiré par le carton / le volumétrique » → NE tient pas
- `service ~ poids` : **R² = 0,03** (aucun lien).
- `service ~ nb articles` : **R² = 0,14** (lien très faible).
  → le service fee n'est corrélé **ni au poids ni au nombre d'articles**.
    Sur 5 710 commandes, **95 % ont un service fee ≤ 4 $** et la médiane est **1,00 $** ;
    les quelques fees à 7–9 $ (voire 60 $) sont des **sauts isolés**, pas une fonction du colis.

### Cohérence croisée
- Les commandes identiques sont bien facturées pareil (ex. **#31463 et #31138**, Suisse,
  3 art., 2,5 kg → **63,83 $ shipping + 3,60 $ service** à l'identique). Forrest est
  **cohérent**, mais « cohérent » ≠ « correct » : ces deux-là sont **2,2× la médiane
  suisse 3 articles (28,53 $)**.
- **Contre-exemple qui casse l'argument** : #31110 (France, 20 art., 6 kg) a un
  **shipping NORMAL (18,75 $)** mais un **service fee de 60 $**. Si le service était lié
  au carton/poids, le shipping aurait bougé aussi. Il n'a pas bougé → le service fee de
  60 $ n'a **aucune justification physique**. Forrest l'a d'ailleurs déjà remboursé (55 $).

---

## Étape 3 — Coût réel PETIT vs GROS colis (livrable central)

Médianes du **montant facturé par Forrest** (USD), par destination × taille.
« perte » = coût logisticien total − port payé par le client.

| Destination | Taille | n | Shipping | Service | **Coût total** | Port client | **Absorbé par Mōom** |
|---|---|--:|--:|--:|--:|--:|--:|
| **France** | petit (1 art.) | 3039 | 14,48 | 1,00 | **17,84** | 5,22 | **12,64** |
| France | moyen (2-3) | 1955 | 17,40 | 1,00 | **19,35** | 0,00 | **18,40** |
| France | gros (4+) | 185 | 28,27 | 3,90 | **32,57** | 0,00 | **32,47** |
| **UE (Belgique…)** | petit | 166 | 16,59 | 1,00 | **19,16** | 17,39 | **2,20** |
| UE | moyen | 160 | 21,71 | 1,60 | **24,09** | 17,39 | **6,94** |
| UE | gros (4+) | 29 | 33,60 | 3,90 | **38,20** | 17,39 | **21,52** |
| **Suisse** | petit | 50 | 25,32 | 1,00 | **26,32** | 43,37 | **-12,95** |
| Suisse | moyen | 79 | 28,53 | 1,60 | **31,32** | 43,37 | **10,11** |
| Suisse | gros (4+) | 16 | 59,50 | 4,75 | **63,95** | 29,78 | **36,52** |

Poids médian : petit **920 g**, moyen **1 800 g**, gros **2 900 g**.

**En clair :**
- **Petit colis France** ≈ **17,8 $** (14,5 shipping / 1 service). Le client paie ~5 $ →
  **Mōom absorbe ~12,6 $**.
- **Gros colis France** ≈ **32,6 $** (28 shipping / 4 service). Client paie **0 $** →
  **Mōom absorbe ~32 $**.
- **Suisse** : c'est cher (26–64 $) **mais le client paie 39,90 €** → sur les petits/moyens
  colis suisses on est **à l'équilibre voire gagnant**. La Suisse n'est **pas** le problème.

> Distinction clé : **le vrai trou de marge n'est pas la Suisse, c'est la France.**
> **36 % des commandes France ont un port client = 0** (livraison offerte) alors qu'elles
> nous coûtent 13–32 $ pièce. Ça, c'est du **prix client sous-évalué** (à corriger chez
> nous), à ne pas confondre avec la sur-facturation Forrest (à contester).

---

## Étape 4 — Anomalies vraiment contestables (triées par $ récupérable)

« Juste » = le **plus élevé** entre (a) le modèle au poids `8,28 + 6,66×kg` et (b) la
médiane de la destination×taille → volontairement **conservateur** (on ne réclame que
l'écart indiscutable). Service « juste » plafonné à `min(4 $, 1+0,47×articles)`.

### A. Contestables sans réserve (France / UE / DOM — **pas de douane**)

| Ordre | Mois | Zone | Type | Art | kg | Facturé | Juste | **Δ récup.** |
|---|---|---|---|--:|--:|--:|--:|--:|
| **#31110** | 07 | FR | service | 20 | 6,0 | 60,00 | 4,00 | **+56,00** |
| #28265 | 03 | FR | shipping | 4 | 2,2 | 62,53 | 28,27 | +34,26 |
| #26142 | 01 | FR | shipping | 9 | 5,0 | 74,12 | 41,58 | +32,54 |
| #27468 | 02 | BE | shipping | 5 | 2,9 | 64,40 | 33,60 | +30,80 |
| #30130 | 06 | FR | shipping | 4 | 2,8 | 56,49 | 28,27 | +28,22 |
| #28318 | 04 | FR | shipping | 5 | 2,9 | 56,28 | 28,27 | +28,01 |
| #27113 | 02 | BE | shipping | 7 | 4,2 | 61,71 | 36,39 | +25,33 |
| #30051 | 06 | FR | shipping | 5 | 3,8 | 58,08 | 33,72 | +24,36 |
| #29887 | 06 | BE | shipping | 7 | 3,9 | 58,19 | 34,25 | +23,94 |
| #28199 | 03 | BE | shipping | 4 | 3,1 | 55,44 | 33,60 | +21,84 |
| **#31643** | 07 | BE | shipping | 4 | 1,8 | 54,96 | 33,60 | **+21,36** |
| #27419 | 02 | FR | shipping | 12 | 8,4 | 85,54 | 64,36 | +21,18 |
| #26599 | 01 | FR | shipping | 9 | 5,5 | 58,72 | 45,04 | +13,68 |
| #28660 | 04 | GP | shipping | 4 | 2,5 | 63,00 | 50,21 | +12,79 |
| #26306 | 01 | FR | shipping | 8 | 5,8 | 55,68 | 47,04 | +8,64 |
| #31631 | 07 | FR | service | 3 | 2,8 | 9,00 | 2,41 | +6,59 |
| #30846 | 07 | FR | service | 4 | 3,0 | 9,00 | 2,88 | +6,12 |
| #31643 | 07 | BE | service | 4 | 1,8 | 8,00 | 2,88 | +5,12 |
| #31148 | 07 | FR | service | 4 | 1,8 | 8,00 | 2,88 | +5,12 |
| #30975 | 07 | BE | service | 3 | 1,8 | 7,00 | 2,41 | +4,59 |
| #30626 | 07 | FR | service | 3 | 1,8 | 7,00 | 2,41 | +4,59 |
| #30928 | 07 | FR | service | 5 | 4,2 | 7,60 | 3,35 | +4,25 |
| #31204 | 07 | FR | service | 5 | 3,2 | 6,95 | 3,35 | +3,60 |
| | | | | | | | **TOTAL** | **≈ 423 $** |

### B. Suisse (douane réelle → à faire justifier, pas à réclamer aveuglément)

15 commandes, **≈ 275 $** d'écart vs médiane suisse, mais la Suisse est **hors-UE
(dédouanement légitime)** et **le client paie déjà 39,90 €**. À traiter en second, en
**exigeant la grille poids + le détail douane** avant de contester. Cas les plus nets :
#29393, #29025, #31463, #31138 (3 art., ~2,5 kg facturés **63–65 $** = 2,2× la médiane CH).

### Focus demandés
- **#31110** : ✅ service fee de **60 $ confirmé** (shipping normal à 18,75 $). Avoir de
  **55 $** attendu → **à tracer sur la facture du mois prochain** (vérifier qu'il apparaît
  bien en crédit).
- **#31643 Belgique** : shipping **54,96 $ + service 8 $ = 62,96 $** pour **4 art. / 1,84 kg**
  vers la Belgique (UE, frontalière, **sans douane**). Équivalent France 4 art. ≈ **28 $**,
  modèle au poids ≈ **20 $**. **Sur-facturation ≈ 21 $ (shipping) + 5 $ (service) ≈ 26 $.**
  → **le cas le plus attaquable** : rien ne justifie un tarif quasi-suisse pour la Belgique.

---

## Étape 5 — Données à réclamer à Forrest (pour boucler la vérif)

1. **Poids pesé réel** (pas le poids produit) **par commande**, sur la facture.
2. **Dimensions du colis + poids volumétrique + type/coût de carton** par commande
   → sans ça, l'argument « service fee = carton/volumétrique » est **irrecevable**.
3. **Grille tarifaire poids → prix** (barème transporteur) par zone (FR / UE / CH).
4. **Décomposition du service fee** (préparation, carton, surcharge volumétrique…).
5. **Détail douane/dédouanement** pour les envois Suisse.
6. **Taux de change** appliqué à chaque facture (on suppose 0,92, non confirmé).

---

## Conclusion

- L'argument **« au poids »** ne tient **qu'à 31 %** (R² 0,31, $/kg de 2 à 149) : il y a un
  socle fixe et une forte dispersion inexpliquée.
- L'argument **« service fee = carton/volumétrique »** **ne tient pas** (R² 0,03 vs poids) :
  le service est à **1 $ médian**, les pics sont isolés (#31110 = 60 $ sur un colis au
  shipping normal, déjà remboursé).
- **≈ 423 $ contestables sans réserve** (FR/UE/DOM) + **≈ 275 $ suisses à faire justifier**.
- **Vrai problème de marge = la France** : 36 % des commandes en **port offert** alors
  qu'elles coûtent **13–32 $** pièce → **à corriger côté prix client**, distinct de la
  sur-facturation Forrest.
