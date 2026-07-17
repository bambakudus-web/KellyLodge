// routes/reviews.js — students rate and review hostels they've actually booked
const express = require('express');
const router = express.Router();
const pool = require('../db');
const { requireLogin, requireRole } = require('../middleware/auth');

// GET /api/reviews/listing/:listingId — public, newest first
router.get('/listing/:listingId', async (req, res) => {
  try {
    const { listingId } = req.params;
    const [rows] = await pool.query(
      `SELECT reviews.id, reviews.rating, reviews.comment, reviews.created_at, users.name AS student_name
       FROM reviews JOIN users ON reviews.student_id = users.id
       WHERE reviews.listing_id = ?
       ORDER BY reviews.created_at DESC`,
      [listingId]
    );
    res.json(rows);
  } catch (err) {
    console.error('Error fetching reviews:', err);
    res.status(500).json({ error: 'Could not fetch reviews.' });
  }
});

// GET /api/reviews/can-review/:listingId — tells the frontend whether the
// logged-in student has actually paid for and stayed at this listing (and
// can therefore leave a review). Checked against completed_stays, not the
// bookings table directly, since a booking can be pending (never actually
// paid) or can get deleted later, neither of which should affect whether
// someone who genuinely paid can still leave a review.
router.get('/can-review/:listingId', requireLogin, async (req, res) => {
  try {
    if (req.session.user.role !== 'student') {
      return res.json({ canReview: false });
    }
    const { listingId } = req.params;
    const [rows] = await pool.query(
      'SELECT id FROM completed_stays WHERE listing_id = ? AND student_id = ? LIMIT 1',
      [listingId, req.session.user.id]
    );
    res.json({ canReview: rows.length > 0 });
  } catch (err) {
    console.error('Error checking review eligibility:', err);
    res.status(500).json({ error: 'Could not check review eligibility.' });
  }
});

// POST /api/reviews — students only, and only for a hostel they've booked.
// Upserts, so submitting again just updates their existing review.
router.post('/', requireRole('student'), async (req, res) => {
  try {
    const { listing_id, rating, comment } = req.body;
    const studentId = req.session.user.id;

    const ratingNum = Number(rating);
    if (!listing_id || !Number.isInteger(ratingNum) || ratingNum < 1 || ratingNum > 5) {
      return res.status(400).json({ error: 'A listing and a rating from 1 to 5 are required.' });
    }

    const [stayRows] = await pool.query(
      'SELECT id FROM completed_stays WHERE listing_id = ? AND student_id = ? LIMIT 1',
      [listing_id, studentId]
    );
    if (stayRows.length === 0) {
      return res.status(403).json({ error: 'You can only review a hostel you have paid for and stayed at.' });
    }

    const trimmedComment = (comment || '').trim().slice(0, 1000);

    await pool.query(
      `INSERT INTO reviews (listing_id, student_id, rating, comment)
       VALUES (?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE rating = VALUES(rating), comment = VALUES(comment), created_at = CURRENT_TIMESTAMP`,
      [listing_id, studentId, ratingNum, trimmedComment || null]
    );

    res.status(201).json({ message: 'Review saved. Thank you!' });
  } catch (err) {
    console.error('Error saving review:', err);
    res.status(500).json({ error: 'Could not save your review.' });
  }
});

// DELETE /api/reviews/:id — the student who wrote it, or an admin, can remove it
router.delete('/:id', requireLogin, async (req, res) => {
  try {
    const { id } = req.params;
    const [rows] = await pool.query('SELECT student_id FROM reviews WHERE id = ?', [id]);

    if (rows.length === 0) {
      return res.status(404).json({ error: 'Review not found.' });
    }

    const isOwner = rows[0].student_id === req.session.user.id;
    const isAdmin = req.session.user.role === 'admin';
    if (!isOwner && !isAdmin) {
      return res.status(403).json({ error: 'You can only remove your own review.' });
    }

    await pool.query('DELETE FROM reviews WHERE id = ?', [id]);
    res.json({ message: 'Review removed.' });
  } catch (err) {
    console.error('Error deleting review:', err);
    res.status(500).json({ error: 'Could not delete review.' });
  }
});

module.exports = router;
