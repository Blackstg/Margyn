-- Poids d'expédition par variante (g), modifiable dans Produits. Sert à la prévision
-- de livraison au poids dès que la grille tarifaire du logisticien est importée.
alter table public.product_variants add column if not exists weight_g integer;
