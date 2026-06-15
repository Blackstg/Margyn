-- SAV : passage d'un statut unique à des jalons multiples cumulables (milestones)
-- milestones = { '<key>': 'YYYY-MM-DD' } ; une clé présente = jalon atteint à cette date
alter table defect_claims add column if not exists milestones jsonb not null default '{}'::jsonb;

-- Reprise des dossiers existants : déduit les jalons depuis le statut + les dates/refs déjà saisies
update defect_claims set milestones = jsonb_strip_nulls(jsonb_build_object(
  'reclamation_envoyee', case when claim_type = 'defaut_fournisseur' and claim_sent_at is not null then to_char(claim_sent_at, 'YYYY-MM-DD') end,
  'etiquette_envoyee',   case when claim_type = 'erreur_envoi' and claim_sent_at is not null then to_char(claim_sent_at, 'YYYY-MM-DD') end,
  'repro_confirmee',     case when status = 'repro_confirmee' then to_char(coalesce(updated_at::date, reported_at), 'YYYY-MM-DD') end,
  'reexpedie',           case when reship_tracking_ref is not null or status = 'reexpedie' then to_char(coalesce(updated_at::date, reported_at), 'YYYY-MM-DD') end,
  'retour_recu',         case when return_received_at is not null or status = 'retour_recu' then to_char(coalesce(return_received_at, updated_at::date), 'YYYY-MM-DD') end,
  'recu',                case when received_at is not null or status = 'recu' then to_char(coalesce(received_at, updated_at::date), 'YYYY-MM-DD') end,
  'clos',                case when status = 'clos' then to_char(updated_at::date, 'YYYY-MM-DD') end,
  'litige',              case when status = 'litige' then to_char(updated_at::date, 'YYYY-MM-DD') end
)) where milestones = '{}'::jsonb;
