# KellyLodge — Project Documentation

**Course:** Software Project Management
**Institution:** Kumasi Technical University (KsTU)
**Developer:** [Your name]
**Date:** [Submission date]

---

## 1. Problem Statement

Students at Kumasi Technical University who need off-campus accommodation currently rely on scattered WhatsApp groups, word-of-mouth referrals, and physically walking around neighborhoods to find available hostels. This process is inefficient and incomplete: listings are not centralized, information is often outdated, and students have no reliable way to compare hostels by location, price, or trustworthiness before committing time to visit them in person. Hostel owners and agents, in turn, have no low-cost, centralized channel to reach prospective student tenants beyond informal networks, and no way to manage the listings they've posted or understand whether those listings are actually being seen.

## 2. Objectives

1. Solve the **discoverability** problem by providing a centralized, searchable platform for hostel listings.
2. Solve the **trust** problem by letting students see multiple real photos per hostel and read reviews left only by students who have actually booked there.
3. Give hostel owners ("hosters") their own accounts so they can post and manage listings, including a per-room-type breakdown of price and availability, without relying on a third party.
4. Give students tools to shortlist and compare hostels (favorites) and to search/filter efficiently by area, price, or keyword.
5. Give hosters visibility into how their listings are performing (view counts, ratings) so they have a reason to improve them.
6. Give the platform operator (admin) oversight tools to moderate content and manage users.
7. Deliver a working, deployable system that demonstrates this end-to-end.

## 3. Scope

### In scope
- Public landing page introducing the platform
- Student and hoster account registration and login (session-based authentication, hashed passwords)
- Email verification on signup (Brevo transactional email), with forgot-password / reset-password flows
- Self-service account management: any logged-in user can update their name, phone, email (re-triggers verification), or password
- Browsing, filtering (by area, min/max price), and keyword search of listings (no login required to browse)
- Free-text areas — a hoster can select one of the known neighborhoods or type a new one ("Other"); the browse page's area filter is populated dynamically from whatever areas are actually in use
- Per-room-type pricing and availability (a single listing can offer several room types, each with its own price, total quantity, and live availability)
- Multi-photo galleries per listing (up to 5 photos), with the ability to remove individual photos and choose which one is the cover photo, when editing
- An optional "walking distance from campus" field per listing, shown as a badge
- Instant booking: a student books a specific room type directly; availability decrements immediately; the owner is notified by email
- Reviews and star ratings — restricted to students who have an actual booking for that listing; one review per student per listing (resubmitting updates it)
- Favorites — students can save/shortlist listings and manage them from a dedicated page
- Hoster analytics — a view counter per listing, and aggregated rating, both visible on the hoster's dashboard
- Hosters can post, view, edit, and remove their own listings; room types that already have active bookings cannot be removed or shrunk below the booked count
- An admin account with a dashboard to view platform statistics, manage all users, and moderate (remove/restore) any listing
- A REST API backend (Node.js/Express) with a MySQL database, enforcing role permissions, CSRF protection, and login rate-limiting server-side
- Responsive frontend usable on both mobile and desktop, including iOS Safari input-zoom prevention
- Deployment to a live URL via Railway

### Out of scope (future work)
- Interactive map view of listings (the current "distance from campus" field is a hoster-entered estimate, not GPS-verified)
- In-app messaging (students still contact owners directly by phone)
- Payment or deposit handling (the platform confirms a room reservation, not a financial transaction)
- Editing a review's star rating from a dedicated "edit" affordance (currently done by resubmitting the review form)
- Photo reordering beyond choosing a cover (drag-to-reorder the rest of the gallery is not implemented)

## 4. Technology Justification

