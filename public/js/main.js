// main.js: powers the homepage: fetch listings, render cards, handle filters, and paginate

const listingContainer = document.getElementById('listing-container');
const filterForm = document.getElementById('filter-form');
const clearFiltersBtn = document.getElementById('clear-filters');
const areaSelect = document.getElementById('area');

const PLACEHOLDER_IMAGE = 'https://images.unsplash.com/photo-1560448204-e02f11c3d0e2?w=600';
let currentPage = 1;
let currentUser = null;
let favoritedIds = new Set();

function starsHTML(rating) {
  const rounded = Math.round(Number(rating) || 0);
  let out = '';
  for (let i = 1; i <= 5; i++) out += i <= rounded ? '★' : '☆';
  return out;
}

async function loadAreaOptions() {
  try {
    const res = await fetch('/api/listings/areas');
    if (!res.ok) return;
    const { areas } = await res.json();
    const previousValue = areaSelect.value;

    areaSelect.innerHTML = '<option value="">All areas</option>' +
      areas.map((a) => `<option value="${a}">${a}</option>`).join('');

    if (areas.includes(previousValue)) areaSelect.value = previousValue;
  } catch (err) {
    console.error('Could not load area list:', err);
  }
}

async function loadFavoriteIds() {
  if (!currentUser || currentUser.role !== 'student') return;
  try {
    const res = await fetch('/api/favorites/mine/ids', { credentials: 'include' });
    if (!res.ok) return;
    const { listingIds } = await res.json();
    favoritedIds = new Set(listingIds);
  } catch (err) {
    console.error('Could not load favorites:', err);
  }
}

function buildQueryUrl(page) {
  const area = areaSelect.value;
  const minPrice = document.getElementById('minPrice').value;
  const maxPrice = document.getElementById('maxPrice').value;
  const search = document.getElementById('search').value.trim();

  const params = new URLSearchParams();
  if (area) params.set('area', area);
  if (minPrice) params.set('minPrice', minPrice);
  if (maxPrice) params.set('maxPrice', maxPrice);
  if (search) params.set('search', search);
  params.set('page', page);

  return `/api/listings?${params.toString()}`;
}

function paginationHTML(page, totalPages) {
  if (totalPages <= 1) return '';
  return `
    <div class="pagination">
      <button class="btn btn-outline btn-small" id="prev-page" ${page <= 1 ? 'disabled' : ''}>&larr; Previous</button>
      <span class="pagination-status">Page ${page} of ${totalPages}</span>
      <button class="btn btn-outline btn-small" id="next-page" ${page >= totalPages ? 'disabled' : ''}>Next &rarr;</button>
    </div>
  `;
}

function favoriteOverlayHTML(listingId) {
  const isFavorited = favoritedIds.has(listingId);
  return `
    <button class="favorite-btn-overlay ${isFavorited ? 'active' : ''}" data-listing-id="${listingId}" data-favorited="${isFavorited}" title="${isFavorited ? 'Remove from favorites' : 'Save to favorites'}">
      ${isFavorited ? '♥' : '♡'}
    </button>
  `;
}

function attachFavoriteOverlayHandlers() {
  document.querySelectorAll('.favorite-btn-overlay').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();

      const listingId = Number(btn.getAttribute('data-listing-id'));
      const isFavorited = btn.getAttribute('data-favorited') === 'true';
      btn.disabled = true;

      try {
        const res = await secureFetch(isFavorited ? `/api/favorites/${listingId}` : '/api/favorites', {
          method: isFavorited ? 'DELETE' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: isFavorited ? undefined : JSON.stringify({ listing_id: listingId }),
        });
        if (!res.ok) throw new Error('Favorite toggle failed');

        const nowFavorited = !isFavorited;
        if (nowFavorited) favoritedIds.add(listingId); else favoritedIds.delete(listingId);
        btn.setAttribute('data-favorited', nowFavorited);
        btn.classList.toggle('active', nowFavorited);
        btn.innerHTML = nowFavorited ? '♥' : '♡';
        btn.title = nowFavorited ? 'Remove from favorites' : 'Save to favorites';
      } catch (err) {
        console.error(err);
      } finally {
        btn.disabled = false;
      }
    });
  });
}

