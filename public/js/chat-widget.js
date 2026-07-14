// chat-widget.js: a floating chat bubble available on every logged-in page.
// Tap it, a small popup opens with the conversation list, tap a thread to
// chat. Socket.io itself is only loaded the first time someone actually
// opens the widget, so pages nobody uses chat on don't pay that cost.

window.KellyLodgeChatWidget = (function () {
  let socket = null;
  let currentUser = null;
  let activeConversationId = null;
  let conversations = [];
  let panelOpen = false;
  let socketReady = false;
  let typingTimeout = null;

  function escHTML(str) {
    if (str === null || str === undefined) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function timeAgo(isoString) {
    const diffMs = Date.now() - new Date(isoString).getTime();
    const mins = Math.floor(diffMs / 60000);
    if (mins < 1) return 'now';
    if (mins < 60) return `${mins}m`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h`;
    const days = Math.floor(hours / 24);
    if (days < 7) return `${days}d`;
    return new Date(isoString).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  }

  function buildDOM() {
    if (document.getElementById('klw-launcher')) return;

    const launcher = document.createElement('button');
    launcher.id = 'klw-launcher';
    launcher.className = 'klw-launcher';
    launcher.setAttribute('aria-label', 'Open messages');
    launcher.innerHTML = '<span class="klw-icon">&#128172;</span><span class="klw-badge" id="klw-badge" style="display:none;"></span>';
    document.body.appendChild(launcher);

    const panel = document.createElement('div');
    panel.id = 'klw-panel';
    panel.className = 'klw-panel';
    panel.innerHTML = `
      <div class="klw-panel-header">
        <button class="klw-back" id="klw-back" style="display:none;" aria-label="Back">&larr;</button>
        <span id="klw-panel-title">Messages</span>
        <button class="klw-close" id="klw-close" aria-label="Close">&times;</button>
      </div>
      <div class="klw-panel-body" id="klw-panel-body"></div>
    `;
    document.body.appendChild(panel);

    launcher.addEventListener('click', togglePanel);
    document.getElementById('klw-close').addEventListener('click', closePanel);
    document.getElementById('klw-back').addEventListener('click', showConversationList);
  }

  function togglePanel() {
    if (panelOpen) closePanel();
    else openPanel();
  }

  function openPanel() {
    panelOpen = true;
    document.getElementById('klw-panel').classList.add('open');
    ensureSocketAndLoad();
  }

  function closePanel() {
    panelOpen = false;
    document.getElementById('klw-panel').classList.remove('open');
  }

  function loadSocketIoScript() {
    return new Promise((resolve, reject) => {
      if (window.io) return resolve();
      const script = document.createElement('script');
      script.src = 'https://cdn.socket.io/4.8.3/socket.io.min.js';
      script.onload = resolve;
      script.onerror = reject;
      document.head.appendChild(script);
    });
  }

  async function ensureSocketAndLoad() {
    if (!socketReady) {
      try {
        await loadSocketIoScript();
        setupSocket();
        socketReady = true;
      } catch (err) {
        console.error('Could not load chat, please check your connection.', err);
      }
    }
    showConversationList();
    refreshConversations();
  }

  function setupSocket() {
    socket = io({ withCredentials: true });

    socket.on('connect_error', (err) => {
      if (err.message === 'unauthorized') showSessionExpiredNotice();
    });

    socket.on('disconnect', (reason) => {
      // "io server disconnect" means the server deliberately closed this
      // (see utils/socket.js's periodic session re-check), not a network
      // hiccup, that's specifically the expired-session case.
      if (reason === 'io server disconnect') showSessionExpiredNotice();
    });

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
          renderList();
        } else {
          refreshConversations();
        }
        updateBadge();
        if (!panelOpen) bumpBadgeDot();
      }
    });

    socket.on('conversation_updated', () => refreshConversations());

    socket.on('typing', ({ conversationId }) => {
      if (conversationId !== activeConversationId) return;
      const indicator = document.getElementById('klw-typing');
      if (!indicator) return;
      indicator.textContent = 'Typing…';
      clearTimeout(typingTimeout);
      typingTimeout = setTimeout(() => { indicator.textContent = ''; }, 2500);
    });
  }

  async function refreshConversations() {
    try {
      const res = await fetch('/api/messages/conversations', { credentials: 'include' });
      conversations = await res.json();
      renderList();
      updateBadge();
    } catch (err) {
      console.error('Could not load conversations:', err);
    }
  }

  function conversationItemHTML(conv) {
    return `
      <button class="klw-conv-item" data-id="${conv.id}">
        <div class="klw-conv-main">
          <span class="klw-conv-name">${escHTML(conv.other_user_name)}</span>
          <span class="klw-conv-listing">${escHTML(conv.listing_title)}</span>
          <span class="klw-conv-preview">${conv.last_message ? escHTML(conv.last_message.slice(0, 42)) : 'No messages yet'}</span>
        </div>
        <div class="klw-conv-side">
          <span class="klw-conv-time">${timeAgo(conv.last_message_at)}</span>
          ${conv.unread_count > 0 ? `<span class="klw-conv-unread">${conv.unread_count}</span>` : ''}
        </div>
      </button>
    `;
  }

  function renderList() {
    const body = document.getElementById('klw-panel-body');
    if (!body || activeConversationId) return;

    const newMessageButton = currentUser.role === 'student'
      ? `<button class="klw-new-message-btn" id="klw-new-message-btn">+ New message</button>`
      : '';

    if (conversations.length === 0) {
      body.innerHTML = `
        ${newMessageButton}
        <p class="klw-empty">${currentUser.role === 'student' ? 'No conversations yet. Search for a hostel above to message its owner.' : 'No conversations yet. A student will show up here once they message you.'}</p>
      `;
    } else {
      body.innerHTML = `${newMessageButton}<div class="klw-conv-list">${conversations.map(conversationItemHTML).join('')}</div>`;
      body.querySelectorAll('.klw-conv-item').forEach((btn) => {
        btn.addEventListener('click', () => openThread(Number(btn.dataset.id)));
      });
    }

    document.getElementById('klw-new-message-btn')?.addEventListener('click', showNewMessageSearch);
  }

  let searchDebounce = null;

  function showNewMessageSearch() {
    const body = document.getElementById('klw-panel-body');
    document.getElementById('klw-back').style.display = 'inline-block';
    document.getElementById('klw-panel-title').textContent = 'New message';

    body.innerHTML = `
      <div class="klw-search-wrap">
        <input type="text" id="klw-search-input" placeholder="Search hostels by name…" autocomplete="off" />
        <div id="klw-search-results"><p class="klw-empty">Start typing a hostel name.</p></div>
      </div>
    `;

    const input = document.getElementById('klw-search-input');
    input.focus();
    input.addEventListener('input', () => {
      clearTimeout(searchDebounce);
      const term = input.value.trim();
      if (!term) {
        document.getElementById('klw-search-results').innerHTML = '<p class="klw-empty">Start typing a hostel name.</p>';
        return;
      }
      searchDebounce = setTimeout(() => runListingSearch(term), 300);
    });
  }

  async function runListingSearch(term) {
    const resultsEl = document.getElementById('klw-search-results');
    if (!resultsEl) return;
    resultsEl.innerHTML = '<p class="klw-empty">Searching…</p>';

    try {
      const res = await fetch(`/api/listings?search=${encodeURIComponent(term)}&limit=6`, { credentials: 'include' });
      const data = await res.json();
      const listings = data.listings || [];

      if (listings.length === 0) {
        resultsEl.innerHTML = '<p class="klw-empty">No hostels match that search.</p>';
        return;
      }

      resultsEl.innerHTML = listings.map((l) => `
        <button class="klw-search-result" data-id="${l.id}">
          <span class="klw-conv-name">${escHTML(l.title)}</span>
          <span class="klw-conv-listing">${escHTML(l.area)}</span>
        </button>
      `).join('');

      resultsEl.querySelectorAll('.klw-search-result').forEach((btn) => {
        btn.addEventListener('click', () => openConversationFor(btn.dataset.id));
      });
    } catch (err) {
      console.error(err);
      resultsEl.innerHTML = '<p class="klw-empty">Could not search right now.</p>';
    }
  }

  function showConversationList() {
    if (activeConversationId) socket?.emit('leave_conversation', activeConversationId);
    activeConversationId = null;
    document.getElementById('klw-back').style.display = 'none';
    document.getElementById('klw-panel-title').textContent = 'Messages';
    renderList();
  }

  function messageBubbleHTML(msg) {
    const isMine = msg.sender_id === currentUser.id;
    const time = new Date(msg.created_at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
    return `
      <div class="klw-msg-row ${isMine ? 'mine' : 'theirs'}">
        <div class="klw-msg-bubble">
          <p>${escHTML(msg.body)}</p>
          <span class="klw-msg-time">${time}</span>
        </div>
      </div>
    `;
  }

  async function openThread(conversationId) {
    if (activeConversationId && activeConversationId !== conversationId) {
      socket?.emit('leave_conversation', activeConversationId);
    }
    activeConversationId = conversationId;

    const conv = conversations.find((c) => c.id === conversationId);
    document.getElementById('klw-back').style.display = 'inline-block';
    document.getElementById('klw-panel-title').textContent = conv?.other_user_name || 'Chat';

    const body = document.getElementById('klw-panel-body');
    body.innerHTML = `
      <div class="klw-thread-messages" id="klw-thread-messages"><p class="klw-empty">Loading…</p></div>
      <div class="klw-typing" id="klw-typing"></div>
      <form class="klw-thread-input" id="klw-thread-form">
        <input type="text" id="klw-thread-input" placeholder="Type a message…" autocomplete="off" maxlength="2000" />
        <button type="submit" aria-label="Send">&#10148;</button>
      </form>
    `;

    try {
      const res = await fetch(`/api/messages/conversations/${conversationId}/messages`, { credentials: 'include' });
      const messages = await res.json();
      const messagesEl = document.getElementById('klw-thread-messages');
      messagesEl.innerHTML = messages.length > 0
        ? messages.map(messageBubbleHTML).join('')
        : '<p class="klw-empty">Say hello, start the conversation.</p>';
      messagesEl.scrollTop = messagesEl.scrollHeight;
    } catch (err) {
      console.error(err);
    }

    socket?.emit('join_conversation', conversationId);
    socket?.emit('mark_read', conversationId);
    const convRef = conversations.find((c) => c.id === conversationId);
    if (convRef) convRef.unread_count = 0;
    updateBadge();

    const form = document.getElementById('klw-thread-form');
    const input = document.getElementById('klw-thread-input');
    input.focus();

    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const body = input.value.trim();
      if (!body) return;
      input.value = '';
      socket?.emit('send_message', { conversationId, body }, (response) => {
        if (response?.error) alert(response.error);
      });
    });

    let typingSentAt = 0;
    input.addEventListener('input', () => {
      const now = Date.now();
      if (now - typingSentAt > 2000) {
        socket?.emit('typing', conversationId);
        typingSentAt = now;
      }
    });
  }

  function appendLiveMessage(msg) {
    const messagesEl = document.getElementById('klw-thread-messages');
    if (!messagesEl) return;
    const empty = messagesEl.querySelector('.klw-empty');
    if (empty) messagesEl.innerHTML = '';
    messagesEl.insertAdjacentHTML('beforeend', messageBubbleHTML(msg));
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  function updateBadge() {
    const total = conversations.reduce((sum, c) => sum + (c.unread_count || 0), 0);
    const badge = document.getElementById('klw-badge');
    if (!badge) return;
    if (total > 0) {
      badge.textContent = total > 9 ? '9+' : total;
      badge.style.display = 'inline-block';
    } else {
      badge.style.display = 'none';
    }
  }

  function showSessionExpiredNotice() {
    socketReady = false;
    const body = document.getElementById('klw-panel-body');
    if (body) {
      body.innerHTML = '<p class="klw-empty">Your session has expired. Please log in again to keep chatting.</p>';
    }
    bumpBadgeDot();
  }

  function bumpBadgeDot() {
    const launcher = document.getElementById('klw-launcher');
    launcher?.classList.add('klw-bump');
    setTimeout(() => launcher?.classList.remove('klw-bump'), 400);
  }

  // Public entry point: nav.js calls this once it knows who's logged in.
  function init(user) {
    if (!user) return;
    currentUser = user;
    buildDOM();

    // A cheap snapshot count so the badge shows something before the
    // widget's ever been opened (and before socket.io is even loaded).
    fetch('/api/messages/unread-count', { credentials: 'include' })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!data) return;
        const badge = document.getElementById('klw-badge');
        if (badge && data.unreadCount > 0) {
          badge.textContent = data.unreadCount > 9 ? '9+' : data.unreadCount;
          badge.style.display = 'inline-block';
        }
      })
      .catch(() => {});
  }

  let csrfTokenCache = null;
  async function getCsrfTokenLocal() {
    if (csrfTokenCache) return csrfTokenCache;
    const res = await fetch('/api/auth/csrf-token', { credentials: 'include' });
    const data = await res.json();
    csrfTokenCache = data.csrfToken;
    return csrfTokenCache;
  }

  // Lets other pages (like a listing's "Message" button) open the widget
  // directly into a specific conversation, instead of dumping the user on
  // a whole separate page. Doesn't depend on csrf.js being loaded on the
  // current page, since not every page includes it.
  async function openConversationFor(listingId) {
    buildDOM();
    openPanel();
    document.getElementById('klw-panel-body').innerHTML = '<p class="klw-empty">Opening…</p>';

    if (!socketReady) {
      try {
        await loadSocketIoScript();
        setupSocket();
        socketReady = true;
      } catch (err) {
        console.error(err);
        return;
      }
    }

    try {
      const token = await getCsrfTokenLocal();
      const res = await fetch('/api/messages/conversations', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', 'x-csrf-token': token },
        body: JSON.stringify({ listing_id: listingId }),
      });
      const data = await res.json();
      if (!res.ok) {
        alert(data.error || 'Could not start a conversation.');
        closePanel();
        return;
      }
      await refreshConversations();
      openThread(data.id);
    } catch (err) {
      console.error(err);
    }
  }

  return { init, openConversationFor };
})();
