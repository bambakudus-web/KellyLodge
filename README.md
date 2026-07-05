# KellyLodge

A hostel listing and discovery platform for students at Kumasi Technical University (KsTU). Built as a solo project for a Software Project Management course, now expanded with authentication, roles, and an admin dashboard.

Students browse and filter hostel listings by area and price. Hostel owners ("hosters") sign up, log in, and post their own listings. An admin (the developer) can moderate listings and manage users.

## Tech stack

- Frontend: HTML, CSS, vanilla JavaScript
- Backend: Node.js + Express, session-based auth (express-session + bcryptjs)
- Database: MySQL
- Deployment: Railway

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
├── server.js                # Express app entry point (sessions, static files, routers)
├── db.js                    # MySQL connection pool
├── middleware/
│   └── auth.js              # requireLogin / requireRole session guards
├── routes/
│   ├── auth.js               # signup, login, logout, /me
│   ├── listings.js           # public browse + hoster post/delete
│   └── admin.js               # admin-only stats, users, moderation
├── public/
│   ├── landing.html          # marketing homepage (site root)
│   ├── index.html            # browse + filter listings
│   ├── listing.html          # single listing detail
│   ├── login.html / signup.html
│   ├── post.html             # hoster-only: post a listing
│   ├── admin.html            # admin-only dashboard
│   ├── css/style.css
│   └── js/                   # one file per page, plus shared nav.js
├── database/
│   ├── schema.sql            # users + listings tables
│   └── seed.js               # creates demo accounts (hashed passwords) + sample listings
├── docs/
│   └── documentation.md      # problem statement, scope, system design
├── .env.example
└── package.json
```

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

### 2. Create the database

```bash
mysql -u root -p < database/schema.sql
```

### 3. Install Node dependencies

```bash
npm install
```

### 4. Configure environment variables

```bash
cp .env.example .env
```

Edit `.env`:
```
DB_HOST=127.0.0.1
DB_USER=root
DB_PASSWORD=yourpassword
DB_NAME=kellylodge
DB_PORT=3306
PORT=3000
SESSION_SECRET=some_random_string
```

### 5. Seed demo users and listings

```bash
npm run seed
```

This creates the demo accounts listed above and 10 sample listings.

### 6. Start the server

```bash
npm start
```

Visit `http://localhost:3000` — it will load the landing page.

## Deploying to Railway

1. Push this project to a GitHub repository.
2. In Railway, create a new project → **Deploy from GitHub repo**.
3. Add a **MySQL** plugin to the same project. Railway provides a `DATABASE_URL` variable automatically — `db.js` already detects and uses it, so you don't need to set individual `DB_*` variables in production.
4. Also set a `SESSION_SECRET` variable in Railway (any random string).
5. Open the MySQL service's query tool and run `database/schema.sql`.
6. Run the seed script once against production — easiest way is to temporarily add `"postdeploy": "node database/seed.js"` to your Railway start command, or run it locally pointed at the production `DATABASE_URL`.
7. Make sure the Node service's **Start Command** is `npm start`.
8. Deploy — Railway gives you a public URL.

## API overview

| Method | Endpoint | Access | Purpose |
|---|---|---|---|
| POST | `/api/auth/signup` | Public | Create a student or hoster account |
| POST | `/api/auth/login` | Public | Log in |
| POST | `/api/auth/logout` | Logged in | Log out |
| GET | `/api/auth/me` | Public | Check current session |
| GET | `/api/listings` | Public | Browse active listings (filter by `area`, `minPrice`, `maxPrice`) |
| GET | `/api/listings/:id` | Public | View one active listing |
| POST | `/api/listings` | Hoster/Admin | Create a listing |
| GET | `/api/listings/mine/all` | Hoster/Admin | View your own listings (any status) |
| DELETE | `/api/listings/:id` | Owner or Admin | Remove a listing |
| GET | `/api/admin/stats` | Admin | Platform-wide counts |
| GET | `/api/admin/users` | Admin | List all users |
| DELETE | `/api/admin/users/:id` | Admin | Remove a user |
| GET | `/api/admin/listings` | Admin | List all listings, any status |
| PATCH | `/api/admin/listings/:id/status` | Admin | Moderate: mark active/removed |

Full request/response examples are in `docs/documentation.md`.

## Notes for the course submission

- Roles are enforced server-side via session middleware (`middleware/auth.js`), not just hidden in the UI.
- Passwords are hashed with bcrypt before storage — never stored in plain text.
- Admin moderation is soft-delete (`status: removed`) rather than a hard delete, so listings can be restored.

## Deploying staging vs. production on Railway

Don't run staging and production against the same database or the same env vars — a bad test on staging shouldn't touch real bookings.

1. In Railway, create **two environments** inside the project (or two separate projects if you want full isolation): `staging` and `production`.
2. Each environment gets its **own MySQL plugin** (own `DATABASE_URL`) and its **own values** for:
   - `SESSION_SECRET` — generate a different random value per environment: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`
   - `BREVO_API_KEY` / `BREVO_SENDER_EMAIL` — you can reuse the same Brevo account, but consider a distinct sender name like "KellyLodge (Staging)" so test emails are obviously test emails.
   - `APP_URL` — the actual Railway-assigned domain for that environment, so verification emails link to the right place.
   - `NODE_ENV=production` — set this in **both** staging and production Railway environments (it controls secure cookies, not which environment it "is"). Only your local `.env` should omit it.
3. Push to a `staging` branch to deploy to the staging environment, and only merge to `main` to deploy to production, once you've clicked through the staging URL yourself.
4. Never run `tests/booking.test.js` against the production `DATABASE_URL` — it creates and deletes real rows. Point your local `.env` at a throwaway MySQL database (or the staging one) before running `npm test`.
