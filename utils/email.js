// utils/email.js — all Brevo transactional emails for KellyLodge
require('dotenv').config();

const BREVO_API_KEY = process.env.BREVO_API_KEY;
const SENDER_EMAIL = process.env.BREVO_SENDER_EMAIL || 'no-reply@kellylodge.com';
const SENDER_NAME = process.env.BREVO_SENDER_NAME || 'KellyLodge';

// Brand colors, matching public/css/style.css's CSS variables so every
// email actually looks like it came from KellyLodge, not a bare Node script.
const COLORS = {
  night: '#131A2E',
  paper: '#F5F1E6',
  paperDeep: '#EDE6D3',
  ink: '#201C14',
  inkSoft: '#6E6858',
  line: '#E1D8C0',
  brass: '#C08A21',
  brassDark: '#8C6416',
  brassLight: '#E2B45B',
};

// Wraps any email's content in a consistent branded shell: navy header with
// the wordmark, a brass accent bar, the message body, an optional button,
// and a light footer. Table-based layout with inline styles throughout,
// since most email clients (Outlook especially) ignore <style> blocks and
// modern CSS.
function wrapEmailTemplate({ heading, bodyHtml, ctaText, ctaUrl, detailsHtml }) {
  const button = ctaText && ctaUrl
    ? `
      <table role="presentation" cellpadding="0" cellspacing="0" style="margin: 24px 0 8px;">
        <tr>
          <td style="border-radius: 8px; background-color: ${COLORS.brass};">
            <a href="${ctaUrl}" style="display: inline-block; padding: 13px 28px; font-family: Arial, Helvetica, sans-serif; font-size: 15px; font-weight: bold; color: #ffffff; text-decoration: none; border-radius: 8px;">${ctaText}</a>
          </td>
        </tr>
      </table>
      <p style="margin: 4px 0 0; font-size: 12px; color: ${COLORS.inkSoft}; word-break: break-all;">Or paste this into your browser: <a href="${ctaUrl}" style="color: ${COLORS.brassDark};">${ctaUrl}</a></p>
    `
    : '';

  const details = detailsHtml
    ? `
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin: 20px 0; background-color: ${COLORS.paper}; border: 1px solid ${COLORS.line}; border-radius: 8px;">
        <tr>
          <td style="padding: 16px 20px;">
            ${detailsHtml}
          </td>
        </tr>
      </table>
    `
    : '';

  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1.0" />
      <title>KellyLodge</title>
    </head>
    <body style="margin: 0; padding: 0; background-color: ${COLORS.paperDeep}; font-family: Arial, Helvetica, sans-serif;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color: ${COLORS.paperDeep}; padding: 32px 16px;">
        <tr>
          <td align="center">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width: 520px; background-color: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 2px 10px rgba(19,26,46,0.08);">
              <tr>
                <td style="background-color: ${COLORS.night}; padding: 22px 32px;">
                  <span style="font-family: Georgia, 'Times New Roman', serif; font-size: 22px; color: #ffffff; font-weight: bold;">Kelly<span style="color: ${COLORS.brassLight}; font-style: italic;">Lodge</span></span>
                </td>
              </tr>
              <tr>
                <td style="height: 4px; background-color: ${COLORS.brass}; font-size: 0; line-height: 0;">&nbsp;</td>
              </tr>
              <tr>
                <td style="padding: 32px 32px 28px;">
                  <h1 style="margin: 0 0 14px; font-family: Georgia, 'Times New Roman', serif; font-size: 21px; color: ${COLORS.ink};">${heading}</h1>
                  <div style="font-size: 15px; line-height: 1.65; color: ${COLORS.ink};">
                    ${bodyHtml}
                  </div>
                  ${details}
                  ${button}
                </td>
              </tr>
              <tr>
                <td style="padding: 18px 32px; background-color: ${COLORS.paper}; border-top: 1px solid ${COLORS.line};">
                  <p style="margin: 0; font-size: 12px; color: ${COLORS.inkSoft}; line-height: 1.6;">
                    KellyLodge, off-campus housing near Kumasi Technical University.<br />
                    This is a transactional email related to your account or booking activity.
                  </p>
                </td>
              </tr>
            </table>
          </td>
        </tr>
      </table>
    </body>
    </html>
  `;
}

// A single labeled row inside a details box (e.g. "Room type: Single")
function detailRow(label, value) {
  return `<p style="margin: 0 0 6px; font-size: 14px; color: ${COLORS.ink};"><strong>${label}:</strong> ${value}</p>`;
}

async function sendViaBrevo({ toEmail, toName, subject, html }) {
  if (!BREVO_API_KEY) {
    console.warn(`BREVO_API_KEY not set, skipping email "${subject}" to ${toEmail}.`);
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

  const html = wrapEmailTemplate({
    heading: 'New room booking',
    bodyHtml: `
      <p>Hi ${ownerName},</p>
      <p><strong>${studentName}</strong> just booked a room at <strong>${listingTitle}</strong>.</p>
      ${deadlineText
        ? `<p>This booking is pending payment. The room is held for the student until <strong>${deadlineText}</strong> (72 hours). You'll get another email the moment payment is confirmed, if payment isn't made in time, the room automatically becomes available again.</p>`
        : ''}
      <p>Log in to your KellyLodge dashboard to see every booking across your listings.</p>
    `,
    detailsHtml:
      detailRow('Room type', roomType) +
      detailRow('Price', `GH₵ ${Number(price).toLocaleString()} / year`) +
      detailRow('Student phone', studentPhone) +
      detailRow('Student email', studentEmail),
  });

  await sendViaBrevo({ toEmail: ownerEmail, toName: ownerName, subject: `New booking at ${listingTitle}`, html });
}

async function sendPaymentReminderEmail({ toEmail, toName, listingTitle, roomType, price, deadline }) {
  const deadlineText = deadline.toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

  const html = wrapEmailTemplate({
    heading: 'Complete your payment to confirm your room',
    bodyHtml: `
      <p>Hi ${toName},</p>
      <p>Your booking at <strong>${listingTitle}</strong> is on hold for you.</p>
      <p><strong>Pay by ${deadlineText}</strong> (72 hours from booking), or this reservation will be automatically cancelled and the room released to other students.</p>
    `,
    detailsHtml:
      detailRow('Room type', roomType) +
      detailRow('Price', `GH₵ ${Number(price).toLocaleString()} / year`) +
      detailRow('Pay by', deadlineText),
    ctaText: 'Pay now in My Bookings',
    ctaUrl: `${process.env.APP_URL || 'http://localhost:3000'}/mybookings.html`,
  });

  await sendViaBrevo({ toEmail, toName, subject: `Action needed: pay for your room at ${listingTitle}`, html });
}

async function sendPaymentConfirmationEmailToStudent({ toEmail, toName, listingTitle, roomNumber }) {
  const html = wrapEmailTemplate({
    heading: 'Payment received, your room is confirmed',
    bodyHtml: `
      <p>Hi ${toName},</p>
      <p>We've received your payment for <strong>${listingTitle}</strong>. Your booking is now fully confirmed.</p>
      <p>Thank you for using KellyLodge.</p>
    `,
    detailsHtml: roomNumber ? detailRow('Your room', roomNumber) : '',
    ctaText: 'View my booking',
    ctaUrl: `${process.env.APP_URL || 'http://localhost:3000'}/mybookings.html`,
  });

  await sendViaBrevo({ toEmail, toName, subject: `Payment confirmed: ${listingTitle}`, html });
}

async function sendPaymentConfirmationEmailToOwner({ toEmail, toName, studentName, listingTitle, roomType, price, roomNumber }) {
  const html = wrapEmailTemplate({
    heading: 'A booking has been paid for',
    bodyHtml: `
      <p>Hi ${toName},</p>
      <p><strong>${studentName}</strong> has completed payment. This booking is now confirmed, no further action needed on your end.</p>
    `,
    detailsHtml:
      detailRow('Listing', listingTitle) +
      detailRow('Room type', roomType) +
      (roomNumber ? detailRow('Room assigned', roomNumber) : '') +
      detailRow('Price', `GH₵ ${Number(price).toLocaleString()} / year`),
    ctaText: 'View your dashboard',
    ctaUrl: `${process.env.APP_URL || 'http://localhost:3000'}/dashboard.html`,
  });

  await sendViaBrevo({ toEmail, toName, subject: `Booking confirmed and paid: ${listingTitle}`, html });
}

async function sendBookingExpiredEmail({ toEmail, toName, listingTitle }) {
  const html = wrapEmailTemplate({
    heading: 'Your booking has been cancelled',
    bodyHtml: `
      <p>Hi ${toName},</p>
      <p>Your booking at <strong>${listingTitle}</strong> was automatically cancelled because payment wasn't completed within the 72-hour window. The room has been released back to other students.</p>
      <p>You're welcome to book again if the room is still available.</p>
    `,
    ctaText: 'Browse hostels',
    ctaUrl: `${process.env.APP_URL || 'http://localhost:3000'}/index.html`,
  });

  await sendViaBrevo({ toEmail, toName, subject: `Booking cancelled: ${listingTitle}`, html });
}

async function sendVerificationEmail({ toEmail, toName, verifyUrl }) {
  const html = wrapEmailTemplate({
    heading: 'Confirm your KellyLodge account',
    bodyHtml: `
      <p>Hi ${toName},</p>
      <p>Thanks for signing up. Click below to verify your email and activate your account.</p>
    `,
    ctaText: 'Verify my email',
    ctaUrl: verifyUrl,
  });

  await sendViaBrevo({ toEmail, toName, subject: 'Verify your KellyLodge account', html });
}

async function sendPasswordResetEmail({ toEmail, toName, resetUrl }) {
  const html = wrapEmailTemplate({
    heading: 'Reset your KellyLodge password',
    bodyHtml: `
      <p>Hi ${toName},</p>
      <p>We received a request to reset your password. This link expires in 1 hour.</p>
      <p>If you didn't request this, you can safely ignore this email, your password won't change.</p>
    `,
    ctaText: 'Reset my password',
    ctaUrl: resetUrl,
  });

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
