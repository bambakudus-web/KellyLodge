// routes/bookings.js — instant room booking (pending payment), "My Bookings", and the hoster's received-bookings feed
const express = require('express');
const router = express.Router();
const pool = require('../db');
const { requireRole } = require('../middleware/auth');
const { sendBookingNotification, sendPaymentReminderEmail } = require('../utils/email');
const { sendBookingSMSToOwner, sendBookingSMSToStudent } = require('../utils/sms');

const PAYMENT_WINDOW_HOURS = 72;

// POST /api/bookings — reserve a room instantly (students only); the room is
// held for 72 hours pending payment, after which an unpaid booking is
// automatically expired (see utils/expireBookings.js, run on a timer in server.js).
router.post('/', requireRole('student'), async (req, res) => {
  const connection = await pool.getConnection();
  try {
    const { room_type_id } = req.body;
    const studentId = req.session.user.id;

    if (!room_type_id) {
      return res.status(400).json({ error: 'room_type_id is required.' });
    }

    await connection.beginTransaction();

    const [roomTypes] = await connection.query(
      'SELECT id, listing_id, room_type, price, available_quantity FROM room_types WHERE id = ? FOR UPDATE',
      [room_type_id]
    );

    if (roomTypes.length === 0) {
      await connection.rollback();
      return res.status(404).json({ error: 'Room type not found.' });
    }

    const roomType = roomTypes[0];

    if (roomType.available_quantity <= 0) {
      await connection.rollback();
      return res.status(409).json({ error: 'No rooms of this type are available right now.' });
    }

    await connection.query(
      'UPDATE room_types SET available_quantity = available_quantity - 1 WHERE id = ?',
      [room_type_id]
    );

    const paymentDeadline = new Date(Date.now() + PAYMENT_WINDOW_HOURS * 60 * 60 * 1000);

    const [result] = await connection.query(
      `INSERT INTO bookings (room_type_id, listing_id, student_id, payment_status, payment_deadline)
       VALUES (?, ?, ?, 'pending', ?)`,
      [room_type_id, roomType.listing_id, studentId, paymentDeadline]
    );

    const [[listing]] = await connection.query(
      `SELECT listings.title, users.name AS owner_name, users.email AS owner_email, users.phone AS owner_phone
       FROM listings JOIN users ON listings.owner_id = users.id
       WHERE listings.id = ?`,
      [roomType.listing_id]
    );

    // Session only stores name/email/role, not phone — pull the full record for the email/SMS.
    const [[student]] = await connection.query(
      'SELECT name, phone, email FROM users WHERE id = ?',
      [studentId]
    );

    await connection.commit();

    // Fire-and-forget — a slow or failed email/SMS should never block the booking response.
    sendBookingNotification({
      ownerEmail: listing.owner_email,
      ownerName: listing.owner_name,
      studentName: student.name,
      studentPhone: student.phone,
      studentEmail: student.email,
      listingTitle: listing.title,
      roomType: roomType.room_type,
      price: roomType.price,
      paymentDeadline,
    });
    sendBookingSMSToOwner({
      ownerPhone: listing.owner_phone,
      studentName: student.name,
      studentPhone: student.phone,
      listingTitle: listing.title,
      roomType: roomType.room_type,
    });
    sendPaymentReminderEmail({
      toEmail: student.email,
      toName: student.name,
      listingTitle: listing.title,
      roomType: roomType.room_type,
      price: roomType.price,
      deadline: paymentDeadline,
    });
    sendBookingSMSToStudent({
      studentPhone: student.phone,
      listingTitle: listing.title,
      roomType: roomType.room_type,
      price: roomType.price,
      deadline: paymentDeadline,
    });

    res.status(201).json({
      id: result.insertId,
      payment_deadline: paymentDeadline,
      message: 'Room held for 72 hours. Complete payment in My Bookings to confirm it.',
    });
  } catch (err) {
    await connection.rollback();
    console.error('Error booking room:', err);
    res.status(500).json({ error: 'Could not complete the booking.' });
  } finally {
    connection.release();
  }
});

