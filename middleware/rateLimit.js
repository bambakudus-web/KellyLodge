// middleware/rateLimit.js — simple in-memory rate limiter for login attempts
const attempts = new Map(); // ip -> { count, firstAttempt }

const WINDOW_MS = 15 * 60 * 1000; // 15 minutes
const MAX_ATTEMPTS = 5;

function loginRateLimit(req, res, next) {
  const ip = req.ip;
  const now = Date.now();
  const record = attempts.get(ip);

  if (!record || now - record.firstAttempt > WINDOW_MS) {
    attempts.set(ip, { count: 1, firstAttempt: now });
    return next();
  }

  if (record.count >= MAX_ATTEMPTS) {
    const minutesLeft = Math.ceil((WINDOW_MS - (now - record.firstAttempt)) / 60000);
    return res.status(429).json({ error: `Too many login attempts. Try again in ${minutesLeft} minute(s).` });
  }

  record.count += 1;
  next();
}

// Call this after a successful login to clear the counter for that IP
function clearRateLimit(req) {
  attempts.delete(req.ip);
}

module.exports = { loginRateLimit, clearRateLimit };
