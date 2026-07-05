// bookings.js — powers the My Bookings page

const bookingsContainer = document.getElementById('bookings-container');
const PLACEHOLDER_IMAGE = 'https://images.unsplash.com/photo-1560448204-e02f11c3d0e2?w=600';

function gate(message) {
  bookingsContainer.innerHTML = `
    <div class="gate-message">
      <div class="icon-lock">🔑</div>
      <h2>Access restricted</h2>
      <p>${message}</p>
      <a href="/login.html" class="btn btn-gold">Log in</a>
    </div>
  `;
}

function renderBookings(bookings) {
  if (bookings.length === 0) {
    bookingsContainer.innerHTML = `
      <div class="state-message">
        You haven't booked a room yet. <a href="/index.html" style="color: var(--brass-dark); font-weight: 700;">Browse hostels</a> to find one.
      </div>`;
    return;
  }

  bookingsContainer.innerHTML = bookings.map((b) => `
    <div class="booking-item" data-booking-id="${b.id}">
      <img src="${b.image_url || PLACEHOLDER_IMAGE}" alt="${escapeHTML(b.title)}" />
      <div class="booking-details">
        <h3><a href="/listing.html?id=${b.listing_id}">${escapeHTML(b.title)}</a></h3>
        <div class="booking-meta">
          ${areaChipHTML(b.area)}
          <span class="tag">${b.room_type}</span>
        </div>
        <div class="price">GH₵ ${Number(b.price).toLocaleString()} <span class="unit">/ year</span></div>
        <div class="booking-owner">Owner: ${escapeHTML(b.owner_name)} — <a href="tel:${b.owner_phone}">${b.owner_phone}</a></div>
      </div>
      <button class="btn btn-danger btn-small cancel-btn" data-booking-id="${b.id}">Cancel</button>
    </div>
  `).join('');

  document.querySelectorAll('.cancel-btn').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (!confirm('Cancel this booking? The room will become available again.')) return;
      const id = btn.getAttribute('data-booking-id');
      try {
        const res = await secureFetch(`/api/bookings/${id}`, { method: 'DELETE' });
        if (!res.ok) throw new Error('Cancel failed');
        document.querySelector(`.booking-item[data-booking-id="${id}"]`).remove();
      } catch (err) {
        alert('Could not cancel this booking.');
      }
    });
  });
}

async function init() {
  const res = await fetch('/api/auth/me', { credentials: 'include' });
  const { user } = await res.json();

  if (!user) return gate('You need to log in to view your bookings.');
  if (user.role !== 'student') return gate('Only students have bookings to view.');

  try {
    const bookingsRes = await fetch('/api/bookings/mine', { credentials: 'include' });
    if (!bookingsRes.ok) throw new Error('Failed to fetch bookings');
    const bookings = await bookingsRes.json();
    renderBookings(bookings);
  } catch (err) {
    console.error(err);
    bookingsContainer.innerHTML = '<p class="state-message">Something went wrong loading your bookings.</p>';
  }
}

init();
