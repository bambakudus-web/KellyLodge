// routes/payments.js — starting a Paystack payment for a booking, and
// confirming it succeeded (via webhook, and via active reconciliation).
const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const pool = require('../db');
const { requireRole } = require('../middleware/auth');
const { initializeTransaction, isValidWebhookSignature } = require('../utils/paystack');
const { reconcileByReference } = require('../utils/reconcilePayment');

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
              users.email AS student_email,
              owner.paystack_subaccount_code
       FROM bookings
       JOIN room_types ON bookings.room_type_id = room_types.id
       JOIN listings ON bookings.listing_id = listings.id
       JOIN users ON bookings.student_id = users.id
       JOIN users AS owner ON listings.owner_id = owner.id
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
      subaccountCode: booking.paystack_subaccount_code || undefined,
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

    const result = await reconcileByReference(event.data.reference);
    if (result.status !== 'newly_paid' && result.status !== 'already_paid') {
      console.warn(`Webhook for reference "${event.data.reference}" did not result in a paid booking: ${result.status}`);
    }
  } catch (err) {
    console.error('Error processing Paystack webhook:', err);
  }
});

// GET /api/payments/status/:bookingId — lets the frontend poll after
// returning from Paystack's checkout. Rather than only reading whatever's
// currently in the DB (which depends entirely on the webhook having already
// landed — not guaranteed, e.g. if it's misconfigured or slow), this
// actively re-checks with Paystack itself first whenever the booking is
// still sitting as "pending", so the frontend gets the true status even if
// the webhook never arrives.
router.get('/status/:bookingId', requireRole('student'), async (req, res) => {
  try {
    const [[booking]] = await pool.query(
      'SELECT id, student_id, payment_status, paystack_reference FROM bookings WHERE id = ?',
      [req.params.bookingId]
    );

    if (!booking || booking.student_id !== req.session.user.id) {
      return res.status(404).json({ error: 'Booking not found.' });
    }

    if (booking.payment_status === 'pending' && booking.paystack_reference) {
      const result = await reconcileByReference(booking.paystack_reference);
      if (result.status === 'newly_paid' || result.status === 'already_paid') {
        return res.json({ payment_status: 'paid' });
      }
    }

    res.json({ payment_status: booking.payment_status });
  } catch (err) {
    console.error('Error checking payment status:', err);
    res.status(500).json({ error: 'Could not check payment status.' });
  }
});

module.exports = router;
