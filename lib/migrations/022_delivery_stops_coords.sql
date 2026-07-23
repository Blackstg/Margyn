-- Coordonnées Shopify (exactes) des arrêts de livraison, pour un positionnement
-- fiable sur la carte sans re-géocoder l'adresse texte (source des mauvais
-- placements type rue homonyme à 300 km).
alter table delivery_stops add column if not exists lat double precision;
alter table delivery_stops add column if not exists lng double precision;