// GET /api/bookings/mine — the logged-in student's bookings
router.get('/mine', requireRole('student'), async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT bookings.id, bookings.created_at, bookings.payment_status, bookings.payment_deadline, bookings.paid_at, bookings.paystack_reference,
              room_types.room_type, room_types.price,
              listings.id AS listing_id, listings.title, listings.area, listings.image_url,
              users.name AS owner_name, users.phone AS owner_phone
       FROM bookings
       JOIN room_types ON bookings.room_type_id = room_types.id
       JOIN listings ON bookings.listing_id = listings.id
       JOIN users ON listings.owner_id = users.id
       WHERE bookings.student_id = ?
       ORDER BY bookings.created_at DESC`,
      [req.session.user.id]
    );
    res.json(rows);
  } catch (err) {
    console.error('Error fetching bookings:', err);
    res.status(500).json({ error: 'Could not fetch your bookings.' });
  }
});

// GET /api/bookings/received — bookings for a hoster's own listings (admin sees all)
router.get('/received', requireRole('hoster', 'admin'), async (req, res) => {
  try {
    const isAdmin = req.session.user.role === 'admin';

    let query = `
      SELECT bookings.id, bookings.created_at, bookings.payment_status, bookings.payment_deadline, bookings.paid_at,
             room_types.room_type, room_types.price,
             listings.id AS listing_id, listings.title,
             users.name AS student_name, users.phone AS student_phone, users.email AS student_email
      FROM bookings
      JOIN room_types ON bookings.room_type_id = room_types.id
      JOIN listings ON bookings.listing_id = listings.id
      JOIN users ON bookings.student_id = users.id
    `;
    const params = [];

    if (!isAdmin) {
      query += ' WHERE listings.owner_id = ?';
      params.push(req.session.user.id);
    }

    query += ' ORDER BY bookings.created_at DESC';

    const [rows] = await pool.query(query, params);
    res.json(rows);
  } catch (err) {
    console.error('Error fetching received bookings:', err);
    res.status(500).json({ error: 'Could not fetch bookings.' });
  }
});

// DELETE /api/bookings/:id — cancel a booking, frees the room type slot back up.
// A booking that's already been paid for can't be self-cancelled here, since
// there's no automatic refund flow — the student needs to go through the
// owner (or admin) directly for that.
router.delete('/:id', requireRole('student'), async (req, res) => {
  const connection = await pool.getConnection();
  try {
    const { id } = req.params;

    await connection.beginTransaction();

    const [bookings] = await connection.query(
      'SELECT room_type_id, student_id, payment_status FROM bookings WHERE id = ?',
      [id]
    );

    if (bookings.length === 0) {
      await connection.rollback();
      return res.status(404).json({ error: 'Booking not found.' });
    }

    if (bookings[0].student_id !== req.session.user.id) {
      await connection.rollback();
      return res.status(403).json({ error: 'You can only cancel your own bookings.' });
    }

    if (bookings[0].payment_status === 'paid') {
      await connection.rollback();
      return res.status(400).json({
        error: 'This booking has already been paid for. Contact the owner directly to arrange a cancellation or refund.',
      });
    }

    await connection.query(
      `UPDATE room_types
       SET available_quantity = LEAST(available_quantity + 1, total_quantity)
       WHERE id = ?`,
      [bookings[0].room_type_id]
    );
    await connection.query('DELETE FROM bookings WHERE id = ?', [id]);

    await connection.commit();
    res.json({ message: 'Booking cancelled.' });
  } catch (err) {
    await connection.rollback();
    console.error('Error cancelling booking:', err);
    res.status(500).json({ error: 'Could not cancel the booking.' });
  } finally {
    connection.release();
  }
});

module.exports = router;
