-- Snapshots quotidiens agrégés
CREATE TABLE daily_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  date date NOT NULL,
  brand text NOT NULL, -- 'bowa' | 'moom' | 'all'
  total_sales numeric,
  gross_profit numeric,
  gross_margin numeric,
  net_profit numeric,
  net_margin numeric,
  order_count integer,
  cogs numeric,
  fulfillment_cost numeric,
  returns numeric,
  discounts numeric,
  created_at timestamptz DEFAULT now()
);

-- Spends publicitaires par jour et plateforme
CREATE TABLE ad_spends (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  date date NOT NULL,
  platform text NOT NULL, -- 'meta' | 'google' | 'tiktok' | 'pinterest'
  brand text NOT NULL,
  spend numeric NOT NULL,
  impressions integer,
  clicks integer,
  conversions integer,
  revenue numeric,
  roas numeric GENERATED ALWAYS AS (
    CASE WHEN spend > 0 THEN revenue / spend ELSE 0 END
  ) STORED,
  created_at timestamptz DEFAULT now()
);

-- Campagnes détaillées
CREATE TABLE campaigns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  external_id text UNIQUE NOT NULL,
  platform text NOT NULL,
  brand text NOT NULL,
  name text NOT NULL,
  status text, -- 'active' | 'paused' | 'archived'
  daily_budget numeric,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE campaign_stats (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid REFERENCES campaigns(id),
  date date NOT NULL,
  spend numeric,
  impressions integer,
  clicks integer,
  conversions integer,
  revenue numeric,
  cpa numeric,
  cpm numeric,
  ctr numeric,
  roas numeric,
  created_at timestamptz DEFAULT now()
);

-- Produits + stock
CREATE TABLE products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shopify_id text UNIQUE NOT NULL,
  brand text NOT NULL,
  title text NOT NULL,
  sku text,
  cost_price numeric, -- prix d'achat (cost per item Shopify)
  sell_price numeric,
  stock_quantity integer DEFAULT 0,
  stock_alert_threshold integer DEFAULT 20, -- seuil alerte
  image_url text,
  updated_at timestamptz DEFAULT now()
);

-- Coûts fixes mensuels
CREATE TABLE fixed_costs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  month date NOT NULL, -- premier jour du mois
  category text NOT NULL, -- 'team' | 'app' | 'other'
  label text NOT NULL, -- 'Ghiles' | 'Marine' | 'Supabase' etc.
  amount numeric NOT NULL,
  created_at timestamptz DEFAULT now()
);

-- Tokens API (stockage chiffré des credentials)
CREATE TABLE api_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand text NOT NULL,
  platform text NOT NULL, -- 'shopify' | 'meta' | 'google' | 'tiktok' | 'pinterest'
  token_data jsonb NOT NULL, -- credentials chiffrés
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(brand, platform)
);

-- Contraintes d'unicité pour les upserts
ALTER TABLE daily_snapshots ADD CONSTRAINT daily_snapshots_date_brand_key UNIQUE(date, brand);
ALTER TABLE ad_spends ADD CONSTRAINT ad_spends_date_platform_brand_key UNIQUE(date, platform, brand);

-- Indexes
CREATE INDEX ON daily_snapshots(date, brand);
CREATE INDEX ON ad_spends(date, platform);
CREATE INDEX ON campaign_stats(campaign_id, date);
CREATE INDEX ON products(brand);
