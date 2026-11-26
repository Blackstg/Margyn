-- Réappro autonome : relevés de stock quotidiens, bons de commande enregistrés,
-- lignes ignorées (« Pas maintenant ») et réglages par marque.

-- Stock par variante, par entrepôt (location Shopify) et par jour (dernier relevé du jour).
create table if not exists stock_snapshots (
  brand              text        not null,
  shopify_variant_id text        not null,
  location_id        text        not null,
  location_name      text,
  day                date        not null,
  stock              integer     not null,
  updated_at         timestamptz not null default now(),
  primary key (brand, shopify_variant_id, location_id, day)
);
create index if not exists stock_snapshots_brand_day on stock_snapshots (brand, day);

-- Commande fournisseur : dates calculées à la validation, décalables en cas de retard.
create table if not exists purchase_orders (
  id            uuid        primary key default gen_random_uuid(),
  brand         text        not null,
  ordered_on    date        not null,
  prod_done_on  date        not null,
  arrival_on    date        not null,
  status        text        not null default 'open' check (status in ('open', 'received', 'cancelled')),
  source        text        not null default 'validated' check (source in ('validated', 'declared', 'after_the_fact')),
  total_cost    numeric     not null default 0,
  note          text,
  received_on   date,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists purchase_orders_brand_status on purchase_orders (brand, status);

create table if not exists purchase_order_lines (
  id                 uuid    primary key default gen_random_uuid(),
  order_id           uuid    not null references purchase_orders(id) on delete cascade,
  shopify_variant_id text    not null,
  product_title      text    not null,
  variant_title      text,
  sku                text,
  qty                integer not null check (qty > 0),
  unit_cost          numeric not null default 0,
  received_qty       integer not null default 0
);
create index if not exists purchase_order_lines_order on purchase_order_lines (order_id);

-- « Pas maintenant » : plus de relance jusqu'à la date indiquée.
create table if not exists reorder_snoozes (
  brand              text        not null,
  shopify_variant_id text        not null,
  until              date        not null,
  created_at         timestamptz not null default now(),
  primary key (brand, shopify_variant_id)
);

-- Délais, périodes promo, minimum/colisage par produit, destinataires du récap…
create table if not exists reorder_settings (
  brand      text        primary key,
  settings   jsonb       not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table stock_snapshots      enable row level security;
alter table purchase_orders      enable row level security;
alter table purchase_order_lines enable row level security;
alter table reorder_snoozes      enable row level security;
alter table reorder_settings     enable row level security;

drop policy if exists app_authenticated_all on stock_snapshots;
create policy app_authenticated_all on stock_snapshots      for all to authenticated using (true) with check (true);
drop policy if exists app_authenticated_all on purchase_orders;
create policy app_authenticated_all on purchase_orders      for all to authenticated using (true) with check (true);
drop policy if exists app_authenticated_all on purchase_order_lines;
create policy app_authenticated_all on purchase_order_lines for all to authenticated using (true) with check (true);
drop policy if exists app_authenticated_all on reorder_snoozes;
create policy app_authenticated_all on reorder_snoozes      for all to authenticated using (true) with check (true);
drop policy if exists app_authenticated_all on reorder_settings;
create policy app_authenticated_all on reorder_settings     for all to authenticated using (true) with check (true);
