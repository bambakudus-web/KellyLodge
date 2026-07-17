// tests/rooms_and_reviews.test.js — integration tests for structured room
// numbers, payment-triggered room assignment, review eligibility surviving
// a deleted booking, and conversation deletion.
//
// ⚠️  WARNING: this creates and deletes real rows using whatever database
// your .env points to. Point .env at a disposable/test database before
// running this — do NOT run it against production data.
//
// Paystack's own verification API can't be called for real in a test, so
// this stubs utils/paystack.js's verifyTransaction before anything else is
// required, that has to happen first: routes/payments.js and
// utils/reconcilePayment.js both destructure `{ verifyTransaction }` out of
// that module the moment they're required, so patching it any later
// wouldn't reach the copy they already grabbed.
//
// Run with: npm test

const { test, before, after } = require('node:test');
const assert = require('node:assert');
require('dotenv').config();

const path = require('path');
const paystackPath = path.resolve(__dirname, '../utils/paystack.js');
const paystackModule = require(paystackPath);
const originalVerifyTransaction = paystackModule.verifyTransaction;
let stubbedVerifyResult = null;
paystackModule.verifyTransaction = async (reference) => {
  if (stubbedVerifyResult) return stubbedVerifyResult;
  return originalVerifyTransaction(reference);
};

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
  paystackModule.verifyTransaction = originalVerifyTransaction;
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

  const [rows] = await pool.query('SELECT id, verification_token FROM users WHERE email = ?', [email]);
  const userId = rows[0].id;

  const verifyRes = await fetch(`${baseUrl}/api/auth/verify?token=${rows[0].verification_token}`);
  assert.strictEqual(verifyRes.status, 200, 'verification should succeed');

  const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'password123' }),
  });
  const cookie = extractSessionCookie(loginRes);

  const csrfRes = await fetch(`${baseUrl}/api/auth/csrf-token`, { headers: { Cookie: cookie } });
  const { csrfToken } = await csrfRes.json();

  return { userId, cookie, csrfToken, email };
}

async function createListing(hoster, roomTypes) {
  const formData = new FormData();
  formData.append('title', `Test Hostel ${Date.now()}`);
  formData.append('description', 'Created by the automated test suite.');
  formData.append('area', 'Fante New Town');
  formData.append('room_types', JSON.stringify(roomTypes));

  const res = await fetch(`${baseUrl}/api/listings`, {
    method: 'POST',
    headers: { Cookie: hoster.cookie, 'x-csrf-token': hoster.csrfToken },
    body: formData,
  });
  assert.strictEqual(res.status, 201, 'listing creation should succeed');
  return res.json();
}

test('creating a listing generates structured room numbers (A001, A002...)', async () => {
  const hoster = await signupVerifyLogin('hoster');
  const { id: listingId } = await createListing(hoster, [
    { room_type: 'Shared (2 in a room)', price: 5000, quantity: 3 },
  ]);

  const [roomTypes] = await pool.query('SELECT id, prefix FROM room_types WHERE listing_id = ?', [listingId]);
  assert.strictEqual(roomTypes.length, 1);
  assert.strictEqual(roomTypes[0].prefix, 'A', 'first room type on a listing should get prefix A');

  const [rooms] = await pool.query(
    'SELECT room_number, status FROM rooms WHERE room_type_id = ? ORDER BY room_number',
    [roomTypes[0].id]
  );
  assert.deepStrictEqual(
    rooms.map((r) => r.room_number),
    ['A001', 'A002', 'A003'],
    'should generate exactly 3 sequentially-numbered rooms'
  );
  assert.ok(rooms.every((r) => r.status === 'available'), 'all rooms should start available');

  await pool.query('DELETE FROM users WHERE id = ?', [hoster.userId]);
});

