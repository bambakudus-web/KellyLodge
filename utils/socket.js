// utils/socket.js — real-time chat server. Shares the exact same Express
// session middleware, so a socket connection is already authenticated as
// whoever is logged into that browser tab, no separate login step needed.
const { Server } = require('socket.io');
const pool = require('../db');

function initSocket(httpServer, sessionMiddleware) {
  const io = new Server(httpServer, {
    cors: { origin: true, credentials: true },
  });

  io.engine.use(sessionMiddleware);

  io.use((socket, next) => {
    const user = socket.request.session?.user;
    if (!user) return next(new Error('unauthorized'));
    socket.user = user;
    next();
  });

  io.on('connection', (socket) => {
    // A personal room per user lets us push notifications (like "you have a
    // new message") to them regardless of which page/tab they currently
    // have open, without needing to track individual socket ids ourselves.
    socket.join(`user:${socket.user.id}`);

    socket.on('join_conversation', async (conversationId) => {
      try {
        const [[conversation]] = await pool.query(
          'SELECT student_id, hoster_id FROM conversations WHERE id = ?',
          [conversationId]
        );
        if (!conversation) return;

        const isParticipant = conversation.student_id === socket.user.id || conversation.hoster_id === socket.user.id;
        if (!isParticipant) return;

        socket.join(`conversation:${conversationId}`);
      } catch (err) {
        console.error('Error joining conversation room:', err);
      }
    });

    socket.on('leave_conversation', (conversationId) => {
      socket.leave(`conversation:${conversationId}`);
    });

    socket.on('send_message', async ({ conversationId, body }, callback) => {
      try {
        const trimmed = (body || '').trim().slice(0, 2000);
        if (!trimmed) return callback?.({ error: 'Message cannot be empty.' });

        const [[conversation]] = await pool.query(
          'SELECT student_id, hoster_id FROM conversations WHERE id = ?',
          [conversationId]
        );
        if (!conversation) return callback?.({ error: 'Conversation not found.' });

        const isParticipant = conversation.student_id === socket.user.id || conversation.hoster_id === socket.user.id;
        if (!isParticipant) return callback?.({ error: 'Not your conversation.' });

        const [result] = await pool.query(
          'INSERT INTO messages (conversation_id, sender_id, body) VALUES (?, ?, ?)',
          [conversationId, socket.user.id, trimmed]
        );
        await pool.query('UPDATE conversations SET last_message_at = NOW() WHERE id = ?', [conversationId]);

        const message = {
          id: result.insertId,
          conversation_id: Number(conversationId),
          sender_id: socket.user.id,
          sender_name: socket.user.name,
          body: trimmed,
          created_at: new Date().toISOString(),
        };

        io.to(`conversation:${conversationId}`).emit('new_message', message);

        // Also notify the recipient's personal room, in case they're
        // elsewhere in the app without this exact thread open, so their
        // inbox list / unread badge can update live too.
        const recipientId = conversation.student_id === socket.user.id ? conversation.hoster_id : conversation.student_id;
        io.to(`user:${recipientId}`).emit('conversation_updated', { conversationId: Number(conversationId) });

        callback?.({ message });
      } catch (err) {
        console.error('Error sending message:', err);
        callback?.({ error: 'Could not send message. Please try again.' });
      }
    });

    socket.on('mark_read', async (conversationId) => {
      try {
        const [[conversation]] = await pool.query(
          'SELECT student_id, hoster_id FROM conversations WHERE id = ?',
          [conversationId]
        );
        if (!conversation) return;

        const isParticipant = conversation.student_id === socket.user.id || conversation.hoster_id === socket.user.id;
        if (!isParticipant) return;

        await pool.query(
          'UPDATE messages SET read_at = NOW() WHERE conversation_id = ? AND sender_id != ? AND read_at IS NULL',
          [conversationId, socket.user.id]
        );

        const otherId = conversation.student_id === socket.user.id ? conversation.hoster_id : conversation.student_id;
        io.to(`user:${otherId}`).emit('messages_read', { conversationId: Number(conversationId), readBy: socket.user.id });
      } catch (err) {
        console.error('Error marking messages read:', err);
      }
    });

    socket.on('typing', async (conversationId) => {
      try {
        const [[conversation]] = await pool.query(
          'SELECT student_id, hoster_id FROM conversations WHERE id = ?',
          [conversationId]
        );
        if (!conversation) return;

        const isParticipant = conversation.student_id === socket.user.id || conversation.hoster_id === socket.user.id;
        if (!isParticipant) return;

        socket.to(`conversation:${conversationId}`).emit('typing', { conversationId: Number(conversationId), userId: socket.user.id });
      } catch (err) {
        console.error('Error handling typing event:', err);
      }
    });
  });

  return io;
}

module.exports = initSocket;
