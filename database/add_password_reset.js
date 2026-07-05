// database/add_password_reset.js — adds password-reset columns to users
// Run with: node database/add_password_reset.js
require('dotenv').config();
const pool = require('../db');

async function migrate() {
  const [tokenCol] = await pool.query("SHOW COLUMNS FROM users LIKE 'reset_token'");
  if (tokenCol.length === 0) {
    await pool.query('ALTER TABLE users ADD COLUMN reset_token VARCHAR(255) NULL');
    console.log('Added reset_token column');
  } else {
    console.log('reset_token column already exists');
  }

  const [expiresCol] = await pool.query("SHOW COLUMNS FROM users LIKE 'reset_token_expires'");
  if (expiresCol.length === 0) {
    await pool.query('ALTER TABLE users ADD COLUMN reset_token_expires DATETIME NULL');
    console.log('Added reset_token_expires column');
  } else {
    console.log('reset_token_expires column already exists');
  }

  console.log('Done.');
  process.exit(0);
}

migrate().catch((err) => {
  console.error(err);
  process.exit(1);
});
