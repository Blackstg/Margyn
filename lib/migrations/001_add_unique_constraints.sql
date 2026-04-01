-- Migration 001 : contraintes d'unicité pour les upserts
-- À exécuter dans Supabase SQL Editor

-- daily_snapshots : upsert sur (date, brand)
ALTER TABLE daily_snapshots
  ADD CONSTRAINT daily_snapshots_date_brand_key UNIQUE (date, brand);

-- products : upsert sur shopify_id
-- (skip si déjà présente via la définition UNIQUE NOT NULL initiale)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'products_shopify_id_key'
      AND conrelid = 'products'::regclass
  ) THEN
    ALTER TABLE products
      ADD CONSTRAINT products_shopify_id_key UNIQUE (shopify_id);
  END IF;
END $$;

-- ad_spends : upsert sur (date, platform, brand) — préventif
ALTER TABLE ad_spends
  ADD CONSTRAINT ad_spends_date_platform_brand_key UNIQUE (date, platform, brand);
