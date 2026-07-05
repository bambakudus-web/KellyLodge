// utils/email.js — sends a booking notification to the hostel owner via Brevo
require('dotenv').config();

const BREVO_API_KEY = process.env.BREVO_API_KEY;
const SENDER_EMAIL = process.env.BREVO_SENDER_EMAIL || 'no-reply@kellylodge.com';
const SENDER_NAME = process.env.BREVO_SENDER_NAME || 'KellyLodge';

async function sendBookingNotification({
  ownerEmail,
  ownerName,
  studentName,
  studentPhone,
  studentEmail,
  listingTitle,
  roomType,
  price,
}) {
  if (!BREVO_API_KEY) {
    console.warn('BREVO_API_KEY not set — skipping booking email. The booking itself was still saved.');
    return;
  }

  const html = `
    <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #1a1a1a;">
      <h2 style="margin-bottom: 0.3em;">New room booking on KellyLodge</h2>
      <p>Hi ${ownerName},</p>
      <p><strong>${studentName}</strong> just booked a room at <strong>${listingTitle}</strong>.</p>
      <ul>
        <li><strong>Room type:</strong> ${roomType}</li>
        <li><strong>Price:</strong> GH₵ ${Number(price).toLocaleString()} / semester</li>
        <li><strong>Student phone:</strong> ${studentPhone}</li>
        <li><strong>Student email:</strong> ${studentEmail}</li>
      </ul>
      <p>Log in to your KellyLodge dashboard to see every booking across your listings.</p>
    </div>
  `;

  try {
    const res = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'api-key': BREVO_API_KEY,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        sender: { name: SENDER_NAME, email: SENDER_EMAIL },
        to: [{ email: ownerEmail, name: ownerName }],
        subject: `New booking at ${listingTitle}`,
        htmlContent: html,
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      console.error('Brevo email failed:', res.status, errText);
    }
  } catch (err) {
    console.error('Error sending booking email:', err);
  }
}

async function sendVerificationEmail({ toEmail, toName, verifyUrl }) {
  if (!BREVO_API_KEY) {
    console.warn('BREVO_API_KEY not set — skipping verification email. The account still exists but stays unverified.');
    return;
  }

  const html = `
    <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #1a1a1a;">
      <h2 style="margin-bottom: 0.3em;">Confirm your KellyLodge account</h2>
      <p>Hi ${toName},</p>
      <p>Thanks for signing up. Click below to verify your email and activate your account:</p>
      <p><a href="${verifyUrl}" style="display:inline-block;background:#c9992e;color:#111;padding:10px 20px;border-radius:6px;text-decoration:none;font-weight:bold;">Verify my email</a></p>
      <p>Or paste this link into your browser: ${verifyUrl}</p>
    </div>
  `;

  try {
    const res = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'api-key': BREVO_API_KEY,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        sender: { name: SENDER_NAME, email: SENDER_EMAIL },
        to: [{ email: toEmail, name: toName }],
        subject: 'Verify your KellyLodge account',
        htmlContent: html,
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      console.error('Brevo verification email failed:', res.status, errText);
    }
  } catch (err) {
    console.error('Error sending verification email:', err);
  }
}

module.exports = { sendBookingNotification, sendVerificationEmail };
