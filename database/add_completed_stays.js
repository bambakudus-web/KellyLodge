// database/add_completed_stays.js — a permanent record of "this student
// really did pay for and stay at this listing", kept independent of the
// bookings table itself.
//
// Why this exists: review eligibility used to be checked directly against
// the bookings table, which had two problems — (1) it didn't actually
// require payment, a booking that was made but never paid for was enough
// to leave a review, and (2) a booking can legitimately get deleted later
// (a hoster clearing out an old paid booking, an expired one being swept
// automatically), which would silently take away a review someone had
// already earned the right to leave. completed_stays is written once, at
// the moment a booking is confirmed paid (see utils/reconcilePayment.js),
// and is never touched by anything that happens to the booking afterward.
//
// Safe to run more than once.
// Run with: node database/add_completed_stays.js
require('dotenv').config();
const pool = require('../db');

async function migrate() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS completed_stays (
      id INT AUTO_INCREMENT PRIMARY KEY,
      student_id INT NOT NULL,
      listing_id INT NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (student_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (listing_id) REFERENCES listings(id) ON DELETE CASCADE,
      UNIQUE KEY uniq_stay (student_id, listing_id)
    )
  `);
  console.log('OK: completed_stays table ready');

  // Backfill from every booking that's already paid right now, so students
  // who paid before this migration existed don't lose review eligibility.
  const [existingPaid] = await pool.query(
    "SELECT DISTINCT student_id, listing_id FROM bookings WHERE payment_status = 'paid'"
  );

  if (existingPaid.length > 0) {
    const rows = existingPaid.map((b) => [b.student_id, b.listing_id]);
    await pool.query('INSERT IGNORE INTO completed_stays (student_id, listing_id) VALUES ?', [rows]);
    console.log(`Backfilled ${rows.length} completed stay(s) from existing paid bookings.`);
  } else {
    console.log('No existing paid bookings to backfill.');
  }

  console.log('Migration complete.');
  process.exit(0);
}

migrate().catch((err) => {
  console.error(err);
  process.exit(1);
});
