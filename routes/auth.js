// routes/auth.js — signup, login, logout, email verification, and "who am I" endpoints
const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const pool = require('../db');
const { loginRateLimit, clearRateLimit } = require('../middleware/rateLimit');
const { ensureCsrfToken } = require('../middleware/csrf');
const { sendVerificationEmail } = require('../utils/email');

const APP_URL = process.env.APP_URL || 'http://localhost:3000';

// POST /api/auth/signup — create a new student or hoster account, unverified until they click the email link
router.post('/signup', async (req, res) => {
  try {
    const { name, email, password, phone, role } = req.body;

    if (!name || !email || !password || !phone || !role) {
      return res.status(400).json({ error: 'All fields are required.' });
    }

    if (!['student', 'hoster'].includes(role)) {
      return res.status(400).json({ error: 'Role must be student or hoster.' });
    }

    if (password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters.' });
    }

    const [existing] = await pool.query('SELECT id FROM users WHERE email = ?', [email]);
    if (existing.length > 0) {
      return res.status(409).json({ error: 'An account with that email already exists.' });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const verificationToken = crypto.randomBytes(32).toString('hex');

    await pool.query(
      'INSERT INTO users (name, email, password_hash, phone, role, email_verified, verification_token) VALUES (?, ?, ?, ?, ?, FALSE, ?)',
      [name, email, passwordHash, phone, role, verificationToken]
    );

    const verifyUrl = `${APP_URL}/verify-email.html?token=${verificationToken}`;
    sendVerificationEmail({ toEmail: email, toName: name, verifyUrl });

    res.status(201).json({
      message: 'Account created! Check your email for a verification link before logging in.',
    });
  } catch (err) {
    console.error('Signup error:', err);
    res.status(500).json({ error: 'Could not create account.' });
  }
});

// GET /api/auth/verify — called from the link in the verification email
router.get('/verify', async (req, res) => {
  try {
    const { token } = req.query;
    if (!token) {
      return res.status(400).json({ error: 'Missing verification token.' });
    }

    const [rows] = await pool.query('SELECT id FROM users WHERE verification_token = ?', [token]);
    if (rows.length === 0) {
      return res.status(400).json({ error: 'This verification link is invalid or has already been used.' });
    }

    await pool.query(
      'UPDATE users SET email_verified = TRUE, verification_token = NULL WHERE id = ?',
      [rows[0].id]
    );

    res.json({ message: 'Email verified! You can now log in.' });
  } catch (err) {
    console.error('Verification error:', err);
    res.status(500).json({ error: 'Could not verify email.' });
  }
});

// POST /api/auth/login
router.post('/login', loginRateLimit, async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required.' });
    }

    const [rows] = await pool.query('SELECT * FROM users WHERE email = ?', [email]);
    if (rows.length === 0) {
      return res.status(401).json({ error: 'Invalid email or password.' });
    }

    const user = rows[0];
    const match = await bcrypt.compare(password, user.password_hash);
    if (!match) {
      return res.status(401).json({ error: 'Invalid email or password.' });
    }

    if (!user.email_verified) {
      return res.status(403).json({ error: 'Please verify your email before logging in. Check your inbox for the verification link.' });
    }

    clearRateLimit(req);
    req.session.user = { id: user.id, name: user.name, email: user.email, role: user.role };
    res.json({ user: req.session.user });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Could not log in.' });
  }
});

// POST /api/auth/logout
router.post('/logout', (req, res) => {
  req.session.destroy(() => {
    res.json({ message: 'Logged out.' });
  });
});

// GET /api/auth/me — used by the frontend to check if someone is logged in
router.get('/me', (req, res) => {
  res.json({ user: req.session.user || null });
});

// GET /api/auth/csrf-token — issues (or returns the existing) CSRF token for this session
router.get('/csrf-token', (req, res) => {
  res.json({ csrfToken: ensureCsrfToken(req) });
});

module.exports = router;
