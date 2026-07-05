// listing.js — fetches and renders a single listing's detail page

const detailContainer = document.getElementById('detail-container');
const PLACEHOLDER_IMAGE = 'https://images.unsplash.com/photo-1560448204-e02f11c3d0e2?w=600';

function getListingIdFromUrl() {
  const params = new URLSearchParams(window.location.search);
  return params.get('id');
}

async function getCurrentUserQuiet() {
  try {
    const res = await fetch('/api/auth/me', { credentials: 'include' });
    const data = await res.json();
    return data.user;
  } catch {
    return null;
  }
}

function roomsSectionHTML(listing, currentUser) {
  const isOwner = currentUser && (currentUser.role === 'admin' || currentUser.id === listing.owner_id);

  if (!currentUser) {
    return `
      <div class="rooms-box locked">
        <h3>Available rooms</h3>
        <p>Log in or sign up to see prices and availability by room type, and book instantly.</p>
        <div class="rooms-box-actions">
          <a href="/login.html" class="btn btn-ghost-light">Log in</a>
          <a href="/signup.html" class="btn btn-gold">Sign up</a>
        </div>
      </div>
    `;
  }

  const roomRows = listing.room_types.map((rt) => {
    const isFull = rt.available_quantity <= 0;
    let actionHTML = `<span class="room-status booked">Fully booked</span>`;

    if (!isFull) {
      if (isOwner) {
        actionHTML = `<span class="room-status open">Open</span>`;
      } else if (currentUser.role === 'student') {
        actionHTML = `<button class="btn btn-gold btn-small book-btn" data-room-type-id="${rt.id}">Book</button>`;
      } else {
        actionHTML = `<span class="room-status open">Open</span>`;
      }
    }

    return `
      <div class="room-item ${isFull ? 'booked' : ''}" data-room-type-id="${rt.id}">
        <span class="room-label">${rt.room_type}</span>
        <span class="room-price">GH₵ ${Number(rt.price).toLocaleString()}<span class="unit"> / year</span></span>
        <span class="room-availability">${rt.available_quantity} of ${rt.total_quantity} available</span>
        <span class="room-action">${actionHTML}</span>
      </div>
    `;
  }).join('');

  return `
    <div class="rooms-box">
      <h3>Available rooms</h3>
      <div class="room-list">${roomRows}</div>
      <div class="room-booking-message" id="room-booking-message"></div>
      <div class="contact-box-inline">
        <span class="owner-name">${escapeHTML(listing.owner_name)}</span>
        <a href="tel:${listing.owner_phone}" class="btn btn-ghost-light btn-small">Call ${listing.owner_phone}</a>
      </div>
    </div>
  `;
}

function attachBookHandlers() {
  const messageBox = document.getElementById('room-booking-message');
  document.querySelectorAll('.book-btn').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const roomTypeId = btn.getAttribute('data-room-type-id');
      if (!confirm('Book this room now? This is instant and cannot be undone from here.')) return;

      btn.disabled = true;
      btn.textContent = 'Booking…';

      try {
        const res = await secureFetch('/api/bookings', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ room_type_id: roomTypeId }),
        });
        const data = await res.json();

        if (!res.ok) {
          messageBox.textContent = data.error || 'Could not book this room.';
          messageBox.className = 'room-booking-message error';
          btn.disabled = false;
          btn.textContent = 'Book';
          return;
        }

        messageBox.innerHTML = `Booked! The owner has been notified by email. Find it in <a href="/mybookings.html">My Bookings</a>.`;
        messageBox.className = 'room-booking-message success';

        const roomItem = btn.closest('.room-item');
        const availabilitySpan = roomItem.querySelector('.room-availability');
        const [available, , total] = availabilitySpan.textContent.split(' ');
        const newAvailable = Number(available) - 1;
        availabilitySpan.textContent = `${newAvailable} of ${total} available`;

        if (newAvailable <= 0) {
          roomItem.classList.add('booked');
          roomItem.querySelector('.room-action').innerHTML = `<span class="room-status booked">Fully booked</span>`;
        } else {
          btn.disabled = false;
          btn.textContent = 'Book';
        }
      } catch (err) {
        console.error(err);
        messageBox.textContent = 'Could not reach the server. Please try again.';
        messageBox.className = 'room-booking-message error';
        btn.disabled = false;
        btn.textContent = 'Book';
      }
    });
  });
}

function renderListing(listing, currentUser) {
  const canManage = currentUser && (currentUser.role === 'admin' || currentUser.id === listing.owner_id);
  const fromPrice = listing.room_types && listing.room_types.length > 0
    ? Math.min(...listing.room_types.map((rt) => Number(rt.price)))
    : Number(listing.price);

  detailContainer.innerHTML = `
    <a href="/index.html" class="back-link">&larr; Back to all listings</a>
    <img src="${listing.image_url || PLACEHOLDER_IMAGE}" alt="${escapeHTML(listing.title)}" class="detail-image" />
    <h1>${escapeHTML(listing.title)}</h1>
    <div class="detail-meta">
      ${areaChipHTML(listing.area)}
    </div>
    <div class="detail-price">From GH₵ ${fromPrice.toLocaleString()} <span class="unit">/ year</span></div>
    <p>${listing.description ? escapeHTML(listing.description) : 'No description provided.'}</p>

    ${roomsSectionHTML(listing, currentUser)}

    ${canManage ? `<p style="margin-top: 1.2rem; display:flex; gap:0.6rem;"><a href="/edit-listing.html?id=${listing.id}" class="btn btn-outline btn-small">Edit listing</a><button id="delete-btn" class="btn btn-danger btn-small">Remove this listing</button></p>` : ''}
  `;

  if (currentUser) attachBookHandlers();

  if (canManage) {
    document.getElementById('delete-btn').addEventListener('click', async () => {
      if (!confirm('Remove this listing? This cannot be undone.')) return;
      try {
        const res = await secureFetch(`/api/listings/${listing.id}`, { method: 'DELETE' });
        if (!res.ok) throw new Error('Delete failed');
        window.location.href = '/index.html';
      } catch (err) {
        alert('Could not remove listing.');
      }
    });
  }
}

async function loadListing() {
  const id = getListingIdFromUrl();

  if (!id) {
    detailContainer.innerHTML += '<p class="state-message">No listing specified.</p>';
    return;
  }

  try {
    const [res, currentUser] = await Promise.all([
      fetch(`/api/listings/${id}`),
      getCurrentUserQuiet(),
    ]);

    if (res.status === 404) {
      detailContainer.innerHTML += '<p class="state-message">This listing could not be found. It may have been removed.</p>';
      return;
    }
    if (!res.ok) throw new Error('Failed to fetch listing');

    const listing = await res.json();
    renderListing(listing, currentUser);
  } catch (err) {
    console.error(err);
    detailContainer.innerHTML += '<p class="state-message">Something went wrong loading this listing.</p>';
  }
}

loadListing();
