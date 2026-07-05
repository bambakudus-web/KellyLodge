// admin.js — powers the admin dashboard: access gate, stats, users, listings

const container = document.getElementById('admin-container');
let currentTab = 'listings';

function gate(message) {
  container.innerHTML = `
    <div class="gate-message">
      <div class="icon-lock">🔒</div>
      <h2>Access restricted</h2>
      <p>${message}</p>
      <a href="/index.html" class="btn btn-gold">Back to Browse</a>
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

function renderStats(stats) {
  return `
    <div class="stat-cards">
      <div class="stat-card"><div class="number">${stats.users.total}</div><div class="label">Total users</div></div>
      <div class="stat-card"><div class="number">${stats.users.students}</div><div class="label">Students</div></div>
      <div class="stat-card"><div class="number">${stats.users.hosters}</div><div class="label">Hosters</div></div>
      <div class="stat-card"><div class="number">${stats.listings.active}</div><div class="label">Active listings</div></div>
      <div class="stat-card"><div class="number">${stats.listings.removed}</div><div class="label">Removed listings</div></div>
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

function renderUsersTable(users, currentUserId) {
  const rows = users.map(u => `
    <tr>
      <td>${escapeHTML(u.name)}</td>
      <td>${escapeHTML(u.email)}</td>
      <td>${escapeHTML(u.phone)}</td>
      <td><span class="role-pill ${u.role}">${u.role}</span></td>
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
    <div class="admin-table-wrap">
      <table class="admin-table">
        <thead><tr><th>Name</th><th>Email</th><th>Phone</th><th>Role</th><th>Joined</th><th>Action</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  `;
}

async function renderDashboard(user) {
  try {
    const [stats, listings, users] = await Promise.all([
      fetchJSON('/api/admin/stats'),
      fetchJSON('/api/admin/listings'),
      fetchJSON('/api/admin/users'),
    ]);

    container.innerHTML = `
      <div class="admin-wrap">
        <div class="admin-heading">
          <div>
            <span class="eyebrow">Admin dashboard</span>
            <h1>The key board</h1>
          </div>
          <p class="form-note">Welcome, ${user.name}. Manage all listings and users on KellyLodge here.</p>
        </div>

        ${renderStats(stats)}

        <div class="admin-tabs">
          <button data-tab="listings" class="${currentTab === 'listings' ? 'active' : ''}">Listings</button>
          <button data-tab="users" class="${currentTab === 'users' ? 'active' : ''}">Users</button>
        </div>

        <div id="tab-content">
          ${currentTab === 'listings' ? renderListingsTable(listings) : renderUsersTable(users, user.id)}
        </div>
      </div>
    `;

    document.querySelectorAll('.admin-tabs button').forEach(btn => {
      btn.addEventListener('click', () => {
        currentTab = btn.dataset.tab;
        renderDashboard(user);
      });
    });

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
          renderDashboard(user);
        } catch (err) {
          alert(err.message);
        }
      });
    });

    document.querySelectorAll('[data-action="delete-user"]').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (!confirm('Delete this user and all their listings? This cannot be undone.')) return;
        try {
          await fetchJSON(`/api/admin/users/${btn.dataset.id}`, { method: 'DELETE' });
          renderDashboard(user);
        } catch (err) {
          alert(err.message);
        }
      });
    });
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
    return gate('This page is only available to KellyLodge administrators.');
  }

  renderDashboard(user);
}

init();
