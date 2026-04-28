-- Add SAV note fields to delivery_stops
-- sav_note: free-text note from SAV team for the driver (e.g. "veut être livré le matin")
-- Also backfills missing columns that were added after the initial migration

alter table delivery_stops
  add column if not exists comment          text,
  add column if not exists comment_at       timestamptz,
  add column if not exists satisfaction_sent_at timestamptz,
  add column if not exists sav_note         text,
  add column if not exists sav_note_at      timestamptz;