test('a room is only assigned once payment is confirmed, not at the initial booking', async () => {
  const hoster = await signupVerifyLogin('hoster');
  const student = await signupVerifyLogin('student');
  const { id: listingId } = await createListing(hoster, [
    { room_type: 'Single (self-contained)', price: 6000, quantity: 2 },
  ]);

  const listingRes = await fetch(`${baseUrl}/api/listings/${listingId}`);
  const listing = await listingRes.json();
  const roomTypeId = listing.room_types[0].id;

  const bookRes = await fetch(`${baseUrl}/api/bookings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: student.cookie, 'x-csrf-token': student.csrfToken },
    body: JSON.stringify({ room_type_id: roomTypeId }),
  });
  assert.strictEqual(bookRes.status, 201);
  const { id: bookingId } = await bookRes.json();

  let [[bookingRow]] = await pool.query('SELECT room_id, payment_status FROM bookings WHERE id = ?', [bookingId]);
  assert.strictEqual(bookingRow.room_id, null, 'a pending booking should not have a room assigned yet');
  assert.strictEqual(bookingRow.payment_status, 'pending');

  // Simulate a completed Paystack payment
  const reference = `test-ref-${bookingId}-${Date.now()}`;
  await pool.query('UPDATE bookings SET paystack_reference = ? WHERE id = ?', [reference, bookingId]);
  stubbedVerifyResult = { status: 'success', amount: 600000 }; // GH₵6000.00 in kobo

  const { reconcileByReference } = require(path.resolve(__dirname, '../utils/reconcilePayment.js'));
  const result = await reconcileByReference(reference);
  stubbedVerifyResult = null;

  assert.strictEqual(result.status, 'newly_paid');
  assert.ok(result.roomNumber, 'a room number should be assigned once payment clears');
  assert.match(result.roomNumber, /^A00[12]$/);

  [[bookingRow]] = await pool.query('SELECT room_id, payment_status FROM bookings WHERE id = ?', [bookingId]);
  assert.strictEqual(bookingRow.payment_status, 'paid');
  assert.ok(bookingRow.room_id, 'the booking should now have a specific room_id');

  const [[assignedRoom]] = await pool.query('SELECT status FROM rooms WHERE id = ?', [bookingRow.room_id]);
  assert.strictEqual(assignedRoom.status, 'occupied', 'the assigned room should now be marked occupied');

  await pool.query('DELETE FROM users WHERE id IN (?, ?)', [hoster.userId, student.userId]);
});

test('review eligibility survives a hoster deleting the paid booking', async () => {
  const hoster = await signupVerifyLogin('hoster');
  const student = await signupVerifyLogin('student');
  const { id: listingId } = await createListing(hoster, [
    { room_type: 'Single (self-contained)', price: 6000, quantity: 1 },
  ]);

  const listingRes = await fetch(`${baseUrl}/api/listings/${listingId}`);
  const listing = await listingRes.json();
  const roomTypeId = listing.room_types[0].id;

  const bookRes = await fetch(`${baseUrl}/api/bookings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: student.cookie, 'x-csrf-token': student.csrfToken },
    body: JSON.stringify({ room_type_id: roomTypeId }),
  });
  const { id: bookingId } = await bookRes.json();

  const reference = `test-ref-${bookingId}-${Date.now()}`;
  await pool.query('UPDATE bookings SET paystack_reference = ? WHERE id = ?', [reference, bookingId]);
  stubbedVerifyResult = { status: 'success', amount: 600000 };
  const { reconcileByReference } = require(path.resolve(__dirname, '../utils/reconcilePayment.js'));
  await reconcileByReference(reference);
  stubbedVerifyResult = null;

  // Before deletion: can review
  const canReviewBefore = await fetch(`${baseUrl}/api/reviews/can-review/${listingId}`, {
    headers: { Cookie: student.cookie },
  });
  assert.strictEqual((await canReviewBefore.json()).canReview, true);

  // Hoster deletes the now-paid booking
  const deleteRes = await fetch(`${baseUrl}/api/bookings/${bookingId}`, {
    method: 'DELETE',
    headers: { Cookie: hoster.cookie, 'x-csrf-token': hoster.csrfToken },
  });
  assert.strictEqual(deleteRes.status, 200, 'hoster should be able to delete a paid booking');

  const [bookingsLeft] = await pool.query('SELECT id FROM bookings WHERE id = ?', [bookingId]);
  assert.strictEqual(bookingsLeft.length, 0, 'the booking row should actually be gone');

  // After deletion: this is the actual bug being tested for — eligibility must still be true
  const canReviewAfter = await fetch(`${baseUrl}/api/reviews/can-review/${listingId}`, {
    headers: { Cookie: student.cookie },
  });
  assert.strictEqual(
    (await canReviewAfter.json()).canReview,
    true,
    'review eligibility must survive the booking being deleted'
  );

  // And an actual review submission should still succeed
  const reviewRes = await fetch(`${baseUrl}/api/reviews`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: student.cookie, 'x-csrf-token': student.csrfToken },
    body: JSON.stringify({ listing_id: listingId, rating: 5, comment: 'Great stay!' }),
  });
  assert.strictEqual(reviewRes.status, 201, 'submitting a review should succeed after the booking was deleted');

  await pool.query('DELETE FROM users WHERE id IN (?, ?)', [hoster.userId, student.userId]);
});

