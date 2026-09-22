-- Date de passage par client (tournées Bowa sur plusieurs jours) : chaque arrêt
-- peut avoir sa propre date, annoncée dans le mail de notification/relance au
-- lieu de la date globale de la tournée.
alter table delivery_stops add column if not exists passage_date date;
