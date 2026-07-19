# KellyLodge

A hostel listing, booking, and payment platform for students at Kumasi Technical University (KsTU). Started as a solo Software Project Management course project and grown into a full booking pipeline: students browse and pay for a specific room, get assigned a real numbered room, and can message the hoster directly.

Students browse and filter hostel listings by area and price. Hostel owners ("hosters") sign up, post listings with a per-room-type breakdown, and receive their share of each payment automatically via Paystack. An admin can moderate listings and manage users.

## Tech stack

- **Frontend:** HTML, CSS, vanilla JavaScript (no build step, no framework)
- **Backend:** Node.js + Express, session-based auth (`express-session` + `bcryptjs`)
- **Database:** MySQL
- **Real-time:** Socket.io (in-app messaging)
- **Payments:** Paystack (checkout + automatic hoster payouts via Subaccounts)
- **Email:** Brevo transactional email
- **SMS:** Arkesel
- **File storage:** Cloudinary (listing photos — Railway's own filesystem doesn't persist between deploys, so photos can't live on local disk)
- **Deployment:** Railway

## Demo accounts

After running the seed script, these accounts are available (password for all: `password123`):

| Role | Email |
|---|---|
| Admin | admin@kellylodge.com |
| Hoster | boateng@kellylodge.com |
| Hoster | rhema@kellylodge.com |
| Hoster | awo@kellylodge.com |
| Hoster | chris@kellylodge.com |
| Student | ama@kellylodge.com |

## Project structure

```
kellylodge/
├── server.js                  # Express app entry point (sessions, CORS, static files, Socket.io init)
├── db.js                      # MySQL connection pool
├── middleware/
│   ├── auth.js                 # requireLogin / requireRole session guards
│   ├── csrf.js                 # CSRF token issuing + verification
│   ├── rateLimit.js             # login rate limiting
│   └── upload.js               # Multer + Cloudinary + real image-signature validation
├── routes/
│   ├── auth.js                  # signup, login, logout, verification, password reset, profile
│   ├── listings.js              # browse, post, edit, delete listings (generates room numbers)
│   ├── bookings.js              # book a room, cancel, list mine/received
│   ├── payments.js              # Paystack checkout + webhook + status polling
│   ├── payouts.js               # hoster bank account setup (Paystack Subaccounts)
│   ├── reviews.js                # star ratings, gated by completed_stays not raw bookings
│   ├── favorites.js              # shortlist listings
│   ├── messages.js               # conversations (Socket.io handles the messages themselves)
│   └── admin.js                  # stats, user management, listing moderation
├── utils/
│   ├── email.js / sms.js          # Brevo / Arkesel senders
│   ├── paystack.js                # Paystack API wrapper (verify, initialize, subaccounts)
│   ├── reconcilePayment.js        # the one place that marks a booking paid + assigns a room
│   ├── cloudinary.js              # image upload/delete
│   ├── socket.js                  # Socket.io server: chat, typing indicators, live deletes
│   ├── expireBookings.js          # background job: sweeps unpaid bookings past their deadline
│   └── validation.js
├── public/
│   ├── landing.html            # marketing homepage (site root)
│   ├── index.html              # browse + filter listings
│   ├── listing.html            # single listing detail, booking, reviews
│   ├── login.html / signup.html / forgot-password.html / reset-password.html / verify-email.html
│   ├── post.html / edit-listing.html   # hoster: create/edit a listing
│   ├── dashboard.html          # hoster: own listings + received bookings
│   ├── payout-settings.html    # hoster: connect a bank account for automatic payouts
│   ├── mybookings.html         # student: own bookings, pay/cancel
│   ├── favorites.html          # student: shortlisted listings
│   ├── payment-callback.html   # where Paystack redirects after checkout
│   ├── admin.html              # admin dashboard
│   ├── css/style.css           # single stylesheet, whole site
│   └── js/                     # one file per page, plus shared nav.js / csrf.js / area.js
├── database/
│   ├── init_schema.js          # creates the full current schema from scratch (all 11 tables)
│   ├── seed.js                 # demo accounts + sample listings
│   ├── add_*.js                # incremental migrations, for upgrading an EXISTING database
│   │                             (each one is idempotent — safe to run more than once)
│   └── fix_room_availability.js / reset_bookings.js / update_prices.js   # one-off maintenance scripts
├── tests/
│   ├── booking.test.js
│   └── rooms_and_reviews.test.js
├── docs/
│   └── documentation.md        # problem statement, scope, full system design
├── .env.example
└── package.json
```

## How a booking actually works

1. A student picks a room type on a listing and books it — this holds a room type's inventory (not a specific physical room yet) for **72 hours** and creates a `pending` booking.
2. The student pays via Paystack from My Bookings. On successful payment (confirmed independently — see below), the booking flips to `paid` **and** a specific physical room (e.g. `A001`) gets assigned to them from that room type's pool. Both the student and hoster get an email and SMS naming the room.
3. If payment never happens within 72 hours, a background sweep (`utils/expireBookings.js`) deletes the booking and returns the room-type inventory.
4. Payment confirmation doesn't rely on Paystack's webhook alone arriving — `utils/reconcilePayment.js` is the single shared function called by the webhook, the payment-callback page, and every time My Bookings loads, so a booking can self-heal into `paid` even if the webhook was missed.
5. A permanent `completed_stays` record is written the moment payment clears, independent of the `bookings` row itself — so a booking being deleted later (by a hoster, or by the expiry sweep) can never take away a review a student already earned the right to leave.

## Running locally on WSL Ubuntu

### 1. Install MySQL (if not already installed)

```bash
sudo apt update
sudo apt install mysql-server
sudo service mysql start
```

Set a root password (needed for Node to connect over TCP):
```bash
sudo mysql -u root -e "ALTER USER 'root'@'localhost' IDENTIFIED WITH mysql_native_password BY 'yourpassword'; FLUSH PRIVILEGES;"
```

### 2. Create the database and schema

```bash
mysql -u root -p -e "CREATE DATABASE kellylodge;"
npm run db:init
```

`db:init` creates all 11 tables fresh. If you're instead upgrading an already-running database, don't use `db:init` — run the individual `migrate:*` scripts listed below under **Migrations** in the order they were added.

### 3. Install Node dependencies

```bash
npm install
```

### 4. Configure environment variables

```bash
cp .env.example .env
```

Fill in `.env` — at minimum `DB_*` and `SESSION_SECRET` are required to run at all. Brevo/Arkesel/Paystack/Cloudinary keys are needed for email, SMS, payments, and photo uploads respectively; the app will run without them but those specific features will silently no-op or log a warning instead of sending/uploading anything.

### 5. Seed demo users and listings

```bash
npm run seed
```

### 6. Start the server

```bash
npm start
```

Visit `http://localhost:3000` — it loads the landing page.

## Migrations

`npm run db:init` (`database/init_schema.js`) is the single canonical way to get a **brand-new** database to the current schema — all 11 tables in one shot, safe to run more than once.

For an **existing** database that predates a given feature, run the specific migration instead:

| Script | Adds |
|---|---|
| `npm run migrate:bookings` | `bookings` table |
| `npm run migrate:room-types` | `room_types` table |
| `npm run migrate:v2-features` | `listing_photos`, `reviews`, `favorites` |
| `npm run migrate:payments` | payment columns on `bookings` |
| `npm run migrate:email-verification` | email verification columns on `users` |
| `npm run migrate:password-reset` | password reset columns on `users` |
| `npm run migrate:cloudinary-fields` | Cloudinary `public_id` columns |
| `npm run migrate:messaging` | `conversations`, `messages` |
| `npm run migrate:payouts` | Paystack Subaccount columns on `users` |
| `npm run migrate:room-numbers` | `rooms` table + structured room numbers (A001, A002...) |
| `npm run migrate:completed-stays` | `completed_stays` table (permanent review eligibility) |

Every migration script only acts on what's actually missing, so running one twice (or running `db:init` on a database that already has some tables) is safe.

## Deploying to Railway

1. Push this project to a GitHub repository.
2. In Railway, create a new project → **Deploy from GitHub repo**.
3. Add a **MySQL** plugin to the same project. Railway provides a `DATABASE_URL` variable automatically — `db.js` already detects and uses it, so you don't need to set individual `DB_*` variables in production.
4. Set the rest of the variables from `.env.example` in Railway's project settings (`SESSION_SECRET`, `APP_URL` — your actual `https://...railway.app` domain, no trailing slash — plus the Brevo/Arkesel/Paystack/Cloudinary keys).
5. Run `railway run node database/init_schema.js` once against the fresh database.
6. Run `railway run node database/seed.js` once, if you want the demo accounts in production too.
7. In your Paystack dashboard, set the **Live Webhook URL** to `https://your-domain/api/payments/webhook` and the **Live Callback URL** to `https://your-domain/payment-callback.html`.
8. Make sure the Node service's **Start Command** is `npm start`.
9. Deploy — Railway gives you a public URL.

## API overview

Full request/response detail for every endpoint is in `docs/documentation.md`. Quick map of what's mounted where:

| Prefix | File | Covers |
|---|---|---|
| `/api/auth` | `routes/auth.js` | signup, login, logout, email verification, password reset, profile |
| `/api/listings` | `routes/listings.js` | browse/search, post, edit, delete |
| `/api/bookings` | `routes/bookings.js` | book, cancel/delete, list mine/received |
| `/api/payments` | `routes/payments.js` | Paystack checkout, webhook, status polling |
| `/api/payouts` | `routes/payouts.js` | hoster bank account setup |
| `/api/reviews` | `routes/reviews.js` | star ratings |
| `/api/favorites` | `routes/favorites.js` | shortlist listings |
| `/api/messages` | `routes/messages.js` | conversations (messages themselves go over Socket.io) |
| `/api/admin` | `routes/admin.js` | stats, users, moderation |

## Testing

```bash
npm test
```

⚠️ This creates and deletes real rows using whatever database `.env` points to. **Never point `.env` at your production `DATABASE_URL` when running this** — use a disposable local or staging database.

## Notes for the course submission

- Roles are enforced server-side via session middleware (`middleware/auth.js`), not just hidden in the UI.
- Passwords are hashed with bcrypt before storage — never stored in plain text.
- Admin moderation is soft-delete (`status: removed`) rather than a hard delete, so listings can be restored.
- State-changing requests require a CSRF token (`middleware/csrf.js`); logins are rate-limited (`middleware/rateLimit.js`).
- Uploaded photos are checked against their real file signature, not just their extension, before being accepted.

## Deploying staging vs. production on Railway

Don't run staging and production against the same database or the same env vars — a bad test on staging shouldn't touch real bookings.

1. In Railway, create **two environments** inside the project (or two separate projects if you want full isolation): `staging` and `production`.
2. Each environment gets its **own MySQL plugin** (own `DATABASE_URL`) and its **own values** for:
   - `SESSION_SECRET` — generate a different random value per environment: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`
   - `BREVO_API_KEY` / `BREVO_SENDER_EMAIL` — you can reuse the same Brevo account, but consider a distinct sender name like "KellyLodge (Staging)" so test emails are obviously test emails.
   - `APP_URL` — the actual Railway-assigned domain for that environment, so verification emails and Paystack redirects link to the right place.
   - `NODE_ENV=production` — set this in **both** staging and production Railway environments (it controls secure cookies, not which environment it "is"). Only your local `.env` should omit it.
3. Push to a `staging` branch to deploy to the staging environment, and only merge to `main` to deploy to production, once you've clicked through the staging URL yourself.
4. Never run `npm test` against the production `DATABASE_URL` — it creates and deletes real rows.
