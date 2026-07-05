// database/init_schema.js — creates the full KellyLodge schema from scratch.
// Unlike schema.sql, this does NOT run CREATE DATABASE / USE — it creates
// tables inside whatever database DATABASE_URL (or DB_NAME) already points
// to, which is what you want on Railway (the database is already selected
// and is usually named something like "railway", not "kellylodge").
// Safe to run more than once — every statement is idempotent.
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
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
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
      price DECIMAL(10, 2) NOT NULL,
      total_quantity INT NOT NULL DEFAULT 1,
      available_quantity INT NOT NULL DEFAULT 1,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (listing_id) REFERENCES listings(id) ON DELETE CASCADE
    )
  `);
  console.log('OK: room_types table ready');

  await createIndexSafely('CREATE INDEX idx_roomtype_listing ON room_types (listing_id)');

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

  await createIndexSafely('CREATE INDEX idx_booking_student ON bookings (student_id)');

  console.log('Schema initialized.');
  process.exit(0);
}

init().catch((err) => {
  console.error(err);
  process.exit(1);
});
