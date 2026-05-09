-- ── Créatives Meta — schema migration ──────────────────────────────────────────
-- Run this in the Supabase SQL editor (Dashboard → SQL Editor → New query)

-- 1. ad_creatives — métadonnées des publicités Meta
CREATE TABLE IF NOT EXISTS ad_creatives (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  meta_ad_id        text UNIQUE NOT NULL,
  meta_creative_id  text,
  ad_name           text,
  campaign_id       text,
  campaign_name     text,
  adset_id          text,
  adset_name        text,
  brand             text NOT NULL,          -- bowa | moom | krom
  format            text,                   -- image | video | carousel
  status            text,                   -- active | paused | archived
  thumbnail_url     text,
  video_url         text,
  primary_text      text,
  headline          text,
  description       text,
  cta_type          text,
  landing_url       text,
  created_at        timestamptz DEFAULT now(),
  updated_at        timestamptz DEFAULT now(),
  first_seen_at     timestamptz DEFAULT now(),
  last_active_at    timestamptz
);

-- 2. creative_stats — stats journalières par créa
CREATE TABLE IF NOT EXISTS creative_stats (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  creative_id      uuid NOT NULL REFERENCES ad_creatives(id) ON DELETE CASCADE,
  date             date NOT NULL,
  spend            numeric DEFAULT 0,
  impressions      bigint  DEFAULT 0,
  reach            bigint  DEFAULT 0,
  clicks           bigint  DEFAULT 0,
  ctr              numeric,
  cpc              numeric,
  cpm              numeric,
  -- Vidéo (null pour les images)
  video_3s_plays   bigint,
  video_p25        bigint,
  video_p50        bigint,
  video_p75        bigint,
  video_p100       bigint,
  -- Conversions
  purchases        bigint  DEFAULT 0,
  purchase_value   numeric DEFAULT 0,
  roas             numeric,
  cpa              numeric,
  UNIQUE(creative_id, date)
);

-- hook_rate et hold_rate en vue calculée (plus portable que GENERATED ALWAYS)
CREATE OR REPLACE VIEW creative_stats_computed AS
SELECT
  cs.*,
  CASE WHEN cs.impressions    > 0 AND cs.video_3s_plays IS NOT NULL
    THEN ROUND((cs.video_3s_plays::numeric / cs.impressions) * 100, 2)
    ELSE NULL END AS hook_rate,       -- % impressions → 3s de vidéo
  CASE WHEN cs.video_3s_plays > 0 AND cs.video_p75 IS NOT NULL
    THEN ROUND((cs.video_p75::numeric  / cs.video_3s_plays) * 100, 2)
    ELSE NULL END AS hold_rate        -- % des viewers 3s → 75%
FROM creative_stats cs;

CREATE INDEX IF NOT EXISTS idx_creative_stats_creative_date
  ON creative_stats(creative_id, date);

CREATE INDEX IF NOT EXISTS idx_creative_stats_date
  ON creative_stats(date);

CREATE INDEX IF NOT EXISTS idx_ad_creatives_brand
  ON ad_creatives(brand);

-- RLS : accès libre (le service role est utilisé côté API)
ALTER TABLE ad_creatives  ENABLE ROW LEVEL SECURITY;
ALTER TABLE creative_stats ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access on ad_creatives"
  ON ad_creatives FOR ALL USING (true);

CREATE POLICY "Service role full access on creative_stats"
  ON creative_stats FOR ALL USING (true);
