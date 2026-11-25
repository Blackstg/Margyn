-- Marges « Marginale » : coût additionnel par article en plus de l'article principal
-- d'une commande (la livraison de la commande est portée par l'article principal).
alter table public.brand_settings add column if not exists extra_item_cost numeric not null default 0;
