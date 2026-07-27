// receipt.js: fetches and renders a printable payment receipt for one
// paid booking. The booking id comes from the query string, e.g.
// /receipt.html?id=42 — linked from My Bookings (student) and the
// hoster's received-bookings list.

const receiptContainer = document.getElementById('receipt-container');
const receiptActions = document.getElementById('receipt-actions');

function formatDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function showError(message) {
  receiptContainer.innerHTML = `<p class="state-message">${escapeHTML(message)}</p>`;
}

function renderReceipt(r) {
  receiptContainer.innerHTML = `
    <div class="receipt-card">
      <div class="receipt-head">
        <div>
          <div class="logo">Kelly<span class="accent">Lodge</span></div>
          <span class="receipt-status">Paid</span>
        </div>
        <div class="receipt-meta">
          <div><strong>${escapeHTML(r.receipt_no)}</strong></div>
          <div>Booking #${r.booking_id}</div>
        </div>
      </div>

      <div class="receipt-section">
        <h4>Billed To</h4>
        <div class="receipt-row"><span class="label">Student</span><span class="value">${escapeHTML(r.student_name)}</span></div>
        <div class="receipt-row"><span class="label">Email</span><span class="value">${escapeHTML(r.student_email)}</span></div>
        <div class="receipt-row"><span class="label">Phone</span><span class="value">${escapeHTML(r.student_phone || '—')}</span></div>
      </div>

      <div class="receipt-section">
        <h4>Booking Details</h4>
        <div class="receipt-row"><span class="label">Hostel</span><span class="value">${escapeHTML(r.listing_title)}</span></div>
        <div class="receipt-row"><span class="label">Area</span><span class="value">${escapeHTML(r.area || '—')}</span></div>
        <div class="receipt-row"><span class="label">Room Type</span><span class="value">${escapeHTML(r.room_type)}</span></div>
        <div class="receipt-row"><span class="label">Room Number</span><span class="value">${escapeHTML(r.room_number || 'Pending assignment')}</span></div>
        <div class="receipt-row"><span class="label">Hostel Owner</span><span class="value">${escapeHTML(r.owner_name)}</span></div>
      </div>

      <div class="receipt-section">
        <h4>Payment</h4>
        <div class="receipt-row"><span class="label">Booked On</span><span class="value">${formatDate(r.booked_at)}</span></div>
        <div class="receipt-row"><span class="label">Paid On</span><span class="value">${formatDate(r.paid_at)}</span></div>
        <div class="receipt-row"><span class="label">Payment Reference</span><span class="value">${escapeHTML(r.paystack_reference || '—')}</span></div>
      </div>

      <div class="receipt-total">
        <span class="label">Amount Paid</span>
        <span class="value">GH₵ ${Number(r.price).toLocaleString()}</span>
      </div>

      <p class="receipt-footer-note">
        This receipt confirms payment received through KellyLodge for the room and dates above.
        Keep it for your records — present it to the hostel owner on arrival if requested.
      </p>
    </div>
  `;
  receiptActions.style.display = 'flex';
}

async function init() {
  const params = new URLSearchParams(window.location.search);
  const id = params.get('id');

  if (!id) {
    showError('No booking specified.');
    return;
  }

  const authRes = await fetch('/api/auth/me', { credentials: 'include' });
  const { user } = await authRes.json();
  if (!user) {
    showError('Please log in to view this receipt.');
    return;
  }

  try {
    const res = await fetch(`/api/bookings/${id}/receipt`, { credentials: 'include' });
    const data = await res.json();
    if (!res.ok) {
      showError(data.error || 'Could not load this receipt.');
      return;
    }
    renderReceipt(data);
  } catch (err) {
    console.error(err);
    showError('Something went wrong loading this receipt.');
  }
}

init();

document.getElementById('print-btn')?.addEventListener('click', () => window.print());
