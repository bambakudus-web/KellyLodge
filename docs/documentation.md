# KellyLodge — Project Documentation

**Course:** Software Project Management
**Institution:** Kumasi Technical University (KsTU)
**Developer:** [Your name]
**Date:** [Submission date]

---

## 1. Problem Statement

Students at Kumasi Technical University who need off-campus accommodation currently rely on scattered WhatsApp groups, word-of-mouth referrals, and physically walking around neighborhoods to find available hostels. This process is inefficient and incomplete: listings are not centralized, information is often outdated, there is no reliable way to actually reserve and pay for a specific room online, and students have no reliable way to compare hostels by location, price, or trustworthiness before committing time to visit them in person. Hostel owners and agents, in turn, have no low-cost, centralized channel to reach prospective student tenants beyond informal networks, no way to collect payment online without handling cash in person, and no way to manage the listings they've posted or understand whether those listings are actually being seen.

## 2. Objectives

1. Solve the **discoverability** problem by providing a centralized, searchable platform for hostel listings.
2. Solve the **trust** problem by letting students see multiple real photos per hostel and read reviews left only by students who have actually paid for and stayed at that hostel.
3. Solve the **payment** problem by letting a student pay for a room online and receive a specific, real room number in return, with the hoster's share of the payment arriving in their own account automatically.
4. Give hostel owners ("hosters") their own accounts so they can post and manage listings, including a per-room-type breakdown of price and availability, without relying on a third party.
5. Give students tools to shortlist and compare hostels (favorites), message an owner directly, and search/filter efficiently by area, price, or keyword.
6. Give hosters visibility into how their listings are performing (view counts, ratings) so they have a reason to improve them.
7. Give the platform operator (admin) oversight tools to moderate content and manage users.
8. Deliver a working, deployable system that demonstrates this end-to-end.

## 3. Scope

### In scope
- Public landing page introducing the platform
- Student and hoster account registration and login (session-based authentication, hashed passwords)
- Email verification on signup (Brevo transactional email), with forgot-password / reset-password flows
- Self-service account management: any logged-in user can update their name, phone, email (re-triggers verification), or password
- Browsing, filtering (by area, min/max price), and keyword search of listings (no login required to browse)
- Free-text areas — a hoster can select one of the known neighborhoods or type a new one; the browse page's area filter is populated dynamically from whatever areas are actually in use
- Per-room-type pricing and availability (a single listing can offer several room types, each with its own price, total quantity, and live availability)
- **Structured room numbers** — each room type is broken down into individually numbered physical units (e.g. `A001`, `A002`) at creation time, not just a bare quantity count. A specific room is only ever assigned to a student once their payment actually clears, not at the moment of booking.
- Multi-photo galleries per listing (up to 5 photos), with the ability to remove individual photos and choose which one is the cover photo, when editing
- An optional "walking distance from campus" field per listing, shown as a badge
- **Online payment** — a student books a room type (holding it for 72 hours) and pays the full year's rent through Paystack. Payment confirmation is self-healing: it's checked independently by the webhook, the payment-callback page, and every time My Bookings loads, so a booking can't get permanently stuck as unpaid just because one notification was missed.
- **Automatic hoster payouts** — a hoster connects their own bank account once (via Paystack account resolution, confirming the real account holder name back to them), after which every future payment automatically splits: the hoster's share goes straight to their account, the platform keeps a configurable fee (`PLATFORM_FEE_PERCENT`, default 10%).
- **In-app messaging** — a student and a hoster can message each other about a specific listing, in real time (Socket.io), from either a floating chat widget available on every page or a dedicated full-page inbox. Either participant can delete a whole conversation (cascades to its messages, and pushes live to the other participant if they have it open).
- Reviews and star ratings — restricted to students who have an actual **paid, completed** booking for that listing (tracked independently of the booking row itself, so a booking being deleted later never revokes an already-earned review); one review per student per listing (resubmitting updates it)
- Favorites — students can save/shortlist listings and manage them from a dedicated page
- Hoster analytics — a view counter per listing, and aggregated rating, both visible on the hoster's dashboard
- Hosters can post, view, edit, and remove their own listings; room types that already have active bookings cannot be removed or shrunk below the booked count, and growing/shrinking a room type's quantity adds/removes actual numbered rooms to match
- An admin account with a dashboard to view platform statistics, manage all users, and moderate (remove/restore) any listing
- A REST API backend (Node.js/Express) with a MySQL database, enforcing role permissions, CSRF protection, and login rate-limiting server-side
- Responsive frontend usable on both mobile and desktop, including iOS Safari input-zoom prevention
- Deployment to a live URL via Railway

