// listing.js: fetches and renders a single listing's detail page

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

function starsHTML(rating) {
  const rounded = Math.round(Number(rating) || 0);
  let out = '';
  for (let i = 1; i <= 5; i++) out += i <= rounded ? '★' : '☆';
  return out;
}

function ratingSummaryHTML(listing) {
  if (!listing.review_count || Number(listing.review_count) === 0) {
    return '<span class="rating-summary rating-summary-empty">No reviews yet</span>';
  }
  return `<span class="rating-summary"><span class="rating-stars">${starsHTML(listing.avg_rating)}</span> ${Number(listing.avg_rating).toFixed(1)} (${listing.review_count} review${listing.review_count == 1 ? '' : 's'})</span>`;
}

function distanceBadgeHTML(listing) {
  if (listing.distance_minutes === null || listing.distance_minutes === undefined) return '';
  return `<span class="distance-badge">🚶 ${listing.distance_minutes} min from campus</span>`;
}

function galleryHTML(listing) {
  const photos = (listing.photos && listing.photos.length > 0)
    ? listing.photos
    : [{ id: 0, image_url: listing.image_url || PLACEHOLDER_IMAGE }];

  const thumbs = photos.length > 1
    ? `<div class="gallery-thumbs">
        ${photos.map((p, i) => `<img src="${p.image_url}" class="gallery-thumb ${i === 0 ? 'active' : ''}" data-full="${p.image_url}" alt="Photo ${i + 1}" />`).join('')}
      </div>`
    : '';

  return `
    <div class="gallery-wrap">
      <img src="${photos[0].image_url}" alt="${escapeHTML(listing.title)}" class="detail-image" id="gallery-main-image" />
      ${thumbs}
    </div>
  `;
}

function attachGalleryHandlers() {
  const mainImage = document.getElementById('gallery-main-image');
  document.querySelectorAll('.gallery-thumb').forEach((thumb) => {
    thumb.addEventListener('click', () => {
      mainImage.src = thumb.getAttribute('data-full');
      document.querySelectorAll('.gallery-thumb').forEach((t) => t.classList.remove('active'));
      thumb.classList.add('active');
    });
  });
}

function favoriteButtonHTML(isFavorited) {
  return `
    <button id="favorite-btn" class="favorite-btn ${isFavorited ? 'active' : ''}" data-favorited="${isFavorited}" title="${isFavorited ? 'Remove from favorites' : 'Save to favorites'}">
      ${isFavorited ? '♥' : '♡'} ${isFavorited ? 'Saved' : 'Save'}
    </button>
  `;
}

function attachFavoriteHandler(listingId) {
  const btn = document.getElementById('favorite-btn');
  if (!btn) return;

  btn.addEventListener('click', async () => {
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
      btn.setAttribute('data-favorited', nowFavorited);
      btn.classList.toggle('active', nowFavorited);
      btn.innerHTML = `${nowFavorited ? '♥' : '♡'} ${nowFavorited ? 'Saved' : 'Save'}`;
      btn.title = nowFavorited ? 'Remove from favorites' : 'Save to favorites';
    } catch (err) {
      console.error(err);
      alert('Could not update favorites. Please try again.');
    } finally {
      btn.disabled = false;
    }
  });
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
        ${!isOwner && currentUser.role === 'student' ? `<button class="btn btn-ghost-gold btn-small message-owner-btn" data-listing-id="${listing.id}">Message</button>` : ''}
      </div>
    </div>
  `;
}

function attachMessageOwnerHandler() {
  const btn = document.querySelector('.message-owner-btn');
  if (!btn) return;

  btn.addEventListener('click', () => {
    if (!window.KellyLodgeChatWidget) {
      alert('Chat is still loading, please try again in a moment.');
      return;
    }
    window.KellyLodgeChatWidget.openConversationFor(btn.dataset.listingId);
  });
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

        messageBox.innerHTML = `Room held for 72 hours! Pay now in <a href="/mybookings.html">My Bookings</a> to confirm it, or it will be released automatically if payment isn't completed in time.`;
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

function reviewItemHTML(review) {
  const date = new Date(review.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  return `
    <div class="review-item">
      <div class="review-item-head">
        <span class="review-stars">${starsHTML(review.rating)}</span>
        <span class="review-author">${escapeHTML(review.student_name)}</span>
        <span class="review-date">${date}</span>
      </div>
      ${review.comment ? `<p class="review-comment">${escapeHTML(review.comment)}</p>` : ''}
    </div>
  `;
}

function reviewFormHTML() {
  return `
    <div class="review-form-wrap">
      <h4>Leave a review</h4>
      <div class="star-picker" id="star-picker">
        ${[1, 2, 3, 4, 5].map((n) => `<span class="star-pick" data-value="${n}">☆</span>`).join('')}
      </div>
      <textarea id="review-comment" placeholder="How was your stay? (optional)"></textarea>
      <button id="submit-review-btn" class="btn btn-outline btn-small">Submit review</button>
      <div class="form-note" id="review-form-note"></div>
    </div>
  `;
}

function attachStarPicker() {
  let selected = 0;
  const stars = document.querySelectorAll('.star-pick');
  stars.forEach((star) => {
    star.addEventListener('click', () => {
      selected = Number(star.getAttribute('data-value'));
      stars.forEach((s) => {
        s.textContent = Number(s.getAttribute('data-value')) <= selected ? '★' : '☆';
      });
    });
  });
  return () => selected;
}

function attachReviewSubmit(listingId, getSelectedStars, onSaved) {
  const btn = document.getElementById('submit-review-btn');
  const note = document.getElementById('review-form-note');

  btn.addEventListener('click', async () => {
    const rating = getSelectedStars();
    if (!rating) {
      note.textContent = 'Pick a star rating first.';
      return;
    }

    const comment = document.getElementById('review-comment').value.trim();
    btn.disabled = true;

    try {
      const res = await secureFetch('/api/reviews', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ listing_id: listingId, rating, comment }),
      });
      const data = await res.json();

      if (!res.ok) {
        note.textContent = data.error || 'Could not save your review.';
        btn.disabled = false;
        return;
      }

      note.textContent = data.message;
      onSaved();
    } catch (err) {
      console.error(err);
      note.textContent = 'Could not reach the server. Please try again.';
      btn.disabled = false;
    }
  });
}

