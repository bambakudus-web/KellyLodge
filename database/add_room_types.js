// database/add_room_types.js — migrates to per-room-type inventory
// (e.g. 30 singles at GH₵3000, 80 doubles at GH₵1800) instead of one row
// per physical room. Safe to run whether or not you already ran
// add_bookings.js earlier — it detects and migrates the old `rooms` table
// if present, and backfills room_types for any listing missing them.
// Run with: node database/add_room_types.js
require('dotenv').config();
const pool = require('../db');

async function tableExists(name) {
  const [rows] = await pool.query(
    `SELECT COUNT(*) AS cnt FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = ?`,
    [name]
  );
  return rows[0].cnt > 0;
}

async function migrate() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS room_types (
      id INT AUTO_INCREMENT PRIMARY KEY,
      listing_id INT NOT NULL,
      room_type VARCHAR(50) NOT NULL,
      price DECIMAL(10, 2) NOT NULL,
      total_quantity INT NOT NULL DEFAULT 1,
      available_quantity INT NOT NULL DEFAULT 1,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (listing_id) REFERENCES listings(id) ON DELETE CASCADE
    )
  `);
  console.log('OK: room_types table ready');

  try {
    await pool.query('CREATE INDEX idx_roomtype_listing ON room_types (listing_id)');
  } catch (err) {
    if (err.code !== 'ER_DUP_KEYNAME') console.error(err.message);
  }

  const hadOldRooms = await tableExists('rooms');

  const [listings] = await pool.query('SELECT id, price, room_type FROM listings');
  for (const listing of listings) {
    const [existing] = await pool.query('SELECT id FROM room_types WHERE listing_id = ?', [listing.id]);
    if (existing.length > 0) continue;

    let totalQty = 1;
    let availableQty = 1;

    if (hadOldRooms) {
      const [oldRooms] = await pool.query('SELECT status FROM rooms WHERE listing_id = ?', [listing.id]);
      if (oldRooms.length > 0) {
        totalQty = oldRooms.length;
        availableQty = oldRooms.filter((r) => r.status === 'available').length;
      }
    }

    await pool.query(
      `INSERT INTO room_types (listing_id, room_type, price, total_quantity, available_quantity) VALUES (?, ?, ?, ?, ?)`,
      [listing.id, listing.room_type, listing.price, totalQty, availableQty]
    );
    console.log(`Backfilled room_types for listing ${listing.id}`);
  }

  const hadOldBookings = await tableExists('bookings');
  let oldBookingRows = [];
  if (hadOldBookings) {
    const [cols] = await pool.query(`SHOW COLUMNS FROM bookings LIKE 'room_id'`);
    if (cols.length > 0) {
      const [rows] = await pool.query('SELECT room_id, listing_id, student_id, created_at FROM bookings');
      oldBookingRows = rows;
      await pool.query('DROP TABLE bookings');
      console.log('Dropped legacy bookings table (rows kept in memory for re-mapping)');
    }
  }

  await pool.query(`
    CREATE TABLE IF NOT EXISTS bookings (
      id INT AUTO_INCREMENT PRIMARY KEY,
      room_type_id INT NOT NULL,
      listing_id INT NOT NULL,
      student_id INT NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (room_type_id) REFERENCES room_types(id) ON DELETE CASCADE,
      FOREIGN KEY (listing_id) REFERENCES listings(id) ON DELETE CASCADE,
      FOREIGN KEY (student_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);
  console.log('OK: bookings table ready');

  try {
    await pool.query('CREATE INDEX idx_booking_student ON bookings (student_id)');
  } catch (err) {
    if (err.code !== 'ER_DUP_KEYNAME') console.error(err.message);
  }

  for (const b of oldBookingRows) {
    const [rt] = await pool.query('SELECT id FROM room_types WHERE listing_id = ? LIMIT 1', [b.listing_id]);
    if (rt.length === 0) continue;
    await pool.query(
      'INSERT INTO bookings (room_type_id, listing_id, student_id, created_at) VALUES (?, ?, ?, ?)',
      [rt[0].id, b.listing_id, b.student_id, b.created_at]
    );
  }
  if (oldBookingRows.length > 0) console.log(`Re-mapped ${oldBookingRows.length} legacy booking(s)`);

  if (hadOldRooms) {
    await pool.query('DROP TABLE IF EXISTS rooms');
    console.log('Dropped legacy rooms table (folded into room_types quantities)');
  }

  console.log('Migration complete.');
  process.exit(0);
}

migrate().catch((err) => {
  console.error(err);
  process.exit(1);
});
