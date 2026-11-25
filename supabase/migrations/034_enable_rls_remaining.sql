-- Alerte Supabase « rls_disabled_in_public » : ces tables étaient lisibles ET
-- modifiables par n'importe qui avec l'URL du projet + la clé anon (publique).
-- Elles ne sont utilisées que côté serveur avec la clé service_role (qui ignore
-- le RLS) → RLS activé SANS policy = fermé au public, rien ne change pour l'app.
alter table public.tenant_integrations    enable row level security;  -- jetons d'intégration chiffrés
alter table public.tenant_features        enable row level security;
alter table public.tenants                enable row level security;
alter table public.delivery_hidden_orders enable row level security;
alter table public.ops_cron_heartbeat     enable row level security;

-- Vue créée en SECURITY DEFINER (défaut) → contournait le RLS et restait lisible
-- avec la clé anon. Non utilisée par l'app ; on la fait respecter le RLS de l'appelant.
alter view public.creative_stats_computed set (security_invoker = true);
