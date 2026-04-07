create table if not exists delivery_tours (
  id uuid primary key default gen_random_uuid(),
  brand text not null default 'bowa',
  name text not null,
  zone text not null default 'mixte',
  driver_name text,
  planned_date date,
  status text not null default 'draft',
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists delivery_stops (
  id uuid primary key default gen_random_uuid(),
  tour_id uuid references delivery_tours(id) on delete cascade,
  order_name text not null,
  shopify_order_id text,
  customer_name text,
  email text,
  address1 text,
  address2 text,
  city text,
  zip text,
  zone text,
  sequence int default 0,
  panel_count int default 0,
  panel_details jsonb default '[]',
  status text not null default 'pending',
  delivered_at timestamptz,
  email_sent_at timestamptz,
  created_at timestamptz default now()
);
