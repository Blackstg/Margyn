import { createClient } from '@supabase/supabase-js'

// Server-side admin client — uses service role, bypasses RLS.
// Only for API routes and server-side code.
export function createAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    // Jamais de cache Next sur les lectures : sinon une route peut servir des données
    // figées (ex. facture logisticien d'octobre importée mais invisible en prod).
    { global: { fetch: (input, init) => fetch(input, { ...init, cache: 'no-store' }) } },
  )
}
