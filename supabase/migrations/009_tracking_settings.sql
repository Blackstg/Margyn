CREATE TABLE IF NOT EXISTS tracking_settings (
  brand                text    PRIMARY KEY,
  brand_name           text    DEFAULT '',
  brand_logo_url       text    DEFAULT '',
  brand_color          text    DEFAULT '#111111',
  brand_website        text    DEFAULT '',
  contact_email        text    DEFAULT '',
  show_products        boolean DEFAULT true,
  show_address         boolean DEFAULT true,
  show_tracking_number boolean DEFAULT true,
  show_tracking_link   boolean DEFAULT true,
  estimated_days_min   integer DEFAULT 7,
  estimated_days_max   integer DEFAULT 14,
  updated_at           timestamptz DEFAULT now()
);
