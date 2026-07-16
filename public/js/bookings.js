// bookings.js: powers the My Bookings page

const bookingsContainer = document.getElementById('bookings-container');
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

  bookingsContainer.innerHTML = `
    <div class="gate-message">
      <div class="icon-lock">🔑</div>
      <h2>${heading}</h2>
      <p>${shownMessage}</p>
      <a href="/login.html" class="btn btn-gold">Log in</a>
    </div>
  `;
}

function timeRemainingText(deadline) {
  const diffMs = new Date(deadline).getTime() - Date.now();
  if (diffMs <= 0) return 'Payment window has closed';
  const hours = Math.floor(diffMs / (1000 * 60 * 60));
  const minutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
  if (hours >= 1) return `${hours}h ${minutes}m left to pay`;
  return `${minutes}m left to pay`;
}

function paymentBadgeHTML(booking) {
  if (booking.payment_status === 'paid') {
    return '<span class="payment-badge paid">Paid</span>';
  }
  if (booking.payment_status === 'expired') {
    return '<span class="payment-badge expired">Expired, unpaid</span>';
  }
  return `<span class="payment-badge pending">Pending payment, ${timeRemainingText(booking.payment_deadline)}</span>`;
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
        ${paymentBadgeHTML(b)}
        ${b.payment_status === 'paid' && b.room_number ? `<div class="room-assigned">Your room: <strong>${escapeHTML(b.room_number)}</strong></div>` : ''}
        <div class="booking-owner">Owner: ${escapeHTML(b.owner_name)}, <a href="tel:${b.owner_phone}">${b.owner_phone}</a></div>
      </div>
      <div class="booking-actions">
        ${b.payment_status === 'pending' ? `<button class="btn btn-gold btn-small pay-btn" data-booking-id="${b.id}">Pay now</button>` : ''}
        ${b.payment_status === 'pending' ? `<button class="btn btn-danger btn-small cancel-btn" data-booking-id="${b.id}">Cancel</button>` : ''}
      </div>
    </div>
  `).join('');

  document.querySelectorAll('.cancel-btn').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (!confirm('Cancel this booking? The room will become available again.')) return;
      const id = btn.getAttribute('data-booking-id');
      try {
        const res = await secureFetch(`/api/bookings/${id}`, { method: 'DELETE' });
        const data = await res.json();
        if (!res.ok) {
          showToast(data.error || 'Could not cancel this booking.');
          return;
        }
        document.querySelector(`.booking-item[data-booking-id="${id}"]`).remove();
      } catch (err) {
        showToast('Could not cancel this booking.');
      }
    });
  });

  document.querySelectorAll('.pay-btn').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const bookingId = btn.getAttribute('data-booking-id');
      btn.disabled = true;
      btn.textContent = 'Redirecting…';

      try {
        const res = await secureFetch('/api/payments/initialize', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ booking_id: bookingId }),
        });
        const data = await res.json();

        if (!res.ok) {
          showToast(data.error || 'Could not start the payment.');
          btn.disabled = false;
          btn.textContent = 'Pay now';
          return;
        }

        window.location.href = data.authorization_url;
      } catch (err) {
        console.error(err);
        showToast('Could not reach the payment server. Please try again.');
        btn.disabled = false;
        btn.textContent = 'Pay now';
      }
    });
  });
}

async function init() {
  const res = await fetch('/api/auth/me', { credentials: 'include' });
  const { user } = await res.json();

  if (!user) return gate('You need to log in to view your bookings.');
  if (user.role !== 'student') return gate('Only students have bookings to view.', 'Not for this account');

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

// If the browser restores this page from its back/forward cache (e.g. the
// student clicked "Pay now", then hit the browser's back button instead of
// completing checkout on Paystack), the page comes back exactly as it was
// frozen, including a "Redirecting…" button stuck disabled. Reloading the
// bookings fresh on restore fixes both that stale button and shows the
// booking's real current payment status.
window.addEventListener('pageshow', (event) => {
  if (event.persisted) init();
});
