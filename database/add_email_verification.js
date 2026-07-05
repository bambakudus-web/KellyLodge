// database/add_email_verification.js — adds email verification columns
// Run with: node database/add_email_verification.js
require('dotenv').config();
const pool = require('../db');

async function migrate() {
  const [cols] = await pool.query("SHOW COLUMNS FROM users LIKE 'email_verified'");
  if (cols.length === 0) {
    await pool.query('ALTER TABLE users ADD COLUMN email_verified BOOLEAN NOT NULL DEFAULT FALSE');
    console.log('Added email_verified column');
  } else {
    console.log('email_verified column already exists');
  }

  const [tokenCols] = await pool.query("SHOW COLUMNS FROM users LIKE 'verification_token'");
  if (tokenCols.length === 0) {
    await pool.query('ALTER TABLE users ADD COLUMN verification_token VARCHAR(255) NULL');
    console.log('Added verification_token column');
  } else {
    console.log('verification_token column already exists');
  }

  // Grandfather in everyone who already has an account so nobody gets locked out.
  const [result] = await pool.query('UPDATE users SET email_verified = TRUE WHERE email_verified = FALSE');
  console.log(`Marked ${result.affectedRows} existing user(s) as verified.`);

  console.log('Done.');
  process.exit(0);
}

migrate().catch((err) => {
  console.error(err);
  process.exit(1);
});
