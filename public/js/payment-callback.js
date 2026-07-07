// payment-callback.js — Paystack redirects here after checkout. The actual
// payment confirmation comes from the webhook (server-to-server), so this
// page just polls briefly until that's landed, then reports the result.

const titleEl = document.getElementById('callback-title');
const messageEl = document.getElementById('callback-message');

function getReferenceFromUrl() {
  const params = new URLSearchParams(window.location.search);
  return params.get('reference') || params.get('trxref');
}

async function findBookingByReference(reference) {
  const res = await fetch('/api/bookings/mine', { credentials: 'include' });
  if (!res.ok) return null;
  const bookings = await res.json();
  return bookings.find((b) => b.paystack_reference === reference) || null;
}

async function pollBookingStatus(bookingId, attemptsLeft) {
  try {
    const res = await fetch(`/api/payments/status/${bookingId}`, { credentials: 'include' });
    if (res.ok) {
      const { payment_status } = await res.json();
      if (payment_status === 'paid') {
        titleEl.textContent = 'Payment confirmed!';
        messageEl.textContent = 'Your booking is fully confirmed. A confirmation has been sent to your email and phone.';
        return;
      }
    }
  } catch (err) {
    console.error(err);
  }

  if (attemptsLeft <= 0) {
    titleEl.textContent = "Still confirming…";
    messageEl.textContent = "Your payment may still be processing. Check My Bookings in a moment, you'll get an email and SMS the moment it's confirmed.";
    return;
  }

  setTimeout(() => pollBookingStatus(bookingId, attemptsLeft - 1), 2000);
}

async function init() {
  const reference = getReferenceFromUrl();
  if (!reference) {
    titleEl.textContent = 'Payment processed';
    messageEl.textContent = 'Check My Bookings to see the current status of your booking.';
    return;
  }

  const booking = await findBookingByReference(reference);
  if (!booking) {
    titleEl.textContent = 'Payment processed';
    messageEl.textContent = 'Check My Bookings to see the current status of your booking.';
    return;
  }

  pollBookingStatus(booking.id, 7);
}

init();
