-- Add delivery proof columns to delivery_stops
-- signature_url: URL of the client signature PNG in Supabase Storage
-- photo_url:     URL of the package photo in Supabase Storage

alter table delivery_stops
  add column if not exists signature_url text,
  add column if not exists photo_url     text;
