// database/init_schema.js — creates the full, CURRENT KellyLodge schema
// from scratch: all 11 tables, exactly as they exist after every migration
// in database/ has been applied.
//
// This file was regenerated from a real database: every migration was run
// in order against an empty database, and the resulting tables were read
// back with SHOW CREATE TABLE, that's what's reproduced below. It isn't
// hand-maintained from memory, which is exactly how the previous version
// of this file drifted out of date in the first place (it only ever
// covered the original 4 tables — users, listings, room_types, bookings —
// and never got updated as payments, messaging, reviews, favorites, photo
// galleries, and room numbers were added incrementally over time).
//
// Unlike schema.sql, this does NOT run CREATE DATABASE / USE — it creates
// tables inside whatever database DATABASE_URL (or DB_NAME) already points
// to, which is what you want on Railway (the database is already selected
// and is usually named something like "railway", not "kellylodge").
//
// Safe to run more than once — every statement is idempotent.
//
// This replaces needing to know the right order to run ~10 separate
// add_*.js migration files by hand on a brand new database. Those files
// still exist and are still safe to run (each one only acts if its
// column/table isn't already there), they're just no longer the only way
// to get a fresh database to the current schema.
//
// Run with: node database/init_schema.js
require('dotenv').config();
const pool = require('../db');

async function createIndexSafely(sql) {
  try {
    await pool.query(sql);
    console.log('OK:', sql);
  } catch (err) {
    if (err.code === 'ER_DUP_KEYNAME') {
      console.log('Skipped (already exists):', sql);
    } else {
      throw err;
    }
  }
}

