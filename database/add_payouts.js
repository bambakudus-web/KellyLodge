// database/add_payouts.js — adds hoster payout details so rent payments can
// automatically split between the platform and the hostel owner via
// Paystack Subaccounts, instead of everything sitting in the platform's
// account with no way to pay hosters out.
// Safe to run more than once.
// Run with: node database/add_payouts.js
require('dotenv').config();
const pool = require('../db');

async function columnExists(table, column) {
  const [rows] = await pool.query(`SHOW COLUMNS FROM ${table} LIKE ?`, [column]);
  return rows.length > 0;
}

async function migrate() {
  const columns = [
    ['paystack_subaccount_code', 'VARCHAR(100) NULL'],
    ['bank_name', 'VARCHAR(100) NULL'],
    ['bank_code', 'VARCHAR(20) NULL'],
    ['bank_account_number', 'VARCHAR(50) NULL'],
    ['bank_account_name', 'VARCHAR(150) NULL'],
  ];

  for (const [name, definition] of columns) {
    if (!(await columnExists('users', name))) {
      await pool.query(`ALTER TABLE users ADD COLUMN ${name} ${definition}`);
      console.log(`Added users.${name}`);
    } else {
      console.log(`users.${name} already exists`);
    }
  }

  console.log('Done.');
  process.exit(0);
}

migrate().catch((err) => {
  console.error(err);
  process.exit(1);
});