### Out of scope (future work)
- Interactive map view of listings (the current "distance from campus" field is a hoster-entered estimate, not GPS-verified)
- Partial refunds or cancelling a *paid* booking as a student (a paid booking can only be cancelled by contacting the owner directly, or removed by the hoster/admin)
- Editing a review's star rating from a dedicated "edit" affordance (currently done by resubmitting the review form)
- Photo reordering beyond choosing a cover (drag-to-reorder the rest of the gallery is not implemented)

## 4. Technology Justification

| Layer | Choice | Justification |
|---|---|---|
| Frontend | HTML/CSS/vanilla JavaScript | No build tooling required, fast to develop and deploy solo; sufficient for the app's UI complexity. |
| Backend | Node.js + Express | Lightweight REST API framework; pairs naturally with a JavaScript frontend for a single-language stack. |
| Auth | express-session + bcryptjs | Session-based auth is simpler to reason about than token-based auth for a project of this scope; bcrypt ensures passwords are never stored in plain text. |
| Real-time | Socket.io | Shares the same Express session middleware, so a socket connection is already authenticated as whoever is logged into that browser tab — no separate login step for chat. |
| Payments | Paystack + Subaccounts | Handles the actual card/mobile-money transaction and can automatically split a single payment between the platform and a hoster's own account, without the platform ever needing to manually move money. |
| Email | Brevo transactional email API | Used for verification emails, password reset links, and booking/payment notifications. |
| SMS | Arkesel | Used to notify students and hosters about bookings and payments by text, since not every hoster reliably checks email. |
| File uploads | Multer (in-memory) + Cloudinary + a real image-signature check | Accepts hostel photos as actual file uploads; validates the file's real byte signature (not just its extension) before accepting it. Uploaded straight to Cloudinary rather than local disk, since Railway's filesystem doesn't persist between deploys. |
| Database | MySQL | Relational structure fits the users/listings/room_types/rooms/bookings/reviews/favorites/conversations relationships; widely taught and supported; integrates cleanly with Railway's managed MySQL plugin. |
| Security middleware | Custom CSRF token check + login rate limiting | Protects state-changing requests (POST/PUT/PATCH/DELETE) from cross-site request forgery, and slows down brute-force login attempts. |
| Deployment | Railway | Single platform hosts both the Node.js app and the MySQL database. |

## 5. System Design

### 5.1 Entity-Relationship Diagram

