// database/fix_room_availability.js — recalculates available_quantity for
// every room type from scratch, based on what's actually booked right now.
// This repairs any drift left over from earlier testing/bugs, regardless of
// what originally caused it, since it doesn't trust the stored number at
// all, it derives the correct number directly from real booking rows.
//
// A room type's true available_quantity = total_quantity minus however many
// bookings currently exist against it with payment_status 'pending' or
// 'paid' (an 'expired' booking already had its slot restored, and a
// cancelled booking is deleted entirely, so neither should count against it).
//
// Safe to run more than once, and safe to run on a database with no drift
// at all (it'll just confirm everything already matches).
// Run with: node database/fix_room_availability.js
require('dotenv').config();
const pool = require('../db');

async function fix() {
  const [roomTypes] = await pool.query('SELECT id, room_type, total_quantity, available_quantity FROM room_types');

  let correctedCount = 0;

  for (const rt of roomTypes) {
    const [[{ heldCount }]] = await pool.query(
      "SELECT COUNT(*) AS heldCount FROM bookings WHERE room_type_id = ? AND payment_status IN ('pending', 'paid')",
      [rt.id]
    );

    const correctAvailable = Math.max(0, Math.min(rt.total_quantity, rt.total_quantity - heldCount));

    if (correctAvailable !== rt.available_quantity) {
      await pool.query('UPDATE room_types SET available_quantity = ? WHERE id = ?', [correctAvailable, rt.id]);
      console.log(
        `Fixed room_type #${rt.id} (${rt.room_type}): was ${rt.available_quantity}, now ${correctAvailable} ` +
        `(${rt.total_quantity} total, ${heldCount} currently held)`
      );
      correctedCount += 1;
    }
  }

  console.log(`\nChecked ${roomTypes.length} room type(s), corrected ${correctedCount}.`);
  process.exit(0);
}

fix().catch((err) => {
  console.error(err);
  process.exit(1);
});
