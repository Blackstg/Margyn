-- SAV : lots de production gérés (auto-numérotés "Lot 01", "Lot 02"…).
-- Remplace la saisie texte libre de production_batch (qui créait des doublons
-- "01" / "Lot 01" / "LOT 01"). Un seul lot "ouvert" (en cours) par marque ;
-- les nouveaux dossiers sont rattachés automatiquement à ce lot.
create table if not exists defect_batches (
  id         uuid primary key default gen_random_uuid(),
  brand      text not null default 'moom',
  number     integer not null,
  label      text not null,            -- "Lot 01"
  po_ref     text,                     -- réf. commande fournisseur (optionnel)
  created_at timestamptz default now(),
  closed_at  timestamptz,              -- null = lot en cours (actif)
  unique (brand, number)
);

create index if not exists defect_batches_brand_idx on defect_batches (brand, number desc);

alter table defect_batches enable row level security;
create policy "Service role full access on defect_batches"
  on defect_batches for all using (true);

-- Lot en cours initial pour Mōom
insert into defect_batches (brand, number, label)
  values ('moom', 1, 'Lot 01')
  on conflict (brand, number) do nothing;

-- Fusion des saisies existantes (toutes = lot 1) vers le libellé canonique
update defect_claims
  set production_batch = 'Lot 01'
  where brand = 'moom'
    and production_batch is not null
    and lower(trim(production_batch)) in ('01', '1', 'lot 01', 'lot01', 'lot 1');
