-- Traçabilité des livraisons Bowa (SAV) :
--  · qui a écrit la note livreur / la note SAV (le « quand » existe déjà : comment_at, sav_note_at)
--  · qui a validé le passage, où (GPS) et quand le client a signé
--  · journal des passages (replanifiée, retirée, déplacée, déjà livrée…), conservé
--    même si l'arrêt ou la tournée est supprimé
alter table delivery_stops
  add column if not exists comment_by    text,
  add column if not exists sav_note_by   text,
  add column if not exists done_by       text,
  add column if not exists done_lat      double precision,
  add column if not exists done_lng      double precision,
  add column if not exists done_accuracy double precision,
  add column if not exists signed_at     timestamptz;

create table if not exists delivery_stop_events (
  id         uuid primary key default gen_random_uuid(),
  stop_id    uuid references delivery_stops(id) on delete set null,
  order_name text not null,
  tour_id    uuid,
  tour_name  text,
  kind       text not null,
  status     text,
  comment    text,
  author     text,
  lat        double precision,
  lng        double precision,
  accuracy   double precision,
  created_at timestamptz not null default now()
);
create index if not exists delivery_stop_events_order_idx on delivery_stop_events (order_name, created_at);
alter table delivery_stop_events enable row level security;