async function loadReviewsSection(listing, currentUser) {
  const section = document.getElementById('reviews-section');
  if (!section) return;

  const [reviewsRes, canReviewRes] = await Promise.all([
    fetch(`/api/reviews/listing/${listing.id}`),
    currentUser && currentUser.role === 'student'
      ? fetch(`/api/reviews/can-review/${listing.id}`, { credentials: 'include' })
      : Promise.resolve(null),
  ]);

  const reviews = reviewsRes.ok ? await reviewsRes.json() : [];
  const canReview = canReviewRes && canReviewRes.ok ? (await canReviewRes.json()).canReview : false;

  const listHTML = reviews.length > 0
    ? reviews.map(reviewItemHTML).join('')
    : '<p class="state-message">No reviews yet, be the first to book and share how it went.</p>';

  section.innerHTML = `
    <h3>Reviews</h3>
    <div class="review-list">${listHTML}</div>
    ${canReview ? reviewFormHTML() : ''}
  `;

  if (canReview) {
    const getSelected = attachStarPicker();
    attachReviewSubmit(listing.id, getSelected, () => loadReviewsSection(listing, currentUser));
  }
}

function renderListing(listing, currentUser, isFavorited) {
  const canManage = currentUser && (currentUser.role === 'admin' || currentUser.id === listing.owner_id);
  const fromPrice = listing.room_types && listing.room_types.length > 0
    ? Math.min(...listing.room_types.map((rt) => Number(rt.price)))
    : Number(listing.price);

  detailContainer.innerHTML = `
    <a href="/index.html" class="back-link">&larr; Back to all listings</a>
    ${galleryHTML(listing)}
    <div class="detail-title-row">
      <h1>${escapeHTML(listing.title)}</h1>
      ${currentUser && currentUser.role === 'student' ? favoriteButtonHTML(isFavorited) : ''}
    </div>
    <div class="detail-meta">
      ${areaChipHTML(listing.area)}
      ${distanceBadgeHTML(listing)}
      ${ratingSummaryHTML(listing)}
    </div>
    <div class="detail-price">From GH₵ ${fromPrice.toLocaleString()} <span class="unit">/ year</span></div>
    <p>${listing.description ? escapeHTML(listing.description) : 'No description provided.'}</p>

    ${roomsSectionHTML(listing, currentUser)}

    ${canManage ? `<p style="margin-top: 1.2rem; display:flex; gap:0.6rem;"><a href="/edit-listing.html?id=${listing.id}" class="btn btn-outline btn-small">Edit listing</a><button id="delete-btn" class="btn btn-danger btn-small">Remove this listing</button></p>` : ''}

    <div id="reviews-section" class="reviews-section"></div>
  `;

  attachGalleryHandlers();
  if (currentUser && currentUser.role === 'student') attachFavoriteHandler(listing.id);
  if (currentUser) attachBookHandlers();
  attachMessageOwnerHandler();
  loadReviewsSection(listing, currentUser);

  if (canManage) {
    document.getElementById('delete-btn').addEventListener('click', async () => {
      if (!confirm('Remove this listing? This cannot be undone.')) return;
      try {
        const res = await secureFetch(`/api/listings/${listing.id}`, { method: 'DELETE' });
        const data = await res.json();
        if (!res.ok) {
          alert(data.error || 'Could not remove listing.');
          return;
        }
        window.location.href = '/index.html';
      } catch (err) {
        alert('Could not reach the server. Please try again.');
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

    let isFavorited = false;
    if (currentUser && currentUser.role === 'student') {
      try {
        const favRes = await fetch('/api/favorites/mine/ids', { credentials: 'include' });
        if (favRes.ok) {
          const { listingIds } = await favRes.json();
          isFavorited = listingIds.includes(listing.id);
        }
      } catch {
        // non-critical, the heart just starts unfilled
      }
    }

    renderListing(listing, currentUser, isFavorited);
  } catch (err) {
    console.error(err);
    detailContainer.innerHTML += '<p class="state-message">Something went wrong loading this listing.</p>';
  }
}

loadListing();