```
users                              listings                          room_types
--------------------------         --------------------------------  ---------------------------------
id             INT PK, AI          id              INT PK, AI        id               INT PK, AI
name           VARCHAR(100)        title           VARCHAR(150)      listing_id (FK -> listings.id)
email          VARCHAR(150) UQ     description     TEXT              room_type        VARCHAR(50)
password_hash  VARCHAR(255)        area            VARCHAR(50)       prefix           CHAR(1)
phone          VARCHAR(20)         price           DECIMAL(10,2)     price            DECIMAL(10,2)
role           ENUM(student,       room_type       VARCHAR(50)       total_quantity   INT
                hoster, admin)     owner_id (FK -> users.id)         available_quantity INT
email_verified BOOLEAN             image_url       VARCHAR(500)      created_at       TIMESTAMP
verification_  VARCHAR(255)        distance_minutes INT NULL
  token                            views           INT DEFAULT 0     rooms
reset_token    VARCHAR(255) NULL   status          ENUM(active,      ---------------------------------
reset_token_   DATETIME NULL         removed)                        id               INT PK, AI
  expires                          created_at      TIMESTAMP         room_type_id (FK -> room_types.id)
paystack_      VARCHAR(100) NULL                                     room_number      VARCHAR(20)  -- "A001"
  subaccount_code                                                    status  ENUM(available, occupied)
bank_name      VARCHAR(100) NULL                                     created_at       TIMESTAMP
bank_code      VARCHAR(20) NULL
bank_account_  VARCHAR(50) NULL
  number
bank_account_  VARCHAR(150) NULL
  name

bookings                           listing_photos                    reviews
--------------------------------   ------------------------------    --------------------------------
id              INT PK, AI         id               INT PK, AI       id             INT PK, AI
room_type_id (FK -> room_types.id) listing_id (FK -> listings.id)    listing_id (FK -> listings.id)
room_id (FK -> rooms.id) NULL      image_url        VARCHAR(500)     student_id (FK -> users.id)
listing_id (FK -> listings.id)     sort_order       INT              rating         TINYINT (1-5)
student_id (FK -> users.id)        created_at       TIMESTAMP        comment        TEXT NULL
created_at      TIMESTAMP                                            created_at     TIMESTAMP
payment_status ENUM(pending,                                         UNIQUE (listing_id, student_id)
  paid, expired, cancelled)
payment_deadline DATETIME NULL     completed_stays                   favorites
paystack_reference VARCHAR(100)    --------------------------------  --------------------------------
  NULL UNIQUE                      id              INT PK, AI        id              INT PK, AI
paid_at         DATETIME NULL      student_id (FK -> users.id)       student_id (FK -> users.id)
                                    listing_id (FK -> listings.id)    listing_id (FK -> listings.id)
                                    created_at      TIMESTAMP         created_at      TIMESTAMP
                                    UNIQUE (student_id, listing_id)   UNIQUE (student_id, listing_id)

conversations                      messages
--------------------------------   --------------------------------
id              INT PK, AI         id              INT PK, AI
listing_id (FK -> listings.id)     conversation_id (FK -> conversations.id)
student_id (FK -> users.id)        sender_id (FK -> users.id)
hoster_id (FK -> users.id)         body            TEXT
created_at      TIMESTAMP          created_at      TIMESTAMP
last_message_at TIMESTAMP          read_at         TIMESTAMP NULL
UNIQUE (listing_id, student_id)
```

Key relationships:
- One user (`hoster` or `admin`) owns many listings (`listings.owner_id`).
- One listing has many room types (`room_types.listing_id`), each tracking its own `total_quantity` / `available_quantity` independently. Each room type has a stable single-letter `prefix` (A, B, C...), assigned once when it's created and never changed on edit.
- One room type has many individual `rooms`, each with a unique `room_number` combining the room type's prefix with a zero-padded sequence number (e.g. `A001`). A room's `status` is `available` or `occupied`.
- One booking references exactly one room type, one listing, and one student, and decrements that room type's `available_quantity` by one the moment it's created (a 72-hour hold). `room_id` stays `NULL` until payment actually clears — a specific physical room is only ever handed to a student once they've paid, not at the initial hold. `payment_status` tracks the booking's lifecycle; `paystack_reference` ties it to a specific Paystack transaction.
- `completed_stays` is written once, the instant a booking is confirmed paid (see `utils/reconcilePayment.js`), and is **never** touched by anything that happens to the booking row afterward. Review eligibility (`routes/reviews.js`) checks this table, not `bookings` directly — this is what lets a hoster delete an old paid booking without silently revoking a student's ability to leave a review for a stay that genuinely happened.
- One listing has many gallery photos (`listing_photos.listing_id`); `listings.image_url` is kept as a denormalized "current cover photo" for fast card rendering, and is recomputed whenever photos are added, removed, or a new cover is chosen.
- A review requires the student to have a row in `completed_stays` for that listing; the `UNIQUE (listing_id, student_id)` constraint means resubmitting a review updates it (upsert) rather than creating duplicates.
- One conversation belongs to exactly one listing, one student, and one hoster (`UNIQUE (listing_id, student_id)` — reopening a chat about the same listing reuses the existing thread). Deleting a conversation cascades to delete all of its `messages`.
- `status` on `listings` supports admin moderation without permanently deleting data.

