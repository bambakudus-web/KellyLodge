// edit-listing.js: pre-fills the post form with an existing listing and PUTs the changes

const container = document.getElementById('edit-container');

const VALID_ROOM_TYPES = [
  'Single (self-contained)',
  'Shared (2 in a room)',
  'Shared (3 in a room)',
  'Shared (4 in a room)',
];
const KNOWN_AREAS = ['Fante New Town', 'Asafo', 'Amakom'];
const MAX_PHOTOS = 5;

// listing_photo ids the hoster has marked for removal in this editing session
let pendingRemovePhotoIds = [];
// listing_photo id the hoster picked as the new cover (null = leave as-is)
let pendingCoverPhotoId = null;

function getListingIdFromUrl() {
  return new URLSearchParams(window.location.search).get('id');
}

function roomTypeRowsHTML(existingRoomTypes) {
  return VALID_ROOM_TYPES.map((type, i) => {
    const existing = existingRoomTypes.find((rt) => rt.room_type === type);
    return `
      <div class="room-type-row" data-room-type="${type}">
        <span class="rt-name">${type}</span>
        <div class="rt-field">
          <label for="rt-price-${i}">Price (GH₵/year)</label>
          <input type="number" id="rt-price-${i}" class="rt-price" min="1" step="0.01"
                 value="${existing ? existing.price : ''}" placeholder="e.g. 3000" />
        </div>
        <div class="rt-field">
          <label for="rt-qty-${i}">Quantity</label>
          <input type="number" id="rt-qty-${i}" class="rt-qty" min="0" step="1"
                 value="${existing ? existing.total_quantity : ''}" placeholder="0" />
        </div>
        ${existing && existing.total_quantity > existing.available_quantity
          ? `<span class="form-note">${existing.total_quantity - existing.available_quantity} already booked, quantity can't go below this.</span>`
          : ''}
      </div>
    `;
  }).join('');
}

function areaOptionsHTML(currentArea) {
  const isKnown = KNOWN_AREAS.includes(currentArea);
  const known = KNOWN_AREAS.map((a) =>
    `<option value="${a}" ${currentArea === a ? 'selected' : ''}>${a}</option>`
  ).join('');
  return `
    ${known}
    <option value="__other__" ${!isKnown ? 'selected' : ''}>Other (type it in)</option>
  `;
}

function existingPhotosHTML(photos) {
  if (!photos || photos.length === 0) {
    return '<p class="form-note">No photos yet, upload some below.</p>';
  }
  return `
    <div class="photo-preview-grid" id="existing-photo-grid">
      ${photos.map((p, i) => `
        <div class="photo-preview-item" data-photo-id="${p.id}">
          <img src="${p.image_url}" alt="Photo ${i + 1}" />
          ${i === 0
            ? '<span class="photo-preview-cover">Cover</span>'
            : '<button type="button" class="photo-cover-btn" data-photo-id="' + p.id + '">Set as cover</button>'}
          <button type="button" class="photo-remove-btn" data-photo-id="${p.id}" title="Remove this photo">&times;</button>
        </div>
      `).join('')}
    </div>
  `;
}

function formHTML(listing) {
  return `
    <section class="hero"><h1>Edit your hostel</h1><p>Update details, pricing, or availability.</p></section>
    <div class="form-wrap">
      <div class="form-error" id="form-error"></div>
      <div class="form-success" id="form-success"></div>

      <form id="edit-form">
        <div class="form-group">
          <label for="title">Hostel name</label>
          <input type="text" id="title" name="title" value="${escapeHTML(listing.title)}" required />
        </div>

        <div class="form-group">
          <label for="description">Description</label>
          <textarea id="description" name="description">${escapeHTML(listing.description || '')}</textarea>
        </div>

        <div class="form-group">
          <label for="area">Area</label>
          <select id="area" name="area" required>${areaOptionsHTML(listing.area)}</select>
          <input type="text" id="area-other" name="area-other" placeholder="Type the area name"
                 value="${KNOWN_AREAS.includes(listing.area) ? '' : escapeHTML(listing.area)}"
                 style="display:${KNOWN_AREAS.includes(listing.area) ? 'none' : 'block'}; margin-top: 0.5rem;" />
        </div>

        <div class="form-group">
          <label for="distance">Walking distance from KsTU main gate (minutes)</label>
          <input type="number" id="distance" name="distance" min="0" max="180" step="1"
                 value="${listing.distance_minutes !== null && listing.distance_minutes !== undefined ? listing.distance_minutes : ''}" placeholder="e.g. 10" />
          <span class="form-note">Optional, but it helps students judge the commute at a glance.</span>
        </div>

        <div class="form-group">
          <label>Room types &amp; availability</label>
          <p class="form-note">You can't shrink a room type below its currently booked count, or remove one that still has active bookings.</p>
          <div class="room-type-grid" id="room-type-grid">
            ${roomTypeRowsHTML(listing.room_types)}
          </div>
        </div>

        <div class="form-group">
          <label>Current photos</label>
          ${existingPhotosHTML(listing.photos)}
        </div>

        <div class="form-group">
          <label for="photos">Add more photos</label>
          <input type="file" id="photos" name="photos" accept="image/*" multiple />
          <span class="form-note">Up to ${MAX_PHOTOS} at once (JPG or PNG, up to 5MB each).</span>
          <div id="photo-preview-grid" class="photo-preview-grid"></div>
        </div>

        <button type="submit" class="btn btn-gold btn-block">Save changes</button>
      </form>
    </div>
  `;
}

function gate(message) {
  container.innerHTML = `
    <div class="gate-message">
      <div class="icon-lock">🔑</div>
      <h2>Access restricted</h2>
      <p>${message}</p>
      <a href="/index.html" class="btn btn-gold">Back to Browse</a>
    </div>
  `;
}

function collectRoomTypes() {
  const rows = document.querySelectorAll('.room-type-row');
  const roomTypes = [];
  let hasInvalidPrice = false;

  rows.forEach((row) => {
    const priceInput = row.querySelector('.rt-price');
    const qtyInput = row.querySelector('.rt-qty');
    const price = Number(priceInput.value);
    const quantity = Number(qtyInput.value);

    if (!priceInput.value && !qtyInput.value) return;

    if (quantity > 0) {
      if (isNaN(price) || price <= 0) {
        hasInvalidPrice = true;
        return;
      }
      roomTypes.push({ room_type: row.getAttribute('data-room-type'), price, quantity });
    }
  });

  return { roomTypes, hasInvalidPrice };
}

function attachAreaToggle() {
  const areaSelect = document.getElementById('area');
  const areaOther = document.getElementById('area-other');

  areaSelect.addEventListener('change', () => {
    if (areaSelect.value === '__other__') {
      areaOther.style.display = 'block';
      areaOther.focus();
    } else {
      areaOther.style.display = 'none';
      areaOther.value = '';
    }
  });
}

function getSelectedArea() {
  const areaSelect = document.getElementById('area');
  const areaOther = document.getElementById('area-other');
  if (areaSelect.value === '__other__') return areaOther.value.trim();
  return areaSelect.value;
}

function selectCoverPhoto(photoId) {
  pendingCoverPhotoId = photoId;

  // Move the "Cover" badge to this tile and put a "Set as cover" button
  // back on whichever tile used to have it, purely visual until the form
  // is actually saved.
  document.querySelectorAll('#existing-photo-grid .photo-preview-item').forEach((item) => {
    const itemId = Number(item.getAttribute('data-photo-id'));
    const existingBadge = item.querySelector('.photo-preview-cover');
    const existingBtn = item.querySelector('.photo-cover-btn');

    if (itemId === photoId) {
      if (existingBtn) existingBtn.remove();
      if (!existingBadge) {
        const badge = document.createElement('span');
        badge.className = 'photo-preview-cover';
        badge.textContent = 'Cover';
        item.insertBefore(badge, item.querySelector('.photo-remove-btn'));
      }
    } else if (existingBadge) {
      existingBadge.remove();
      if (!existingBtn) {
        const newBtn = document.createElement('button');
        newBtn.type = 'button';
        newBtn.className = 'photo-cover-btn';
        newBtn.setAttribute('data-photo-id', itemId);
        newBtn.textContent = 'Set as cover';
        item.insertBefore(newBtn, item.querySelector('.photo-remove-btn'));
        newBtn.addEventListener('click', () => selectCoverPhoto(itemId));
      }
    }
  });
}

function attachExistingPhotoRemoval() {
  document.querySelectorAll('.photo-remove-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const photoId = Number(btn.getAttribute('data-photo-id'));
      pendingRemovePhotoIds.push(photoId);
      if (pendingCoverPhotoId === photoId) pendingCoverPhotoId = null;
      btn.closest('.photo-preview-item').remove();
    });
  });
}

function attachSetCoverHandler() {
  document.querySelectorAll('.photo-cover-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      selectCoverPhoto(Number(btn.getAttribute('data-photo-id')));
    });
  });
}

function attachNewPhotoPreview() {
  const input = document.getElementById('photos');
  const grid = document.getElementById('photo-preview-grid');

  input.addEventListener('change', () => {
    grid.innerHTML = '';
    const files = Array.from(input.files).slice(0, MAX_PHOTOS);

    if (input.files.length > MAX_PHOTOS) {
      const notice = document.createElement('p');
      notice.className = 'form-note';
      notice.textContent = `Only the first ${MAX_PHOTOS} new photos will be uploaded.`;
      grid.appendChild(notice);
    }

    files.forEach((file, i) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        const wrap = document.createElement('div');
        wrap.className = 'photo-preview-item';
        wrap.innerHTML = `<img src="${e.target.result}" alt="New photo ${i + 1}" />`;
        grid.appendChild(wrap);
      };
      reader.readAsDataURL(file);
    });
  });
}

async function init() {
  const id = getListingIdFromUrl();
  if (!id) return gate('No listing specified.');

  const meRes = await fetch('/api/auth/me', { credentials: 'include' });
  const { user } = await meRes.json();
  if (!user) return gate('You need to log in to edit a listing.');

  const listingRes = await fetch(`/api/listings/${id}`);
  if (!listingRes.ok) return gate('This listing could not be found.');
  const listing = await listingRes.json();

  const canManage = user.role === 'admin' || user.id === listing.owner_id;
  if (!canManage) return gate('You can only edit your own listings.');

  container.innerHTML = formHTML(listing);
  attachAreaToggle();
  attachExistingPhotoRemoval();
  attachSetCoverHandler();
  attachNewPhotoPreview();

  const form = document.getElementById('edit-form');
  const errorBox = document.getElementById('form-error');
  const successBox = document.getElementById('form-success');

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    errorBox.style.display = 'none';
    successBox.style.display = 'none';

    const title = document.getElementById('title').value.trim();
    const description = document.getElementById('description').value.trim();
    const area = getSelectedArea();
    const distance = document.getElementById('distance').value;
    const photoFiles = Array.from(document.getElementById('photos').files).slice(0, MAX_PHOTOS);
    const { roomTypes, hasInvalidPrice } = collectRoomTypes();

    if (!title || !area) {
      errorBox.textContent = 'Please fill in the hostel name and area.';
      errorBox.style.display = 'block';
      return;
    }
    if (hasInvalidPrice) {
      errorBox.textContent = 'Every room type needs a valid price greater than 0.';
      errorBox.style.display = 'block';
      return;
    }
    if (roomTypes.length === 0) {
      errorBox.textContent = 'Add a price and quantity for at least one room type.';
      errorBox.style.display = 'block';
      return;
    }

    const formData = new FormData();
    formData.append('title', title);
    formData.append('description', description);
    formData.append('area', area);
    if (distance) formData.append('distance_minutes', distance);
    formData.append('room_types', JSON.stringify(roomTypes));
    formData.append('remove_photo_ids', JSON.stringify(pendingRemovePhotoIds));
    if (pendingCoverPhotoId !== null) formData.append('set_cover_photo_id', pendingCoverPhotoId);
    photoFiles.forEach((file) => formData.append('photos', file));

    try {
      const res = await secureFetch(`/api/listings/${id}`, { method: 'PUT', body: formData });
      const data = await res.json();

      if (!res.ok) {
        errorBox.textContent = data.error || 'Could not save changes.';
        errorBox.style.display = 'block';
        return;
      }

      successBox.textContent = 'Saved! Redirecting…';
      successBox.style.display = 'block';
      setTimeout(() => { window.location.href = `/listing.html?id=${id}`; }, 1000);
    } catch (err) {
      console.error(err);
      errorBox.textContent = 'Could not reach the server. Please try again.';
      errorBox.style.display = 'block';
    }
  });
}

init();
