-- Suivi transporteur réel via 17Track (cache local + cible des webhooks)
create table if not exists carrier_tracking (
  tracking_number text primary key,
  brand           text,
  order_name      text,
  carrier         text,
  status          text,          -- statut 17Track brut (InTransit, Delivered, InfoReceived…)
  step            integer,       -- étape logique 1-5 pour la timeline
  delivered       boolean not null default false,
  eta_from        text,
  eta_to          text,
  events          jsonb not null default '[]'::jsonb,
  registered      boolean not null default false,
  raw             jsonb,
  updated_at      timestamptz default now(),
  created_at      timestamptz default now()
);

alter table carrier_tracking enable row level security;
create policy "Service role full access on carrier_tracking"
  on carrier_tracking for all using (true);