test('a student with only a pending (unpaid) booking cannot leave a review', async () => {
  const hoster = await signupVerifyLogin('hoster');
  const student = await signupVerifyLogin('student');
  const { id: listingId } = await createListing(hoster, [
    { room_type: 'Single (self-contained)', price: 6000, quantity: 1 },
  ]);

  const listingRes = await fetch(`${baseUrl}/api/listings/${listingId}`);
  const listing = await listingRes.json();
  const roomTypeId = listing.room_types[0].id;

  await fetch(`${baseUrl}/api/bookings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: student.cookie, 'x-csrf-token': student.csrfToken },
    body: JSON.stringify({ room_type_id: roomTypeId }),
  });

  const canReview = await fetch(`${baseUrl}/api/reviews/can-review/${listingId}`, {
    headers: { Cookie: student.cookie },
  });
  assert.strictEqual(
    (await canReview.json()).canReview,
    false,
    'an unpaid booking should not grant review eligibility'
  );

  await pool.query('DELETE FROM users WHERE id IN (?, ?)', [hoster.userId, student.userId]);
});

test('deleting a conversation removes it and its messages for both participants', async () => {
  const hoster = await signupVerifyLogin('hoster');
  const student = await signupVerifyLogin('student');
  const { id: listingId } = await createListing(hoster, [
    { room_type: 'Single (self-contained)', price: 6000, quantity: 1 },
  ]);

  const startRes = await fetch(`${baseUrl}/api/messages/conversations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: student.cookie, 'x-csrf-token': student.csrfToken },
    body: JSON.stringify({ listing_id: listingId }),
  });
  assert.strictEqual(startRes.status, 201);
  const { id: conversationId } = await startRes.json();

  // Messages normally arrive via the socket's send_message event, not this
  // REST route — insert one directly to have something for the delete to
  // actually need to cascade away.
  await pool.query(
    'INSERT INTO messages (conversation_id, sender_id, body) VALUES (?, ?, ?)',
    [conversationId, student.userId, 'Hi, is this still available?']
  );

  const [messagesBefore] = await pool.query('SELECT id FROM messages WHERE conversation_id = ?', [conversationId]);
  assert.strictEqual(messagesBefore.length, 1, 'should have one message in the thread before deletion');

  // A user who isn't part of this conversation must not be able to delete it
  const outsider = await signupVerifyLogin('student');
  const forbiddenRes = await fetch(`${baseUrl}/api/messages/conversations/${conversationId}`, {
    method: 'DELETE',
    headers: { Cookie: outsider.cookie, 'x-csrf-token': outsider.csrfToken },
  });
  assert.strictEqual(forbiddenRes.status, 403, 'a non-participant should not be able to delete the conversation');

  // The hoster (a real participant) deletes it
  const deleteRes = await fetch(`${baseUrl}/api/messages/conversations/${conversationId}`, {
    method: 'DELETE',
    headers: { Cookie: hoster.cookie, 'x-csrf-token': hoster.csrfToken },
  });
  assert.strictEqual(deleteRes.status, 200);

  const [convLeft] = await pool.query('SELECT id FROM conversations WHERE id = ?', [conversationId]);
  assert.strictEqual(convLeft.length, 0, 'the conversation row should be gone');

  const [messagesAfter] = await pool.query('SELECT id FROM messages WHERE conversation_id = ?', [conversationId]);
  assert.strictEqual(messagesAfter.length, 0, 'its messages should have cascade-deleted along with it');

  await pool.query('DELETE FROM users WHERE id IN (?, ?, ?)', [hoster.userId, student.userId, outsider.userId]);
});
