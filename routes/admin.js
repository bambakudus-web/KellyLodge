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
    const [[bookingCounts]] = await pool.query(`
      SELECT
        SUM(payment_status = 'pending') AS pending,
        SUM(payment_status = 'paid') AS paid,
        SUM(payment_status = 'expired') AS expired,
        COUNT(*) AS total,
        COALESCE(SUM(CASE WHEN bookings.payment_status = 'paid' THEN room_types.price ELSE 0 END), 0) AS revenue
      FROM bookings
      JOIN room_types ON bookings.room_type_id = room_types.id
    `);
    res.json({ users: userCounts, listings: listingCounts, bookings: bookingCounts });
  } catch (err) {
    console.error('Error fetching admin stats:', err);
    res.status(500).json({ error: 'Could not fetch stats.' });
  }
});

// GET /api/admin/users — every registered user, optionally filtered by a
// name/email search term
router.get('/users', async (req, res) => {
  try {
    const { search } = req.query;
    let query = 'SELECT id, name, email, phone, role, created_at FROM users';
    const params = [];

    if (search) {
      query += ' WHERE name LIKE ? OR email LIKE ?';
      const term = `%${search}%`;
      params.push(term, term);
    }

    query += ' ORDER BY created_at DESC';

    const [rows] = await pool.query(query, params);
    res.json(rows);
  } catch (err) {
    console.error('Error fetching users:', err);
    res.status(500).json({ error: 'Could not fetch users.' });
  }
});

// PATCH /api/admin/users/:id/role — promote or demote a user
router.patch('/users/:id/role', async (req, res) => {
  try {
    const { id } = req.params;
    const { role } = req.body;

    if (!['student', 'hoster', 'admin'].includes(role)) {
      return res.status(400).json({ error: 'Role must be student, hoster, or admin.' });
    }
    if (Number(id) === req.session.user.id) {
      return res.status(400).json({ error: 'You cannot change your own role.' });
    }

    await pool.query('UPDATE users SET role = ? WHERE id = ?', [role, id]);
    res.json({ message: `Role updated to ${role}.` });
  } catch (err) {
    console.error('Error updating user role:', err);
    res.status(500).json({ error: 'Could not update role.' });
  }
});

// DELETE /api/admin/users/:id — remove a user (cascades to their listings
// and bookings). Any room they were actively holding (pending or paid
// bookings) has its availability restored first, since the cascade delete
// removes the booking row without knowing to do that itself.
router.delete('/users/:id', async (req, res) => {
  const { id } = req.params;
  if (Number(id) === req.session.user.id) {
    return res.status(400).json({ error: 'You cannot delete your own admin account.' });
  }

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    const [activeBookings] = await connection.query(
      `SELECT room_type_id FROM bookings WHERE student_id = ? AND payment_status IN ('pending', 'paid')`,
      [id]
    );

    for (const booking of activeBookings) {
      await connection.query(
        'UPDATE room_types SET available_quantity = LEAST(available_quantity + 1, total_quantity) WHERE id = ?',
        [booking.room_type_id]
      );
    }

    await connection.query('DELETE FROM users WHERE id = ?', [id]);

    await connection.commit();
    res.json({ message: 'User removed.' });
  } catch (err) {
    await connection.rollback();
    console.error('Error deleting user:', err);
    res.status(500).json({ error: 'Could not delete user.' });
  } finally {
    connection.release();
  }
});

// GET /api/admin/bookings — every booking platform-wide, for the revenue/oversight tab
router.get('/bookings', async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT bookings.id, bookings.payment_status, bookings.payment_deadline, bookings.paid_at, bookings.created_at,
             room_types.room_type, room_types.price,
             listings.title AS listing_title,
             student.name AS student_name, student.email AS student_email,
             owner.name AS owner_name
      FROM bookings
      JOIN room_types ON bookings.room_type_id = room_types.id
      JOIN listings ON bookings.listing_id = listings.id
      JOIN users AS student ON bookings.student_id = student.id
      JOIN users AS owner ON listings.owner_id = owner.id
      ORDER BY bookings.created_at DESC
    `);
    res.json(rows);
  } catch (err) {
    console.error('Error fetching all bookings:', err);
    res.status(500).json({ error: 'Could not fetch bookings.' });
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
