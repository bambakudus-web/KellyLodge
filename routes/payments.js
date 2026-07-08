// routes/payments.js — starting a Paystack payment for a booking, and
// receiving Paystack's webhook confirming it succeeded.
const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const pool = require('../db');
const { requireRole } = require('../middleware/auth');
const { initializeTransaction, verifyTransaction, isValidWebhookSignature } = require('../utils/paystack');
const {
  sendPaymentConfirmationEmailToStudent,
  sendPaymentConfirmationEmailToOwner,
} = require('../utils/email');
const {
  sendPaymentConfirmationSMSToStudent,
  sendPaymentConfirmationSMSToOwner,
} = require('../utils/sms');

// POST /api/payments/initialize — student starts paying for one of their
// own pending bookings; returns the Paystack checkout URL to redirect to.
router.post('/initialize', requireRole('student'), async (req, res) => {
  try {
    const { booking_id } = req.body;
    if (!booking_id) {
      return res.status(400).json({ error: 'booking_id is required.' });
    }

    const [[booking]] = await pool.query(
      `SELECT bookings.id, bookings.student_id, bookings.payment_status, bookings.paystack_reference,
              room_types.price, listings.title AS listing_title,
              users.email AS student_email
       FROM bookings
       JOIN room_types ON bookings.room_type_id = room_types.id
       JOIN listings ON bookings.listing_id = listings.id
       JOIN users ON bookings.student_id = users.id
       WHERE bookings.id = ?`,
      [booking_id]
    );

    if (!booking) {
      return res.status(404).json({ error: 'Booking not found.' });
    }
    if (booking.student_id !== req.session.user.id) {
      return res.status(403).json({ error: 'You can only pay for your own booking.' });
    }
    if (booking.payment_status === 'paid') {
      return res.status(400).json({ error: 'This booking has already been paid for.' });
    }
    if (booking.payment_status !== 'pending') {
      return res.status(400).json({ error: 'This booking is no longer available to pay for (it may have expired).' });
    }

    // A fresh, unique reference per payment attempt, tied back to this booking.
    const reference = `kellylodge-${booking.id}-${crypto.randomBytes(4).toString('hex')}`;

    const transaction = await initializeTransaction({
      email: booking.student_email,
      amountCedis: booking.price,
      reference,
      bookingId: booking.id,
    });

    await pool.query('UPDATE bookings SET paystack_reference = ? WHERE id = ?', [reference, booking.id]);

    res.json({ authorization_url: transaction.authorization_url });
  } catch (err) {
    console.error('Error initializing payment:', err);
    res.status(500).json({ error: 'Could not start the payment. Please try again.' });
  }
});

// POST /api/payments/webhook — Paystack calls this server-to-server when a
// transaction completes. Must verify the signature against the RAW request
// body (see server.js, where express.json() captures req.rawBody for this
// exact path) before trusting anything in it.
router.post('/webhook', async (req, res) => {
  const signature = req.headers['x-paystack-signature'];

  if (!isValidWebhookSignature(req.rawBody, signature)) {
    console.warn('Rejected a Paystack webhook: invalid signature.');
    return res.status(401).json({ error: 'Invalid signature.' });
  }

  // Acknowledge immediately, Paystack retries if it doesn't get a fast 200,
  // and the actual work below shouldn't hold up that acknowledgment.
  res.status(200).json({ received: true });

  try {
    const event = req.body;
    console.log(`Paystack webhook received: event="${event?.event}" reference="${event?.data?.reference}"`);

    if (event.event !== 'charge.success') return;

    const reference = event.data.reference;

    // A valid signature only proves the request body wasn't tampered with in
    // transit, it does NOT prove a real charge happened (Paystack's own
    // connectivity-test pings can be signed and shaped like a real event).
    // Independently asking Paystack's verify API "did this reference really
    // succeed" closes that gap, only Paystack's own transaction records are
    // trusted for the actual yes/no.
    let verified;
    try {
      verified = await verifyTransaction(reference);
    } catch (err) {
      console.warn(`Could not independently verify reference "${reference}", refusing to mark it paid:`, err.message);
      return;
    }

    if (!verified || verified.status !== 'success') {
      console.warn(`Reference "${reference}" is not a verified successful transaction (status: ${verified?.status}), ignoring.`);
      return;
    }

    const [[booking]] = await pool.query(
      `SELECT bookings.id, bookings.payment_status,
              room_types.room_type, room_types.price, listings.title AS listing_title,
              student.name AS student_name, student.email AS student_email, student.phone AS student_phone,
              owner.name AS owner_name, owner.email AS owner_email, owner.phone AS owner_phone
       FROM bookings
       JOIN room_types ON bookings.room_type_id = room_types.id
       JOIN listings ON bookings.listing_id = listings.id
       JOIN users AS student ON bookings.student_id = student.id
       JOIN users AS owner ON listings.owner_id = owner.id
       WHERE bookings.paystack_reference = ?`,
      [reference]
    );

    if (!booking) {
      console.warn(`Verified webhook for unknown Paystack reference: ${reference}`);
      return;
    }

    const expectedAmountKobo = Math.round(Number(booking.price) * 100);
    if (verified.amount !== expectedAmountKobo) {
      console.warn(
        `Reference "${reference}" paid amount (${verified.amount}) does not match booking #${booking.id}'s expected amount (${expectedAmountKobo}), refusing to mark it paid.`
      );
      return;
    }

    // Idempotency: Paystack can send the same webhook more than once, and
    // the expiry job could theoretically race with a late webhook, only
    // act the first time this booking is marked paid.
    const [updateResult] = await pool.query(
      "UPDATE bookings SET payment_status = 'paid', paid_at = NOW() WHERE id = ? AND payment_status = 'pending'",
      [booking.id]
    );
    if (updateResult.affectedRows === 0) return;

    console.log(`Booking #${booking.id} confirmed paid (reference: ${reference}, verified amount: ${verified.amount}).`);

    sendPaymentConfirmationEmailToStudent({
      toEmail: booking.student_email,
      toName: booking.student_name,
      listingTitle: booking.listing_title,
    });
    sendPaymentConfirmationEmailToOwner({
      toEmail: booking.owner_email,
      toName: booking.owner_name,
      studentName: booking.student_name,
      listingTitle: booking.listing_title,
      roomType: booking.room_type,
      price: booking.price,
    });
    sendPaymentConfirmationSMSToStudent({
      studentPhone: booking.student_phone,
      listingTitle: booking.listing_title,
    });
    sendPaymentConfirmationSMSToOwner({
      ownerPhone: booking.owner_phone,
      studentName: booking.student_name,
      listingTitle: booking.listing_title,
    });
  } catch (err) {
    console.error('Error processing Paystack webhook:', err);
  }
});

// GET /api/payments/status/:bookingId — lets the frontend poll after
// returning from Paystack's checkout, in case the webhook hasn't landed yet.
router.get('/status/:bookingId', requireRole('student'), async (req, res) => {
  try {
    const [[booking]] = await pool.query(
      'SELECT id, student_id, payment_status FROM bookings WHERE id = ?',
      [req.params.bookingId]
    );

    if (!booking || booking.student_id !== req.session.user.id) {
      return res.status(404).json({ error: 'Booking not found.' });
    }

    res.json({ payment_status: booking.payment_status });
  } catch (err) {
    console.error('Error checking payment status:', err);
    res.status(500).json({ error: 'Could not check payment status.' });
  }
});

module.exports = router;
