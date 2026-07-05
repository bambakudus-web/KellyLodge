// main.js — powers the homepage: fetch listings, render cards, handle filters, and paginate

const listingContainer = document.getElementById('listing-container');
const filterForm = document.getElementById('filter-form');
const clearFiltersBtn = document.getElementById('clear-filters');

const PLACEHOLDER_IMAGE = 'https://images.unsplash.com/photo-1560448204-e02f11c3d0e2?w=600';
let currentPage = 1;

function buildQueryUrl(page) {
  const area = document.getElementById('area').value;
  const minPrice = document.getElementById('minPrice').value;
  const maxPrice = document.getElementById('maxPrice').value;

  const params = new URLSearchParams();
  if (area) params.set('area', area);
  if (minPrice) params.set('minPrice', minPrice);
  if (maxPrice) params.set('maxPrice', maxPrice);
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
    const card = document.createElement('a');
    card.href = `/listing.html?id=${listing.id}`;
    card.className = 'listing-card';
    const roomsAvailable = Number(listing.rooms_available || 0);
    const roomsBadge = roomsAvailable > 0
      ? `<span class="rooms-left">${roomsAvailable} room${roomsAvailable === 1 ? '' : 's'} available</span>`
      : `<span class="rooms-left rooms-full">Fully booked</span>`;
    card.innerHTML = `
      <div class="card-photo">
        <img src="${listing.image_url || PLACEHOLDER_IMAGE}" alt="${escapeHTML(listing.title)}" />
        ${areaChipHTML(listing.area)}
      </div>
      <div class="card-stub">
        <span class="notch-l"></span><span class="notch-r"></span>
        <h3>${escapeHTML(listing.title)}</h3>
        <div class="price">From GH₵ ${Number(listing.price).toLocaleString()} <span class="unit">/ year</span></div>
        <div class="room-type">${listing.room_type}</div>
        ${roomsBadge}
      </div>
    `;
    grid.appendChild(card);
  });

  listingContainer.innerHTML = '';
  listingContainer.appendChild(grid);
  listingContainer.insertAdjacentHTML('beforeend', paginationHTML(page, totalPages));

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

async function maybeShowGuestBanner() {
  try {
    const res = await fetch('/api/auth/me', { credentials: 'include' });
    const { user } = await res.json();
    if (user) return;

    const banner = document.createElement('div');
    banner.className = 'access-banner';
    banner.innerHTML = `
      <span>Browsing as a guest — you can see hostels here, but you'll need an account to view available rooms and book instantly.</span>
      <span class="access-banner-actions">
        <a href="/login.html" class="btn btn-outline btn-small">Log in</a>
        <a href="/signup.html" class="btn btn-gold btn-small">Sign up</a>
      </span>
    `;
    document.querySelector('.filter-bar').insertAdjacentElement('beforebegin', banner);
  } catch (err) {
    console.error('Could not check login state:', err);
  }
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

maybeShowGuestBanner();
loadListings();
