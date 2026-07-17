// routes/messages.js — REST endpoints for the messaging inbox. Actual
// message sending/receiving happens over Socket.io (see utils/socket.js);
// these routes only cover initial page loads: the conversation list, a
// specific thread's history, and starting a new conversation.
const express = require('express');
const router = express.Router();
const pool = require('../db');
const { requireLogin, requireRole } = require('../middleware/auth');

// GET /api/messages/conversations — every conversation the logged-in user
// (student or hoster) is a participant in, newest activity first.
router.get('/conversations', requireLogin, async (req, res) => {
  try {
    const userId = req.session.user.id;
    const isStudent = req.session.user.role === 'student';

    const [rows] = await pool.query(
      `SELECT conversations.id, conversations.listing_id, conversations.last_message_at,
              listings.title AS listing_title, listings.image_url AS listing_image,
              other_user.id AS other_user_id, other_user.name AS other_user_name,
              (SELECT body FROM messages WHERE conversation_id = conversations.id ORDER BY created_at DESC LIMIT 1) AS last_message,
              (SELECT COUNT(*) FROM messages WHERE conversation_id = conversations.id AND sender_id != ? AND read_at IS NULL) AS unread_count
       FROM conversations
       JOIN listings ON conversations.listing_id = listings.id
       JOIN users AS other_user ON other_user.id = ${isStudent ? 'conversations.hoster_id' : 'conversations.student_id'}
       WHERE ${isStudent ? 'conversations.student_id' : 'conversations.hoster_id'} = ?
       ORDER BY conversations.last_message_at DESC`,
      [userId, userId]
    );

    res.json(rows);
  } catch (err) {
    console.error('Error fetching conversations:', err);
    res.status(500).json({ error: 'Could not fetch conversations.' });
  }
});

// GET /api/messages/conversations/:id/messages — full history for one thread
router.get('/conversations/:id/messages', requireLogin, async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.session.user.id;

    const [[conversation]] = await pool.query(
      'SELECT student_id, hoster_id FROM conversations WHERE id = ?',
      [id]
    );

    if (!conversation) {
      return res.status(404).json({ error: 'Conversation not found.' });
    }
    if (conversation.student_id !== userId && conversation.hoster_id !== userId) {
      return res.status(403).json({ error: 'Not your conversation.' });
    }

    const [messages] = await pool.query(
      `SELECT messages.id, messages.sender_id, messages.body, messages.created_at, messages.read_at,
              users.name AS sender_name
       FROM messages JOIN users ON messages.sender_id = users.id
       WHERE conversation_id = ?
       ORDER BY messages.created_at ASC`,
      [id]
    );

    res.json(messages);
  } catch (err) {
    console.error('Error fetching messages:', err);
    res.status(500).json({ error: 'Could not fetch messages.' });
  }
});

// POST /api/messages/conversations — a student starts (or reopens) a
// conversation about a specific listing. Idempotent: messaging the same
// listing twice returns the same existing thread rather than duplicating it.
router.post('/conversations', requireRole('student'), async (req, res) => {
  try {
    const { listing_id } = req.body;
    if (!listing_id) {
      return res.status(400).json({ error: 'listing_id is required.' });
    }

    const [[listing]] = await pool.query('SELECT owner_id FROM listings WHERE id = ?', [listing_id]);
    if (!listing) {
      return res.status(404).json({ error: 'Listing not found.' });
    }

    const studentId = req.session.user.id;

    if (listing.owner_id === studentId) {
      return res.status(400).json({ error: "You can't message yourself about your own listing." });
    }

    const [[existing]] = await pool.query(
      'SELECT id FROM conversations WHERE listing_id = ? AND student_id = ?',
      [listing_id, studentId]
    );

    if (existing) {
      return res.json({ id: existing.id });
    }

    const [result] = await pool.query(
      'INSERT INTO conversations (listing_id, student_id, hoster_id) VALUES (?, ?, ?)',
      [listing_id, studentId, listing.owner_id]
    );

    res.status(201).json({ id: result.insertId });
  } catch (err) {
    console.error('Error starting conversation:', err);
    res.status(500).json({ error: 'Could not start conversation.' });
  }
});

// GET /api/messages/unread-count — a cheap total for the nav badge
router.get('/unread-count', requireLogin, async (req, res) => {
  try {
    const userId = req.session.user.id;
    const isStudent = req.session.user.role === 'student';

    const [[{ total }]] = await pool.query(
      `SELECT COUNT(*) AS total
       FROM messages
       JOIN conversations ON messages.conversation_id = conversations.id
       WHERE ${isStudent ? 'conversations.student_id' : 'conversations.hoster_id'} = ?
         AND messages.sender_id != ?
         AND messages.read_at IS NULL`,
      [userId, userId]
    );

    res.json({ unreadCount: total });
  } catch (err) {
    console.error('Error fetching unread count:', err);
    res.status(500).json({ error: 'Could not fetch unread count.' });
  }
});

// DELETE /api/messages/conversations/:id — either participant can delete
// the whole thread. Messages cascade-delete with it at the DB level
// (see database/add_messaging.js's FOREIGN KEY ... ON DELETE CASCADE), so
// this is one clean operation, not a loop of individual message deletes.
router.delete('/conversations/:id', requireLogin, async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.session.user.id;

    const [[conversation]] = await pool.query(
      'SELECT student_id, hoster_id FROM conversations WHERE id = ?',
      [id]
    );

    if (!conversation) {
      return res.status(404).json({ error: 'Conversation not found.' });
    }
    if (conversation.student_id !== userId && conversation.hoster_id !== userId) {
      return res.status(403).json({ error: 'Not your conversation.' });
    }

    await pool.query('DELETE FROM conversations WHERE id = ?', [id]);

    // Both participants get notified live — whoever didn't click delete
    // sees it vanish from their list (and their open thread close, if they
    // had it open) immediately, not just on their next page load.
    const io = req.app.get('io');
    if (io) {
      io.to(`user:${conversation.student_id}`)
        .to(`user:${conversation.hoster_id}`)
        .emit('conversation_deleted', { conversationId: Number(id) });
    }

    res.json({ message: 'Conversation deleted.' });
  } catch (err) {
    console.error('Error deleting conversation:', err);
    res.status(500).json({ error: 'Could not delete conversation.' });
  }
});

module.exports = router;
