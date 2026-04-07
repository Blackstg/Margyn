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
      // Legacy URL redirects (301)
      { source: '/reconciliation-stock', destination: '/stock',    permanent: true },
      { source: '/reconciliation-stock/:path*', destination: '/stock/:path*', permanent: true },
      { source: '/factures-logisticien', destination: '/invoices', permanent: true },
      { source: '/factures-logisticien/:path*', destination: '/invoices/:path*', permanent: true },
      { source: '/reapprovisionnement',  destination: '/reorder',  permanent: true },
      { source: '/reapprovisionnement/:path*', destination: '/reorder/:path*', permanent: true },
      { source: '/produits',             destination: '/products', permanent: true },
      { source: '/produits/:path*',      destination: '/products/:path*', permanent: true },
    ]
  },
}

module.exports = nextConfig
