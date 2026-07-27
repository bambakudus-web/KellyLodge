// routes/bookings.js — instant room booking (pending payment), "My Bookings", and the hoster's received-bookings feed
const express = require('express');
const router = express.Router();
const pool = require('../db');
const { requireLogin, requireRole } = require('../middleware/auth');
const { sendBookingNotification, sendPaymentReminderEmail } = require('../utils/email');
const { sendBookingSMSToOwner, sendBookingSMSToStudent } = require('../utils/sms');
const { reconcileByReference } = require('../utils/reconcilePayment');

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
              room_types.room_type, room_types.price, rooms.room_number,
              listings.id AS listing_id, listings.title, listings.area, listings.image_url,
              users.name AS owner_name, users.phone AS owner_phone
       FROM bookings
       JOIN room_types ON bookings.room_type_id = room_types.id
       LEFT JOIN rooms ON bookings.room_id = rooms.id
       JOIN listings ON bookings.listing_id = listings.id
       JOIN users ON listings.owner_id = users.id
       WHERE bookings.student_id = ?
       ORDER BY bookings.created_at DESC`,
      [req.session.user.id]
    );

    // Self-healing: if the Paystack webhook never landed (misconfigured
    // webhook URL, a slow retry, etc.) a booking can be stuck showing
    // "pending" even though the student really did pay. Rather than trust
    // the DB alone, actively re-check any still-pending booking with
    // Paystack directly whenever the student opens this page, this doesn't
    // depend on the webhook or the callback page having worked at all.
    const stillPending = rows.filter((b) => b.payment_status === 'pending' && b.paystack_reference);
    if (stillPending.length > 0) {
      let anyUpdated = false;
      for (const b of stillPending) {
        try {
          const result = await reconcileByReference(b.paystack_reference);
          if (result.status === 'newly_paid' || result.status === 'already_paid') {
            b.payment_status = 'paid';
            anyUpdated = true;
          }
        } catch (err) {
          console.error(`Reconciliation check failed for booking #${b.id}:`, err.message);
        }
      }
      if (anyUpdated) {
        // Re-read paid_at for whichever rows just flipped, cheap since it's few rows.
        const [fresh] = await pool.query(
          'SELECT id, paid_at FROM bookings WHERE id IN (?)',
          [stillPending.map((b) => b.id)]
        );
        const paidAtById = new Map(fresh.map((f) => [f.id, f.paid_at]));
        rows.forEach((b) => {
          if (paidAtById.has(b.id) && b.payment_status === 'paid') b.paid_at = paidAtById.get(b.id);
        });
      }
    }

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
             room_types.room_type, room_types.price, rooms.room_number,
             listings.id AS listing_id, listings.title,
             users.name AS student_name, users.phone AS student_phone, users.email AS student_email
      FROM bookings
      JOIN room_types ON bookings.room_type_id = room_types.id
      LEFT JOIN rooms ON bookings.room_id = rooms.id
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

