// favorites.js: powers the My Favorites (shortlist) page

const favoritesContainer = document.getElementById('favorites-container');
const PLACEHOLDER_IMAGE = 'https://images.unsplash.com/photo-1560448204-e02f11c3d0e2?w=600';

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

  favoritesContainer.innerHTML = `
    <div class="gate-message">
      <div class="icon-lock">🔑</div>
      <h2>${heading}</h2>
      <p>${shownMessage}</p>
      <a href="/login.html" class="btn btn-gold">Log in</a>
    </div>
  `;
}

function renderFavorites(favorites) {
  if (favorites.length === 0) {
    favoritesContainer.innerHTML = `
      <div class="state-message">
        You haven't saved any hostels yet. <a href="/index.html" style="color: var(--brass-dark); font-weight: 700;">Browse hostels</a> and tap the heart on ones you like.
      </div>`;
    return;
  }

  favoritesContainer.innerHTML = favorites.map((f) => {
    const roomsAvailable = Number(f.rooms_available || 0);
    const roomsBadge = roomsAvailable > 0
      ? `<span class="rooms-left">${roomsAvailable} room${roomsAvailable === 1 ? '' : 's'} available</span>`
      : `<span class="rooms-left rooms-full">Fully booked</span>`;
    const distanceBadge = (f.distance_minutes !== null && f.distance_minutes !== undefined)
      ? `<span class="card-distance">🚶 ${f.distance_minutes} min</span>`
      : '';

    return `
    <div class="booking-item" data-listing-id="${f.id}">
      <img src="${f.image_url || PLACEHOLDER_IMAGE}" alt="${escapeHTML(f.title)}" />
      <div class="booking-details">
        <h3><a href="/listing.html?id=${f.id}">${escapeHTML(f.title)}</a></h3>
        <div class="booking-meta">
          ${areaChipHTML(f.area)}
          ${distanceBadge}
        </div>
        <div class="price">GH₵ ${Number(f.price).toLocaleString()} <span class="unit">/ year</span></div>
        ${roomsBadge}
      </div>
      <button class="btn btn-danger btn-small remove-favorite-btn" data-listing-id="${f.id}">Remove</button>
    </div>
  `;
  }).join('');

  document.querySelectorAll('.remove-favorite-btn').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const listingId = btn.getAttribute('data-listing-id');
      try {
        const res = await secureFetch(`/api/favorites/${listingId}`, { method: 'DELETE' });
        if (!res.ok) throw new Error('Remove failed');
        document.querySelector(`.booking-item[data-listing-id="${listingId}"]`).remove();
      } catch (err) {
        alert('Could not remove this favorite.');
      }
    });
  });
}

async function init() {
  const res = await fetch('/api/auth/me', { credentials: 'include' });
  const { user } = await res.json();

  if (!user) return gate('You need to log in to view your favorites.');
  if (user.role !== 'student') return gate('Only students have a favorites list.', 'Not for this account');

  try {
    const favRes = await fetch('/api/favorites/mine', { credentials: 'include' });
    if (!favRes.ok) throw new Error('Failed to fetch favorites');
    const favorites = await favRes.json();
    renderFavorites(favorites);
  } catch (err) {
    console.error(err);
    favoritesContainer.innerHTML = '<p class="state-message">Something went wrong loading your favorites.</p>';
  }
}

init();
