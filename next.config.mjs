/** @type {import('next').NextConfig} */

const isProd = process.env.NODE_ENV === 'production';

// Strict security headers for production.
// CSP notes:
// - 'unsafe-inline' for scripts is required by Next.js unless nonce-based CSP is wired
//   through middleware; it still blocks loading of unapproved external scripts.
// - checkout.razorpay.com / api.razorpay.com are allowlisted for the Razorpay Checkout.js flow.
const productionSecurityHeaders = [
  {
    key: 'Content-Security-Policy',
    value: [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' https://checkout.razorpay.com",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob: https:",
      "font-src 'self' data:",
      "connect-src 'self' https://api.razorpay.com https://lumberjack.razorpay.com https://checkout.razorpay.com",
      "frame-src 'self' https://api.razorpay.com https://checkout.razorpay.com",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "frame-ancestors 'self'",
      'upgrade-insecure-requests',
    ].join('; '),
  },
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' },
];

const baseSecurityHeaders = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'X-DNS-Prefetch-Control', value: 'on' },
  {
    key: 'Permissions-Policy',
    value: 'camera=(), microphone=(), geolocation=(), browsing-topics=()',
  },
];

const nextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  headers: async () => [
    {
      source: '/:path*',
      headers: isProd
        ? [...baseSecurityHeaders, ...productionSecurityHeaders]
        : baseSecurityHeaders,
    },
    {
      // Uploaded files must never be interpreted as HTML.
      source: '/uploads/:path*',
      headers: [
        { key: 'X-Content-Type-Options', value: 'nosniff' },
        { key: 'Content-Disposition', value: 'inline' },
      ],
    },
  ],
  images: {
    // Product images may be supplied by admins as external URLs (e.g. supplier CDNs).
    // Tighten `remotePatterns` to your known supplier/CDN hosts before production launch.
    remotePatterns: [{ protocol: 'https', hostname: '**' }],
    formats: ['image/avif', 'image/webp'],
  },
};

export default nextConfig;
