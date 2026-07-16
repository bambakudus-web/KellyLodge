// database/add_room_numbers.js — adds structured, student-facing room
// numbers (e.g. "A001") instead of just a bare quantity count.
//
// New:
//   - `rooms` table: one row per physical room unit under a room_type,
//     each with a unique number and an available/occupied status.
//   - `room_types.prefix`: the stable letter (A, B, C...) used in that
//     room type's numbers, assigned once and reused on every future edit
//     so numbering never shifts around under an existing listing.
//   - `bookings.room_id`: which physical room a paid booking landed on.
//     Stays NULL for pending bookings (nothing's assigned until payment
//     actually clears) and for bookings that were already paid before
//     this migration ran, there's no way to know retroactively which of a
//     room type's units was "theirs", only future payments get a real
//     room assigned.
//
// Safe to run more than once — every step checks what's already there
// before doing anything.
// Run with: node database/add_room_numbers.js
require('dotenv').config();
const pool = require('../db');

async function columnExists(table, column) {
  const [rows] = await pool.query(
    `SELECT COUNT(*) AS cnt FROM information_schema.columns
     WHERE table_schema = DATABASE() AND table_name = ? AND column_name = ?`,
    [table, column]
  );
  return rows[0].cnt > 0;
}

async function migrate() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS rooms (
      id INT AUTO_INCREMENT PRIMARY KEY,
      room_type_id INT NOT NULL,
      room_number VARCHAR(20) NOT NULL,
      status ENUM('available', 'occupied') NOT NULL DEFAULT 'available',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (room_type_id) REFERENCES room_types(id) ON DELETE CASCADE,
      UNIQUE KEY uniq_room_number (room_type_id, room_number)
    )
  `);
  console.log('OK: rooms table ready');

  try {
    await pool.query('CREATE INDEX idx_rooms_type_status ON rooms (room_type_id, status)');
  } catch (err) {
    if (err.code !== 'ER_DUP_KEYNAME') console.error(err.message);
  }

  if (!(await columnExists('room_types', 'prefix'))) {
    await pool.query('ALTER TABLE room_types ADD COLUMN prefix CHAR(1) NULL AFTER room_type');
    console.log('OK: room_types.prefix added');
  } else {
    console.log('Skipped (already exists): room_types.prefix');
  }

  if (!(await columnExists('bookings', 'room_id'))) {
    await pool.query('ALTER TABLE bookings ADD COLUMN room_id INT NULL AFTER room_type_id');
    await pool.query('ALTER TABLE bookings ADD FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE SET NULL');
    console.log('OK: bookings.room_id added');
  } else {
    console.log('Skipped (already exists): bookings.room_id');
  }

  // Backfill: give every existing room_type a stable prefix, and generate
  // its `total_quantity` room rows if it doesn't have any yet. As many
  // rows as are currently booked (total_quantity - available_quantity)
  // get marked 'occupied' so the counts line up, arbitrarily which ones,
  // since there's no historical record of which unit was whose.
  const [listings] = await pool.query('SELECT id FROM listings');
  for (const listing of listings) {
    const [roomTypes] = await pool.query(
      'SELECT id, total_quantity, available_quantity, prefix FROM room_types WHERE listing_id = ? ORDER BY id ASC',
      [listing.id]
    );

    const usedPrefixes = new Set(roomTypes.map((rt) => rt.prefix).filter(Boolean));
    let letterCode = 'A'.charCodeAt(0);

    for (const rt of roomTypes) {
      let prefix = rt.prefix;
      if (!prefix) {
        let letter = String.fromCharCode(letterCode);
        while (usedPrefixes.has(letter)) {
          letterCode += 1;
          letter = String.fromCharCode(letterCode);
        }
        prefix = letter;
        usedPrefixes.add(prefix);
        await pool.query('UPDATE room_types SET prefix = ? WHERE id = ?', [prefix, rt.id]);
      }

      const [[{ cnt }]] = await pool.query('SELECT COUNT(*) AS cnt FROM rooms WHERE room_type_id = ?', [rt.id]);
      if (cnt > 0) continue; // already backfilled on a previous run

      const occupiedCount = Math.max(0, rt.total_quantity - rt.available_quantity);
      const roomRows = [];
      for (let i = 1; i <= rt.total_quantity; i++) {
        const status = i <= occupiedCount ? 'occupied' : 'available';
        roomRows.push([rt.id, `${prefix}${String(i).padStart(3, '0')}`, status]);
      }
      if (roomRows.length > 0) {
        await pool.query('INSERT INTO rooms (room_type_id, room_number, status) VALUES ?', [roomRows]);
        console.log(`Generated ${roomRows.length} room(s) for room_type ${rt.id} (listing ${listing.id}), prefix "${prefix}"`);
      }
    }
  }

  console.log('Migration complete.');
  process.exit(0);
}

migrate().catch((err) => {
  console.error(err);
  process.exit(1);
});
