/** @type {import('next').NextConfig} */
const nextConfig = {
  async redirects() {
    return [
      // Catch OAuth params sent to root URL and forward to callback
      {
        source: '/',
        has: [{ type: 'query', key: 'code' }],
        destination: '/api/shopify/oauth/callback',
        permanent: false,
      },
    ]
  },
}

module.exports = nextConfig
