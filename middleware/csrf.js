// middleware/csrf.js — double-submit CSRF protection tied to the session
const crypto = require('crypto');

function ensureCsrfToken(req) {
  if (!req.session.csrfToken) {
    req.session.csrfToken = crypto.randomBytes(32).toString('hex');
  }
  return req.session.csrfToken;
}

// Login/signup happen before a session-bound token can exist, a forced
// logout via CSRF is low-severity, and the Paystack webhook is called
// server-to-server (verified instead by its own HMAC signature, see
// routes/payments.js), so those paths are exempt.
const EXEMPT_PATHS = ['/api/auth/login', '/api/auth/signup', '/api/auth/logout', '/api/payments/webhook'];

function csrfProtection(req, res, next) {
  const safeMethods = ['GET', 'HEAD', 'OPTIONS'];
  if (safeMethods.includes(req.method)) return next();
  if (EXEMPT_PATHS.includes(req.path)) return next();

  const tokenFromHeader = req.headers['x-csrf-token'];
  const tokenFromSession = req.session.csrfToken;

  if (!tokenFromSession || !tokenFromHeader || tokenFromHeader !== tokenFromSession) {
    return res.status(403).json({ error: 'Invalid or missing CSRF token. Please refresh the page and try again.' });
  }

  next();
}

module.exports = { ensureCsrfToken, csrfProtection };
