-- Attribution des actions SAV à l'agent qui les a faites.
-- Avant : seul le temps de session était attribué (email stocké dans `category`
-- sur session_start). Les actions ticket (sent/escalated/archived) n'avaient
-- aucun agent → impossible de compter « combien de tickets tel agent a traité ».
alter table sav_actions add column if not exists user_email text;

-- Requêtes fréquentes du dashboard Qualité : filtre par marque + agent + période.
create index if not exists sav_actions_brand_email_created_idx
  on sav_actions (brand, user_email, created_at desc);
