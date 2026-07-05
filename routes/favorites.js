// routes/favorites.js — a student's shortlist of hostels they're considering
const express = require('express');
const router = express.Router();
const pool = require('../db');
const { requireRole } = require('../middleware/auth');

// GET /api/favorites/mine — every listing the logged-in student has favorited
router.get('/mine', requireRole('student'), async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT favorites.id AS favorite_id, favorites.created_at AS favorited_at,
              listings.id, listings.title, listings.area, listings.price, listings.image_url,
              listings.status, listings.distance_minutes,
              (SELECT COALESCE(SUM(available_quantity), 0) FROM room_types WHERE room_types.listing_id = listings.id) AS rooms_available
       FROM favorites
       JOIN listings ON favorites.listing_id = listings.id
       WHERE favorites.student_id = ?
       ORDER BY favorites.created_at DESC`,
      [req.session.user.id]
    );
    res.json(rows);
  } catch (err) {
    console.error('Error fetching favorites:', err);
    res.status(500).json({ error: 'Could not fetch your favorites.' });
  }
});

// GET /api/favorites/mine/ids — just the listing ids, so pages with a grid of
// cards can cheaply mark which ones are already favorited
router.get('/mine/ids', requireRole('student'), async (req, res) => {
  try {
    const [rows] = await pool.query(
      'SELECT listing_id FROM favorites WHERE student_id = ?',
      [req.session.user.id]
    );
    res.json({ listingIds: rows.map((r) => r.listing_id) });
  } catch (err) {
    console.error('Error fetching favorite ids:', err);
    res.status(500).json({ error: 'Could not fetch your favorites.' });
  }
});

// POST /api/favorites — add a listing to the shortlist (idempotent)
router.post('/', requireRole('student'), async (req, res) => {
  try {
    const { listing_id } = req.body;
    if (!listing_id) {
      return res.status(400).json({ error: 'listing_id is required.' });
    }

    await pool.query(
      'INSERT INTO favorites (student_id, listing_id) VALUES (?, ?) ON DUPLICATE KEY UPDATE id = id',
      [req.session.user.id, listing_id]
    );
    res.status(201).json({ message: 'Added to favorites.' });
  } catch (err) {
    console.error('Error adding favorite:', err);
    res.status(500).json({ error: 'Could not add to favorites.' });
  }
});

// DELETE /api/favorites/:listingId — remove a listing from the shortlist
router.delete('/:listingId', requireRole('student'), async (req, res) => {
  try {
    const { listingId } = req.params;
    await pool.query(
      'DELETE FROM favorites WHERE student_id = ? AND listing_id = ?',
      [req.session.user.id, listingId]
    );
    res.json({ message: 'Removed from favorites.' });
  } catch (err) {
    console.error('Error removing favorite:', err);
    res.status(500).json({ error: 'Could not remove from favorites.' });
  }
});

module.exports = router;
