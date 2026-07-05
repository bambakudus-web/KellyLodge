// routes/auth.js — signup, login, logout, verification, password reset, and account management
const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const pool = require('../db');
const { loginRateLimit, clearRateLimit } = require('../middleware/rateLimit');
const { requireLogin } = require('../middleware/auth');
const { ensureCsrfToken } = require('../middleware/csrf');
const { sendVerificationEmail, sendPasswordResetEmail } = require('../utils/email');

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

// POST /api/auth/forgot-password — always responds the same way whether or not the email exists,
// so this endpoint can't be used to check who has an account.
router.post('/forgot-password', async (req, res) => {
  const genericMessage = { message: 'If an account exists for that email, a reset link has been sent.' };
  try {
    const { email } = req.body;
    if (!email) {
      return res.status(400).json({ error: 'Email is required.' });
    }

    const [rows] = await pool.query('SELECT id, name FROM users WHERE email = ?', [email]);
    if (rows.length === 0) {
      return res.json(genericMessage);
    }

    const resetToken = crypto.randomBytes(32).toString('hex');
    const expires = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

    await pool.query(
      'UPDATE users SET reset_token = ?, reset_token_expires = ? WHERE id = ?',
      [resetToken, expires, rows[0].id]
    );

    const resetUrl = `${APP_URL}/reset-password.html?token=${resetToken}`;
    sendPasswordResetEmail({ toEmail: email, toName: rows[0].name, resetUrl });

    res.json(genericMessage);
  } catch (err) {
    console.error('Forgot-password error:', err);
    res.status(500).json({ error: 'Could not process that request.' });
  }
});

// POST /api/auth/reset-password — sets a new password using a valid, unexpired token
router.post('/reset-password', async (req, res) => {
  try {
    const { token, newPassword } = req.body;

    if (!token || !newPassword) {
      return res.status(400).json({ error: 'Token and new password are required.' });
    }
    if (newPassword.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters.' });
    }

    const [rows] = await pool.query(
      'SELECT id, reset_token_expires FROM users WHERE reset_token = ?',
      [token]
    );

    if (rows.length === 0) {
      return res.status(400).json({ error: 'This reset link is invalid or has already been used.' });
    }

    if (new Date(rows[0].reset_token_expires) < new Date()) {
      return res.status(400).json({ error: 'This reset link has expired. Please request a new one.' });
    }

    const passwordHash = await bcrypt.hash(newPassword, 10);
    await pool.query(
      'UPDATE users SET password_hash = ?, reset_token = NULL, reset_token_expires = NULL WHERE id = ?',
      [passwordHash, rows[0].id]
    );

    res.json({ message: 'Password reset! You can now log in with your new password.' });
  } catch (err) {
    console.error('Reset-password error:', err);
    res.status(500).json({ error: 'Could not reset password.' });
  }
});

// PUT /api/auth/me — any logged-in user (student, hoster, or admin) updates their own profile.
// Changing email marks it unverified again and sends a fresh verification link.
router.put('/me', requireLogin, async (req, res) => {
  try {
    const { name, phone, email } = req.body;
    const userId = req.session.user.id;

    if (!name || !phone || !email) {
      return res.status(400).json({ error: 'Name, phone, and email are all required.' });
    }

    const [existing] = await pool.query('SELECT id FROM users WHERE email = ? AND id != ?', [email, userId]);
    if (existing.length > 0) {
      return res.status(409).json({ error: 'Another account already uses that email.' });
    }

    const [[currentUser]] = await pool.query('SELECT email FROM users WHERE id = ?', [userId]);
    const emailChanged = currentUser.email !== email;

    if (emailChanged) {
      const verificationToken = crypto.randomBytes(32).toString('hex');
      await pool.query(
        'UPDATE users SET name = ?, phone = ?, email = ?, email_verified = FALSE, verification_token = ? WHERE id = ?',
        [name, phone, email, verificationToken, userId]
      );
      const verifyUrl = `${APP_URL}/verify-email.html?token=${verificationToken}`;
      sendVerificationEmail({ toEmail: email, toName: name, verifyUrl });
    } else {
      await pool.query('UPDATE users SET name = ?, phone = ? WHERE id = ?', [name, phone, userId]);
    }

    req.session.user = { ...req.session.user, name, email };

    res.json({
      user: req.session.user,
      message: emailChanged
        ? 'Profile updated. Since you changed your email, please check your inbox to verify it before logging in again.'
        : 'Profile updated.',
    });
  } catch (err) {
    console.error('Profile update error:', err);
    res.status(500).json({ error: 'Could not update profile.' });
  }
});

// PUT /api/auth/password — change password while logged in (requires the current password)
router.put('/password', requireLogin, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    const userId = req.session.user.id;

    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: 'Current and new password are both required.' });
    }
    if (newPassword.length < 6) {
      return res.status(400).json({ error: 'New password must be at least 6 characters.' });
    }

    const [[user]] = await pool.query('SELECT password_hash FROM users WHERE id = ?', [userId]);
    const match = await bcrypt.compare(currentPassword, user.password_hash);
    if (!match) {
      return res.status(401).json({ error: 'Current password is incorrect.' });
    }

    const newHash = await bcrypt.hash(newPassword, 10);
    await pool.query('UPDATE users SET password_hash = ? WHERE id = ?', [newHash, userId]);

    res.json({ message: 'Password changed successfully.' });
  } catch (err) {
    console.error('Password change error:', err);
    res.status(500).json({ error: 'Could not change password.' });
  }
});

module.exports = router;
