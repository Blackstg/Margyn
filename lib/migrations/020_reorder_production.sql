-- Productions en cours (page Réappro), persistées côté serveur et partagées.
create table if not exists reorder_production (
  brand              text        not null,
  shopify_variant_id text        not null,
  qty                integer     not null default 0,
  updated_at         timestamptz not null default now(),
  primary key (brand, shopify_variant_id)
);

alter table reorder_production enable row level security;
drop policy if exists app_authenticated_all on reorder_production;
create policy app_authenticated_all on reorder_production
  for all to authenticated using (true) with check (true);