### 5.2 Roles and Permissions

| Action | Public | Student | Hoster | Admin |
|---|---|---|---|---|
| Browse / search / filter active listings | Yes | Yes | Yes | Yes |
| Sign up / log in / reset forgotten password | Yes | - | - | - |
| Manage own profile (name, phone, email, password) | No | Yes | Yes | Yes |
| Post a listing | No | No | Yes | Yes |
| Edit / remove own listing | No | No | Yes | Yes |
| Book a room (72-hour hold) | No | Yes | No | No |
| Pay for a booking | No | Yes | No | No |
| Cancel own booking (only while still unpaid) | No | Yes | No | No |
| Delete any booking on own listing (any status) | No | No | Yes | Yes |
| Set up payout bank account | No | No | Yes | Yes (self) |
| Leave a review (requires a completed, paid stay) | No | Yes | No | No |
| Favorite / unfavorite a listing | No | Yes | No | No |
| Message the other party about a listing | No | Yes (initiates) | Yes (replies) | No |
| Delete a conversation (either participant) | No | Yes (own) | Yes (own) | No |
| Delete any listing | No | No | No | Yes |
| View platform stats | No | No | No | Yes |
| View / delete any user | No | No | No | Yes |
| Moderate (remove/restore) any listing | No | No | No | Yes |

Permissions are enforced server-side in `middleware/auth.js` (`requireLogin`, `requireRole`), not just hidden in the UI — for example, a student cannot post a listing even by calling the API directly, and a hoster cannot edit a listing they don't own even if they know its id. Every route under `/api/admin` requires the `admin` role at the router level (`routes/admin.js`).

### 5.3 API Endpoint Specification

**Base URL (local):** `http://localhost:3000/api`

**Auth** (`routes/auth.js`)

| Method | Endpoint | Access | Body | Response |
|---|---|---|---|---|
| POST | `/auth/signup` | Public | name, email, password, phone, role (student or hoster) | 201; sends a verification email |
| GET | `/auth/verify?token=` | Public | - | 200, marks the account verified |
| POST | `/auth/login` | Public (rate-limited) | email, password | 200 with user object, or 401/403 if unverified |
| POST | `/auth/logout` | Logged in | - | 200 |
| GET | `/auth/me` | Public | - | 200, user is null if logged out |
| GET | `/auth/csrf-token` | Public | - | 200, issues the session's CSRF token |
| POST | `/auth/forgot-password` | Public | email | 200 (same response whether or not the email exists) |
| POST | `/auth/reset-password` | Public | token, newPassword | 200, or 400 if expired/invalid |
| PUT | `/auth/me` | Logged in | name, phone, email | 200; changing email re-triggers verification |
| PUT | `/auth/password` | Logged in | currentPassword, newPassword | 200, or 401 if current password is wrong |

**Listings** (`routes/listings.js`)

