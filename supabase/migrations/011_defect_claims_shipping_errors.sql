-- SAV : étend defect_claims aux erreurs d'envoi (mauvais article) + lookup commande
alter table defect_claims
  add column if not exists claim_type            text not null default 'defaut_fournisseur'
    check (claim_type in ('defaut_fournisseur','erreur_envoi')),
  add column if not exists shopify_variant_id    text,
  add column if not exists received_sku          text,
  add column if not exists received_product_name text,
  add column if not exists return_label_url      text,
  add column if not exists return_tracking_ref   text,
  add column if not exists return_received_at    date;

-- Élargit l'enum status pour couvrir le flux erreur d'envoi
alter table defect_claims drop constraint if exists defect_claims_status_check;
alter table defect_claims add constraint defect_claims_status_check
  check (status in (
    'signale','reclamation_envoyee','repro_confirmee',
    'etiquette_envoyee','retour_recu',
    'reexpedie','recu','clos','litige'
  ));

create index if not exists defect_claims_brand_type_idx on defect_claims (brand, claim_type);
