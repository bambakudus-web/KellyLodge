// database/add_cloudinary_fields.js — adds columns to store each photo's
// Cloudinary public_id, needed to actually delete an image from Cloudinary
// later (the URL alone isn't enough for that).
// Safe to run more than once.
// Run with: node database/add_cloudinary_fields.js
require('dotenv').config();
const pool = require('../db');

async function columnExists(table, column) {
  const [rows] = await pool.query(`SHOW COLUMNS FROM ${table} LIKE ?`, [column]);
  return rows.length > 0;
}

async function migrate() {
  if (!(await columnExists('listing_photos', 'public_id'))) {
    await pool.query('ALTER TABLE listing_photos ADD COLUMN public_id VARCHAR(255) NULL');
    console.log('Added listing_photos.public_id');
  } else {
    console.log('listing_photos.public_id already exists');
  }

  if (!(await columnExists('listings', 'image_public_id'))) {
    await pool.query('ALTER TABLE listings ADD COLUMN image_public_id VARCHAR(255) NULL');
    console.log('Added listings.image_public_id');
  } else {
    console.log('listings.image_public_id already exists');
  }

  console.log('Done.');
  process.exit(0);
}

migrate().catch((err) => {
  console.error(err);
  process.exit(1);
});
