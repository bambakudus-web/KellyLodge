// messages.js: real-time messaging inbox + thread view, powered by Socket.io

const container = document.getElementById('messages-container');
let socket = null;
let currentUser = null;
let activeConversationId = null;
let conversations = [];
let typingTimeout = null;

function gate(message, customHeading) {
  let heading = customHeading;
  let shownMessage = message;

  if (!customHeading) {
    const expired = window.wasRecentlyLoggedIn && window.wasRecentlyLoggedIn();
    heading = expired ? 'Your session has expired' : 'Please log in';
    if (expired) {
      shownMessage = "For your security, you're logged out after a period of inactivity. Please log in again to continue.";
      if (window.clearLoggedInFlag) window.clearLoggedInFlag();
    }
  }

  container.innerHTML = `
    <div class="gate-message">
      <div class="icon-lock">🔑</div>
      <h2>${heading}</h2>
      <p>${shownMessage}</p>
      <a href="/login.html" class="btn btn-gold">Log in</a>
    </div>
  `;
}

function timeAgo(isoString) {
  const diffMs = Date.now() - new Date(isoString).getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(isoString).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

function conversationItemHTML(conv) {
  const isActive = conv.id === activeConversationId;
  return `
    <div class="conversation-item ${isActive ? 'active' : ''}" data-id="${conv.id}">
      <div class="ci-main">
        <span class="ci-name">${escapeHTML(conv.other_user_name)}</span>
        <span class="ci-listing">${escapeHTML(conv.listing_title)}</span>
        <span class="ci-preview">${conv.last_message ? escapeHTML(conv.last_message.slice(0, 60)) : 'No messages yet'}</span>
      </div>
      <div class="ci-side">
        <span class="ci-time">${timeAgo(conv.last_message_at)}</span>
        ${conv.unread_count > 0 ? `<span class="ci-unread">${conv.unread_count}</span>` : ''}
      </div>
      <button type="button" class="ci-delete" data-id="${conv.id}" aria-label="Delete conversation" title="Delete conversation">&times;</button>
    </div>
  `;
}

function renderConversationList() {
  const listEl = document.getElementById('conversation-list');
  if (!listEl) return;

  if (conversations.length === 0) {
    listEl.innerHTML = '<p class="state-message">No conversations yet.</p>';
    return;
  }

  listEl.innerHTML = conversations.map(conversationItemHTML).join('');

  listEl.querySelectorAll('.conversation-item').forEach((item) => {
    item.addEventListener('click', (e) => {
      if (e.target.closest('.ci-delete')) return;
      openConversation(Number(item.dataset.id));
    });
  });

  listEl.querySelectorAll('.ci-delete').forEach((delBtn) => {
    delBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (!confirm('Delete this entire conversation? This removes all messages in it for both of you.')) return;
      const conversationId = delBtn.getAttribute('data-id');
      try {
        const res = await secureFetch(`/api/messages/conversations/${conversationId}`, { method: 'DELETE' });
        const data = await res.json();
        if (!res.ok) {
          alert(data.error || 'Could not delete conversation.');
          return;
        }
        conversations = conversations.filter((c) => c.id !== Number(conversationId));
        if (activeConversationId === Number(conversationId)) {
          activeConversationId = null;
          document.getElementById('messages-shell')?.classList.remove('thread-open');
          const threadPanel = document.getElementById('thread-panel');
          if (threadPanel) threadPanel.innerHTML = '<div class="thread-empty">Select a conversation to start chatting.</div>';
        }
        renderConversationList();
      } catch (err) {
        console.error(err);
        alert('Could not delete conversation.');
      }
    });
  });
}

