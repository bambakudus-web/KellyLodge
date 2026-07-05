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
app.use(express.json());

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
}

module.exports = app;
