// utils/origins.js: decides which browser origins may make credentialed
// requests to this app. Shared by the Express CORS setup and Socket.io.

// Lowercase and drop trailing slashes so "https://Site.com/" and
// "https://site.com" are treated as the same origin.
function normalize(value) {
  return String(value || '').trim().replace(/\/+$/, '').toLowerCase();
}

function configuredOrigins() {
  const list = [
    process.env.APP_URL,
    'http://localhost:3000',
    // Optional: extra origins, comma separated (for example a custom domain
    // and its www version).
    ...(process.env.ALLOWED_ORIGINS || '').split(','),
  ];
  // Railway sets this automatically to the service's public domain.
  if (process.env.RAILWAY_PUBLIC_DOMAIN) {
    list.push(`https://${process.env.RAILWAY_PUBLIC_DOMAIN}`);
  }
  return list.map(normalize).filter(Boolean);
}

// requestHost is the Host header of the incoming request. If the browser's
// Origin points at the same host that is serving the request, it is a
// same-origin request and is always fine.
function isAllowedOrigin(origin, requestHost) {
  if (!origin) return true;
  const normalized = normalize(origin);
  if (configuredOrigins().includes(normalized)) return true;
  if (requestHost) {
    try {
      if (new URL(normalized).host === String(requestHost).toLowerCase()) return true;
    } catch (err) {
      // Malformed Origin header: fall through and reject.
    }
  }
  return false;
}

module.exports = { isAllowedOrigin, configuredOrigins };
