-- Add phone number to delivery_stops
alter table delivery_stops
  add column if not exists phone text;
