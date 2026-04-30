-- Add partial delivery support to delivery_stops
-- partial_delivered: JSONB array of {sku, title, qty_ordered, qty_delivered}
--   for stops where the driver could only deliver part of the order

alter table delivery_stops
  add column if not exists partial_delivered jsonb;

-- Note: status column already accepts any text value.
-- New status value used: 'partial'