function renderListings(listings, page, totalPages) {
  if (listings.length === 0) {
    listingContainer.innerHTML = `
      <div class="state-message">
        No hostels match those filters yet. Try widening your search, or
        <a href="/post.html" style="color: var(--brass-dark); font-weight: 700;">post the first one</a>.
      </div>`;
    return;
  }

  const grid = document.createElement('div');
  grid.className = 'listing-grid';

  listings.forEach((listing) => {
    const card = document.createElement('div');
    card.className = 'listing-card';
    const roomsAvailable = Number(listing.rooms_available || 0);
    const roomsBadge = roomsAvailable > 0
      ? `<span class="rooms-left">${roomsAvailable} room${roomsAvailable === 1 ? '' : 's'} available</span>`
      : `<span class="rooms-left rooms-full">Fully booked</span>`;

    const ratingBadge = listing.review_count > 0
      ? `<span class="card-rating"><span class="rating-stars">${starsHTML(listing.avg_rating)}</span> ${Number(listing.avg_rating).toFixed(1)}</span>`
      : '';
    const distanceBadge = (listing.distance_minutes !== null && listing.distance_minutes !== undefined)
      ? `<span class="card-distance">🚶 ${listing.distance_minutes} min</span>`
      : '';

    card.innerHTML = `
      <a href="/listing.html?id=${listing.id}" class="card-link">
        <div class="card-photo">
          <img src="${listing.image_url || PLACEHOLDER_IMAGE}" alt="${escapeHTML(listing.title)}" />
          ${areaChipHTML(listing.area)}
        </div>
        <div class="card-stub">
          <span class="notch-l"></span><span class="notch-r"></span>
          <h3>${escapeHTML(listing.title)}</h3>
          <div class="price">From GH₵ ${Number(listing.price).toLocaleString()} <span class="unit">/ year</span></div>
          <div class="room-type">${listing.room_type}</div>
          <div class="card-meta-row">${ratingBadge}${distanceBadge}</div>
          ${roomsBadge}
        </div>
      </a>
      ${currentUser && currentUser.role === 'student' ? favoriteOverlayHTML(listing.id) : ''}
    `;
    grid.appendChild(card);
  });

  listingContainer.innerHTML = '';
  listingContainer.appendChild(grid);
  listingContainer.insertAdjacentHTML('beforeend', paginationHTML(page, totalPages));
  attachFavoriteOverlayHandlers();

  const prevBtn = document.getElementById('prev-page');
  const nextBtn = document.getElementById('next-page');
  if (prevBtn) prevBtn.addEventListener('click', () => { currentPage -= 1; loadListings(); });
  if (nextBtn) nextBtn.addEventListener('click', () => { currentPage += 1; loadListings(); });
}

async function loadListings() {
  listingContainer.innerHTML = '<p class="state-message">Loading listings…</p>';
  try {
    const res = await fetch(buildQueryUrl(currentPage));
    if (!res.ok) throw new Error('Failed to fetch listings');
    const data = await res.json();
    renderListings(data.listings, data.page, data.totalPages);
    window.scrollTo({ top: listingContainer.offsetTop - 80, behavior: 'smooth' });
  } catch (err) {
    console.error(err);
    listingContainer.innerHTML = '<p class="state-message">Something went wrong loading listings. Please refresh the page.</p>';
  }
}

function maybeShowGuestBanner() {
  if (currentUser) return;

  const banner = document.createElement('div');
  banner.className = 'access-banner';
  banner.innerHTML = `
    <span>Browsing as a guest, you can see hostels here, but you'll need an account to view available rooms and book instantly.</span>
    <span class="access-banner-actions">
      <a href="/login.html" class="btn btn-outline btn-small">Log in</a>
      <a href="/signup.html" class="btn btn-gold btn-small">Sign up</a>
    </span>
  `;
  document.querySelector('.filter-bar').insertAdjacentElement('beforebegin', banner);
}

filterForm.addEventListener('submit', (e) => {
  e.preventDefault();
  currentPage = 1;
  loadListings();
});

clearFiltersBtn.addEventListener('click', () => {
  filterForm.reset();
  currentPage = 1;
  loadListings();
});

async function init() {
  try {
    const res = await fetch('/api/auth/me', { credentials: 'include' });
    const data = await res.json();
    currentUser = data.user;
  } catch (err) {
    console.error('Could not check login state:', err);
  }

  maybeShowGuestBanner();
  await Promise.all([loadAreaOptions(), loadFavoriteIds()]);
  loadListings();
}

init();
