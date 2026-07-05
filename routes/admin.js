// routes/admin.js — admin-only endpoints for platform oversight
const express = require('express');
const router = express.Router();
const pool = require('../db');
const { requireRole } = require('../middleware/auth');

router.use(requireRole('admin'));

// GET /api/admin/stats — quick counts for the dashboard
router.get('/stats', async (req, res) => {
  try {
    const [[userCounts]] = await pool.query(`
      SELECT
        SUM(role = 'student') AS students,
        SUM(role = 'hoster') AS hosters,
        SUM(role = 'admin') AS admins,
        COUNT(*) AS total
      FROM users
    `);
    const [[listingCounts]] = await pool.query(`
      SELECT
        SUM(status = 'active') AS active,
        SUM(status = 'removed') AS removed,
        COUNT(*) AS total
      FROM listings
    `);
    res.json({ users: userCounts, listings: listingCounts });
  } catch (err) {
    console.error('Error fetching admin stats:', err);
    res.status(500).json({ error: 'Could not fetch stats.' });
  }
});

// GET /api/admin/users — every registered user
router.get('/users', async (req, res) => {
  try {
    const [rows] = await pool.query(
      'SELECT id, name, email, phone, role, created_at FROM users ORDER BY created_at DESC'
    );
    res.json(rows);
  } catch (err) {
    console.error('Error fetching users:', err);
    res.status(500).json({ error: 'Could not fetch users.' });
  }
});

// DELETE /api/admin/users/:id — remove a user (cascades to their listings)
router.delete('/users/:id', async (req, res) => {
  try {
    const { id } = req.params;
    if (Number(id) === req.session.user.id) {
      return res.status(400).json({ error: 'You cannot delete your own admin account.' });
    }
    await pool.query('DELETE FROM users WHERE id = ?', [id]);
    res.json({ message: 'User removed.' });
  } catch (err) {
    console.error('Error deleting user:', err);
    res.status(500).json({ error: 'Could not delete user.' });
  }
});

// GET /api/admin/listings — every listing, regardless of status
router.get('/listings', async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT listings.*, users.name AS owner_name, users.email AS owner_email,
        (SELECT COALESCE(SUM(available_quantity), 0) FROM room_types WHERE room_types.listing_id = listings.id) AS rooms_available,
        (SELECT COALESCE(SUM(total_quantity), 0) FROM room_types WHERE room_types.listing_id = listings.id) AS rooms_total
      FROM listings JOIN users ON listings.owner_id = users.id
      ORDER BY listings.created_at DESC
    `);
    res.json(rows);
  } catch (err) {
    console.error('Error fetching all listings:', err);
    res.status(500).json({ error: 'Could not fetch listings.' });
  }
});

// PATCH /api/admin/listings/:id/status — toggle active/removed (moderation)
router.patch('/listings/:id/status', async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;
    if (!['active', 'removed'].includes(status)) {
      return res.status(400).json({ error: 'Status must be active or removed.' });
    }
    await pool.query('UPDATE listings SET status = ? WHERE id = ?', [status, id]);
    res.json({ message: `Listing marked as ${status}.` });
  } catch (err) {
    console.error('Error updating listing status:', err);
    res.status(500).json({ error: 'Could not update listing.' });
  }
});

module.exports = router;
