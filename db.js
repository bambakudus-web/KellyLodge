// db.js: sets up a reusable MySQL connection pool for the whole app
require('dotenv').config();
const mysql = require('mysql2/promise');

// Settings shared by both the DATABASE_URL and the DB_* setups.
// The keep-alive and idle settings stop Railway's network proxy (or MySQL)
// from silently killing idle connections, which is what produced
// "PROTOCOL_CONNECTION_LOST: The server closed the connection".
const poolOptions = {
  waitForConnections: true,
  connectionLimit: 10,
  enableKeepAlive: true,
  keepAliveInitialDelay: 10000,
  maxIdle: 2,
  idleTimeout: 30000,
  connectTimeout: 20000,
};

// Railway provides a single DATABASE_URL for its MySQL plugin.
// Locally, we use the separate DB_* variables from .env instead.
// This function handles both cases so the same code works in dev and production.
function createPool() {
  if (process.env.DATABASE_URL) {
    return mysql.createPool({ uri: process.env.DATABASE_URL, ...poolOptions });
  }

  return mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    port: process.env.DB_PORT || 3306,
    ...poolOptions,
  });
}

const pool = createPool();

const LOST_CODES = ['PROTOCOL_CONNECTION_LOST', 'ECONNRESET', 'EPIPE'];

// If a pooled connection died while idle, the first query on it fails. Plain
// reads are safe to repeat, so retry them once on a fresh connection.
for (const method of ['query', 'execute']) {
  const original = pool[method].bind(pool);
  pool[method] = async (...args) => {
    try {
      return await original(...args);
    } catch (err) {
      const sql = typeof args[0] === 'string' ? args[0] : (args[0] && args[0].sql) || '';
      if (LOST_CODES.includes(err.code) && /^\s*(select|show)\b/i.test(sql)) {
        return original(...args);
      }
      throw err;
    }
  };
}

// Transactions use getConnection(). Check that the connection is alive before
// handing it out, and throw away dead ones.
const originalGetConnection = pool.getConnection.bind(pool);
pool.getConnection = async () => {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const connection = await originalGetConnection();
    try {
      await connection.ping();
      return connection;
    } catch (err) {
      connection.destroy();
    }
  }
  return originalGetConnection();
};

module.exports = pool;
