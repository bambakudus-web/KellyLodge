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
    `SELECT bookings.id, bookings.payment_status, bookings.room_type_id, bookings.student_id, bookings.listing_id,
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

  // A specific physical room (e.g. "A001") only ever gets handed to a
  // student once they've actually paid, not at the initial 72-hour hold —
  // a pending, possibly-never-completed booking shouldn't tie up a
  // numbered unit. The status flip and the room assignment happen in one
  // transaction so nothing can observe "paid" without a room attempt
  // having already happened, and so two concurrent reconcile calls can't
  // both grab the same room.
  let assignedRoomNumber = null;
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    const [updateResult] = await connection.query(
      "UPDATE bookings SET payment_status = 'paid', paid_at = NOW() WHERE id = ? AND payment_status = 'pending'",
      [booking.id]
    );

    if (updateResult.affectedRows === 0) {
      // A concurrent reconcile call (webhook + page load landing at the
      // same moment, say) already flipped it, nothing left to do here.
      await connection.rollback();
      return { status: 'already_paid', booking };
    }

    const [[room]] = await connection.query(
      `SELECT id, room_number FROM rooms
       WHERE room_type_id = ? AND status = 'available'
       ORDER BY CAST(SUBSTRING(room_number, 2) AS UNSIGNED) ASC
       LIMIT 1 FOR UPDATE`,
      [booking.room_type_id]
    );

    if (room) {
      await connection.query("UPDATE rooms SET status = 'occupied' WHERE id = ?", [room.id]);
      await connection.query('UPDATE bookings SET room_id = ? WHERE id = ?', [room.id, booking.id]);
      assignedRoomNumber = room.room_number;
    } else {
      // Shouldn't normally happen (the room_types.available_quantity check
      // at booking time already gated this), but a numbering gap is never
      // a reason to fail a real, verified payment, it just won't have a
      // room number attached until a hoster sorts it out.
      console.warn(
        `No available numbered room for room_type_id ${booking.room_type_id} on booking #${booking.id}, payment recorded without a room assignment.`
      );
    }

    // A permanent record that this student genuinely paid for and stayed
    // at this listing, kept independent of the booking row itself. Review
    // eligibility checks this table, not the bookings table, specifically
    // so that a booking being deleted later (a hoster clearing out an old
    // paid booking, an expired one being swept) can never take away a
    // review someone has already earned the right to leave.
    await connection.query(
      'INSERT IGNORE INTO completed_stays (student_id, listing_id) VALUES (?, ?)',
      [booking.student_id, booking.listing_id]
    );

    await connection.commit();
  } catch (err) {
    await connection.rollback();
    console.error(`Error finalizing payment for booking #${booking.id}:`, err);
    return { status: 'update_failed' };
  } finally {
    connection.release();
  }

  console.log(
    `Booking #${booking.id} confirmed paid (reference: ${reference}, verified amount: ${verified.amount}, room: ${assignedRoomNumber || 'unassigned'}).`
  );

  sendPaymentConfirmationEmailToStudent({
    toEmail: booking.student_email,
    toName: booking.student_name,
    listingTitle: booking.listing_title,
    roomNumber: assignedRoomNumber,
  });
  sendPaymentConfirmationEmailToOwner({
    toEmail: booking.owner_email,
    toName: booking.owner_name,
    studentName: booking.student_name,
    listingTitle: booking.listing_title,
    roomType: booking.room_type,
    price: booking.price,
    roomNumber: assignedRoomNumber,
  });
  sendPaymentConfirmationSMSToStudent({
    studentPhone: booking.student_phone,
    listingTitle: booking.listing_title,
    roomNumber: assignedRoomNumber,
  });
  sendPaymentConfirmationSMSToOwner({
    ownerPhone: booking.owner_phone,
    studentName: booking.student_name,
    listingTitle: booking.listing_title,
    roomNumber: assignedRoomNumber,
  });

  return { status: 'newly_paid', booking, roomNumber: assignedRoomNumber };
}

module.exports = { reconcileByReference };
