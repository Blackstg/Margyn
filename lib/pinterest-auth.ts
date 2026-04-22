import { createClient } from '@supabase/supabase-js'

// ─── Constants ────────────────────────────────────────────────────────────────

const PINTEREST_TOKEN_URL       = 'https://api.pinterest.com/v5/oauth/token'
const REFRESH_THRESHOLD_DAYS    = 5   // refresh when < 5 days left
const VERCEL_PROJECT_ID         = 'prj_jTw2zoB25TE34OBhkZnuMuI14DNa'
const VERCEL_TEAM_ID            = 'team_97EDPPIOYCfIF268nGxnfCuU'

// ─── Supabase ─────────────────────────────────────────────────────────────────

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
}

// ─── getAccessToken ───────────────────────────────────────────────────────────
// Returns the current valid access token for a brand.
// Checks DB first (primary runtime store), falls back to env var.

export async function getAccessToken(brand: string): Promise<string> {
  const supabase = getSupabase()
  const { data } = await supabase
    .from('pinterest_tokens')
    .select('access_token')
    .eq('brand', brand)
    .single()

  if (data?.access_token) return data.access_token

  const envToken = process.env[`PINTEREST_ACCESS_TOKEN_${brand.toUpperCase()}`]
  if (envToken) return envToken

  throw new Error(`No Pinterest access token found for brand: ${brand}`)
}

// ─── checkAndRefreshToken ─────────────────────────────────────────────────────
// Called at the start of each sync. If the token expires within 5 days,
// refreshes it and stores the new tokens in Supabase + Vercel env.
// On refresh failure, sends an alert email and falls back to the current token.

export async function checkAndRefreshToken(brand: string): Promise<string> {
  const supabase = getSupabase()

  const { data: row } = await supabase
    .from('pinterest_tokens')
    .select('access_token, refresh_token, access_token_expires_at')
    .eq('brand', brand)
    .single()

  // No DB row yet — bootstrap from PINTEREST_REFRESH_TOKEN_* env var
  if (!row) {
    const envRefresh = process.env[`PINTEREST_REFRESH_TOKEN_${brand.toUpperCase()}`]
    if (envRefresh) {
      console.log(`[pinterest-auth] Bootstrapping ${brand} from env refresh token`)
      return refreshAndStore(brand, envRefresh)
    }
    // No refresh token either — return env access token (initial state before first auth)
    const envAccess = process.env[`PINTEREST_ACCESS_TOKEN_${brand.toUpperCase()}`]
    if (envAccess) return envAccess
    throw new Error(`No Pinterest token configured for brand: ${brand}. Complete OAuth at /api/pinterest/auth?brand=${brand}`)
  }

  // Check expiry
  const expiresAt      = new Date(row.access_token_expires_at)
  const thresholdMs    = REFRESH_THRESHOLD_DAYS * 24 * 60 * 60 * 1000
  const needsRefresh   = expiresAt.getTime() - Date.now() < thresholdMs
  const daysLeft       = Math.round((expiresAt.getTime() - Date.now()) / 86_400_000)

  if (!needsRefresh) {
    console.log(`[pinterest-auth] ${brand} token OK (expires in ${daysLeft}d)`)
    return row.access_token
  }

  console.log(`[pinterest-auth] ${brand} token expires in ${daysLeft}d — refreshing now`)

  try {
    return await refreshAndStore(brand, row.refresh_token)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error(`[pinterest-auth] Refresh failed for ${brand}: ${msg}`)
    await sendRefreshAlert(brand, msg)
    // Fall back to current token even if it may be expiring
    return row.access_token
  }
}

// ─── refreshAndStore ──────────────────────────────────────────────────────────
// Calls Pinterest OAuth token endpoint with grant_type=refresh_token,
// saves the new tokens to Supabase, and updates Vercel env vars.