| Method | Endpoint | Access | Body | Response |
|---|---|---|---|---|
| GET | `/listings?area=&minPrice=&maxPrice=&search=&page=&limit=` | Public | - | 200, paginated active listings with rating summary |
| GET | `/listings/areas` | Public | - | 200, distinct area names currently in use |
| GET | `/listings/:id` | Public (owner/admin see any status) | - | 200, full listing with room types, photo gallery, rating; increments the view counter only for active-listing public views |
| POST | `/listings` | Hoster/Admin | multipart form: title, description, area, distance_minutes, room_types (JSON), photos (files, up to 5) | 201 with id; generates structured room numbers for each room type |
| GET | `/listings/mine/all` | Hoster/Admin | - | 200, own listings (any status) with view counts and ratings |
| DELETE | `/listings/:id` | Owner/Admin | - | 200, or 403 if not owner; also deletes photo files from Cloudinary |
| PUT | `/listings/:id` | Owner/Admin | multipart form: title, description, area, distance_minutes, room_types (JSON), remove_photo_ids (JSON), set_cover_photo_id, photos (new files) | 200, or 400 if a room type with active bookings would be removed/shrunk below its booked count; growing/shrinking quantity adds/removes actual numbered rooms |

**Bookings** (`routes/bookings.js`)

| Method | Endpoint | Access | Body | Response |
|---|---|---|---|---|
| POST | `/bookings` | Student | room_type_id | 201; holds the room type for 72 hours; emails/texts the owner and student |
| GET | `/bookings/mine` | Student | - | 200, the student's own bookings, self-healing any stuck-pending payment against Paystack on load |
| GET | `/bookings/received` | Hoster/Admin | - | 200, bookings made against the hoster's listings |
| DELETE | `/bookings/:id` | Student (own, only if still `pending`) or Hoster/Admin (own listing, any status) | - | 200; restores room-type availability by one, and releases the specific assigned room back to `available` if one had been assigned |

**Payments** (`routes/payments.js`)

| Method | Endpoint | Access | Body | Response |
|---|---|---|---|---|
| POST | `/payments/initialize` | Student | booking_id | 200 with `authorization_url` to redirect the student to Paystack |
| POST | `/payments/webhook` | Paystack (signature-verified) | Paystack event payload | 200; on `charge.success`, confirms payment via `utils/reconcilePayment.js` |
| GET | `/payments/status/:bookingId` | Student (own) | - | 200, `{ payment_status }`; actively re-checks with Paystack if still `pending` instead of only trusting the database |

**Payouts** (`routes/payouts.js`)

| Method | Endpoint | Access | Body | Response |
|---|---|---|---|---|
| GET | `/payouts/banks` | Hoster/Admin | - | 200, list of banks supported by Paystack |
| POST | `/payouts/resolve` | Hoster/Admin | account_number, bank_code | 200, confirms the real account holder name |
| GET | `/payouts/status` | Hoster/Admin | - | 200, whether payouts are already set up, and the current platform fee percentage |
| POST | `/payouts/setup` | Hoster/Admin | account_number, bank_code, bank_name | 200; creates a Paystack Subaccount and stores it on the user |

**Reviews** (`routes/reviews.js`)

| Method | Endpoint | Access | Body | Response |
|---|---|---|---|---|
| GET | `/reviews/listing/:listingId` | Public | - | 200, array of reviews for that listing |
| GET | `/reviews/can-review/:listingId` | Logged in | - | 200, `{ canReview: boolean }` based on `completed_stays`, not raw booking history |
| POST | `/reviews` | Student | listing_id, rating (1-5), comment | 201, or 403 if no completed, paid stay exists for that listing |
| DELETE | `/reviews/:id` | Review author or Admin | - | 200 |

**Favorites** (`routes/favorites.js`)

| Method | Endpoint | Access | Body | Response |
|---|---|---|---|---|
| GET | `/favorites/mine` | Student | - | 200, full favorited listings |
| GET | `/favorites/mine/ids` | Student | - | 200, just the listing ids (cheap lookup for card grids) |
| POST | `/favorites` | Student | listing_id | 201 (idempotent) |
| DELETE | `/favorites/:listingId` | Student | - | 200 |

**Messages** (`routes/messages.js`) — REST handles conversations; the messages themselves are sent/received live over Socket.io (`utils/socket.js`), not REST.