function messageBubbleHTML(msg) {
  const isMine = msg.sender_id === currentUser.id;
  const time = new Date(msg.created_at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  return `
    <div class="msg-bubble-row ${isMine ? 'mine' : 'theirs'}" data-message-id="${msg.id}">
      <div class="msg-bubble">
        <p>${escapeHTML(msg.body)}</p>
        <span class="msg-time">${time}</span>
        ${isMine ? `<button type="button" class="msg-delete-btn" data-message-id="${msg.id}" aria-label="Delete message" title="Delete message">&times;</button>` : ''}
      </div>
    </div>
  `;
}

async function openConversation(conversationId) {
  if (activeConversationId && activeConversationId !== conversationId) {
    socket.emit('leave_conversation', activeConversationId);
  }

  activeConversationId = conversationId;
  renderConversationList();

  const shell = document.getElementById('messages-shell');
  shell?.classList.add('thread-open');

  const conv = conversations.find((c) => c.id === conversationId);
  const threadPanel = document.getElementById('thread-panel');

  threadPanel.innerHTML = `
    <div class="thread-header">
      <button class="thread-back" id="thread-back">&larr;</button>
      <div>
        <h3>${escapeHTML(conv?.other_user_name || '')}</h3>
        <span class="form-note">${escapeHTML(conv?.listing_title || '')}</span>
      </div>
    </div>
    <div class="thread-messages" id="thread-messages"><p class="state-message">Loading…</p></div>
    <div class="typing-indicator" id="typing-indicator"></div>
    <form class="thread-input-row" id="thread-form">
      <input type="text" id="thread-input" placeholder="Type a message…" autocomplete="off" maxlength="2000" />
      <button type="submit" class="btn btn-gold btn-small">Send</button>
    </form>
  `;

  document.getElementById('thread-back').addEventListener('click', () => {
    shell?.classList.remove('thread-open');
  });

  try {
    const res = await fetch(`/api/messages/conversations/${conversationId}/messages`, { credentials: 'include' });
    const messages = await res.json();
    const messagesEl = document.getElementById('thread-messages');
    messagesEl.innerHTML = messages.length > 0
      ? messages.map(messageBubbleHTML).join('')
      : '<p class="state-message">Say hello, start the conversation.</p>';
    messagesEl.scrollTop = messagesEl.scrollHeight;

    messagesEl.addEventListener('click', (e) => {
      const delBtn = e.target.closest('.msg-delete-btn');
      if (!delBtn) return;
      if (!confirm('Delete this message?')) return;
      const messageId = delBtn.getAttribute('data-message-id');
      socket.emit('delete_message', { messageId }, (response) => {
        if (response?.error) alert(response.error);
      });
    });
  } catch (err) {
    console.error(err);
    document.getElementById('thread-messages').innerHTML = '<p class="state-message">Could not load messages.</p>';
  }

  socket.emit('join_conversation', conversationId);
  socket.emit('mark_read', conversationId);

  const conversation = conversations.find((c) => c.id === conversationId);
  if (conversation) conversation.unread_count = 0;
  renderConversationList();

  const form = document.getElementById('thread-form');
  const input = document.getElementById('thread-input');

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const body = input.value.trim();
    if (!body) return;

    input.value = '';
    socket.emit('send_message', { conversationId, body }, (response) => {
      if (response?.error) alert(response.error);
    });
  });

  let typingSentAt = 0;
  input.addEventListener('input', () => {
    const now = Date.now();
    if (now - typingSentAt > 2000) {
      socket.emit('typing', conversationId);
      typingSentAt = now;
    }
  });
}

function appendLiveMessage(msg) {
  const messagesEl = document.getElementById('thread-messages');
  if (!messagesEl) return;
  const emptyState = messagesEl.querySelector('.state-message');
  if (emptyState) messagesEl.innerHTML = '';
  messagesEl.insertAdjacentHTML('beforeend', messageBubbleHTML(msg));
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

async function refreshConversationList() {
  try {
    const res = await fetch('/api/messages/conversations', { credentials: 'include' });
    conversations = await res.json();
    renderConversationList();
  } catch (err) {
    console.error('Could not refresh conversations:', err);
  }
}

function setupSocket() {
  socket = io({ withCredentials: true });

  socket.on('new_message', (msg) => {
    if (msg.conversation_id === activeConversationId) {
      appendLiveMessage(msg);
      if (msg.sender_id !== currentUser.id) socket.emit('mark_read', activeConversationId);
    } else {
      const conv = conversations.find((c) => c.id === msg.conversation_id);
      if (conv) {
        conv.last_message = msg.body;
        conv.last_message_at = msg.created_at;
        if (msg.sender_id !== currentUser.id) conv.unread_count = (conv.unread_count || 0) + 1;
        conversations.sort((a, b) => new Date(b.last_message_at) - new Date(a.last_message_at));
        renderConversationList();
      } else {
        refreshConversationList();
      }
    }
  });

  socket.on('conversation_updated', () => {
    refreshConversationList();
  });

  socket.on('message_deleted', ({ messageId, conversationId }) => {
    if (conversationId === activeConversationId) {
      const row = document.querySelector(`.msg-bubble-row[data-message-id="${messageId}"]`);
      if (row) row.remove();
      const messagesEl = document.getElementById('thread-messages');
      if (messagesEl && !messagesEl.querySelector('.msg-bubble-row')) {
        messagesEl.innerHTML = '<p class="state-message">Say hello, start the conversation.</p>';
      }
    }
    refreshConversationList();
  });

  socket.on('typing', ({ conversationId }) => {
    if (conversationId !== activeConversationId) return;
    const indicator = document.getElementById('typing-indicator');
    if (!indicator) return;
    indicator.textContent = 'Typing…';
    clearTimeout(typingTimeout);
    typingTimeout = setTimeout(() => { indicator.textContent = ''; }, 2500);
  });
}

async function init() {
  const res = await fetch('/api/auth/me', { credentials: 'include' });
  const { user } = await res.json();

  if (!user) return gate('You need to log in to view your messages.');
  currentUser = user;

  container.innerHTML = `
    <div class="messages-shell" id="messages-shell">
      <div class="conversation-list" id="conversation-list"><p class="state-message">Loading…</p></div>
      <div class="thread-panel" id="thread-panel">
        <div class="thread-empty">Select a conversation to start chatting.</div>
      </div>
    </div>
  `;

  setupSocket();
  await refreshConversationList();

  // If arriving from a listing's "Message owner" button with ?conversation=ID
  const params = new URLSearchParams(window.location.search);
  const targetId = params.get('conversation');
  if (targetId) openConversation(Number(targetId));
}

init();
