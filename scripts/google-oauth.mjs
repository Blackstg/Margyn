import { createServer } from 'http'
import { OAuth2Client } from 'google-auth-library'
import { exec } from 'child_process'

const CLIENT_ID = process.env.GOOGLE_ADS_CLIENT_ID
const CLIENT_SECRET = process.env.GOOGLE_ADS_CLIENT_SECRET
const REDIRECT_URI = 'http://localhost:4000/oauth2callback'
const SCOPE = 'https://www.googleapis.com/auth/adwords'

const client = new OAuth2Client(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI)

const authUrl = client.generateAuthUrl({
  access_type: 'offline',
  scope: SCOPE,
  prompt: 'consent', // force refresh_token
})

console.log('\n→ Ouverture du navigateur pour autorisation Google Ads...\n')
exec(`open "${authUrl}"`)

const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost:4000')
  if (url.pathname !== '/oauth2callback') return

  const code = url.searchParams.get('code')
  if (!code) {
    res.end('Erreur : pas de code dans la réponse.')
    return
  }

  try {
    const { tokens } = await client.getToken(code)
    res.end('<h2>Authentification réussie. Vous pouvez fermer cette fenêtre.</h2>')
    console.log('\n✓ Tokens obtenus :')
    console.log(`GOOGLE_ADS_REFRESH_TOKEN=${tokens.refresh_token}`)
    console.log(`GOOGLE_ADS_ACCESS_TOKEN=${tokens.access_token}`)
    console.log('\nAjoute GOOGLE_ADS_REFRESH_TOKEN dans ton .env.local\n')
  } catch (err) {
    res.end(`Erreur : ${err.message}`)
    console.error(err)
  } finally {
    server.close()
  }
})

server.listen(4000, () => {
  console.log('En attente du callback sur http://localhost:4000/oauth2callback ...')
})