| Layer | Choice | Justification |
|---|---|---|
| Frontend | HTML/CSS/vanilla JavaScript | No build tooling required, fast to develop and deploy solo; sufficient for the app's UI complexity. |
| Backend | Node.js + Express | Lightweight REST API framework; pairs naturally with a JavaScript frontend for a single-language stack. |
| Auth | express-session + bcryptjs | Session-based auth is simpler to reason about than token-based auth for a project of this scope; bcrypt ensures passwords are never stored in plain text. |
| Email | Brevo transactional email API | Used for verification emails, password reset links, and booking notifications to hosters; free tier is sufficient for project scale. |
| File uploads | Multer (in-memory) + Cloudinary + a real image-signature check | Accepts hostel photos as actual file uploads (not just URLs); validates the file's real byte signature (not just its extension) before accepting it. Files are uploaded straight to Cloudinary rather than local disk, since Railway's filesystem doesn't persist between deploys, saving to local disk would silently lose every photo on the next `git push`. |
| Database | MySQL | Relational structure fits the users/listings/room_types/bookings/reviews/favorites relationships; widely taught and supported; integrates cleanly with Railway's managed MySQL plugin. |
| Security middleware | Custom CSRF token check + login rate limiting | Protects state-changing requests (POST/PUT/DELETE) from cross-site request forgery, and slows down brute-force login attempts. |
| Deployment | Railway | Single platform hosts both the Node.js app and the MySQL database. |

## 5. System Design

### 5.1 Entity-Relationship Diagram

```
users                              listings                          room_types
--------------------------         --------------------------------  ------------------------------
id             INT PK, AI          id              INT PK, AI        id               INT PK, AI
name           VARCHAR(100)        title           VARCHAR(150)      listing_id (FK -> listings.id)
email          VARCHAR(150) UQ     description     TEXT              room_type        VARCHAR(50)
password_hash  VARCHAR(255)        area            VARCHAR(50)       price            DECIMAL(10,2)
phone          VARCHAR(20)         price           DECIMAL(10,2)     total_quantity   INT
role           ENUM(student,       room_type       VARCHAR(50)       available_quantity INT
                hoster, admin)     owner_id (FK -> users.id)         created_at       TIMESTAMP
email_verified BOOLEAN             image_url       VARCHAR(500)
verification_  VARCHAR(255)        distance_minutes INT NULL
  token                            views           INT DEFAULT 0
reset_token    VARCHAR(255) NULL   status          ENUM(active,
reset_token_   DATETIME NULL         removed)
  expires                          created_at      TIMESTAMP
created_at     TIMESTAMP

bookings                           listing_photos                    reviews
--------------------------------   ------------------------------    --------------------------------
id              INT PK, AI         id               INT PK, AI       id             INT PK, AI
room_type_id (FK -> room_types.id) listing_id (FK -> listings.id)    listing_id (FK -> listings.id)
listing_id (FK -> listings.id)     image_url        VARCHAR(500)     student_id (FK -> users.id)
student_id (FK -> users.id)        sort_order       INT              rating         TINYINT (1-5)
created_at      TIMESTAMP          created_at       TIMESTAMP        comment        TEXT NULL
                                                                      created_at     TIMESTAMP
                                                                      UNIQUE (listing_id, student_id)

favorites
--------------------------------
id              INT PK, AI
student_id (FK -> users.id)
listing_id (FK -> listings.id)
created_at      TIMESTAMP
UNIQUE (student_id, listing_id)
```

Key relationships:
- One user (`hoster` or `admin`) owns many listings (`listings.owner_id`).
- One listing has many room types (`room_types.listing_id`), each tracking its own `total_quantity` / `available_quantity` independently.
- One booking references exactly one room type, one listing, and one student; a booking decrements that room type's `available_quantity` by one.
- One listing has many gallery photos (`listing_photos.listing_id`); `listings.image_url` is kept as a denormalized "current cover photo" for fast card rendering, and is recomputed whenever photos are added, removed, or a new cover is chosen. Both `listings` and `listing_photos` also carry a `public_id` column (`image_public_id` on listings), Cloudinary's identifier for that specific asset, needed to actually delete an image from Cloudinary later since the URL alone isn't enough for that.
- A review requires the student to already have a row in `bookings` for that listing; the `UNIQUE (listing_id, student_id)` constraint means resubmitting a review updates it (upsert) rather than creating duplicates.
- `status` on `listings` supports admin moderation without permanently deleting data.

### 5.2 Roles and Permissions

