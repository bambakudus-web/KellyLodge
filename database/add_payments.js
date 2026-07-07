// database/add_payments.js — adds Paystack payment tracking to bookings.
// A booking now holds the room for 72 hours pending payment; if payment
// isn't confirmed by the deadline, a background job (see server.js)
// cancels it and restores the room's availability.
// Safe to run more than once.
// Run with: node database/add_payments.js
require('dotenv').config();
const pool = require('../db');

async function columnExists(table, column) {
  const [rows] = await pool.query(`SHOW COLUMNS FROM ${table} LIKE ?`, [column]);
  return rows.length > 0;
}

async function migrate() {
  if (!(await columnExists('bookings', 'payment_status'))) {
    await pool.query(
      "ALTER TABLE bookings ADD COLUMN payment_status ENUM('pending', 'paid', 'expired', 'cancelled') NOT NULL DEFAULT 'pending'"
    );
    console.log('Added bookings.payment_status');
  } else {
    console.log('bookings.payment_status already exists');
  }

  if (!(await columnExists('bookings', 'payment_deadline'))) {
    await pool.query('ALTER TABLE bookings ADD COLUMN payment_deadline DATETIME NULL');
    console.log('Added bookings.payment_deadline');
  } else {
    console.log('bookings.payment_deadline already exists');
  }

  if (!(await columnExists('bookings', 'paystack_reference'))) {
    await pool.query('ALTER TABLE bookings ADD COLUMN paystack_reference VARCHAR(100) NULL UNIQUE');
    console.log('Added bookings.paystack_reference');
  } else {
    console.log('bookings.paystack_reference already exists');
  }

  if (!(await columnExists('bookings', 'paid_at'))) {
    await pool.query('ALTER TABLE bookings ADD COLUMN paid_at DATETIME NULL');
    console.log('Added bookings.paid_at');
  } else {
    console.log('bookings.paid_at already exists');
  }

  // Existing bookings made before this migration are treated as already
  // settled (there was no payment step yet), so they aren't retroactively
  // put on a payment countdown.
  const [result] = await pool.query(
    "UPDATE bookings SET payment_status = 'paid', paid_at = created_at WHERE payment_status = 'pending' AND paystack_reference IS NULL AND created_at < NOW()"
  );
  console.log(`Marked ${result.affectedRows} pre-existing booking(s) as already paid (grandfathered).`);

  console.log('Done.');
  process.exit(0);
}

migrate().catch((err) => {
  console.error(err);
  process.exit(1);
});
