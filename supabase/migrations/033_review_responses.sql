-- Enquête de satisfaction avant Trustpilot (/avis/[brand]) : note 1-5, puis
-- 4-5 → invitation Trustpilot ; 1-3 → retour interne (catégories, commentaire,
-- demande de rappel). Une réponse par commande quand le lien est personnel
-- (Klaviyo / mail de livraison), sinon réponse anonyme (lien générique, ex. Omnisend).
create table if not exists review_responses (
  id                 uuid primary key default gen_random_uuid(),
  brand              text not null,
  order_id           text,                 -- id Shopify (lien personnel vérifié)
  order_name         text,
  customer_name      text,
  customer_email     text,
  source             text,                 -- klaviyo | omnisend | livraison | direct
  rating             int  not null check (rating between 1 and 5),
  categories         text[] not null default '{}',
  comment            text,
  contact_requested  boolean not null default false,
  contact_phone      text,
  contact_email      text,
  trustpilot_clicked boolean not null default false,
  completed          boolean not null default false,
  handled_at         timestamptz,
  handled_by         text,
  edit_key           uuid not null default gen_random_uuid(),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create unique index if not exists review_responses_order_uq on review_responses (brand, order_id) where order_id is not null;
create index if not exists review_responses_brand_idx on review_responses (brand, created_at desc);
alter table review_responses enable row level security;