| Action | Public | Student | Hoster | Admin |
|---|---|---|---|---|
| Browse / search / filter active listings | Yes | Yes | Yes | Yes |
| Sign up / log in / reset forgotten password | Yes | - | - | - |
| Manage own profile (name, phone, email, password) | No | Yes | Yes | Yes |
| Post a listing | No | No | Yes | Yes |
| Edit / remove own listing | No | No | Yes | Yes |
| Book a room | No | Yes | No | No |
| Cancel own booking | No | Yes | No | No |
| Leave a review (requires an existing booking for that listing) | No | Yes | No | No |
| Favorite / unfavorite a listing | No | Yes | No | No |
| Delete any listing | No | No | No | Yes |
| View platform stats | No | No | No | Yes |
| View / delete any user | No | No | No | Yes |
| Moderate (remove/restore) any listing | No | No | No | Yes |

Permissions are enforced server-side in `middleware/auth.js` (`requireLogin`, `requireRole`), not just hidden in the UI — for example, a student cannot post a listing even by calling the API directly, and a hoster cannot edit a listing they don't own even if they know its id.

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
| GET | `/listings/:id` | Public | - | 200, full listing with room types, photo gallery, rating; increments the view counter |
| POST | `/listings` | Hoster/Admin | multipart form: title, description, area, distance_minutes, room_types (JSON), photos (files, up to 5) | 201 with id |
| GET | `/listings/mine/all` | Hoster/Admin | - | 200, own listings (any status) with view counts and ratings |
| DELETE | `/listings/:id` | Owner/Admin | - | 200, or 403 if not owner; also deletes photo files from disk |
| PUT | `/listings/:id` | Owner/Admin | multipart form: title, description, area, distance_minutes, room_types (JSON), remove_photo_ids (JSON), set_cover_photo_id, photos (new files) | 200, or 400 if a room type with active bookings would be removed/shrunk |

**Bookings** (`routes/bookings.js`)

| Method | Endpoint | Access | Body | Response |
|---|---|---|---|---|
| POST | `/bookings` | Student | room_type_id | 201; decrements availability; emails the owner |
| GET | `/bookings/mine` | Student | - | 200, the student's own bookings |
| GET | `/bookings/received` | Hoster/Admin | - | 200, bookings made against the hoster's listings |
| DELETE | `/bookings/:id` | Student (own booking) | - | 200; restores availability by one |

**Reviews** (`routes/reviews.js`)

| Method | Endpoint | Access | Body | Response |
|---|---|---|---|---|
| GET | `/reviews/listing/:listingId` | Public | - | 200, array of reviews for that listing |
| GET | `/reviews/can-review/:listingId` | Logged in | - | 200, `{ canReview: boolean }` based on booking history |
| POST | `/reviews` | Student | listing_id, rating (1-5), comment | 201, or 403 if no booking exists for that listing |
| DELETE | `/reviews/:id` | Review author or Admin | - | 200 |

**Favorites** (`routes/favorites.js`)

| Method | Endpoint | Access | Body | Response |
|---|---|---|---|---|
| GET | `/favorites/mine` | Student | - | 200, full favorited listings |
| GET | `/favorites/mine/ids` | Student | - | 200, just the listing ids (cheap lookup for card grids) |
| POST | `/favorites` | Student | listing_id | 201 (idempotent) |
| DELETE | `/favorites/:listingId` | Student | - | 200 |

**Admin** (`routes/admin.js`)

| Method | Endpoint | Access | Response |
|---|---|---|---|
| GET | `/admin/stats` | Admin | user and listing counts |
| GET | `/admin/users` | Admin | array of all users |
| DELETE | `/admin/users/:id` | Admin | 200 |
| GET | `/admin/listings` | Admin | array of all listings, any status, with owner info |
| PATCH | `/admin/listings/:id/status` | Admin | body: status = active or removed |

### 5.4 Frontend Architecture