// DELETE /api/bookings/:id — remove a booking, frees the room type slot back up.
// Two people can do this:
//  - the student who made it, but only while it's still 'pending' (there's
//    no automatic refund flow, so a paid booking needs to go through the
//    owner or admin directly instead)
//  - the hoster who owns the listing (or an admin), any time, for any
//    status, this is their call to make about their own room, e.g.
//    clearing out a booking after a guest leaves, or rejecting one they
//    don't want to honor.
router.delete('/:id', requireRole('student', 'hoster', 'admin'), async (req, res) => {
  const connection = await pool.getConnection();
  try {
    const { id } = req.params;
    const requester = req.session.user;

    await connection.beginTransaction();

    const [bookings] = await connection.query(
      `SELECT bookings.room_type_id, bookings.room_id, bookings.student_id, bookings.payment_status, listings.owner_id
       FROM bookings
       JOIN listings ON bookings.listing_id = listings.id
       WHERE bookings.id = ?`,
      [id]
    );

    if (bookings.length === 0) {
      await connection.rollback();
      return res.status(404).json({ error: 'Booking not found.' });
    }

    const booking = bookings[0];
    const isOwnStudentBooking = requester.role === 'student' && booking.student_id === requester.id;
    const isOwningHoster = requester.role === 'hoster' && booking.owner_id === requester.id;
    const isAdmin = requester.role === 'admin';

    if (!isOwnStudentBooking && !isOwningHoster && !isAdmin) {
      await connection.rollback();
      return res.status(403).json({ error: 'You do not have permission to delete this booking.' });
    }

    // Students can only self-cancel while it's still unpaid, hosters/admins may remove any status.
    if (isOwnStudentBooking && booking.payment_status === 'paid') {
      await connection.rollback();
      return res.status(400).json({
        error: 'This booking has already been paid for. Contact the owner directly to arrange a cancellation or refund.',
      });
    }

    await connection.query(
      `UPDATE room_types
       SET available_quantity = LEAST(available_quantity + 1, total_quantity)
       WHERE id = ?`,
      [booking.room_type_id]
    );

    // A paid booking has a specific numbered room tied to it (e.g. "A001")
    // — free that exact unit back up too, not just the room_type's count,
    // so the next student to pay for this room type can be assigned it.
    if (booking.room_id) {
      await connection.query("UPDATE rooms SET status = 'available' WHERE id = ?", [booking.room_id]);
    }

    await connection.query('DELETE FROM bookings WHERE id = ?', [id]);

    await connection.commit();
    res.json({ message: 'Booking deleted.' });
  } catch (err) {
    await connection.rollback();
    console.error('Error deleting booking:', err);
    res.status(500).json({ error: 'Could not delete the booking.' });
  } finally {
    connection.release();
  }
});

// GET /api/bookings/:id/receipt — a printable payment receipt for a paid
// booking. Available to the student who paid, the hoster who owns the
// listing, or an admin — nobody else can pull up someone else's receipt.
router.get('/:id/receipt', requireLogin, async (req, res) => {
  try {
    const { id } = req.params;
    const requester = req.session.user;

    const [rows] = await pool.query(
      `SELECT bookings.id, bookings.created_at, bookings.payment_status, bookings.paid_at,
              bookings.paystack_reference, bookings.student_id,
              room_types.room_type, room_types.price, rooms.room_number,
              listings.id AS listing_id, listings.title, listings.area, listings.owner_id,
              student.name AS student_name, student.email AS student_email, student.phone AS student_phone,
              owner.name AS owner_name
       FROM bookings
       JOIN room_types ON bookings.room_type_id = room_types.id
       LEFT JOIN rooms ON bookings.room_id = rooms.id
       JOIN listings ON bookings.listing_id = listings.id
       JOIN users AS student ON bookings.student_id = student.id
       JOIN users AS owner ON listings.owner_id = owner.id
       WHERE bookings.id = ?`,
      [id]
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: 'Booking not found.' });
    }

    const b = rows[0];
    const isOwnStudentBooking = requester.role === 'student' && b.student_id === requester.id;
    const isOwningHoster = requester.role === 'hoster' && b.owner_id === requester.id;
    const isAdmin = requester.role === 'admin';

    if (!isOwnStudentBooking && !isOwningHoster && !isAdmin) {
      return res.status(403).json({ error: 'You do not have permission to view this receipt.' });
    }

    if (b.payment_status !== 'paid') {
      return res.status(400).json({ error: 'A receipt is only available once a booking has been paid for.' });
    }

    res.json({
      receipt_no: `KL-${String(b.id).padStart(6, '0')}`,
      booking_id: b.id,
      booked_at: b.created_at,
      paid_at: b.paid_at,
      paystack_reference: b.paystack_reference,
      listing_title: b.title,
      area: b.area,
      room_type: b.room_type,
      room_number: b.room_number,
      price: b.price,
      student_name: b.student_name,
      student_email: b.student_email,
      student_phone: b.student_phone,
      owner_name: b.owner_name,
    });
  } catch (err) {
    console.error('Error building receipt:', err);
    res.status(500).json({ error: 'Could not generate the receipt.' });
  }
});

module.exports = router;
