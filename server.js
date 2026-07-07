// server.js — entry point for the KellyLodge app
require('dotenv').config();
const express = require('express');
const session = require('express-session');
const cors = require('cors');
const path = require('path');

const authRouter = require('./routes/auth');
const listingsRouter = require('./routes/listings');
const adminRouter = require('./routes/admin');
const bookingsRouter = require('./routes/bookings');
const reviewsRouter = require('./routes/reviews');
const favoritesRouter = require('./routes/favorites');
const paymentsRouter = require('./routes/payments');
const { expirePendingBookings } = require('./utils/expireBookings');
const { csrfProtection } = require('./middleware/csrf');

if (process.env.NODE_ENV === 'production' && !process.env.SESSION_SECRET) {
  console.error('FATAL: SESSION_SECRET must be set in production. Refusing to start.');
  process.exit(1);
}

const app = express();
const PORT = process.env.PORT || 3000;

app.set('trust proxy', 1); // needed for secure cookies behind Railway's proxy

app.use(cors({
  origin: true,
  credentials: true,
}));
app.use(express.json({
  verify: (req, res, buf) => {
    // Stashed for routes/payments.js's webhook, which needs the exact raw
    // bytes (not the re-serialized object) to verify Paystack's signature.
    req.rawBody = buf;
  },
}));

app.use(session({
  secret: process.env.SESSION_SECRET || 'kellylodge-dev-secret-change-in-production',
  resave: false,
  saveUninitialized: false,
  cookie: {
    maxAge: 1000 * 60 * 60 * 24 * 7, // 1 week
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
  },
}));

app.use(csrfProtection);

// Serve the frontend as static files
app.use(express.static(path.join(__dirname, 'public'), { index: 'landing.html' }));

// Belt-and-braces: guarantee the root URL always lands on the landing page
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'landing.html'));
});

// API routes
app.use('/api/auth', authRouter);
app.use('/api/listings', listingsRouter);
app.use('/api/admin', adminRouter);
app.use('/api/bookings', bookingsRouter);
app.use('/api/reviews', reviewsRouter);
app.use('/api/favorites', favoritesRouter);
app.use('/api/payments', paymentsRouter);

// Simple health check — useful for confirming Railway deployment is alive
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' });
});

// Only start listening when this file is run directly (node server.js),
// not when it's required by the test suite.
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`KellyLodge server running on port ${PORT}`);
  });

  // Sweep for unpaid bookings past their 72-hour deadline every 5 minutes.
  const FIVE_MINUTES = 5 * 60 * 1000;
  setInterval(() => {
    expirePendingBookings().catch((err) => {
      console.error('Error running the booking-expiry sweep:', err);
    });
  }, FIVE_MINUTES);
}

module.exports = app;
