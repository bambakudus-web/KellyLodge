# KellyLodge: branded emails, strict signup validation, admin powerhouse, friendlier session gates

## 1. Branded email templates
Every email KellyLodge sends (verification, password reset, booking, payment
reminder/confirmation, expiry notice) now uses a shared branded template:
navy header with the KellyLodge wordmark, a brass accent bar, a details box
for booking/payment info, and a proper button instead of a raw text link.
Table-based HTML so it renders correctly across Gmail, Outlook, etc.

New: utils/email.js (full rewrite, same function names/signatures, so
nothing else needed to change to pick this up).

## 2. Strict signup/login validation
Previously signup only checked "is something typed" and password length.
Now, both server-side (the real gate) and with matching client-side hints:
- Name: letters only (plus spaces/apostrophes/hyphens), at least 2 characters.
  Rejects "123", "asdf!!", single letters.
- Email: proper format check (something@something.tld).
- Phone: must be a real Ghanaian number, either 0XXXXXXXXX or +233XXXXXXXXX.
- Password: at least 6 characters AND must contain both a letter and a number
  (rejects "111111" or "aaaaaa").

Applied to: signup, profile updates (Account page), password changes, and
password resets.

New: utils/validation.js. Modified: routes/auth.js, public/js/signup.js,
public/js/account.js, public/signup.html.

## 3. Admin powerhouse
- New "Bookings & Revenue" tab: total revenue collected (from paid bookings),
  pending-payment count, and a full table of every booking platform-wide
  (listing, student, owner, payment status).
- Users tab now has a live search box (by name or email).
- Each user row (except your own) now has a role dropdown, promote/demote
  between student, hoster, and admin directly, with a confirmation prompt.
- The "Delete user" button already existed in the code, it's confirmed
  working, might just not have been noticed before.

New endpoints: GET /api/admin/bookings, PATCH /api/admin/users/:id/role,
GET /api/admin/users now accepts ?search=. Modified: routes/admin.js,
public/js/admin.js, public/css/style.css.

## 4. Friendlier session-expiry messaging
Every "gate" screen (shown when you're not logged in, or logged in as the
wrong role) used to say "Access restricted" regardless of why. Now:
- If your session just expired from inactivity: "Your session has expired"
  with an explanation, not an accusation.
- If you've simply never logged in: "Please log in."
- If you're logged in but the page isn't for your role (e.g. a student
  hitting the hoster dashboard): a specific heading like "Not for this
  account", "Listing not found", "Not your listing", "Admins only", etc.,
  instead of one generic word for every situation.

This works by nav.js remembering (via localStorage) that you were
successfully logged in at some point, so it can tell "never logged in" apart
from "was logged in, now isn't" without the backend needing to change at all.

Modified: public/js/nav.js, account.js, bookings.js, dashboard.js,
edit-listing.js, admin.js, favorites.js, post.js.

## Apply

```bash
cd ~/kellylodge
unzip -o /mnt/c/Users/USER/Downloads/kellylodge_v16_patch.zip -d .
git add -A
git status
```

Confirm all 15 files above show as modified/new, then:

```bash
git commit -m "Branded email templates, strict signup validation, admin bookings/revenue tab and role management, friendlier session-expiry messaging"
git push origin main
```

No database migration needed, this patch is pure code.

## Test checklist

1. Sign up with a fake name like "123" or "!!!", confirm it's rejected with
   a clear message. Try a weak password like "aaaaaa", confirm it's rejected.
   Try a phone number that isn't a real Ghanaian number.
2. Trigger any email (sign up, book a room, reset password) and check your
   inbox, it should look like a real branded email now, not raw text.
3. Log in as admin, open the new "Bookings & Revenue" tab, confirm it shows
   real data. Search for a user by name in the Users tab. Try changing a
   user's role via the dropdown.
4. To test the session-expiry message without waiting a week: log in, then
   in another tab call `POST /api/auth/logout` directly (or just clear the
   session cookie via dev tools), then try to load My Bookings or Account,
   you should see "Your session has expired" instead of "Access restricted."
   Then open a fresh incognito window and go straight to My Bookings without
   ever logging in, you should see the plainer "Please log in" instead.
