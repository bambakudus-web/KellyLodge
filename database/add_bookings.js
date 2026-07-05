// database/add_bookings.js — one-time migration: adds rooms + bookings tables
// to an existing KellyLodge database without touching users/listings data.
// Run with: node database/add_bookings.js
require('dotenv').config();
const pool = require('../db');

const statements = [
  `CREATE TABLE IF NOT EXISTS rooms (
    id INT AUTO_INCREMENT PRIMARY KEY,
    listing_id INT NOT NULL,
    room_label VARCHAR(50) NOT NULL,
    capacity INT NOT NULL DEFAULT 1,
    status ENUM('available', 'booked') NOT NULL DEFAULT 'available',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (listing_id) REFERENCES listings(id) ON DELETE CASCADE
  )`,
  `CREATE TABLE IF NOT EXISTS bookings (
    id INT AUTO_INCREMENT PRIMARY KEY,
    room_id INT NOT NULL,
    listing_id INT NOT NULL,
    student_id INT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE,
    FOREIGN KEY (listing_id) REFERENCES listings(id) ON DELETE CASCADE,
    FOREIGN KEY (student_id) REFERENCES users(id) ON DELETE CASCADE
  )`,
  `CREATE INDEX idx_room_listing ON rooms (listing_id)`,
  `CREATE INDEX idx_room_status ON rooms (status)`,
  `CREATE INDEX idx_booking_student ON bookings (student_id)`,
];

async function migrate() {
  for (const sql of statements) {
    try {
      await pool.query(sql);
      console.log('OK:', sql.split('\n')[0]);
    } catch (err) {
      if (err.code === 'ER_DUP_KEYNAME') {
        console.log('Skipped (already exists):', sql.split('\n')[0]);
      } else {
        console.error('Failed:', sql.split('\n')[0], err.message);
      }
    }
  }

  // Backfill: give every existing listing at least one room so nothing
  // becomes unbookable just because it predates this migration.
  const [listings] = await pool.query('SELECT id FROM listings');
  for (const listing of listings) {
    const [existing] = await pool.query('SELECT id FROM rooms WHERE listing_id = ?', [listing.id]);
    if (existing.length === 0) {
      await pool.query(
        `INSERT INTO rooms (listing_id, room_label, capacity, status) VALUES (?, 'Room 1', 1, 'available')`,
        [listing.id]
      );
      console.log(`Backfilled Room 1 for listing ${listing.id}`);
    }
  }

  console.log('Migration complete.');
  process.exit(0);
}

migrate().catch((err) => {
  console.error(err);
  process.exit(1);
});
