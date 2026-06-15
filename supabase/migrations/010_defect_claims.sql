-- SAV / Défauts fournisseur : dossiers de réclamation produits défectueux (Mōom)
create table if not exists defect_claims (
  id                 uuid primary key default gen_random_uuid(),
  brand              text not null default 'moom',
  reported_at        date not null default now(),
  sku                text,
  product_name       text,
  shopify_order_id   text,
  quantity           integer not null default 1,
  defect_description text,
  photo_url          text,
  status             text not null default 'signale'
    check (status in ('signale','reclamation_envoyee','repro_confirmee','reexpedie','recu','clos','litige')),
  supplier_claim_ref text,
  reship_tracking_ref text,
  claim_sent_at      date,
  received_at        date,
  charged_amount     numeric not null default 0,
  notes              text,
  created_at         timestamptz default now(),
  updated_at         timestamptz default now()
);

create index if not exists defect_claims_brand_reported_idx on defect_claims (brand, reported_at desc);
create index if not exists defect_claims_brand_status_idx   on defect_claims (brand, status);

-- RLS : accès libre (le service role est utilisé côté API)
alter table defect_claims enable row level security;

create policy "Service role full access on defect_claims"
  on defect_claims for all using (true);
