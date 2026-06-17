-- SAV : notion de lot de production (les défauts sont reproduits à la prochaine prod)
-- production_batch = réf. de la commande/production fournisseur qui regroupe les dossiers
alter table defect_claims add column if not exists production_batch text;
create index if not exists defect_claims_brand_batch_idx on defect_claims (brand, production_batch);
