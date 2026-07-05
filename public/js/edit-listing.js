// edit-listing.js — pre-fills the post form with an existing listing and PUTs the changes

const container = document.getElementById('edit-container');

const VALID_ROOM_TYPES = [
  'Single (self-contained)',
  'Shared (2 in a room)',
  'Shared (3 in a room)',
  'Shared (4 in a room)',
];
const MIN_PRICE = 3000;

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
          <input type="number" id="rt-price-${i}" class="rt-price" min="${MIN_PRICE}" step="0.01"
                 value="${existing ? existing.price : ''}" placeholder="from ${MIN_PRICE}" />
        </div>
        <div class="rt-field">
          <label for="rt-qty-${i}">Quantity</label>
          <input type="number" id="rt-qty-${i}" class="rt-qty" min="0" step="1"
                 value="${existing ? existing.total_quantity : ''}" placeholder="0" />
        </div>
        ${existing && existing.total_quantity > existing.available_quantity
          ? `<span class="form-note">${existing.total_quantity - existing.available_quantity} already booked — quantity can't go below this.</span>`
          : ''}
      </div>
    `;
  }).join('');
}

function formHTML(listing) {
  const areaOptions = ['Fante New Town', 'Asafo', 'Amakom'].map((a) =>
    `<option value="${a}" ${listing.area === a ? 'selected' : ''}>${a}</option>`
  ).join('');

  return `
    <section class="hero"><h1>Edit your hostel</h1><p>Update details, pricing, or availability.</p></section>
    <div class="form-wrap">
      <div class="form-error" id="form-error"></div>
      <div class="form-success" id="form-success"></div>

      <form id="edit-form">
        <div class="form-group">
          <label for="title">Hostel name</label>
          <input type="text" id="title" name="title" value="${listing.title}" required />
        </div>

        <div class="form-group">
          <label for="description">Description</label>
          <textarea id="description" name="description">${listing.description || ''}</textarea>
        </div>

        <div class="form-group">
          <label for="area">Area</label>
          <select id="area" name="area" required>${areaOptions}</select>
        </div>

        <div class="form-group">
          <label>Room types &amp; availability</label>
          <p class="form-note">You can't shrink a room type below its currently booked count, or remove one that still has active bookings.</p>
          <div class="room-type-grid" id="room-type-grid">
            ${roomTypeRowsHTML(listing.room_types)}
          </div>
        </div>

        <div class="form-group">
          <label for="image">Replace photo (optional)</label>
          ${listing.image_url ? `<img src="${listing.image_url}" class="image-preview" style="display:block;" alt="Current photo" />` : ''}
          <input type="file" id="image" name="image" accept="image/*" />
          <span class="form-note">Leave blank to keep the current photo.</span>
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
      if (price < MIN_PRICE) {
        hasInvalidPrice = true;
        return;
      }
      roomTypes.push({ room_type: row.getAttribute('data-room-type'), price, quantity });
    }
  });

  return { roomTypes, hasInvalidPrice };
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

  const form = document.getElementById('edit-form');
  const errorBox = document.getElementById('form-error');
  const successBox = document.getElementById('form-success');

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    errorBox.style.display = 'none';
    successBox.style.display = 'none';

    const title = document.getElementById('title').value.trim();
    const description = document.getElementById('description').value.trim();
    const area = document.getElementById('area').value;
    const imageFile = document.getElementById('image').files[0];
    const { roomTypes, hasInvalidPrice } = collectRoomTypes();

    if (hasInvalidPrice) {
      errorBox.textContent = `Every room type needs a price of at least GH₵${MIN_PRICE.toLocaleString()}.`;
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
    formData.append('room_types', JSON.stringify(roomTypes));
    if (imageFile) formData.append('image', imageFile);

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