async function init() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id INT AUTO_INCREMENT PRIMARY KEY,
      name VARCHAR(100) NOT NULL,
      email VARCHAR(150) NOT NULL UNIQUE,
      password_hash VARCHAR(255) NOT NULL,
      phone VARCHAR(20) NOT NULL,
      role ENUM('student', 'hoster', 'admin') NOT NULL DEFAULT 'student',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      email_verified BOOLEAN NOT NULL DEFAULT FALSE,
      verification_token VARCHAR(255) NULL,
      reset_token VARCHAR(255) NULL,
      reset_token_expires DATETIME NULL,
      paystack_subaccount_code VARCHAR(100) NULL,
      bank_name VARCHAR(100) NULL,
      bank_code VARCHAR(20) NULL,
      bank_account_number VARCHAR(50) NULL,
      bank_account_name VARCHAR(150) NULL
    )
  `);
  console.log('OK: users table ready');

  await pool.query(`
    CREATE TABLE IF NOT EXISTS listings (
      id INT AUTO_INCREMENT PRIMARY KEY,
      title VARCHAR(150) NOT NULL,
      description TEXT,
      area VARCHAR(50) NOT NULL,
      price DECIMAL(10, 2) NOT NULL,
      room_type VARCHAR(50) NOT NULL,
      owner_id INT NOT NULL,
      image_url VARCHAR(500),
      status ENUM('active', 'removed') NOT NULL DEFAULT 'active',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      views INT NOT NULL DEFAULT 0,
      distance_minutes INT NULL,
      image_public_id VARCHAR(255) NULL,
      FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);
  console.log('OK: listings table ready');
  await createIndexSafely('CREATE INDEX idx_area_price ON listings (area, price)');
  await createIndexSafely('CREATE INDEX idx_owner ON listings (owner_id)');

  await pool.query(`
    CREATE TABLE IF NOT EXISTS room_types (
      id INT AUTO_INCREMENT PRIMARY KEY,
      listing_id INT NOT NULL,
      room_type VARCHAR(50) NOT NULL,
      prefix CHAR(1) NULL,
      price DECIMAL(10, 2) NOT NULL,
      total_quantity INT NOT NULL DEFAULT 1,
      available_quantity INT NOT NULL DEFAULT 1,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (listing_id) REFERENCES listings(id) ON DELETE CASCADE
    )
  `);
  console.log('OK: room_types table ready');
  await createIndexSafely('CREATE INDEX idx_roomtype_listing ON room_types (listing_id)');

  // One row per physical room unit (e.g. "A001"). A specific room only
  // ever gets assigned to a booking once payment actually clears, see
  // utils/reconcilePayment.js.
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
  await createIndexSafely('CREATE INDEX idx_rooms_type_status ON rooms (room_type_id, status)');

  await pool.query(`
    CREATE TABLE IF NOT EXISTS bookings (
      id INT AUTO_INCREMENT PRIMARY KEY,
      room_type_id INT NOT NULL,
      room_id INT NULL,
      listing_id INT NOT NULL,
      student_id INT NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      payment_status ENUM('pending', 'paid', 'expired', 'cancelled') NOT NULL DEFAULT 'pending',
      payment_deadline DATETIME NULL,
      paystack_reference VARCHAR(100) NULL UNIQUE,
      paid_at DATETIME NULL,
      FOREIGN KEY (room_type_id) REFERENCES room_types(id) ON DELETE CASCADE,
      FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE SET NULL,
      FOREIGN KEY (listing_id) REFERENCES listings(id) ON DELETE CASCADE,
      FOREIGN KEY (student_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);
  console.log('OK: bookings table ready');
  await createIndexSafely('CREATE INDEX idx_booking_student ON bookings (student_id)');

  await pool.query(`
    CREATE TABLE IF NOT EXISTS listing_photos (
      id INT AUTO_INCREMENT PRIMARY KEY,
      listing_id INT NOT NULL,
      image_url VARCHAR(500) NOT NULL,
      sort_order INT NOT NULL DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      public_id VARCHAR(255) NULL,
      FOREIGN KEY (listing_id) REFERENCES listings(id) ON DELETE CASCADE
    )
  `);
  console.log('OK: listing_photos table ready');
  await createIndexSafely('CREATE INDEX idx_photos_listing ON listing_photos (listing_id)');

  await pool.query(`
    CREATE TABLE IF NOT EXISTS reviews (
      id INT AUTO_INCREMENT PRIMARY KEY,
      listing_id INT NOT NULL,
      student_id INT NOT NULL,
      rating TINYINT NOT NULL,
      comment TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (listing_id) REFERENCES listings(id) ON DELETE CASCADE,
      FOREIGN KEY (student_id) REFERENCES users(id) ON DELETE CASCADE,
      UNIQUE KEY uniq_review_per_student (listing_id, student_id)
    )
  `);
  console.log('OK: reviews table ready');
  await createIndexSafely('CREATE INDEX idx_reviews_listing ON reviews (listing_id)');

  await pool.query(`
    CREATE TABLE IF NOT EXISTS favorites (
      id INT AUTO_INCREMENT PRIMARY KEY,
      student_id INT NOT NULL,
      listing_id INT NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (student_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (listing_id) REFERENCES listings(id) ON DELETE CASCADE,
      UNIQUE KEY uniq_favorite (student_id, listing_id)
    )
  `);
  console.log('OK: favorites table ready');

  await pool.query(`
    CREATE TABLE IF NOT EXISTS conversations (
      id INT AUTO_INCREMENT PRIMARY KEY,
      listing_id INT NOT NULL,
      student_id INT NOT NULL,
      hoster_id INT NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      last_message_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (listing_id) REFERENCES listings(id) ON DELETE CASCADE,
      FOREIGN KEY (student_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (hoster_id) REFERENCES users(id) ON DELETE CASCADE,
      UNIQUE KEY uniq_conversation (listing_id, student_id)
    )
  `);
  console.log('OK: conversations table ready');
  await createIndexSafely('CREATE INDEX idx_conv_student ON conversations (student_id, last_message_at)');
  await createIndexSafely('CREATE INDEX idx_conv_hoster ON conversations (hoster_id, last_message_at)');

  await pool.query(`
    CREATE TABLE IF NOT EXISTS messages (
      id INT AUTO_INCREMENT PRIMARY KEY,
      conversation_id INT NOT NULL,
      sender_id INT NOT NULL,
      body TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      read_at TIMESTAMP NULL,
      FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE,
      FOREIGN KEY (sender_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);
  console.log('OK: messages table ready');
  await createIndexSafely('CREATE INDEX idx_messages_conversation ON messages (conversation_id, created_at)');

  // A permanent "this student really did pay and stay here" record, kept
  // independent of the bookings table so that review eligibility survives
  // a booking row being deleted later. See utils/reconcilePayment.js
  // (where this gets written) and routes/reviews.js (where it's read).
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

  console.log('Schema initialized.');
  process.exit(0);
}

init().catch((err) => {
  console.error(err);
  process.exit(1);
});
