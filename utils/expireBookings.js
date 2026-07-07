// utils/expireBookings.js — finds bookings whose 72-hour payment window has
// passed without payment, cancels them, and restores the room's availability.
// Run on a timer from server.js.
const pool = require('../db');
const { sendBookingExpiredEmail } = require('./email');
const { sendBookingExpiredSMSToStudent } = require('./sms');

async function expirePendingBookings() {
  const [expired] = await pool.query(
    `SELECT bookings.id, bookings.room_type_id, listings.title AS listing_title,
            users.name AS student_name, users.email AS student_email, users.phone AS student_phone
     FROM bookings
     JOIN listings ON bookings.listing_id = listings.id
     JOIN users ON bookings.student_id = users.id
     WHERE bookings.payment_status = 'pending' AND bookings.payment_deadline < NOW()`
  );

  for (const booking of expired) {
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();

      // Re-check status inside the transaction in case the webhook confirmed
      // payment in the moment between the SELECT above and now.
      const [[current]] = await connection.query(
        "SELECT payment_status FROM bookings WHERE id = ? FOR UPDATE",
        [booking.id]
      );
      if (!current || current.payment_status !== 'pending') {
        await connection.rollback();
        continue;
      }

      await connection.query(
        `UPDATE room_types SET available_quantity = LEAST(available_quantity + 1, total_quantity) WHERE id = ?`,
        [booking.room_type_id]
      );
      await connection.query("UPDATE bookings SET payment_status = 'expired' WHERE id = ?", [booking.id]);

      await connection.commit();

      sendBookingExpiredEmail({
        toEmail: booking.student_email,
        toName: booking.student_name,
        listingTitle: booking.listing_title,
      });
      sendBookingExpiredSMSToStudent({
        studentPhone: booking.student_phone,
        listingTitle: booking.listing_title,
      });

      console.log(`Expired unpaid booking #${booking.id} (${booking.listing_title}) and restored availability.`);
    } catch (err) {
      await connection.rollback();
      console.error(`Error expiring booking #${booking.id}:`, err);
    } finally {
      connection.release();
    }
  }
}

module.exports = { expirePendingBookings };
