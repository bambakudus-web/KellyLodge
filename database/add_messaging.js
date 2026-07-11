// database/add_messaging.js — adds real-time chat between a student and a
// listing's owner. One conversation per (listing, student) pair; a student
// messaging two different listings gets two separate threads.
// Safe to run more than once.
// Run with: node database/add_messaging.js
require('dotenv').config();
const pool = require('../db');

async function migrate() {
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

  try {
    await pool.query('CREATE INDEX idx_conv_student ON conversations (student_id, last_message_at)');
    await pool.query('CREATE INDEX idx_conv_hoster ON conversations (hoster_id, last_message_at)');
    console.log('OK: conversation indexes ready');
  } catch (err) {
    if (err.code === 'ER_DUP_KEYNAME') console.log('Skipped (already exist): conversation indexes');
    else throw err;
  }

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

  try {
    await pool.query('CREATE INDEX idx_messages_conversation ON messages (conversation_id, created_at)');
    console.log('OK: idx_messages_conversation');
  } catch (err) {
    if (err.code === 'ER_DUP_KEYNAME') console.log('Skipped (already exists): idx_messages_conversation');
    else throw err;
  }

  console.log('Done.');
  process.exit(0);
}

migrate().catch((err) => {
  console.error(err);
  process.exit(1);
});
