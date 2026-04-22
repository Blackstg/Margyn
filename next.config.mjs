/** @type {import('next').NextConfig} */
const nextConfig = {
  async headers() {
    return [
      {
        // Allow /tracking to be embedded as an iframe from Shopify stores
        source: '/tracking',
        headers: [
          {
            key: 'Content-Security-Policy',
            value: "frame-ancestors 'self' https://*.myshopify.com https://*.bowa.fr https://*.bowa.com",
          },
          // Do NOT set X-Frame-Options — it conflicts with CSP frame-ancestors
          // and some browsers treat ALLOWALL as invalid
        ],
      },
    ]
  },
}

export default nextConfig
