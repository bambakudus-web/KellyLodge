// database/add_v2_features.js — adds photo galleries, reviews, favorites,
// view counts, and walking-distance-from-campus to the schema.
// Safe to run more than once.
// Run with: node database/add_v2_features.js
require('dotenv').config();
const pool = require('../db');

async function columnExists(table, column) {
  const [rows] = await pool.query(`SHOW COLUMNS FROM ${table} LIKE ?`, [column]);
  return rows.length > 0;
}

async function migrate() {
  // --- listings: view counter + walking distance from campus ---
  if (!(await columnExists('listings', 'views'))) {
    await pool.query('ALTER TABLE listings ADD COLUMN views INT NOT NULL DEFAULT 0');
    console.log('Added listings.views');
  } else {
    console.log('listings.views already exists');
  }

  if (!(await columnExists('listings', 'distance_minutes'))) {
    await pool.query('ALTER TABLE listings ADD COLUMN distance_minutes INT NULL');
    console.log('Added listings.distance_minutes');
  } else {
    console.log('listings.distance_minutes already exists');
  }

  // --- listing_photos: extra photos beyond the cover image ---
  await pool.query(`
    CREATE TABLE IF NOT EXISTS listing_photos (
      id INT AUTO_INCREMENT PRIMARY KEY,
      listing_id INT NOT NULL,
      image_url VARCHAR(500) NOT NULL,
      sort_order INT NOT NULL DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (listing_id) REFERENCES listings(id) ON DELETE CASCADE
    )
  `);
  console.log('OK: listing_photos table ready');

  try {
    await pool.query('CREATE INDEX idx_photos_listing ON listing_photos (listing_id)');
    console.log('OK: idx_photos_listing');
  } catch (err) {
    if (err.code === 'ER_DUP_KEYNAME') console.log('Skipped (already exists): idx_photos_listing');
    else throw err;
  }

  // Backfill: every listing that already has a single image_url gets that
  // photo copied into listing_photos too, so the new gallery isn't empty
  // for hostels posted before this migration.
  const [backfillResult] = await pool.query(`
    INSERT INTO listing_photos (listing_id, image_url, sort_order)
    SELECT l.id, l.image_url, 0
    FROM listings l
    WHERE l.image_url IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM listing_photos lp WHERE lp.listing_id = l.id)
  `);
  console.log(`Backfilled ${backfillResult.affectedRows} existing cover photo(s) into listing_photos.`);

  // --- reviews: one review per student per listing, only after a booking ---
  await pool.query(`
    CREATE TABLE IF NOT EXISTS reviews (
      id INT AUTO_INCREMENT PRIMARY KEY,
      listing_id INT NOT NULL,
      student_id INT NOT NULL,
      rating TINYINT NOT NULL,
      comment TEXT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (listing_id) REFERENCES listings(id) ON DELETE CASCADE,
      FOREIGN KEY (student_id) REFERENCES users(id) ON DELETE CASCADE,
      UNIQUE KEY uniq_review_per_student (listing_id, student_id)
    )
  `);
  console.log('OK: reviews table ready');

  try {
    await pool.query('CREATE INDEX idx_reviews_listing ON reviews (listing_id)');
    console.log('OK: idx_reviews_listing');
  } catch (err) {
    if (err.code === 'ER_DUP_KEYNAME') console.log('Skipped (already exists): idx_reviews_listing');
    else throw err;
  }

  // --- favorites: a student's shortlist ---
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

  console.log('Done.');
  process.exit(0);
}

migrate().catch((err) => {
  console.error(err);
  process.exit(1);
});
