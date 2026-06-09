CREATE TABLE IF NOT EXISTS invoice_settings (
  brand            text PRIMARY KEY,
  company_name     text    DEFAULT '',
  address_line1    text    DEFAULT '',
  address_line2    text    DEFAULT '',
  city             text    DEFAULT '',
  zip              text    DEFAULT '',
  country          text    DEFAULT 'France',
  vat_number       text    DEFAULT '',
  siret            text    DEFAULT '',
  email            text    DEFAULT '',
  phone            text    DEFAULT '',
  logo_url         text    DEFAULT '',
  tva_rate         numeric DEFAULT 20,
  tva_enabled      boolean DEFAULT true,
  payment_terms    text    DEFAULT '30 jours nets',
  footer_notes     text    DEFAULT '',
  color_primary    text    DEFAULT '#1a1a2e',
  bank_iban        text    DEFAULT '',
  bank_bic         text    DEFAULT '',
  logo_size        integer DEFAULT 36,
  updated_at       timestamptz DEFAULT now()
);

-- Add column if table already exists
ALTER TABLE invoice_settings ADD COLUMN IF NOT EXISTS logo_size integer DEFAULT 36;
