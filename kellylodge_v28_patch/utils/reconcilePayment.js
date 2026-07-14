// utils/reconcilePayment.js — the ONE place that marks a booking paid.
// Used by three different triggers (webhook, callback-page status poll,
// and My Bookings loading) so that no matter which one fires first, the
// same safety checks (independent Paystack verification, amount match,
// idempotent update) always apply.
const pool = require('../db');
const { verifyTransaction } = require('./paystack');
const {
  sendPaymentConfirmationEmailToStudent,
  sendPaymentConfirmationEmailToOwner,
} = require('./email');
const {
  sendPaymentConfirmationSMSToStudent,
  sendPaymentConfirmationSMSToOwner,
} = require('./sms');

// Given a Paystack reference, independently verifies it with Paystack and,
// if genuinely successful and the amount matches, marks the booking paid.
// Safe to call repeatedly (e.g. once from the webhook AND once from a page
// load) — the UPDATE only ever fires once thanks to the payment_status
// check, so notifications only ever go out once too.
async function reconcileByReference(reference) {
  if (!reference) return { status: 'no_reference' };

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

  if (!booking) return { status: 'unknown_reference' };
  if (booking.payment_status === 'paid') return { status: 'already_paid', booking };

  let verified;
  try {
    verified = await verifyTransaction(reference);
  } catch (err) {
    console.warn(`Could not verify reference "${reference}" with Paystack:`, err.message);
    return { status: 'verify_failed' };
  }

  if (!verified || verified.status !== 'success') {
    return { status: 'not_successful', paystackStatus: verified?.status };
  }

  const expectedAmountKobo = Math.round(Number(booking.price) * 100);
  if (verified.amount !== expectedAmountKobo) {
    console.warn(
      `Reference "${reference}" paid amount (${verified.amount}) does not match booking #${booking.id}'s expected amount (${expectedAmountKobo}), refusing to mark it paid.`
    );
    return { status: 'amount_mismatch' };
  }

  // Idempotent: only the request that actually flips pending -> paid sends notifications.
  const [updateResult] = await pool.query(
    "UPDATE bookings SET payment_status = 'paid', paid_at = NOW() WHERE id = ? AND payment_status = 'pending'",
    [booking.id]
  );
  if (updateResult.affectedRows === 0) return { status: 'already_paid', booking };

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

  return { status: 'newly_paid', booking };
}

module.exports = { reconcileByReference };
