// admin.js: powers the admin dashboard: access gate, stats, users, listings, bookings/revenue

const container = document.getElementById('admin-container');
let currentTab = 'listings';
let userSearchTerm = '';

function gate(message, customHeading) {
  let heading = customHeading;
  let shownMessage = message;
  let isLoginIssue = !customHeading;

  if (isLoginIssue) {
    const expired = window.wasRecentlyLoggedIn && window.wasRecentlyLoggedIn();
    heading = expired ? 'Your session has expired' : 'Please log in';
    if (expired) {
      shownMessage = "For your security, you're logged out after a period of inactivity. Please log in again to continue.";
      if (window.clearLoggedInFlag) window.clearLoggedInFlag();
    }
  }

  const cta = isLoginIssue
    ? '<a href="/login.html" class="btn btn-gold">Log in</a>'
    : '<a href="/index.html" class="btn btn-gold">Back to Browse</a>';

  container.innerHTML = `
    <div class="gate-message">
      <div class="icon-lock">🔒</div>
      <h2>${heading}</h2>
      <p>${shownMessage}</p>
      ${cta}
    </div>
  `;
}

async function fetchJSON(url, options = {}) {
  const method = (options.method || 'GET').toUpperCase();
  const doFetch = method === 'GET' ? fetch : secureFetch;
  const res = await doFetch(url, { credentials: 'include', ...options });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}

function formatMoney(n) {
  return `GH₵ ${Number(n || 0).toLocaleString()}`;
}

function renderStats(stats) {
  return `
    <div class="stat-cards">
      <div class="stat-card"><div class="number">${stats.users.total}</div><div class="label">Total users</div></div>
      <div class="stat-card"><div class="number">${stats.users.students}</div><div class="label">Students</div></div>
      <div class="stat-card"><div class="number">${stats.users.hosters}</div><div class="label">Hosters</div></div>
      <div class="stat-card"><div class="number">${stats.listings.active}</div><div class="label">Active listings</div></div>
      <div class="stat-card"><div class="number">${formatMoney(stats.bookings.revenue)}</div><div class="label">Revenue collected</div></div>
      <div class="stat-card"><div class="number">${stats.bookings.pending || 0}</div><div class="label">Pending payment</div></div>
    </div>
  `;
}

function renderListingsTable(listings) {
  const rows = listings.map(l => `
    <tr>
      <td>${escapeHTML(l.title)}</td>
      <td>${areaChipHTML(l.area)}</td>
      <td>GH₵ ${Number(l.price).toLocaleString()}</td>
      <td>${l.rooms_available} / ${l.rooms_total}</td>
      <td>${escapeHTML(l.owner_name)}<br><span class="form-note">${escapeHTML(l.owner_email)}</span></td>
      <td><span class="status-pill ${l.status}">${l.status}</span></td>
      <td>
        ${l.status === 'active'
          ? `<button class="btn btn-small btn-outline" data-action="remove" data-id="${l.id}">Remove</button>`
          : `<button class="btn btn-small" data-action="restore" data-id="${l.id}">Restore</button>`
        }
      </td>
    </tr>
  `).join('');

  return `
    <div class="admin-table-wrap">
      <table class="admin-table">
        <thead><tr><th>Title</th><th>Area</th><th>Price</th><th>Rooms</th><th>Owner</th><th>Status</th><th>Action</th></tr></thead>
        <tbody>${rows || '<tr><td colspan="7">No listings yet.</td></tr>'}</tbody>
      </table>
    </div>
  `;
}

function roleSelectHTML(u) {
  const roles = ['student', 'hoster', 'admin'];
  return `
    <select class="role-select" data-id="${u.id}">
      ${roles.map(r => `<option value="${r}" ${r === u.role ? 'selected' : ''}>${r}</option>`).join('')}
    </select>
  `;
}

function renderUsersTable(users, currentUserId) {
  const rows = users.map(u => `
    <tr>
      <td>${escapeHTML(u.name)}</td>
      <td>${escapeHTML(u.email)}</td>
      <td>${escapeHTML(u.phone)}</td>
      <td>${u.id === currentUserId ? `<span class="role-pill ${u.role}">${u.role}</span>` : roleSelectHTML(u)}</td>
      <td>${new Date(u.created_at).toLocaleDateString()}</td>
      <td>
        ${u.id === currentUserId
          ? '<span class="form-note">You</span>'
          : `<button class="btn btn-small btn-danger" data-action="delete-user" data-id="${u.id}">Delete</button>`
        }
      </td>
    </tr>
  `).join('');

  return `
    <div class="admin-search-row">
      <input type="text" id="user-search" placeholder="Search by name or email…" value="${escapeHTML(userSearchTerm)}" />
    </div>
    <div class="admin-table-wrap">
      <table class="admin-table">
        <thead><tr><th>Name</th><th>Email</th><th>Phone</th><th>Role</th><th>Joined</th><th>Action</th></tr></thead>
        <tbody>${rows || '<tr><td colspan="6">No users match that search.</td></tr>'}</tbody>
      </table>
    </div>
  `;
}

function paymentPillHTML(status) {
  if (status === 'paid') return '<span class="status-pill active">paid</span>';
  if (status === 'expired') return '<span class="status-pill removed">expired</span>';
  return '<span class="status-pill pending">pending</span>';
}

