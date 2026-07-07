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
  paymentDeadline,
}) {
  const deadlineText = paymentDeadline
    ? paymentDeadline.toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
    : null;

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
      ${deadlineText
        ? `<p><strong>This booking is pending payment.</strong> The room is held for the student until ${deadlineText} (72 hours). You'll get another email the moment payment is confirmed. If payment isn't made in time, the room automatically becomes available again.</p>`
        : ''}
      <p>Log in to your KellyLodge dashboard to see every booking across your listings.</p>
    </div>
  `;
  await sendViaBrevo({ toEmail: ownerEmail, toName: ownerName, subject: `New booking at ${listingTitle}`, html });
}

async function sendPaymentReminderEmail({ toEmail, toName, listingTitle, roomType, price, deadline }) {
  const deadlineText = deadline.toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  const html = `
    <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #1a1a1a;">
      <h2 style="margin-bottom: 0.3em;">Complete your payment to confirm your room</h2>
      <p>Hi ${toName},</p>
      <p>Your booking for <strong>${roomType}</strong> at <strong>${listingTitle}</strong> (GH₵ ${Number(price).toLocaleString()} / year) is on hold.</p>
      <p><strong>Pay by ${deadlineText}</strong> (72 hours from booking), or this reservation will be automatically cancelled and the room released back to other students.</p>
      <p>Go to My Bookings on KellyLodge to complete your payment securely with Paystack.</p>
    </div>
  `;
  await sendViaBrevo({ toEmail, toName, subject: `Action needed: pay for your room at ${listingTitle}`, html });
}

async function sendPaymentConfirmationEmailToStudent({ toEmail, toName, listingTitle }) {
  const html = `
    <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #1a1a1a;">
      <h2 style="margin-bottom: 0.3em;">Payment received, your room is confirmed</h2>
      <p>Hi ${toName},</p>
      <p>We've received your payment for <strong>${listingTitle}</strong>. Your booking is now fully confirmed.</p>
      <p>Thank you for using KellyLodge.</p>
    </div>
  `;
  await sendViaBrevo({ toEmail, toName, subject: `Payment confirmed: ${listingTitle}`, html });
}

async function sendPaymentConfirmationEmailToOwner({ toEmail, toName, studentName, listingTitle, roomType, price }) {
  const html = `
    <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #1a1a1a;">
      <h2 style="margin-bottom: 0.3em;">A booking has been paid for</h2>
      <p>Hi ${toName},</p>
      <p><strong>${studentName}</strong> has completed payment for <strong>${roomType}</strong> at <strong>${listingTitle}</strong> (GH₵ ${Number(price).toLocaleString()} / year). This booking is now confirmed, no further action needed on your end.</p>
    </div>
  `;
  await sendViaBrevo({ toEmail, toName, subject: `Booking confirmed and paid: ${listingTitle}`, html });
}

async function sendBookingExpiredEmail({ toEmail, toName, listingTitle }) {
  const html = `
    <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #1a1a1a;">
      <h2 style="margin-bottom: 0.3em;">Your booking has been cancelled</h2>
      <p>Hi ${toName},</p>
      <p>Your booking at <strong>${listingTitle}</strong> was automatically cancelled because payment wasn't completed within the 72-hour window. The room has been released back to other students.</p>
      <p>You're welcome to book again on KellyLodge if the room is still available.</p>
    </div>
  `;
  await sendViaBrevo({ toEmail, toName, subject: `Booking cancelled: ${listingTitle}`, html });
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

module.exports = {
  sendBookingNotification,
  sendVerificationEmail,
  sendPasswordResetEmail,
  sendPaymentReminderEmail,
  sendPaymentConfirmationEmailToStudent,
  sendPaymentConfirmationEmailToOwner,
  sendBookingExpiredEmail,
};