| Page | File | Access | Responsibility |
|---|---|---|---|
| Landing | landing.html + js/landing.js | Public | Marketing intro, animated hero (key-tag entrance animation, mouse-parallax tilt), entry points for both roles |
| Browse | index.html + js/main.js | Public | Listing grid, area/price/keyword filters, favorite hearts (students), guest banner |
| Detail | listing.html + js/listing.js | Public (booking/review/favorite actions require login) | Photo gallery, room type breakdown with booking, reviews, favorite toggle, distance badge, owner-only edit/remove |
| Login | login.html + js/login.js | Public | Session login, redirects by role, "forgot password" link |
| Signup | signup.html + js/signup.js | Public | Registration with role toggle |
| Forgot password | forgot-password.html + js/forgot-password.js | Public | Requests a reset link by email |
| Reset password | reset-password.html + js/reset-password.js | Public | Sets a new password from an emailed token |
| Verify email | verify-email.html + js/verify-email.js | Public | Confirms a signup verification token |
| Account | account.html + js/account.js | Logged in (any role) | Update profile (name/phone/email) and change password |
| Post | post.html + js/post.js | Hoster/Admin only | Create a listing: area (with "Other"), distance, per-room-type pricing, photo upload with preview |
| Edit listing | edit-listing.html + js/edit-listing.js | Owner/Admin only | Same fields as Post, plus remove-photo and set-cover-photo controls |
| Dashboard | dashboard.html + js/dashboard.js | Hoster/Admin only | Own listings with room availability, view counts, ratings |
| My Bookings | mybookings.html + js/bookings.js | Student only | Own bookings, cancel option |
| Favorites | favorites.html + js/favorites.js | Student only | Shortlisted listings, remove option |
| Admin | admin.html + js/admin.js | Admin only | Stats, user management, listing moderation |

`js/nav.js` is shared across every page — it calls `GET /api/auth/me` on load and renders the correct navigation links (Login/Signup vs. a user menu with role-specific links, including Account and, for students, My Bookings and Favorites). `js/area.js` and `js/csrf.js` are also shared utilities (area-chip color coding, and CSRF-token attachment for any state-changing fetch).

## 6. Validation Rules

- Signup requires name, email, password (6+ characters), phone, and role (student or hoster); duplicate emails are rejected. Accounts must verify their email before logging in.
- Listings require a title, an area (free text, 1-60 characters — either a known neighborhood or a typed-in "Other" value), and at least one room type with a price greater than 0 and a quantity between 1 and 2000.
- A listing's optional "distance from campus" field, if provided, must be a whole number of minutes between 0 and 180.
- Room types are restricted to four fixed labels (single self-contained, or shared for 2/3/4); a listing cannot list the same room type twice.
- A room type that already has active bookings cannot be removed, and its quantity cannot be reduced below its currently booked count.
- A review requires a rating from 1-5 and can only be submitted by a student with an existing booking for that listing; one review per student per listing (further submissions update it rather than duplicating it).
- Uploaded photos are checked against their actual file signature (not just their extension) before being accepted, and are capped at 5 photos per listing.
- All role and ownership checks happen server-side; client-side gating is a UX convenience only, not the security boundary.
- State-changing requests (POST/PUT/DELETE) require a valid CSRF token issued to the current session; repeated failed logins are rate-limited.

## 7. Testing Approach

All roles were demonstrated using seeded demo accounts (see `database/seed.js`): one admin, several hosters, and a student account, covering sample listings across multiple areas.

Testing covered:
- Public browsing, keyword search, and area/price filtering
- Signup → email verification → login, and the forgot-password → reset-password flow
- Account self-management (name/phone/email/password changes, including re-verification after an email change)
- Role-gated posting (hoster succeeds, student blocked with 403)
- Listing ownership (a hoster can edit/delete their own listing but not another's)
- Room-type editing edge cases: attempting to remove or shrink a room type below its booked count is correctly rejected
- Photo gallery management: uploading multiple photos, removing individual photos, and setting a non-first photo as the cover
- Booking a room, confirming availability decrements immediately and the owner receives an email notification
- Leaving a review as a student who has booked, confirming a student who hasn't booked is blocked, and confirming the listing's average rating updates
- Favoriting/unfavoriting from both the browse grid and the listing detail page
- Admin capabilities (stats, user list, listing moderation via status toggle, confirming moderated listings disappear from public view but remain visible to admin)
- Mobile responsiveness: iOS Safari input-zoom prevention, mobile nav, and the landing hero's layout and animation on a real phone screen

## 8. Future Work

Highest-priority next steps: an interactive map view (the current distance-from-campus field is hoster-entered, not GPS-verified), in-app messaging as an alternative to phone calls, and surfacing "favorited by N students" back to hosters as a demand signal they don't currently see.
