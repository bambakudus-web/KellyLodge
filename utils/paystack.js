// utils/paystack.js — initializing and verifying Paystack transactions
require('dotenv').config();
const crypto = require('crypto');

const PAYSTACK_SECRET_KEY = process.env.PAYSTACK_SECRET_KEY;
const APP_URL = process.env.APP_URL || 'http://localhost:3000';

// Starts a Paystack transaction and returns the checkout URL to redirect
// the student to. Amount must be in the smallest currency unit (pesewas
// for GHS, i.e. cedis * 100).
async function initializeTransaction({ email, amountCedis, reference }) {
  if (!PAYSTACK_SECRET_KEY) {
    throw new Error('PAYSTACK_SECRET_KEY is not set.');
  }

  const res = await fetch('https://api.paystack.co/transaction/initialize', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${PAYSTACK_SECRET_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      email,
      amount: Math.round(amountCedis * 100),
      currency: 'GHS',
      reference,
      callback_url: `${APP_URL}/payment-callback.html`,
    }),
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
  return expected === signatureHeader;
}

module.exports = { initializeTransaction, verifyTransaction, isValidWebhookSignature };
