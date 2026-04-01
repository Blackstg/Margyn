-- Migration 002 : contrainte unique sur campaign_stats pour les upserts
ALTER TABLE campaign_stats
  ADD CONSTRAINT campaign_stats_campaign_id_date_key UNIQUE (campaign_id, date);