export async function refreshAndStore(brand: string, refreshToken: string): Promise<string> {
  const prefix       = brand.toUpperCase()
  const clientId     = process.env[`PINTEREST_CLIENT_ID_${prefix}`]     ?? process.env.PINTEREST_CLIENT_ID
  const clientSecret = process.env[`PINTEREST_CLIENT_SECRET_${prefix}`] ?? process.env.PINTEREST_CLIENT_SECRET

  if (!clientId || !clientSecret) {
    throw new Error(`PINTEREST_CLIENT_ID_${prefix} and PINTEREST_CLIENT_SECRET_${prefix} must be set`)
  }

  const res = await fetch(PINTEREST_TOKEN_URL, {
    method: 'POST',
    headers: {
      Authorization:  `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken }).toString(),
    cache: 'no-store',
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Pinterest token refresh ${res.status}: ${text}`)
  }

  const data = await res.json() as {
    access_token:              string
    refresh_token?:            string
    expires_in:                number
    refresh_token_expires_in?: number
  }

  const newAccess   = data.access_token
  const newRefresh  = data.refresh_token ?? refreshToken
  const accessExp   = new Date(Date.now() + data.expires_in * 1000).toISOString()
  const refreshExp  = new Date(Date.now() + (data.refresh_token_expires_in ?? 31_536_000) * 1000).toISOString()

  // 1. Supabase — primary runtime store (takes effect immediately for all invocations)
  const supabase = getSupabase()
  const { error } = await supabase
    .from('pinterest_tokens')
    .upsert({
      brand,
      access_token:             newAccess,
      refresh_token:            newRefresh,
      access_token_expires_at:  accessExp,
      refresh_token_expires_at: refreshExp,
      updated_at:               new Date().toISOString(),
    }, { onConflict: 'brand' })

  if (error) throw new Error(`Failed to save refreshed tokens to DB: ${error.message}`)

  // 2. Vercel env vars — persists across future deployments (best-effort)
  await updateVercelEnv(brand, newAccess, newRefresh).catch(
    (e: Error) => console.warn(`[pinterest-auth] Vercel env update skipped: ${e.message}`)
  )

  console.log(`[pinterest-auth] ${brand} refreshed — new access token expires ${accessExp}`)
  return newAccess
}

// ─── saveInitialTokens ────────────────────────────────────────────────────────
// Called by the OAuth callback to persist the initial token set.

export async function saveInitialTokens(
  brand: string,
  accessToken: string,
  refreshToken: string,
  expiresIn: number,
  refreshExpiresIn: number
) {
  const accessExp  = new Date(Date.now() + expiresIn * 1000).toISOString()
  const refreshExp = new Date(Date.now() + refreshExpiresIn * 1000).toISOString()

  const supabase = getSupabase()
  const { error } = await supabase
    .from('pinterest_tokens')
    .upsert({
      brand,
      access_token:             accessToken,
      refresh_token:            refreshToken,
      access_token_expires_at:  accessExp,
      refresh_token_expires_at: refreshExp,
      updated_at:               new Date().toISOString(),
    }, { onConflict: 'brand' })

  if (error) throw new Error(`DB save failed: ${error.message}`)

  // Also update Vercel env vars (best-effort)
  await updateVercelEnv(brand, accessToken, refreshToken).catch(
    (e: Error) => console.warn(`[pinterest-auth] Vercel env update skipped: ${e.message}`)
  )

  return { accessExp, refreshExp }
}

// ─── updateVercelEnv ──────────────────────────────────────────────────────────
// Updates PINTEREST_ACCESS_TOKEN_* and PINTEREST_REFRESH_TOKEN_* in Vercel
// so the values survive future deployments (env vars are baked at build time,
// but Supabase is the source of truth for running functions).

async function updateVercelEnv(brand: string, accessToken: string, refreshToken: string) {
  const vercelToken = process.env.VERCEL_API_TOKEN
  if (!vercelToken) return

  const prefix = brand.toUpperCase()
  const varsToSet = [
    { key: `PINTEREST_ACCESS_TOKEN_${prefix}`,  value: accessToken  },
    { key: `PINTEREST_REFRESH_TOKEN_${prefix}`,  value: refreshToken },
  ]

  // Fetch existing env var IDs once
  const listRes = await fetch(
    `https://api.vercel.com/v9/projects/${VERCEL_PROJECT_ID}/env?teamId=${VERCEL_TEAM_ID}&limit=100`,
    { headers: { Authorization: `Bearer ${vercelToken}` }, cache: 'no-store' }
  )
  if (!listRes.ok) throw new Error(`Vercel env list ${listRes.status}`)
  const { envs = [] } = await listRes.json() as { envs: Array<{ id: string; key: string }> }

  for (const { key, value } of varsToSet) {
    const existing = envs.find((e) => e.key === key)

    if (existing) {
      await fetch(
        `https://api.vercel.com/v9/projects/${VERCEL_PROJECT_ID}/env/${existing.id}?teamId=${VERCEL_TEAM_ID}`,
        {
          method: 'PATCH',
          headers: {
            Authorization:  `Bearer ${vercelToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ value, target: ['production', 'preview'] }),
          cache: 'no-store',
        }
      )
    } else {
      await fetch(
        `https://api.vercel.com/v9/projects/${VERCEL_PROJECT_ID}/env?teamId=${VERCEL_TEAM_ID}`,
        {
          method: 'POST',
          headers: {
            Authorization:  `Bearer ${vercelToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            key,
            value,
            type:   'encrypted',
            target: ['production', 'preview'],
          }),
          cache: 'no-store',
        }
      )
    }
  }
}

// ─── sendRefreshAlert ─────────────────────────────────────────────────────────
// Sends an email via Resend when token refresh fails.

async function sendRefreshAlert(brand: string, errorMessage: string) {
  const resendKey  = process.env.RESEND_API_KEY
  const alertEmail = process.env.ALERT_EMAIL
  if (!resendKey || !alertEmail) return

  const appUrl   = process.env.NEXT_PUBLIC_APP_URL ?? 'https://steero.vercel.app'
  const authLink = `${appUrl}/api/pinterest/auth?brand=${brand}`

  await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization:  `Bearer ${resendKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from:    'Steero Alerts <alerts@steero.co>',
      to:      [alertEmail],
      subject: `⚠️ Pinterest token refresh failed — ${brand}`,
      html: `
        <div style="font-family:sans-serif;max-width:520px">
          <h2 style="color:#c0392b">⚠️ Pinterest token refresh failed</h2>
          <table style="border-collapse:collapse;width:100%">
            <tr><td style="padding:4px 8px;font-weight:bold">Brand</td><td>${brand}</td></tr>
            <tr><td style="padding:4px 8px;font-weight:bold">Error</td><td style="color:#c0392b">${errorMessage}</td></tr>
            <tr><td style="padding:4px 8px;font-weight:bold">Time</td><td>${new Date().toISOString()}</td></tr>
          </table>
          <p style="margin-top:1.5rem">
            Action required: re-authenticate Pinterest for <strong>${brand}</strong> via the link below.<br>
            Make sure you are logged into the correct Pinterest account before clicking.
          </p>
          <a href="${authLink}" style="display:inline-block;padding:10px 20px;background:#e60023;color:#fff;text-decoration:none;border-radius:4px;margin-top:0.5rem">
            Reconnect Pinterest — ${brand}
          </a>
          <p style="margin-top:1.5rem;color:#888;font-size:0.85rem">
            Once re-authenticated the system will resume automatic refreshing and no further action will be needed for ~1 year.
          </p>
        </div>
      `,
    }),
    cache: 'no-store',
  }).catch((e) => console.error('[pinterest-auth] Resend alert failed:', e))
}
