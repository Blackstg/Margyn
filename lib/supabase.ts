import { createClient } from '@supabase/supabase-js'

// Server-side admin client — uses service role, bypasses RLS.
// Only for API routes and server-side code.
export function createAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}
