-- Attribution des tickets SAV Mōom (qui répond : Satiana / Todi).
create table if not exists sav_assignments (
  ticket_id   bigint      primary key,
  assignee    text        not null,
  updated_by  text,
  updated_at  timestamptz not null default now()
);

alter table sav_assignments enable row level security;
drop policy if exists app_authenticated_all on sav_assignments;
create policy app_authenticated_all on sav_assignments
  for all to authenticated using (true) with check (true);
