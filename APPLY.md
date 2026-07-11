# KellyLodge: real-time in-app messaging

Students and hosters can now chat directly inside the app, in real time,
instead of relying only on phone calls. One conversation thread per
(listing, student) pair.

## New files
- database/add_messaging.js (migration: conversations + messages tables)
- utils/socket.js (the real-time server, shares the same session as the rest of the app)
- routes/messages.js (REST: conversation list, message history, starting a thread)
- public/messages.html (inbox + thread UI)
- public/js/messages.js (all the client-side chat logic)

## Modified files
- server.js (switched to a raw HTTP server so Socket.io can attach; mounts
  the messages router; starts the socket server alongside the existing
  booking-expiry sweep)
- middleware/csrf.js (exempts Socket.io's HTTP polling fallback path)
- package.json (added the `socket.io` dependency)
- public/js/nav.js (adds a "Messages" link with a live unread-count badge)
- public/js/listing.js (adds a "Message" button next to "Call" for students)
- public/css/style.css (the whole chat UI: inbox list, thread bubbles, mobile layout)

## How it works, in short

- Real-time delivery happens over WebSockets (Socket.io), which shares your
  existing login session, no separate chat login needed.
- If a browser/network can't do a real WebSocket connection, it automatically
  falls back to HTTP polling, same chat, just slightly less instant.
- Messages are always saved to the database regardless of whether the other
  person is online, so nothing is lost, they'll see it next time they open
  the app.
- The nav badge shows unread count as of page load (not live-updating on
  every other page, only inside Messages itself, so browsing/listing pages
  don't need their own permanent socket connection just for a badge number).

## Apply

```bash
cd ~/kellylodge
unzip -o /mnt/c/Users/USER/Downloads/kellylodge_v22_patch.zip -d .
npm install
node database/add_messaging.js
git add -A
git status
```

Confirm all 11 files above show as new/modified (plus `package-lock.json`
updated from `npm install`), then:

```bash
git commit -m "Add real-time in-app messaging with Socket.io"
git push origin main
railway run node database/add_messaging.js
```

No new environment variables needed, it reuses your existing session setup.

## Test checklist

1. As a student, open a listing, click "Message" next to "Call", confirm it
   takes you to Messages with that conversation open.
2. Send a message. Open a second browser (or incognito window), log in as
   that listing's owner, go to Messages, confirm the conversation and
   message show up.
3. With both windows open side by side, send messages back and forth,
   confirm they appear instantly on both sides without refreshing.
4. Check the unread badge in the nav updates after navigating away and back.
5. Close one browser entirely, send a message from the other side, reopen
   the closed one and confirm the message is there waiting (this confirms
   persistence works independent of who's online).
6. Try it on a phone-sized screen, confirm the inbox/thread views switch
   properly with the back button, not squeezed side by side.
