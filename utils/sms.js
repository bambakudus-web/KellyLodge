// utils/sms.js — all Arkesel SMS notifications for KellyLodge
require('dotenv').config();

const ARKESEL_API_KEY = process.env.ARKESEL_API_KEY;
const ARKESEL_SENDER_ID = process.env.ARKESEL_SENDER_ID || 'KellyLodge';
const ARKESEL_URL = 'https://sms.arkesel.com/api/v2/sms/send';

// Arkesel expects Ghanaian numbers in international format (233XXXXXXXXX),
// not the local 0XXXXXXXXX format most people type in.
function toInternationalGhana(rawPhone) {
  const digits = String(rawPhone || '').replace(/\D/g, '');
  if (digits.startsWith('233')) return digits;
  if (digits.startsWith('0')) return `233${digits.slice(1)}`;
  return digits;
}

async function sendSMS({ toPhone, message }) {
  if (!ARKESEL_API_KEY) {
    console.warn(`ARKESEL_API_KEY not set — skipping SMS to ${toPhone}: "${message}"`);
    return;
  }

  const recipient = toInternationalGhana(toPhone);
  if (!recipient) {
    console.warn('No valid phone number to send SMS to, skipping.');
    return;
  }

  try {
    const res = await fetch(ARKESEL_URL, {
      method: 'POST',
      headers: {
        'api-key': ARKESEL_API_KEY,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        sender: ARKESEL_SENDER_ID,
        message,
        recipients: [recipient],
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      console.error(`Arkesel SMS to ${recipient} failed:`, res.status, errText);
      return;
    }

    const data = await res.json();
    if (data.status && data.status !== 'success') {
      console.error(`Arkesel SMS to ${recipient} returned a non-success status:`, data);
    }
  } catch (err) {
    console.error(`Error sending SMS to ${recipient}:`, err);
  }
}

async function sendBookingSMSToOwner({ ownerPhone, studentName, studentPhone, listingTitle, roomType }) {
  const message = `KellyLodge: ${studentName} (${studentPhone}) just booked "${roomType}" at ${listingTitle}. They have 72 hours to complete payment. Check your dashboard for details.`;
  await sendSMS({ toPhone: ownerPhone, message });
}

async function sendBookingSMSToStudent({ studentPhone, listingTitle, roomType, price, deadline }) {
  const deadlineText = deadline.toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  const message = `KellyLodge: your room "${roomType}" at ${listingTitle} (GHC ${Number(price).toLocaleString()}/year) is on hold. Pay by ${deadlineText} (72 hours) or the booking will be cancelled. Check My Bookings to pay now.`;
  await sendSMS({ toPhone: studentPhone, message });
}

async function sendPaymentConfirmationSMSToStudent({ studentPhone, listingTitle }) {
  const message = `KellyLodge: payment received! Your booking at ${listingTitle} is confirmed. Thank you for using KellyLodge.`;
  await sendSMS({ toPhone: studentPhone, message });
}

async function sendPaymentConfirmationSMSToOwner({ ownerPhone, studentName, listingTitle }) {
  const message = `KellyLodge: ${studentName} has completed payment for their booking at ${listingTitle}. The booking is now confirmed.`;
  await sendSMS({ toPhone: ownerPhone, message });
}

async function sendBookingExpiredSMSToStudent({ studentPhone, listingTitle }) {
  const message = `KellyLodge: your booking at ${listingTitle} was cancelled because payment wasn't completed within 72 hours. You're welcome to book again if the room is still available.`;
  await sendSMS({ toPhone: studentPhone, message });
}

module.exports = {
  sendSMS,
  sendBookingSMSToOwner,
  sendBookingSMSToStudent,
  sendPaymentConfirmationSMSToStudent,
  sendPaymentConfirmationSMSToOwner,
  sendBookingExpiredSMSToStudent,
};