| Method | Endpoint | Access | Body | Response |
|---|---|---|---|---|
| GET | `/messages/conversations` | Logged in | - | 200, this user's conversations with last message preview + unread count |
| GET | `/messages/conversations/:id/messages` | Logged in (participant) | - | 200, full message history for that thread |
| POST | `/messages/conversations` | Student | listing_id | 201, creates (or reuses) the conversation with that listing's owner |
| GET | `/messages/unread-count` | Logged in | - | 200, total unread count across all conversations |
| DELETE | `/messages/conversations/:id` | Logged in (participant) | - | 200; cascades to delete all messages in it; pushes a live `conversation_deleted` socket event to both participants |

**Admin** (`routes/admin.js`) — every route requires the `admin` role.

| Method | Endpoint | Response |
|---|---|---|
| GET | `/admin/stats` | user, listing, and booking counts |
| GET | `/admin/users` | array of all users |
| PATCH | `/admin/users/:id/role` | 200, changes a user's role |
| DELETE | `/admin/users/:id` | 200 |
| GET | `/admin/bookings` | array of all bookings platform-wide |
| GET | `/admin/listings` | array of all listings, any status, with owner info |
| PATCH | `/admin/listings/:id/status` | body: status = active or removed |

### 5.4 Frontend Architecture

| Page | File | Access | Responsibility |
|---|---|---|---|
| Landing | landing.html + js/landing.js | Public | Marketing intro, autoplaying photo carousel, entry points for both roles |
| Browse | index.html + js/main.js | Public | Listing grid, area/price/keyword filters, favorite hearts (students), guest banner (price/availability hidden until logged in) |
| Detail | listing.html + js/listing.js | Public (booking/review/favorite/message actions require login) | Photo gallery, room type breakdown with booking, reviews, favorite toggle, distance badge, owner-only edit/remove |
| Login | login.html + js/login.js | Public | Session login, redirects by role, "forgot password" link |
| Signup | signup.html + js/signup.js | Public | Registration with role toggle |
| Forgot password | forgot-password.html + js/forgot-password.js | Public | Requests a reset link by email |
| Reset password | reset-password.html + js/reset-password.js | Public | Sets a new password from an emailed token |
| Verify email | verify-email.html + js/verify-email.js | Public | Confirms a signup verification token |
| Account | account.html + js/account.js | Logged in (any role) | Update profile (name/phone/email) and change password |
| Post | post.html + js/post.js | Hoster/Admin only | Create a listing: area, distance, per-room-type pricing, photo upload with preview |
| Edit listing | edit-listing.html + js/edit-listing.js | Owner/Admin only | Same fields as Post, plus remove-photo and set-cover-photo controls |
| Dashboard | dashboard.html + js/dashboard.js | Hoster/Admin only | Own listings with room availability, view counts, ratings; bookings received, with the assigned room number once paid, and a delete option |
| Payout settings | payout-settings.html + js/payout-settings.js | Hoster/Admin only | Connect a bank account for automatic payouts |
| My Bookings | mybookings.html + js/bookings.js | Student only | Own bookings, pay/cancel, shows the assigned room number once paid |
| Favorites | favorites.html + js/favorites.js | Student only | Shortlisted listings, remove option |
| Messages | messages.html + js/messages.js | Logged in | Full-page conversation list + thread view, real-time via Socket.io |
| Payment callback | payment-callback.html + js/payment-callback.js | Student | Where Paystack redirects after checkout; polls payment status |
| Admin | admin.html + js/admin.js | Admin only | Stats, user management, listing moderation |

`js/nav.js` is shared across every page — it calls `GET /api/auth/me` on load, renders the correct navigation links, injects the floating chat widget for logged-in users, and defines `window.showToast(...)` (a shared toast-notification system used across every page instead of native `alert()`/`confirm()` popups for error/success feedback). `js/chat-widget.js` is loaded on demand by `nav.js` the first time a logged-in user needs it, rather than on every page load. `js/area.js` and `js/csrf.js` are also shared utilities (area-chip color coding, and CSRF-token attachment for any state-changing fetch).

## 6. Validation Rules

