// post.js — gates the post-a-listing page to hosters/admins, then handles submission

const container = document.getElementById('post-container');

const VALID_ROOM_TYPES = [
  'Single (self-contained)',
  'Shared (2 in a room)',
  'Shared (3 in a room)',
  'Shared (4 in a room)',
];
const MIN_PRICE = 3000;

function roomTypeRowsHTML() {
  return VALID_ROOM_TYPES.map((type, i) => `
    <div class="room-type-row" data-room-type="${type}">
      <span class="rt-name">${type}</span>
      <div class="rt-field">
        <label for="rt-price-${i}">Price (GH₵/year)</label>
        <input type="number" id="rt-price-${i}" class="rt-price" min="${MIN_PRICE}" step="0.01" placeholder="from ${MIN_PRICE}" />
      </div>
      <div class="rt-field">
        <label for="rt-qty-${i}">Quantity</label>
        <input type="number" id="rt-qty-${i}" class="rt-qty" min="0" step="1" placeholder="0" />
      </div>
    </div>
  `).join('');
}

const FORM_HTML = `
  <div class="form-wrap">
    <h2>Post your hostel</h2>
    <p class="form-note">Fill in the details below. Description and photo are optional.</p>

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
        <select id="area" name="area" required>
          <option value="">Select an area</option>
          <option value="Fante New Town">Fante New Town</option>
          <option value="Asafo">Asafo</option>
          <option value="Amakom">Amakom</option>
        </select>
      </div>

      <div class="form-group">
        <label>Room types &amp; availability</label>
        <p class="form-note">Enter a price (GH₵${MIN_PRICE.toLocaleString()} minimum, per year) and quantity for each room type you offer — leave a type at 0 if you don't have it. If you have 300 rooms, this is where they all go, grouped by type.</p>
        <div class="room-type-grid" id="room-type-grid">
          ${roomTypeRowsHTML()}
        </div>
      </div>

      <div class="form-group">
        <label for="image">Hostel photo</label>
        <input type="file" id="image" name="image" accept="image/*" />
        <span class="form-note">Upload a photo from your device (JPG or PNG, up to 5MB).</span>
        <img id="image-preview" class="image-preview" style="display: none;" alt="Preview" />
      </div>

      <p class="form-note">Your contact details on the listing will use your account name and phone number.</p>

      <button type="submit" class="btn btn-gold btn-block">Post listing</button>
    </form>
  </div>
`;

function gate(message) {
  container.innerHTML = `
    <div class="gate-message">
      <div class="icon-lock">🔑</div>
      <h2>Access restricted</h2>
      <p>${message}</p>
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
      if (price < MIN_PRICE) {
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

function attachImagePreview() {
  const input = document.getElementById('image');
  const preview = document.getElementById('image-preview');

  input.addEventListener('change', () => {
    const file = input.files[0];
    if (!file) {
      preview.style.display = 'none';
      return;
    }
    const reader = new FileReader();
    reader.onload = (e) => {
      preview.src = e.target.result;
      preview.style.display = 'block';
    };
    reader.readAsDataURL(file);
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
    const area = document.getElementById('area').value;
    const imageFile = document.getElementById('image').files[0];
    const { roomTypes, hasInvalidPrice } = collectRoomTypes();

    if (!title || !area) {
      errorBox.textContent = 'Please fill in the hostel name and area.';
      errorBox.style.display = 'block';
      return;
    }

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
  if (user.role === 'student') return gate('Only hostel owners can post listings. Sign up as a hoster to list your property.');

  container.innerHTML = FORM_HTML;
  attachFormHandler();
  attachImagePreview();
}

init();
