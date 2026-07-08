// database/reset_bookings.js — wipes every booking (and therefore every
// payment record) and restores every room type's availability back to its
// full total. Use this to clear out test data, like the falsely-marked-paid
// booking from testing, so the admin dashboard reflects only real activity.
//
// This does NOT touch users, listings, reviews, or favorites, only bookings
// and the availability counts derived from them.
//
// This is destructive and cannot be undone. Run with:
// node database/reset_bookings.js
require('dotenv').config();
const pool = require('../db');

async function reset() {
  const [[{ count }]] = await pool.query('SELECT COUNT(*) AS count FROM bookings');
  console.log(`About to delete ${count} booking(s) and reset all room availability.`);

  await pool.query('DELETE FROM bookings');
  console.log('All bookings deleted.');

  const [result] = await pool.query('UPDATE room_types SET available_quantity = total_quantity');
  console.log(`Restored availability on ${result.affectedRows} room type row(s) to their full total.`);

  console.log('\nDone. The admin dashboard should now show 0 bookings and GH₵0 revenue.');
  process.exit(0);
}

reset().catch((err) => {
  console.error(err);
  process.exit(1);
});