- Signup requires name, email, password (6+ characters), phone, and role (student or hoster); duplicate emails are rejected. Accounts must verify their email before logging in.
- Listings require a title, an area (free text, 1-60 characters), and at least one room type with a price greater than 0 and a quantity between 1 and 2000. There is intentionally no minimum price floor — a hoster is free to price a room however they choose.
- A listing's optional "distance from campus" field, if provided, must be a whole number of minutes between 0 and 180.
- Room types are restricted to four fixed labels (single self-contained, or shared for 2/3/4); a listing cannot list the same room type twice.
- A room type that already has active bookings cannot be removed, and its quantity cannot be reduced below its currently booked count. Growing or shrinking a room type's quantity on edit adds or removes actual numbered `rooms` rows to match, and shrinking never removes a currently-occupied room.
- A specific room (`rooms.room_number`) is only ever assigned to a booking once payment is independently verified with Paystack — never at the moment of the initial 72-hour hold.
- A review requires a rating from 1-5 and can only be submitted by a student with a row in `completed_stays` for that listing (i.e. they actually paid and their stay was confirmed) — not merely having made a booking.
- Uploaded photos are checked against their actual file signature (not just their extension) before being accepted, and are capped at 5 photos per listing.
- All role and ownership checks happen server-side; client-side gating is a UX convenience only, not the security boundary.
- State-changing requests (POST/PUT/PATCH/DELETE) require a valid CSRF token issued to the current session; repeated failed logins are rate-limited.
- CORS only allows requests (with credentials) from the app's own configured `APP_URL`, not any origin.
- Session cookies expire after 20 minutes of inactivity — long enough to survive a real Paystack checkout (card entry, or waiting on a mobile money OTP), short enough to protect a shared computer.

## 7. Testing Approach

Automated tests live in `tests/` (run with `npm test`) and cover, end-to-end against a real (disposable) database:
- Signup → email verification → login
- Listing creation, including that structured room numbers are generated correctly (e.g. the first room type on a listing gets prefix `A`, with sequentially numbered rooms)
- CSRF protection (a state-changing request without a valid token is rejected)
- That a booking only gets a specific room assigned once payment is confirmed, not at the initial hold
- That review eligibility survives a hoster deleting the paid booking (the actual bug this was built to prevent regressing)
- That an unpaid (pending) booking does **not** grant review eligibility
- That deleting a conversation removes it and cascades to delete its messages for both participants, and that a non-participant cannot delete someone else's conversation

Beyond the automated suite, manual testing covered all roles using seeded demo accounts (`database/seed.js`): one admin, several hosters, and a student account, across sample listings in multiple areas, including:
- Public browsing, keyword search, and area/price filtering
- Account self-management (name/phone/email/password changes, including re-verification after an email change)
- Role-gated posting (hoster succeeds, student blocked with 403)
- Listing ownership (a hoster can edit/delete their own listing but not another's)
- Room-type editing edge cases: attempting to remove or shrink a room type below its booked count is correctly rejected
- Photo gallery management: uploading multiple photos, removing individual photos, and setting a non-first photo as the cover
- The full booking → payment → room assignment pipeline, including a payment landing successfully even when the Paystack webhook is delayed or missed (self-healed via My Bookings loading)
- Favoriting/unfavoriting from both the browse grid and the listing detail page
- Real-time messaging between a student and hoster account, including the floating widget on multiple pages and conversation deletion pushing live to the other participant
- Admin capabilities (stats, user list, listing moderation via status toggle, confirming moderated listings disappear from public view but remain visible to admin)
- Mobile responsiveness: iOS Safari input-zoom prevention, mobile nav for both guests and logged-in users, and the landing page's carousel and layout on a real phone screen

## 8. Future Work

Highest-priority next steps: an interactive map view (the current distance-from-campus field is hoster-entered, not GPS-verified), letting a student cancel a *paid* booking themselves with an automatic partial refund instead of needing to contact the owner directly, and surfacing "favorited by N students" back to hosters as a demand signal they don't currently see.
