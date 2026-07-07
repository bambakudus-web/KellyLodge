// dashboard.js: powers the hoster/admin dashboard

const dashboardContainer = document.getElementById('dashboard-container');

function gate(message) {
  dashboardContainer.innerHTML = `
    <div class="gate-message">
      <div class="icon-lock">🔑</div>
      <h2>Access restricted</h2>
      <p>${message}</p>
      <a href="/login.html" class="btn btn-gold">Log in</a>
    </div>
  `;
}

function formatDate(isoString) {
  return new Date(isoString).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

function listingsSectionHTML(listings) {
  if (listings.length === 0) {
    return `
      <div class="dashboard-section">
        <h2>Your listings</h2>
        <p class="state-message">You haven't posted a listing yet. <a href="/post.html" style="color: var(--brass-dark); font-weight: 700;">Post one now</a>.</p>
      </div>
    `;
  }

  const rows = listings.map((listing) => `
    <a href="/listing.html?id=${listing.id}" class="dashboard-listing-row">
      <span class="dl-title">${escapeHTML(listing.title)}</span>
      ${areaChipHTML(listing.area)}
      <span class="dl-rooms">${listing.rooms_available} of ${listing.rooms_total} rooms available</span>
      <span class="dl-views">👁 ${listing.views || 0} view${listing.views === 1 ? '' : 's'}</span>
      ${listing.review_count > 0 ? `<span class="dl-rating">★ ${Number(listing.avg_rating).toFixed(1)} (${listing.review_count})</span>` : ''}
      <span class="dl-status ${listing.status}">${listing.status}</span>
    </a>
  `).join('');

  return `
    <div class="dashboard-section">
      <h2>Your listings</h2>
      <div class="dashboard-listing-list">${rows}</div>
    </div>
  `;
}

function bookingsSectionHTML(bookings) {
  if (bookings.length === 0) {
    return `
      <div class="dashboard-section">
        <h2>Bookings received</h2>
        <p class="state-message">No bookings yet. They'll show up here the moment a student books a room.</p>
      </div>
    `;
  }

  const rows = bookings.map((b) => `
    <div class="booking-received-item">
      <div class="bri-main">
        <h3>${escapeHTML(b.student_name)}</h3>
        <div class="bri-meta">
          <span class="tag">${b.room_type}</span>
          <span>${escapeHTML(b.title)}</span>
        </div>
        <div class="bri-contact">
          <a href="tel:${b.student_phone}">${b.student_phone}</a> &middot; <a href="mailto:${b.student_email}">${b.student_email}</a>
        </div>
      </div>
      <div class="bri-side">
        <div class="price">GH₵ ${Number(b.price).toLocaleString()}</div>
        <div class="bri-date">${formatDate(b.created_at)}</div>
      </div>
    </div>
  `).join('');

  return `
    <div class="dashboard-section">
      <h2>Bookings received</h2>
      <div class="booking-received-list">${rows}</div>
    </div>
  `;
}

async function init() {
  const res = await fetch('/api/auth/me', { credentials: 'include' });
  const { user } = await res.json();

  if (!user) return gate('You need to log in as a hostel owner to view your dashboard.');
  if (user.role === 'student') return gate('Only hostel owners have a dashboard to view.');

  try {
    const [listingsRes, bookingsRes] = await Promise.all([
      fetch('/api/listings/mine/all', { credentials: 'include' }),
      fetch('/api/bookings/received', { credentials: 'include' }),
    ]);

    if (!listingsRes.ok || !bookingsRes.ok) throw new Error('Failed to load dashboard data');

    const listings = await listingsRes.json();
    const bookings = await bookingsRes.json();

    dashboardContainer.innerHTML = listingsSectionHTML(listings) + bookingsSectionHTML(bookings);
  } catch (err) {
    console.error(err);
    dashboardContainer.innerHTML = '<p class="state-message">Something went wrong loading your dashboard.</p>';
  }
}

init();
