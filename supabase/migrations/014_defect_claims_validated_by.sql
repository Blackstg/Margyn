-- SAV : qui a validé la reproduction + réexpédition (Hao / Lily / Forrest / Autre)
alter table defect_claims add column if not exists validated_by text;
