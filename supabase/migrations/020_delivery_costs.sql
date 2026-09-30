-- Coût de revient logistique Bowa : frais par tournée + salaire mensuel par chauffeur.
-- Permet de calculer coût/commande et coût/panneau par mois dans les stats.

-- Frais réels saisis par tournée (montants en €, TTC ou HT selon saisie — cohérent).
alter table delivery_tours
  add column if not exists cost_fuel  numeric,   -- essence / carburant
  add column if not exists cost_toll  numeric,   -- péage
  add column if not exists cost_hotel numeric,   -- hôtel (tournées multi-jours)
  add column if not exists cost_meal  numeric;   -- restauration

-- Salaire mensuel fixe (récurrent) par chauffeur et par marque.
create table if not exists driver_salaries (
  id            uuid primary key default gen_random_uuid(),
  brand         text not null,
  driver_name   text not null,
  monthly_salary numeric not null default 0,
  updated_at    timestamptz default now(),
  unique (brand, driver_name)
);