function renderBookingsTable(bookings) {
  const rows = bookings.map(b => `
    <tr>
      <td>${escapeHTML(b.listing_title)}</td>
      <td>${b.room_type}</td>
      <td>GH₵ ${Number(b.price).toLocaleString()}</td>
      <td>${escapeHTML(b.student_name)}<br><span class="form-note">${escapeHTML(b.student_email)}</span></td>
      <td>${escapeHTML(b.owner_name)}</td>
      <td>${paymentPillHTML(b.payment_status)}</td>
      <td>${new Date(b.created_at).toLocaleDateString()}</td>
    </tr>
  `).join('');

  return `
    <div class="admin-table-wrap">
      <table class="admin-table">
        <thead><tr><th>Listing</th><th>Room type</th><th>Price</th><th>Student</th><th>Owner</th><th>Payment</th><th>Booked</th></tr></thead>
        <tbody>${rows || '<tr><td colspan="7">No bookings yet.</td></tr>'}</tbody>
      </table>
    </div>
  `;
}

async function loadTabContent(user) {
  const tabContent = document.getElementById('tab-content');
  tabContent.innerHTML = '<p class="state-message">Loading…</p>';

  try {
    if (currentTab === 'listings') {
      const listings = await fetchJSON('/api/admin/listings');
      tabContent.innerHTML = renderListingsTable(listings);
      attachListingActions(user);
    } else if (currentTab === 'users') {
      const query = userSearchTerm ? `?search=${encodeURIComponent(userSearchTerm)}` : '';
      const users = await fetchJSON(`/api/admin/users${query}`);
      tabContent.innerHTML = renderUsersTable(users, user.id);
      attachUserActions(user);
    } else {
      const bookings = await fetchJSON('/api/admin/bookings');
      tabContent.innerHTML = renderBookingsTable(bookings);
    }
  } catch (err) {
    console.error(err);
    tabContent.innerHTML = '<p class="state-message">Could not load this tab. Please refresh.</p>';
  }
}

function attachListingActions(user) {
  document.querySelectorAll('[data-action="remove"], [data-action="restore"]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.id;
      const newStatus = btn.dataset.action === 'remove' ? 'removed' : 'active';
      try {
        await fetchJSON(`/api/admin/listings/${id}/status`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: newStatus }),
        });
        loadTabContent(user);
        showToast(newStatus === 'removed' ? 'Listing removed.' : 'Listing restored.', 'success');
      } catch (err) {
        showToast(err.message);
      }
    });
  });
}

function attachUserActions(user) {
  const searchInput = document.getElementById('user-search');
  let searchTimeout;
  searchInput?.addEventListener('input', () => {
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(() => {
      userSearchTerm = searchInput.value.trim();
      loadTabContent(user);
    }, 350);
  });

  document.querySelectorAll('[data-action="delete-user"]').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!confirm('Delete this user and all their listings? This cannot be undone.')) return;
      try {
        await fetchJSON(`/api/admin/users/${btn.dataset.id}`, { method: 'DELETE' });
        loadTabContent(user);
        showToast('User deleted.', 'success');
      } catch (err) {
        showToast(err.message);
      }
    });
  });

  document.querySelectorAll('.role-select').forEach(select => {
    const originalValue = select.value;
    select.addEventListener('change', async () => {
      const newRole = select.value;
      if (!confirm(`Change this user's role to "${newRole}"?`)) {
        select.value = originalValue;
        return;
      }
      try {
        await fetchJSON(`/api/admin/users/${select.dataset.id}/role`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ role: newRole }),
        });
        loadTabContent(user);
        showToast(`Role updated to "${newRole}".`, 'success');
      } catch (err) {
        showToast(err.message);
        select.value = originalValue;
      }
    });
  });
}

async function renderDashboard(user) {
  try {
    const stats = await fetchJSON('/api/admin/stats');

    container.innerHTML = `
      <div class="admin-wrap">
        <div class="admin-heading">
          <div>
            <span class="eyebrow">Admin dashboard</span>
            <h1>The key board</h1>
          </div>
          <p class="form-note">Welcome, ${user.name}. Manage every listing, user, and booking on KellyLodge here.</p>
        </div>

        ${renderStats(stats)}

        <div class="admin-tabs">
          <button data-tab="listings" class="${currentTab === 'listings' ? 'active' : ''}">Listings</button>
          <button data-tab="users" class="${currentTab === 'users' ? 'active' : ''}">Users</button>
          <button data-tab="bookings" class="${currentTab === 'bookings' ? 'active' : ''}">Bookings &amp; Revenue</button>
        </div>

        <div id="tab-content"></div>
      </div>
    `;

    document.querySelectorAll('.admin-tabs button').forEach(btn => {
      btn.addEventListener('click', () => {
        currentTab = btn.dataset.tab;
        renderDashboard(user);
      });
    });

    loadTabContent(user);
  } catch (err) {
    console.error(err);
    container.innerHTML = '<p class="state-message">Could not load admin data. Please refresh.</p>';
  }
}

async function init() {
  const res = await fetch('/api/auth/me', { credentials: 'include' });
  const { user } = await res.json();

  if (!user) {
    return gate('You need to log in as an admin to view this page.');
  }
  if (user.role !== 'admin') {
    return gate('This page is only available to KellyLodge administrators.', 'Admins only');
  }

  renderDashboard(user);
}

init();
