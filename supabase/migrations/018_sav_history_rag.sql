-- RAG SAV : recherche sémantique des réponses passées.
-- embedding : vecteur OpenAI (text-embedding-3-small) stocké en JSON.
-- brand     : sépare les exemples Moom / Bowa (un ticket Bowa ne doit récupérer
--             que des réponses Bowa, et inversement). Les 1309 existants = Moom.
-- category  : catégorie du ticket (bonus de pertinence même-catégorie).
alter table sav_history_examples add column if not exists embedding jsonb;
alter table sav_history_examples add column if not exists brand text not null default 'moom';
alter table sav_history_examples add column if not exists category text;
create index if not exists sav_history_examples_brand_idx on sav_history_examples (brand);
