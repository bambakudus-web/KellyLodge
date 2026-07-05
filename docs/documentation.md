# KellyLodge — Project Documentation

**Course:** Software Project Management
**Institution:** Kumasi Technical University (KsTU)
**Developer:** [Your name]
**Date:** [Submission date]

---

## 1. Problem Statement

Students at Kumasi Technical University who need off-campus accommodation currently rely on scattered WhatsApp groups, word-of-mouth referrals, and physically walking around neighborhoods such as Fante New Town, Asafo, and Amakom to find available hostels. This process is inefficient and incomplete: listings are not centralized, information is often outdated, and students have no reliable way to compare hostels by location or price before committing time to visit them in person. Hostel owners and agents, in turn, have no low-cost, centralized channel to reach prospective student tenants beyond informal networks, and no way to manage the listings they've posted.

## 2. Objectives

1. Solve the **discoverability** problem by providing a centralized, searchable platform for hostel listings.
2. Give hostel owners ("hosters") their own accounts so they can post and manage listings without relying on a third party.
3. Give the platform operator (admin) oversight tools to moderate content and manage users.
4. Deliver a working, deployable system that demonstrates this end-to-end.

## 3. Scope

### In scope
- Public landing page introducing the platform
- Student and hoster account registration and login (session-based authentication, hashed passwords)
- Browsing and filtering listings by area and price (no login required)
- Hosters can post, view, and remove their own listings
- An admin account with a dashboard to view platform statistics, manage all users, and moderate (remove/restore) any listing
- A REST API backend (Node.js/Express) with a MySQL database, enforcing role permissions server-side
- Responsive frontend usable on both mobile and desktop
- Deployment to a live URL via Railway

### Out of scope (future work)
- Image upload to cloud storage (the MVP accepts image URLs only)
- Password reset / email verification flows
- Reviews and ratings
- Favorites/bookmarking
- Map view of listings
- In-app messaging (students contact owners directly by phone)
- Payment or booking confirmation (the platform is a discovery/listing tool, not a booking system)

## 4. Technology Justification

| Layer | Choice | Justification |
|---|---|---|
| Frontend | HTML/CSS/vanilla JavaScript | No build tooling required, fast to develop and deploy solo; sufficient for the app's UI complexity. |
| Backend | Node.js + Express | Lightweight REST API framework; pairs naturally with a JavaScript frontend for a single-language stack. |
| Auth | express-session + bcryptjs | Session-based auth is simpler to reason about than token-based auth for a project of this scope; bcrypt ensures passwords are never stored in plain text. |
| Database | MySQL | Relational structure fits the users/listings relationship (one hoster owns many listings); widely taught and supported, integrates cleanly with Railway's managed MySQL plugin. |
| Deployment | Railway | Single platform can host both the Node.js app and the MySQL database. |

## 5. System Design

### 5.1 Entity-Relationship Diagram

```
users                              listings
--------------------------         --------------------------------
id             INT PK, AI          id              INT PK, AI
name           VARCHAR(100)        title           VARCHAR(150)
email          VARCHAR(150) UQ     description     TEXT
password_hash  VARCHAR(255)        area            VARCHAR(50)
phone          VARCHAR(20)         price           DECIMAL(10,2)
role           ENUM(student,       owner_id (FK -> users.id)
                hoster, admin)     room_type       VARCHAR(50)
created_at     TIMESTAMP           image_url       VARCHAR(500)
                                   status          ENUM(active, removed)
                                   created_at      TIMESTAMP
```

Relationship: one user (role = `hoster` or `admin`) can own many listings (`listings.owner_id` references `users.id`). `status` supports admin moderation without permanently deleting data.

### 5.2 Roles and Permissions

| Action | Public | Student | Hoster | Admin |
|---|---|---|---|---|
| Browse / view active listings | Yes | Yes | Yes | Yes |
| Sign up / log in | Yes | - | - | - |
| Post a listing | No | No | Yes | Yes |
| Delete own listing | No | No | Yes | Yes |
| Delete any listing | No | No | No | Yes |
| View platform stats | No | No | No | Yes |
| View / delete any user | No | No | No | Yes |
| Moderate (remove/restore) any listing | No | No | No | Yes |

Permissions are enforced server-side in `middleware/auth.js`, not just hidden in the UI — a student cannot post a listing even by calling the API directly.

### 5.3 API Endpoint Specification

**Base URL (local):** `http://localhost:3000/api`

**Auth**

| Method | Endpoint | Access | Body | Response |
|---|---|---|---|---|
| POST | `/auth/signup` | Public | name, email, password, phone, role (student or hoster) | 201 with user object |
| POST | `/auth/login` | Public | email, password | 200 with user object, or 401 |
| POST | `/auth/logout` | Logged in | - | 200 |
| GET | `/auth/me` | Public | - | 200, user is null if logged out |

**Listings**

| Method | Endpoint | Access | Body | Response |
|---|---|---|---|---|
| GET | `/listings?area=&minPrice=&maxPrice=` | Public | - | 200, array of active listings |
| GET | `/listings/:id` | Public | - | 200 listing, or 404 |
| POST | `/listings` | Hoster/Admin | title, description, area, price, room_type, image_url | 201 with id |
| GET | `/listings/mine/all` | Hoster/Admin | - | 200, own listings (any status) |
| DELETE | `/listings/:id` | Owner/Admin | - | 200, or 403 if not owner |

**Admin**

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
| Landing | landing.html | Public | Marketing intro, entry points for both roles |
| Browse | index.html + js/main.js | Public | Listing grid, area/price filter |
| Detail | listing.html + js/listing.js | Public (delete button shown only to owner/admin) | Full listing view, contact info |
| Login | login.html + js/login.js | Public | Session login, redirects by role |
| Signup | signup.html + js/signup.js | Public | Registration with role toggle |
| Post | post.html + js/post.js | Hoster/Admin only | Create a listing |
| Admin | admin.html + js/admin.js | Admin only | Stats, user management, listing moderation |

`js/nav.js` is shared across every page — it calls GET /api/auth/me on load and renders the correct navigation links (Login/Signup vs. a user menu with role-specific links).

## 6. Validation Rules

- Signup requires name, email, password (6+ characters), phone, and role (student or hoster); duplicate emails are rejected.
- Listing creation requires title, area (one of three fixed values), price (positive number), and room_type (one of four fixed values).
- All role checks happen server-side; client-side gating is a UX convenience only, not the security boundary.

## 7. Testing Approach

Since no real hostel owners or students were recruited, all roles were demonstrated using seeded demo accounts (see database/seed.js): one admin, four hosters, and one student, covering sample listings across all three target areas.

Testing covered: public browsing/filtering, signup/login/logout, role-gated posting (hoster succeeds, student blocked with 403), listing ownership (a hoster can delete their own listing but not another's), and admin capabilities (stats, user list, listing moderation via status toggle, confirming moderated listings disappear from public view but remain visible to admin).

## 8. Future Work

Highest-priority next steps: image upload support, a trust/verification badge system for hostels, and password reset via email.
