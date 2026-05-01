alter table delivery_stops
  add column if not exists client_availability text
    check (client_availability in ('confirmed', 'unavailable'));
