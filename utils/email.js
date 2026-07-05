// utils/email.js — all Brevo transactional emails for KellyLodge
require('dotenv').config();

const BREVO_API_KEY = process.env.BREVO_API_KEY;
const SENDER_EMAIL = process.env.BREVO_SENDER_EMAIL || 'no-reply@kellylodge.com';
const SENDER_NAME = process.env.BREVO_SENDER_NAME || 'KellyLodge';

async function sendViaBrevo({ toEmail, toName, subject, html }) {
  if (!BREVO_API_KEY) {
    console.warn(`BREVO_API_KEY not set — skipping email "${subject}" to ${toEmail}.`);
    return;
  }

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
        subject,
        htmlContent: html,
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      console.error(`Brevo email "${subject}" failed:`, res.status, errText);
    }
  } catch (err) {
    console.error(`Error sending email "${subject}":`, err);
  }
}

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
  const html = `
    <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #1a1a1a;">
      <h2 style="margin-bottom: 0.3em;">New room booking on KellyLodge</h2>
      <p>Hi ${ownerName},</p>
      <p><strong>${studentName}</strong> just booked a room at <strong>${listingTitle}</strong>.</p>
      <ul>
        <li><strong>Room type:</strong> ${roomType}</li>
        <li><strong>Price:</strong> GH₵ ${Number(price).toLocaleString()} / year</li>
        <li><strong>Student phone:</strong> ${studentPhone}</li>
        <li><strong>Student email:</strong> ${studentEmail}</li>
      </ul>
      <p>Log in to your KellyLodge dashboard to see every booking across your listings.</p>
    </div>
  `;
  await sendViaBrevo({ toEmail: ownerEmail, toName: ownerName, subject: `New booking at ${listingTitle}`, html });
}

async function sendVerificationEmail({ toEmail, toName, verifyUrl }) {
  const html = `
    <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #1a1a1a;">
      <h2 style="margin-bottom: 0.3em;">Confirm your KellyLodge account</h2>
      <p>Hi ${toName},</p>
      <p>Thanks for signing up. Click below to verify your email and activate your account:</p>
      <p><a href="${verifyUrl}" style="display:inline-block;background:#c9992e;color:#111;padding:10px 20px;border-radius:6px;text-decoration:none;font-weight:bold;">Verify my email</a></p>
      <p>Or paste this link into your browser: ${verifyUrl}</p>
    </div>
  `;
  await sendViaBrevo({ toEmail, toName, subject: 'Verify your KellyLodge account', html });
}

async function sendPasswordResetEmail({ toEmail, toName, resetUrl }) {
  const html = `
    <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #1a1a1a;">
      <h2 style="margin-bottom: 0.3em;">Reset your KellyLodge password</h2>
      <p>Hi ${toName},</p>
      <p>We received a request to reset your password. This link expires in 1 hour:</p>
      <p><a href="${resetUrl}" style="display:inline-block;background:#c9992e;color:#111;padding:10px 20px;border-radius:6px;text-decoration:none;font-weight:bold;">Reset my password</a></p>
      <p>Or paste this link into your browser: ${resetUrl}</p>
      <p>If you didn't request this, you can safely ignore this email (your password won't change).</p>
    </div>
  `;
  await sendViaBrevo({ toEmail, toName, subject: 'Reset your KellyLodge password', html });
}

module.exports = { sendBookingNotification, sendVerificationEmail, sendPasswordResetEmail };
