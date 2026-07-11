# KellyLodge: floating chat widget + automatic hoster payouts

## Part 1 — Floating chat bubble (replaces the full-page messages.html)

Messaging is now a small bubble icon fixed in the bottom-right corner on
every logged-in page, tap it, a compact popup opens with your conversation
list, tap a thread to chat. No more dedicated page. Socket.io itself only
loads the first time someone actually opens the widget.

New: public/js/chat-widget.js
Modified: public/js/nav.js (injects the widget for logged-in users, removed
the old "Messages" nav link), public/js/listing.js ("Message" button opens
the widget directly instead of navigating away), public/css/style.css (all
the widget's styling).

The old public/messages.html and public/js/messages.js still exist and
still work if you ever want them, they're just no longer linked from
anywhere. Safe to ignore or delete later.

## Part 2 — Automatic hoster payouts (Paystack Subaccounts)

**Important context on how this works:** right now, when a student pays,
100% of the money goes into your own Paystack account. This patch lets each
hoster connect their own bank/mobile money account (once, from their
dashboard), and Paystack automatically splits every future payment: the
hoster's share goes straight to them, you keep a platform fee (10% by
default, set PLATFORM_FEE_PERCENT to change it). You do NOT create accounts
for hosters manually, they do it themselves via a form, and the app calls
Paystack's API to set it up.

**Bookings made before a hoster sets up payouts** still pay 100% into your
account as before, nothing breaks for hosters who haven't onboarded yet.

New: database/add_payouts.js (migration), routes/payouts.js,
public/payout-settings.html, public/js/payout-settings.js

Modified: utils/paystack.js (added bank listing, account verification,
subaccount creation, and split support in the transaction initialize call),
routes/payments.js (passes the hoster's subaccount code when starting a
payment), server.js (mounts the payouts router), public/js/nav.js (adds a
"Payout Settings" link for hosters), public/js/dashboard.js (shows a banner
reminding hosters to set up payouts if they haven't), .env.example
(documents PLATFORM_FEE_PERCENT).

### ⚠️ Before trusting this with real bookings

This involves real money splitting automatically, please do one thing
before relying on it: as a test hoster account, set up payout details, then
have a test student complete one real (small) payment, and manually check
in your Paystack dashboard that the subaccount actually received its
expected share and your main account received the platform fee. I built
this against Paystack's documented split-payment behavior, but I can't run
a live transaction myself to confirm it end to end, that first real test is
the actual verification.

## Apply

```bash
cd ~/kellylodge
unzip -o /mnt/c/Users/USER/Downloads/kellylodge_v23_patch.zip -d .
node database/add_payouts.js
git add -A
git status
```

Confirm all 13 files above show as new/modified, then:

```bash
git commit -m "Add floating chat widget, automatic hoster payouts via Paystack Subaccounts"
git push origin main
railway run node database/add_payouts.js
```

No new npm packages needed for this one (Cloudinary and Socket.io were
already added in earlier patches).

## Test checklist

**Chat widget:**
1. Log in as a student, open any listing, click "Message", confirm the
   floating panel opens directly into that conversation (not a separate page).
2. Confirm the bubble icon appears on every page while logged in (browse,
   dashboard, account, etc.), not just the listing page.
3. Send messages back and forth between two accounts, confirm the bubble
   shows an unread badge and "bumps" when a message arrives while closed.

**Payouts:**
1. Log in as a hoster, go to Payout Settings (via the nav dropdown), select
   a bank, enter an account number, click "Verify account", confirm it shows
   a real account holder name back to you.
2. Save it, confirm the dashboard's reminder banner disappears.
3. Complete a real test payment as a student for that hoster's listing, then
   check your Paystack dashboard's Transactions to confirm it actually split
   (this is the important one, see the warning above).
