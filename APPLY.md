# KellyLodge: switch listing photo uploads to Cloudinary

Fixes the root cause of uploaded photos disappearing: Railway's filesystem
doesn't persist across deploys, so anything saved to local disk (the old
`public/uploads/` approach) gets wiped on the next `git push`. Uploads now go
straight to Cloudinary instead, permanent, CDN-served, and automatically
resized/compressed.

## New files
- utils/cloudinary.js (SDK config + upload/delete helpers)
- database/add_cloudinary_fields.js (migration)

## Modified files
- middleware/upload.js (full rewrite: memory storage + Cloudinary upload instead of disk)
- routes/listings.js (create/edit/delete all use Cloudinary URLs + public_ids now)
- package.json (added the `cloudinary` dependency)
- .env.example (documents the 3 new required variables)
- docs/documentation.md (tech justification + ERD note updated)

## Required setup

1. **Create a free Cloudinary account** at https://cloudinary.com if you
   haven't already.
2. On your Cloudinary dashboard (console.cloudinary.com), find your
   **Product Environment Credentials**: Cloud Name, API Key, API Secret.
3. Set these on Railway (never commit real values to git):
   - `CLOUDINARY_CLOUD_NAME`
   - `CLOUDINARY_API_KEY`
   - `CLOUDINARY_API_SECRET`

## Apply

```bash
cd ~/kellylodge
unzip -o /mnt/c/Users/USER/Downloads/kellylodge_v21_patch.zip -d .
npm install
node database/add_cloudinary_fields.js
git add -A
git status
```

Confirm all 7 files above show as new/modified, plus `package-lock.json`
should have updated too (from `npm install`). Then:

```bash
git commit -m "Move listing photo uploads from local disk to Cloudinary"
git push origin main
railway run node database/add_cloudinary_fields.js
```

## Then: re-upload your photos one more time

This is the last time you'll need to do this. Go to each listing's edit page
and re-upload the photos, they'll now be stored on Cloudinary permanently and
will survive every future deploy.

## Test checklist

1. Post a new listing with photos, confirm the image shows immediately and
   the URL in your browser's dev tools points to `res.cloudinary.com`, not
   `/uploads/...`.
2. Edit that listing: remove one photo, add another, set a different one as
   cover, confirm all three actions work and persist after a refresh.
3. Delete a listing (with no active bookings), then check your Cloudinary
   Media Library, confirm those images were actually removed there too, not
   left orphaned.
4. Push some unrelated small change and redeploy, confirm the photos are
   still there afterward (this is the actual regression test for the bug
   that started this).
