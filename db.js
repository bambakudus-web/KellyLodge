// db.js — sets up a reusable MySQL connection pool for the whole app
require('dotenv').config();
const mysql = require('mysql2/promise');

// Railway provides a single DATABASE_URL for its MySQL plugin.
// Locally, we use the separate DB_* variables from .env instead.
// This function handles both cases so the same code works in dev and production.
function createPool() {
  if (process.env.DATABASE_URL) {
    return mysql.createPool(process.env.DATABASE_URL);
  }

  return mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    port: process.env.DB_PORT || 3306,
    waitForConnections: true,
    connectionLimit: 10,
  });
}

const pool = createPool();

module.exports = pool;
