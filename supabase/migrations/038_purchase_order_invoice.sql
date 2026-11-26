-- Réappro : commande créée depuis une facture fournisseur (numéro, devise, acompte, solde).
alter table purchase_orders add column if not exists supplier       text;
alter table purchase_orders add column if not exists invoice_number text;
alter table purchase_orders add column if not exists currency       text;
alter table purchase_orders add column if not exists invoice_total  numeric;  -- avant acompte, dans la devise de la facture
alter table purchase_orders add column if not exists deposit_paid   numeric;
alter table purchase_orders add column if not exists balance_due    numeric;
alter table purchase_order_lines add column if not exists unit_price numeric; -- prix de la facture, dans sa devise

alter table purchase_orders drop constraint if exists purchase_orders_source_check;
alter table purchase_orders add constraint purchase_orders_source_check
  check (source in ('validated', 'declared', 'after_the_fact', 'invoice'));

-- Une facture ne s'importe qu'une fois (hors commandes annulées).
create unique index if not exists purchase_orders_invoice_once
  on purchase_orders (brand, supplier, invoice_number)
  where invoice_number is not null and status <> 'cancelled';
