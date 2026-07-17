// post.js: gates the post-a-listing page to hosters/admins, then handles submission

const container = document.getElementById('post-container');

const VALID_ROOM_TYPES = [
  'Single (self-contained)',
  'Shared (2 in a room)',
  'Shared (3 in a room)',
  'Shared (4 in a room)',
];
const KNOWN_AREAS = ['Fante New Town', 'Asafo', 'Amakom'];
const MAX_PHOTOS = 5;

function roomTypeRowsHTML() {
  return VALID_ROOM_TYPES.map((type, i) => `
    <div class="room-type-row" data-room-type="${type}">
      <span class="rt-name">${type}</span>
      <div class="rt-field">
        <label for="rt-price-${i}">Price (GH₵/year)</label>
        <input type="number" id="rt-price-${i}" class="rt-price" min="3000" step="0.01" placeholder="e.g. 3000" />
      </div>
      <div class="rt-field">
        <label for="rt-qty-${i}">Quantity</label>
        <input type="number" id="rt-qty-${i}" class="rt-qty" min="0" step="1" placeholder="0" />
      </div>
    </div>
  `).join('');
}

function areaOptionsHTML() {
  const known = KNOWN_AREAS.map((a) => `<option value="${a}">${a}</option>`).join('');
  return `
    <option value="">Select an area</option>
    ${known}
    <option value="__other__">Other (type it in)</option>
  `;
}

const FORM_HTML = `
  <div class="form-wrap">
    <h2>Post your hostel</h2>
    <p class="form-note">Fill in the details below. Description and photos are optional.</p>

    <div class="form-error" id="form-error"></div>
    <div class="form-success" id="form-success"></div>

    <form id="listing-form">
      <div class="form-group">
        <label for="title">Hostel name</label>
        <input type="text" id="title" name="title" required />
      </div>

      <div class="form-group">
        <label for="description">Description</label>
        <textarea id="description" name="description" placeholder="Tell students what makes this hostel a good place to stay"></textarea>
      </div>

      <div class="form-group">
        <label for="area">Area</label>
        <select id="area" name="area" required>${areaOptionsHTML()}</select>
        <input type="text" id="area-other" name="area-other" placeholder="Type the area name" style="display:none; margin-top: 0.5rem;" />
      </div>

      <div class="form-group">
        <label for="distance">Walking distance from KsTU main gate (minutes)</label>
        <input type="number" id="distance" name="distance" min="0" max="180" step="1" placeholder="e.g. 10" />
        <span class="form-note">Optional, but it helps students judge the commute at a glance.</span>
      </div>

      <div class="form-group">
        <label>Room types &amp; availability</label>
        <p class="form-note">Enter a price (per year) and quantity for each room type you offer, leave a type at 0 if you don't have it. If you have 300 rooms, this is where they all go, grouped by type.</p>
        <div class="room-type-grid" id="room-type-grid">
          ${roomTypeRowsHTML()}
        </div>
      </div>

      <div class="form-group">
        <label for="photos">Hostel photos</label>
        <input type="file" id="photos" name="photos" accept="image/*" multiple />
        <span class="form-note">Up to ${MAX_PHOTOS} photos (JPG or PNG, up to 5MB each). The first one becomes the cover photo.</span>
        <div id="photo-preview-grid" class="photo-preview-grid"></div>
      </div>

      <p class="form-note">Your contact details on the listing will use your account name and phone number.</p>

      <button type="submit" class="btn btn-gold btn-block">Post listing</button>
    </form>
  </div>
`;

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

  container.innerHTML = `
    <div class="gate-message">
      <div class="icon-lock">🔑</div>
      <h2>${heading}</h2>
      <p>${shownMessage}</p>
      <a href="/login.html" class="btn btn-gold">Log in</a>
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

    if (!priceInput.value && !qtyInput.value) return; // untouched row, skip silently

    if (quantity > 0) {
      if (isNaN(price) || price <= 0) {
        hasInvalidPrice = true;
        return;
      }
      roomTypes.push({
        room_type: row.getAttribute('data-room-type'),
        price,
        quantity,
      });
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

function attachPhotoPreview() {
  const input = document.getElementById('photos');
  const grid = document.getElementById('photo-preview-grid');

  input.addEventListener('change', () => {
    grid.innerHTML = '';
    const files = Array.from(input.files).slice(0, MAX_PHOTOS);

    if (input.files.length > MAX_PHOTOS) {
      const notice = document.createElement('p');
      notice.className = 'form-note';
      notice.textContent = `Only the first ${MAX_PHOTOS} photos will be uploaded.`;
      grid.appendChild(notice);
    }

    files.forEach((file, i) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        const wrap = document.createElement('div');
        wrap.className = 'photo-preview-item';
        wrap.innerHTML = `
          <img src="${e.target.result}" alt="Preview ${i + 1}" />
          ${i === 0 ? '<span class="photo-preview-cover">Cover</span>' : ''}
        `;
        grid.appendChild(wrap);
      };
      reader.readAsDataURL(file);
    });
  });
}

function attachFormHandler() {
  const form = document.getElementById('listing-form');
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
    photoFiles.forEach((file) => formData.append('photos', file));

    try {
      const res = await secureFetch('/api/listings', {
        method: 'POST',
        body: formData,
      });
      const data = await res.json();

      if (!res.ok) {
        errorBox.textContent = data.error || 'Something went wrong. Please try again.';
        errorBox.style.display = 'block';
        return;
      }

      successBox.textContent = 'Listing posted! Redirecting…';
      successBox.style.display = 'block';
      setTimeout(() => { window.location.href = `/listing.html?id=${data.id}`; }, 1200);
    } catch (err) {
      console.error(err);
      errorBox.textContent = 'Could not reach the server. Please try again.';
      errorBox.style.display = 'block';
    }
  });
}

async function init() {
  const res = await fetch('/api/auth/me', { credentials: 'include' });
  const { user } = await res.json();

  if (!user) return gate('You need to log in as a hostel owner to post a listing.');
  if (user.role === 'student') return gate('Only hostel owners can post listings. Sign up as a hoster to list your property.', 'Not for this account');

  container.innerHTML = FORM_HTML;
  attachFormHandler();
  attachAreaToggle();
  attachPhotoPreview();
}

init();
