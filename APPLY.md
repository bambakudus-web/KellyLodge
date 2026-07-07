# KellyLodge: Login/Signup redesign + Arkesel SMS + Paystack payments

## What's in here

**Login/Signup:** split-screen layout with a branded photo panel (reusing the
hero image), polished input focus states. Collapses to single-column on mobile.

**SMS (Arkesel):** every booking event now sends SMS in addition to email, to
both the student and the hoster: new booking (payment reminder to student,
notification to owner), successful payment (confirmation to both), and
expired/unpaid booking (notice to student).

**Payments (Paystack):** booking a room now holds it for 72 hours pending
payment (full year's rent). A background sweep every 5 minutes automatically
cancels any booking that's still unpaid after its deadline and restores the
room's availability. Payment confirmation happens via Paystack's webhook
(server-to-server, signature-verified), not just the browser redirect.

## New files
- database/add_payments.js (migration)
- utils/sms.js, utils/paystack.js, utils/expireBookings.js
- routes/payments.js
- public/payment-callback.html, public/js/payment-callback.js

## Modified files
- utils/email.js (added payment reminder/confirmation/expiry emails)
- routes/bookings.js (payment_status, payment_deadline, SMS on booking)
- server.js (raw-body capture for webhook signature, mounts payments router, starts the expiry sweep)
- middleware/csrf.js (exempts the webhook path)
- public/js/bookings.js, dashboard.js, listing.js (payment status UI, Pay Now button)
- public/css/style.css (auth split-screen, payment badges)
- public/login.html, public/signup.html (new split-screen markup)
- .env.example (documents the new required variables)

## Required setup (in addition to applying this patch)

1. **Set environment variables** on Railway (never commit real keys to git):
   - `ARKESEL_API_KEY`, `ARKESEL_SENDER_ID`
   - `PAYSTACK_SECRET_KEY`, `PAYSTACK_PUBLIC_KEY`
   - Confirm `APP_URL` is set to your real production URL (used for both
     email links and Paystack's callback redirect).

2. **Register the webhook URL in your Paystack dashboard.** This is a manual
   step Paystack requires, code alone can't do it:
   - Go to https://dashboard.paystack.com/#/settings/developer
   - Under Webhook URL, enter: `https://kellylodge-production.up.railway.app/api/payments/webhook`
   - (adjust the domain if it's different from what's shown in your browser)
   - Save. Without this, Paystack will never call your server when a payment
     completes, the student would pay but the booking would never
     auto-confirm.

3. **Run the migration** (see commands below), locally and then on Railway.

## Apply

```bash
cd ~/kellylodge
unzip -o /mnt/c/Users/USER/Downloads/kellylodge_v13_patch.zip -d .
node database/add_payments.js
git add -A
git status
```

Confirm all 18 files above show as new/modified, then:

```bash
git commit -m "Add split-screen login/signup, Arkesel SMS notifications, and Paystack payment flow with 72-hour hold"
git push origin main
railway run node database/add_payments.js
```

## Test checklist (use Paystack's test mode/test cards if your keys are in test mode)

1. Book a room as a student. Confirm you (and the hoster) receive both an
   email and an SMS mentioning the 72-hour deadline.
2. Go to My Bookings, confirm the booking shows "Pending payment" with a
   live countdown, and a "Pay now" button.
3. Click Pay now, complete checkout on Paystack's page.
4. Confirm you land back on `/payment-callback.html` and it eventually shows
   "Payment confirmed."
5. Confirm both the student and the hoster receive a payment-confirmation
   email and SMS.
6. Check My Bookings again, status should now show "Paid."
7. Try cancelling a **paid** booking, confirm it's blocked with a message
   directing you to contact the owner.
8. For the 72-hour expiry itself: since waiting 3 real days isn't practical
   to test, you can temporarily shorten `PAYMENT_WINDOW_HOURS` in
   `routes/bookings.js` to something small (like 0.02 for ~1 minute) on a
   test booking, wait for the 5-minute sweep to run, and confirm the booking
   flips to "Expired, unpaid," the room's availability is restored, and the
   student gets the expiry email/SMS. Remember to change it back to 72
   afterward.
