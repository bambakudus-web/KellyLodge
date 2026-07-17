// tests/booking.test.js — integration test for the booking flow, including the
// core concurrency-sensitive logic: a room can't be double-booked.
//
// ⚠️  WARNING: this creates and deletes real rows using whatever database
// your .env points to. Point .env at a disposable/test database before
// running this — do NOT run it against production data.
//
// Run with: npm test

const { test, before, after } = require('node:test');
const assert = require('node:assert');
require('dotenv').config();

const app = require('../server');
const pool = require('../db');

let server;
let baseUrl;

before(async () => {
  await new Promise((resolve) => {
    server = app.listen(0, () => {
      baseUrl = `http://localhost:${server.address().port}`;
      resolve();
    });
  });
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  await pool.end();
});

function extractSessionCookie(res) {
  const raw = res.headers.get('set-cookie');
  if (!raw) return null;
  return raw.split(';')[0];
}

async function signupVerifyLogin(role) {
  const email = `test-${role}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;

  const signupRes = await fetch(`${baseUrl}/api/auth/signup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: `Test ${role}`,
      email,
      password: 'password123',
      phone: '+233200000000',
      role,
    }),
  });
  assert.strictEqual(signupRes.status, 201, `signup should succeed for ${role}`);

  // Bypass the real email — pull the verification token straight from the DB.
  const [rows] = await pool.query('SELECT id, verification_token FROM users WHERE email = ?', [email]);
  assert.ok(rows.length === 1, 'user should exist after signup');
  const userId = rows[0].id;

  const verifyRes = await fetch(`${baseUrl}/api/auth/verify?token=${rows[0].verification_token}`);
  assert.strictEqual(verifyRes.status, 200, 'verification should succeed');

  const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'password123' }),
  });
  assert.strictEqual(loginRes.status, 200, 'login should succeed after verification');
  const cookie = extractSessionCookie(loginRes);
  assert.ok(cookie, 'login should set a session cookie');

  const csrfRes = await fetch(`${baseUrl}/api/auth/csrf-token`, { headers: { Cookie: cookie } });
  const { csrfToken } = await csrfRes.json();

  return { userId, cookie, csrfToken, email };
}

test('a room can be booked, cannot be double-booked, and frees up on cancel', async () => {
  const hoster = await signupVerifyLogin('hoster');
  const studentA = await signupVerifyLogin('student');
  const studentB = await signupVerifyLogin('student');

  // Create a listing with exactly ONE room of one type.
  const formData = new FormData();
  formData.append('title', 'Test Hostel (automated test)');
  formData.append('description', 'Created by the automated test suite.');
  formData.append('area', 'Fante New Town');
  formData.append('room_types', JSON.stringify([
    { room_type: 'Single (self-contained)', price: 6000, quantity: 1 },
  ]));

  const createRes = await fetch(`${baseUrl}/api/listings`, {
    method: 'POST',
    headers: { Cookie: hoster.cookie, 'x-csrf-token': hoster.csrfToken },
    body: formData,
  });
  assert.strictEqual(createRes.status, 201, 'listing creation should succeed');
  const { id: listingId } = await createRes.json();

  const listingRes = await fetch(`${baseUrl}/api/listings/${listingId}`);
  const listing = await listingRes.json();
  assert.strictEqual(listing.room_types.length, 1);
  const roomTypeId = listing.room_types[0].id;
  assert.strictEqual(listing.room_types[0].available_quantity, 1);

  // Student A books the only room — should succeed.
  const bookARes = await fetch(`${baseUrl}/api/bookings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: studentA.cookie, 'x-csrf-token': studentA.csrfToken },
    body: JSON.stringify({ room_type_id: roomTypeId }),
  });
  assert.strictEqual(bookARes.status, 201, 'first booking should succeed');
  const { id: bookingId } = await bookARes.json();

  // Student B tries to book the same (now-full) room type — should be rejected.
  const bookBRes = await fetch(`${baseUrl}/api/bookings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: studentB.cookie, 'x-csrf-token': studentB.csrfToken },
    body: JSON.stringify({ room_type_id: roomTypeId }),
  });
  assert.strictEqual(bookBRes.status, 409, 'second booking on a full room type should be rejected');

  // Verify availability dropped to zero.
  const afterBookRes = await fetch(`${baseUrl}/api/listings/${listingId}`);
  const afterBook = await afterBookRes.json();
  assert.strictEqual(afterBook.room_types[0].available_quantity, 0);

  // Student A cancels — room should become available again.
  const cancelRes = await fetch(`${baseUrl}/api/bookings/${bookingId}`, {
    method: 'DELETE',
    headers: { Cookie: studentA.cookie, 'x-csrf-token': studentA.csrfToken },
  });
  assert.strictEqual(cancelRes.status, 200, 'cancel should succeed');

  const afterCancelRes = await fetch(`${baseUrl}/api/listings/${listingId}`);
  const afterCancel = await afterCancelRes.json();
  assert.strictEqual(afterCancel.room_types[0].available_quantity, 1, 'room should be available again after cancel');

  // Cleanup: deleting the users cascades to their listings/bookings/room_types.
  await pool.query('DELETE FROM users WHERE id IN (?, ?, ?)', [hoster.userId, studentA.userId, studentB.userId]);
});

test('a state-changing request without a CSRF token is rejected', async () => {
  const hoster = await signupVerifyLogin('hoster');

  const formData = new FormData();
  formData.append('title', 'No CSRF Token Hostel');
  formData.append('area', 'Amakom');
  formData.append('room_types', JSON.stringify([
    { room_type: 'Single (self-contained)', price: 6000, quantity: 5 },
  ]));

  const res = await fetch(`${baseUrl}/api/listings`, {
    method: 'POST',
    headers: { Cookie: hoster.cookie }, // no x-csrf-token header
    body: formData,
  });
  assert.strictEqual(res.status, 403, 'request without CSRF token should be rejected');

  await pool.query('DELETE FROM users WHERE id = ?', [hoster.userId]);
});
