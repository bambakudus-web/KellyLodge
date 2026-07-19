// utils/paystack.js — initializing and verifying Paystack transactions,
// plus hoster payout setup via Paystack Subaccounts (split payments)
require('dotenv').config();
const crypto = require('crypto');

const PAYSTACK_SECRET_KEY = process.env.PAYSTACK_SECRET_KEY;
const APP_URL = process.env.APP_URL || 'http://localhost:3000';
// The platform's cut of each booking payment, as a percentage. The rest
// goes straight to the hoster's own bank account via their Paystack
// Subaccount. Override with the PLATFORM_FEE_PERCENT env var if you want a
// different number than this default.
const PLATFORM_FEE_PERCENT = Number(process.env.PLATFORM_FEE_PERCENT) || 10;

// Starts a Paystack transaction and returns the checkout URL to redirect
// the student to. Amount must be in the smallest currency unit (pesewas
// for GHS, i.e. cedis * 100). If the listing's owner has a Paystack
// Subaccount set up, the payment automatically splits: the hoster gets
// their share directly, the platform keeps PLATFORM_FEE_PERCENT. If they
// haven't set up payouts yet, the full amount goes to the platform account
// as before (nothing breaks for hosters who haven't onboarded yet).
async function initializeTransaction({ email, amountCedis, reference, bookingId, subaccountCode }) {
  if (!PAYSTACK_SECRET_KEY) {
    throw new Error('PAYSTACK_SECRET_KEY is not set.');
  }

  const body = {
    email,
    amount: Math.round(amountCedis * 100),
    currency: 'GHS',
    reference,
    callback_url: `${APP_URL}/payment-callback.html`,
    metadata: {
      booking_id: bookingId,
      custom_fields: [
        { display_name: 'KellyLodge Booking ID', variable_name: 'booking_id', value: bookingId },
      ],
    },
  };

  if (subaccountCode) {
    body.subaccount = subaccountCode;
  }

  const res = await fetch('https://api.paystack.co/transaction/initialize', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${PAYSTACK_SECRET_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  const data = await res.json();
  if (!res.ok || !data.status) {
    throw new Error(data.message || 'Could not start the Paystack transaction.');
  }

  return data.data; // { authorization_url, access_code, reference }
}

// Server-to-server confirmation, used as a belt-and-suspenders check
// alongside the webhook (e.g. if the student lands back on the callback
// page before the webhook has arrived yet).
async function verifyTransaction(reference) {
  if (!PAYSTACK_SECRET_KEY) {
    throw new Error('PAYSTACK_SECRET_KEY is not set.');
  }

  const res = await fetch(`https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`, {
    headers: { Authorization: `Bearer ${PAYSTACK_SECRET_KEY}` },
  });

  const data = await res.json();
  if (!res.ok || !data.status) {
    throw new Error(data.message || 'Could not verify the Paystack transaction.');
  }

  return data.data; // { status: 'success' | ..., reference, amount, ... }
}

// Paystack signs each webhook payload with HMAC-SHA512 using your secret
// key, over the raw (unparsed) request body. Comparing against this is
// what proves a webhook request actually came from Paystack.
function isValidWebhookSignature(rawBody, signatureHeader) {
  if (!PAYSTACK_SECRET_KEY || !signatureHeader || !rawBody) return false;
  const expected = crypto.createHmac('sha512', PAYSTACK_SECRET_KEY).update(rawBody).digest('hex');

  // A plain === comparison here would return as soon as it finds the
  // first mismatched character, which — while V8 doesn't document its
  // exact string-comparison timing — is exactly the class of thing HMAC
  // signature checks are conventionally done with crypto.timingSafeEqual
  // to rule out entirely, rather than relying on how a specific JS engine
  // happens to implement string equality today. timingSafeEqual requires
  // equal-length buffers, so the length check has to happen first — that
  // alone can't leak anything useful, since a correct signature always has
  // a fixed, known length (a hex-encoded SHA-512 digest, 128 characters).
  const expectedBuffer = Buffer.from(expected, 'utf8');
  const providedBuffer = Buffer.from(signatureHeader, 'utf8');
  if (expectedBuffer.length !== providedBuffer.length) return false;

  return crypto.timingSafeEqual(expectedBuffer, providedBuffer);
}

// --- Hoster payouts (Paystack Subaccounts) ---

// Every Ghanaian bank and mobile money network Paystack supports, with the
// bank_code each one needs for the two functions below.
async function listBanks() {
  if (!PAYSTACK_SECRET_KEY) {
    throw new Error('PAYSTACK_SECRET_KEY is not set.');
  }

  const res = await fetch('https://api.paystack.co/bank?country=ghana&currency=GHS', {
    headers: { Authorization: `Bearer ${PAYSTACK_SECRET_KEY}` },
  });

  const data = await res.json();
  if (!res.ok || !data.status) {
    throw new Error(data.message || 'Could not fetch the bank list.');
  }

  return data.data; // [{ name, code, ... }]
}

// Confirms an account number actually belongs to a real account before we
// trust it, and returns the real account holder's name so the hoster can
// double-check it's actually theirs before saving it.
async function resolveAccountNumber(accountNumber, bankCode) {
  if (!PAYSTACK_SECRET_KEY) {
    throw new Error('PAYSTACK_SECRET_KEY is not set.');
  }

  const res = await fetch(
    `https://api.paystack.co/bank/resolve?account_number=${encodeURIComponent(accountNumber)}&bank_code=${encodeURIComponent(bankCode)}`,
    { headers: { Authorization: `Bearer ${PAYSTACK_SECRET_KEY}` } }
  );

  const data = await res.json();
  if (!res.ok || !data.status) {
    throw new Error(data.message || 'Could not verify that account number.');
  }

  return data.data; // { account_number, account_name }
}

// Creates the actual Paystack Subaccount that lets a hoster's share of
// future payments route straight to their own bank account. percentage_charge
// is the percentage Paystack keeps for the MAIN (platform) account, the
// remainder settles to this subaccount automatically, per transaction.
async function createSubaccount({ businessName, bankCode, accountNumber }) {
  if (!PAYSTACK_SECRET_KEY) {
    throw new Error('PAYSTACK_SECRET_KEY is not set.');
  }

  const res = await fetch('https://api.paystack.co/subaccount', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${PAYSTACK_SECRET_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      business_name: businessName,
      settlement_bank: bankCode,
      account_number: accountNumber,
      percentage_charge: PLATFORM_FEE_PERCENT,
    }),
  });

  const data = await res.json();
  if (!res.ok || !data.status) {
    throw new Error(data.message || 'Could not set up payouts for this account.');
  }

  return data.data; // { subaccount_code, ... }
}

module.exports = {
  initializeTransaction,
  verifyTransaction,
  isValidWebhookSignature,
  listBanks,
  resolveAccountNumber,
  createSubaccount,
  PLATFORM_FEE_PERCENT,
};
