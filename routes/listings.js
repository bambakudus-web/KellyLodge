// routes/listings.js — all REST endpoints for hostel listings
const express = require('express');
const router = express.Router();
const pool = require('../db');
const { requireRole } = require('../middleware/auth');
const { uploadMultipleImages } = require('../middleware/upload');
const { deleteFromCloudinary } = require('../utils/cloudinary');

const VALID_ROOM_TYPES = [
  'Single (self-contained)',
  'Shared (2 in a room)',
  'Shared (3 in a room)',
  'Shared (4 in a room)',
];
const MAX_AREA_LENGTH = 60;

// Areas are free text now (a hoster can type any neighborhood name), so this
// just trims and length-checks instead of matching a fixed list.
function cleanArea(rawArea) {
  const area = String(rawArea || '').trim();
  if (!area || area.length > MAX_AREA_LENGTH) return null;
  return area;
}

function cleanDistanceMinutes(rawValue) {
  if (rawValue === undefined || rawValue === null || rawValue === '') {
    return { ok: true, value: null };
  }
  const d = Number(rawValue);
  if (isNaN(d) || d < 0 || d > 180) {
    return { ok: false };
  }
  return { ok: true, value: Math.round(d) };
}

const ROOMS_SUBQUERY = `
  (SELECT COALESCE(SUM(available_quantity), 0) FROM room_types WHERE room_types.listing_id = listings.id) AS rooms_available,
  (SELECT COALESCE(SUM(total_quantity), 0) FROM room_types WHERE room_types.listing_id = listings.id) AS rooms_total
`;

const REVIEWS_SUBQUERY = `
  (SELECT ROUND(AVG(rating), 1) FROM reviews WHERE reviews.listing_id = listings.id) AS avg_rating,
  (SELECT COUNT(*) FROM reviews WHERE reviews.listing_id = listings.id) AS review_count
`;

// GET /api/listings — list active listings, with pagination, filters, and keyword search
router.get('/', async (req, res) => {
  try {
    const { area, minPrice, maxPrice, search, page, limit } = req.query;

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const pageSize = Math.min(48, Math.max(1, parseInt(limit, 10) || 12));
    const offset = (pageNum - 1) * pageSize;

    let whereClause = "WHERE listings.status = 'active'";
    const params = [];

    if (area) {
      whereClause += ' AND area = ?';
      params.push(area);
    }
    if (minPrice) {
      whereClause += ' AND price >= ?';
      params.push(Number(minPrice));
    }
    if (maxPrice) {
      whereClause += ' AND price <= ?';
      params.push(Number(maxPrice));
    }
    if (search) {
      whereClause += ' AND (title LIKE ? OR description LIKE ? OR area LIKE ?)';
      const term = `%${search}%`;
      params.push(term, term, term);
    }

    const [[{ total }]] = await pool.query(
      `SELECT COUNT(*) AS total FROM listings JOIN users ON listings.owner_id = users.id ${whereClause}`,
      params
    );

    const query = `
      SELECT listings.*, users.name AS owner_name, users.phone AS owner_phone,
        ${ROOMS_SUBQUERY}, ${REVIEWS_SUBQUERY}
      FROM listings
      JOIN users ON listings.owner_id = users.id
      ${whereClause}
      ORDER BY listings.created_at DESC
      LIMIT ? OFFSET ?
    `;

    const [rows] = await pool.query(query, [...params, pageSize, offset]);

    // Price and room availability are only for logged-in eyes — this
    // mirrors what the frontend already visually hides for guests, but
    // enforced here too so it can't be read straight out of the network
    // response by someone who's simply not logged in. Filtering by price
    // above still works fine for guests, since minPrice/maxPrice narrows
    // the SQL query itself; this only touches what comes back in the JSON.
    const requester = req.session.user;
    const listings = requester
      ? rows
      : rows.map(({ price, rooms_available, rooms_total, ...rest }) => rest);

    res.json({
      listings,
      page: pageNum,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
      total,
    });
  } catch (err) {
    console.error('Error fetching listings:', err);
    res.status(500).json({ error: 'Could not fetch listings.' });
  }
});

// GET /api/listings/areas — every distinct area currently in use, for the filter dropdown.
// Must be declared before GET /:id, or Express would treat "areas" as an :id.
router.get('/areas', async (req, res) => {
  try {
    const [rows] = await pool.query(
      "SELECT DISTINCT area FROM listings WHERE status = 'active' ORDER BY area ASC"
    );
    res.json({ areas: rows.map((r) => r.area) });
  } catch (err) {
    console.error('Error fetching areas:', err);
    res.status(500).json({ error: 'Could not fetch areas.' });
  }
});

// GET /api/listings/:id — a single listing's full details: rooms, photo
// gallery, rating. Used by both the public listing page (anonymous
// visitors should only ever see 'active' listings) and the hoster's own
// edit-listing page (which needs to load a listing regardless of status —
// otherwise a listing an admin marked 'removed' would become permanently
// unviewable and unfixable by its own owner).
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const [rows] = await pool.query(
      `SELECT listings.*, users.name AS owner_name, users.phone AS owner_phone, ${REVIEWS_SUBQUERY}
       FROM listings JOIN users ON listings.owner_id = users.id
       WHERE listings.id = ?`,
      [id]
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: 'Listing not found.' });
    }

    const listing = rows[0];
    const requester = req.session.user;
    const isOwner = requester && requester.id === listing.owner_id;
    const isAdmin = requester && requester.role === 'admin';

    if (listing.status !== 'active' && !isOwner && !isAdmin) {
      return res.status(404).json({ error: 'Listing not found.' });
    }

    const [roomTypes] = await pool.query(
      `SELECT id, room_type, price, total_quantity, available_quantity
       FROM room_types WHERE listing_id = ? ORDER BY price ASC`,
      [id]
    );

    const [photos] = await pool.query(
      'SELECT id, image_url FROM listing_photos WHERE listing_id = ? ORDER BY sort_order ASC, id ASC',
      [id]
    );

    listing.room_types = roomTypes;
    listing.photos = photos;

    // Same rule as the browse endpoint: price and per-room-type
    // availability are only for logged-in eyes, stripped server-side so
    // it can't be read straight out of the raw response by a logged-out
    // visitor, not just visually hidden by the frontend.
    if (!requester) {
      delete listing.price;
      listing.room_types = roomTypes.map(({ id: roomTypeId, room_type }) => ({ id: roomTypeId, room_type }));
    }

    res.json(listing);

    // Fire-and-forget view counter — only for genuine public views of an
    // active listing, an owner reloading their own edit page (or an admin
    // reviewing a removed one) shouldn't inflate the view count.
    if (listing.status === 'active') {
      pool.query('UPDATE listings SET views = views + 1 WHERE id = ?', [id]).catch((err) => {
        console.error('Could not increment view count:', err);
      });
    }
  } catch (err) {
    console.error('Error fetching listing:', err);
    res.status(500).json({ error: 'Could not fetch listing.' });
  }
});

// POST /api/listings — create a new listing with a photo gallery and per-room-type breakdown
router.post('/', requireRole('hoster', 'admin'), uploadMultipleImages, async (req, res) => {
  const connection = await pool.getConnection();
  try {
    const { title, description } = req.body;
    const ownerId = req.session.user.id;

    const area = cleanArea(req.body.area);
    if (!area) {
      return res.status(400).json({ error: `Enter an area name (${MAX_AREA_LENGTH} characters or fewer).` });
    }

    const distance = cleanDistanceMinutes(req.body.distance_minutes);
    if (!distance.ok) {
      return res.status(400).json({ error: 'Walking distance must be a number of minutes between 0 and 180.' });
    }

    let roomTypesInput;
    try {
      roomTypesInput = JSON.parse(req.body.room_types || '[]');
    } catch {
      return res.status(400).json({ error: 'Invalid room type data.' });
    }

    if (!title) {
      return res.status(400).json({ error: 'Missing required fields.' });
    }

    if (!Array.isArray(roomTypesInput) || roomTypesInput.length === 0) {
      return res.status(400).json({ error: 'Add at least one room type with a price and quantity.' });
    }

    const seenTypes = new Set();
    const cleanRoomTypes = [];

    for (const rt of roomTypesInput) {
      const roomType = rt.room_type;
      const price = Number(rt.price);
      const quantity = Number(rt.quantity);

      if (!VALID_ROOM_TYPES.includes(roomType)) {
        return res.status(400).json({ error: `Room type must be one of: ${VALID_ROOM_TYPES.join(', ')}` });
      }
      if (seenTypes.has(roomType)) {
        return res.status(400).json({ error: `"${roomType}" was entered more than once. Combine it into a single row.` });
      }
      if (isNaN(price) || price <= 0) {
        return res.status(400).json({ error: `"${roomType}" needs a valid price greater than 0.` });
      }
      if (!Number.isInteger(quantity) || quantity <= 0 || quantity > 2000) {
        return res.status(400).json({ error: `Enter a valid quantity (1-2000) for "${roomType}".` });
      }

      seenTypes.add(roomType);
      cleanRoomTypes.push({ roomType, price, quantity });
    }

    const cheapest = cleanRoomTypes.reduce((min, rt) => (rt.price < min.price ? rt : min), cleanRoomTypes[0]);

    const uploadedFiles = req.files || [];
    const photoUrls = uploadedFiles.map((f) => f.cloudinaryUrl);
    const coverUrl = photoUrls[0] || null;
    const coverPublicId = uploadedFiles[0]?.cloudinaryPublicId || null;

    await connection.beginTransaction();

    const [result] = await connection.query(
      `INSERT INTO listings (title, description, area, price, room_type, owner_id, image_url, image_public_id, distance_minutes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [title, description || '', area, cheapest.price, cheapest.roomType, ownerId, coverUrl, coverPublicId, distance.value]
    );

    const listingId = result.insertId;

    // Each room type gets its own letter (A, B, C...) in creation order,
    // and within it every physical unit gets a zero-padded number — e.g.
    // the first room type's units are A001, A002, A003..., matching
    // whatever a hoster tells students their room actually is once a
    // booking gets paid for and a specific unit is assigned to them.
    let prefixCode = 'A'.charCodeAt(0);
    for (const rt of cleanRoomTypes) {
      const prefix = String.fromCharCode(prefixCode);
      prefixCode += 1;

      const [rtResult] = await connection.query(
        `INSERT INTO room_types (listing_id, room_type, prefix, price, total_quantity, available_quantity)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [listingId, rt.roomType, prefix, rt.price, rt.quantity, rt.quantity]
      );
      const roomTypeId = rtResult.insertId;

      const roomRows = [];
      for (let i = 1; i <= rt.quantity; i++) {
        roomRows.push([roomTypeId, `${prefix}${String(i).padStart(3, '0')}`]);
      }
      await connection.query('INSERT INTO rooms (room_type_id, room_number) VALUES ?', [roomRows]);
    }

    if (uploadedFiles.length > 0) {
      const photoValues = uploadedFiles.map((f, i) => [listingId, f.cloudinaryUrl, f.cloudinaryPublicId, i]);
      await connection.query(
        'INSERT INTO listing_photos (listing_id, image_url, public_id, sort_order) VALUES ?',
        [photoValues]
      );
    }

    await connection.commit();
    res.status(201).json({ id: listingId, message: 'Listing created successfully.' });
  } catch (err) {
    await connection.rollback();
    console.error('Error creating listing:', err);
    res.status(500).json({ error: 'Could not create listing.' });
  } finally {
    connection.release();
  }
});

// GET /api/listings/mine/all — a hoster's own listings (any status), with room counts and view totals
router.get('/mine/all', requireRole('hoster', 'admin'), async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT listings.*, ${ROOMS_SUBQUERY}, ${REVIEWS_SUBQUERY}
       FROM listings WHERE owner_id = ? ORDER BY created_at DESC`,
      [req.session.user.id]
    );
    res.json(rows);
  } catch (err) {
    console.error('Error fetching your listings:', err);
    res.status(500).json({ error: 'Could not fetch your listings.' });
  }
});

// DELETE /api/listings/:id — owner of the listing, or admin, can remove it.
// Also deletes every uploaded photo (cover + gallery) from Cloudinary.
router.delete('/:id', requireRole('hoster', 'admin'), async (req, res) => {
  try {
    const { id } = req.params;
    const [rows] = await pool.query('SELECT owner_id, image_public_id FROM listings WHERE id = ?', [id]);

    if (rows.length === 0) {
      return res.status(404).json({ error: 'Listing not found.' });
    }

    const isOwner = rows[0].owner_id === req.session.user.id;
    const isAdmin = req.session.user.role === 'admin';

    if (!isOwner && !isAdmin) {
      return res.status(403).json({ error: 'You can only remove your own listings.' });
    }

    const [[{ activeCount }]] = await pool.query(
      `SELECT COUNT(*) AS activeCount
       FROM bookings
       WHERE listing_id = ? AND payment_status IN ('pending', 'paid')`,
      [id]
    );

    if (activeCount > 0) {
      return res.status(400).json({
        error: `This listing has ${activeCount} active booking${activeCount === 1 ? '' : 's'} (pending or paid). It can't be deleted while students are holding rooms here, wait for those bookings to resolve, or reach out to those students directly first.`,
      });
    }

    const [photos] = await pool.query('SELECT public_id FROM listing_photos WHERE listing_id = ?', [id]);

    await pool.query('DELETE FROM listings WHERE id = ?', [id]);

    const allPublicIds = [rows[0].image_public_id, ...photos.map((p) => p.public_id)].filter(Boolean);
    await Promise.all(allPublicIds.map((publicId) => deleteFromCloudinary(publicId)));

    res.json({ message: 'Listing removed.' });
  } catch (err) {
    console.error('Error deleting listing:', err);
    res.status(500).json({ error: 'Could not delete listing.' });
  }
});

// PUT /api/listings/:id — edit an existing listing (owner or admin only).
// Room types already booked can't be removed or shrunk below their booked count.
// Photos: send new files under "photos" to append them, and/or a JSON array
// of listing_photo ids under "remove_photo_ids" to delete specific ones.
router.put('/:id', requireRole('hoster', 'admin'), uploadMultipleImages, async (req, res) => {
  const connection = await pool.getConnection();
  try {
    const { id } = req.params;
    const { title, description } = req.body;

    const [existingRows] = await connection.query('SELECT owner_id, image_url FROM listings WHERE id = ?', [id]);
    if (existingRows.length === 0) {
      return res.status(404).json({ error: 'Listing not found.' });
    }

    const isOwner = existingRows[0].owner_id === req.session.user.id;
    const isAdmin = req.session.user.role === 'admin';
    if (!isOwner && !isAdmin) {
      return res.status(403).json({ error: 'You can only edit your own listings.' });
    }

    const area = cleanArea(req.body.area);
    if (!area) {
      return res.status(400).json({ error: `Enter an area name (${MAX_AREA_LENGTH} characters or fewer).` });
    }

    const distance = cleanDistanceMinutes(req.body.distance_minutes);
    if (!distance.ok) {
      return res.status(400).json({ error: 'Walking distance must be a number of minutes between 0 and 180.' });
    }

    let roomTypesInput;
    try {
      roomTypesInput = JSON.parse(req.body.room_types || '[]');
    } catch {
      return res.status(400).json({ error: 'Invalid room type data.' });
    }

    let removePhotoIds = [];
    try {
      const parsed = JSON.parse(req.body.remove_photo_ids || '[]');
      if (Array.isArray(parsed)) removePhotoIds = parsed.map(Number).filter((n) => Number.isInteger(n));
    } catch {
      removePhotoIds = [];
    }

    let setCoverPhotoId = null;
    if (req.body.set_cover_photo_id !== undefined && req.body.set_cover_photo_id !== '') {
      const parsedCoverId = Number(req.body.set_cover_photo_id);
      if (Number.isInteger(parsedCoverId)) setCoverPhotoId = parsedCoverId;
    }

    if (!title) {
      return res.status(400).json({ error: 'Missing required fields.' });
    }
    if (!Array.isArray(roomTypesInput) || roomTypesInput.length === 0) {
      return res.status(400).json({ error: 'Add at least one room type with a price and quantity.' });
    }

    const seenTypes = new Set();
    const cleanRoomTypes = [];
    for (const rt of roomTypesInput) {
      const roomType = rt.room_type;
      const price = Number(rt.price);
      const quantity = Number(rt.quantity);

      if (!VALID_ROOM_TYPES.includes(roomType)) {
        return res.status(400).json({ error: `Room type must be one of: ${VALID_ROOM_TYPES.join(', ')}` });
      }
      if (seenTypes.has(roomType)) {
        return res.status(400).json({ error: `"${roomType}" was entered more than once.` });
      }
      if (isNaN(price) || price <= 0) {
        return res.status(400).json({ error: `"${roomType}" needs a valid price greater than 0.` });
      }
      if (!Number.isInteger(quantity) || quantity <= 0 || quantity > 2000) {
        return res.status(400).json({ error: `Enter a valid quantity (1-2000) for "${roomType}".` });
      }
      seenTypes.add(roomType);
      cleanRoomTypes.push({ roomType, price, quantity });
    }

    await connection.beginTransaction();

    const [existingRoomTypes] = await connection.query(
      'SELECT id, room_type, prefix, total_quantity, available_quantity FROM room_types WHERE listing_id = ?',
      [id]
    );

    for (const existing of existingRoomTypes) {
      const stillPresent = cleanRoomTypes.some((rt) => rt.roomType === existing.room_type);
      const bookedCount = existing.total_quantity - existing.available_quantity;
      if (!stillPresent && bookedCount > 0) {
        await connection.rollback();
        return res.status(400).json({
          error: `Cannot remove "${existing.room_type}" (it has ${bookedCount} active booking(s)). Cancel those first.`,
        });
      }
    }

    // Prefix letters already spoken for, so a brand-new room type added in
    // this edit doesn't collide with one that's staying as-is.
    const usedPrefixes = new Set(existingRoomTypes.map((e) => e.prefix).filter(Boolean));
    let nextPrefixCode = 'A'.charCodeAt(0);
    function claimNextPrefix() {
      let letter = String.fromCharCode(nextPrefixCode);
      while (usedPrefixes.has(letter)) {
        nextPrefixCode += 1;
        letter = String.fromCharCode(nextPrefixCode);
      }
      usedPrefixes.add(letter);
      return letter;
    }

    for (const rt of cleanRoomTypes) {
      const existing = existingRoomTypes.find((e) => e.room_type === rt.roomType);
      if (existing) {
        const bookedCount = existing.total_quantity - existing.available_quantity;
        if (rt.quantity < bookedCount) {
          await connection.rollback();
          return res.status(400).json({
            error: `"${rt.roomType}" has ${bookedCount} active booking(s), quantity can't go below that.`,
          });
        }
        const newAvailable = rt.quantity - bookedCount;
        await connection.query(
          'UPDATE room_types SET price = ?, total_quantity = ?, available_quantity = ? WHERE id = ?',
          [rt.price, rt.quantity, newAvailable, existing.id]
        );

        const diff = rt.quantity - existing.total_quantity;
        if (diff > 0) {
          // Growing: continue the numbering sequence rather than assuming
          // it always starts right after the old total_quantity, in case
          // any past shrink+grow cycle left a gap.
          const [[{ maxNum }]] = await connection.query(
            `SELECT COALESCE(MAX(CAST(SUBSTRING(room_number, 2) AS UNSIGNED)), 0) AS maxNum
             FROM rooms WHERE room_type_id = ?`,
            [existing.id]
          );
          // mysql2 returns this aggregate as a string, not a number —
          // without Number(), maxNum + i below is string concatenation
          // ("5" + 1 = "51") instead of addition (5 + 1 = 6).
          const maxNumValue = Number(maxNum);
          const newRoomRows = [];
          for (let i = 1; i <= diff; i++) {
            const num = maxNumValue + i;
            newRoomRows.push([existing.id, `${existing.prefix}${String(num).padStart(3, '0')}`]);
          }
          await connection.query('INSERT INTO rooms (room_type_id, room_number) VALUES ?', [newRoomRows]);
        } else if (diff < 0) {
          // Shrinking: only ever remove rooms nobody's actually in — the
          // bookedCount check above already guarantees there are enough
          // unoccupied units to spare.
          await connection.query(
            'DELETE FROM rooms WHERE room_type_id = ? AND status = \'available\' ORDER BY CAST(SUBSTRING(room_number, 2) AS UNSIGNED) DESC LIMIT ?',
            [existing.id, Math.abs(diff)]
          );
        }
      } else {
        const prefix = claimNextPrefix();
        const [rtResult] = await connection.query(
          'INSERT INTO room_types (listing_id, room_type, prefix, price, total_quantity, available_quantity) VALUES (?, ?, ?, ?, ?, ?)',
          [id, rt.roomType, prefix, rt.price, rt.quantity, rt.quantity]
        );
        const roomTypeId = rtResult.insertId;
        const roomRows = [];
        for (let i = 1; i <= rt.quantity; i++) {
          roomRows.push([roomTypeId, `${prefix}${String(i).padStart(3, '0')}`]);
        }
        await connection.query('INSERT INTO rooms (room_type_id, room_number) VALUES ?', [roomRows]);
      }
    }

    for (const existing of existingRoomTypes) {
      const stillPresent = cleanRoomTypes.some((rt) => rt.roomType === existing.room_type);
      if (!stillPresent) {
        // rooms rows cascade-delete with it (FK ON DELETE CASCADE)
        await connection.query('DELETE FROM room_types WHERE id = ?', [existing.id]);
      }
    }

    const cheapest = cleanRoomTypes.reduce((min, rt) => (rt.price < min.price ? rt : min), cleanRoomTypes[0]);

    // Photo gallery: remove any photos the hoster asked to remove, then
    // append any newly uploaded ones after the current highest sort order.
    let removedPublicIds = [];
    if (removePhotoIds.length > 0) {
      const [toRemove] = await connection.query(
        'SELECT id, public_id FROM listing_photos WHERE id IN (?) AND listing_id = ?',
        [removePhotoIds, id]
      );
      if (toRemove.length > 0) {
        await connection.query('DELETE FROM listing_photos WHERE id IN (?) AND listing_id = ?', [removePhotoIds, id]);
        removedPublicIds = toRemove.map((p) => p.public_id).filter(Boolean);
      }
    }

    const uploadedFiles = req.files || [];
    if (uploadedFiles.length > 0) {
      const [[{ maxOrder }]] = await connection.query(
        'SELECT COALESCE(MAX(sort_order), -1) AS maxOrder FROM listing_photos WHERE listing_id = ?',
        [id]
      );
      const photoValues = uploadedFiles.map((f, i) => [id, f.cloudinaryUrl, f.cloudinaryPublicId, maxOrder + 1 + i]);
      await connection.query(
        'INSERT INTO listing_photos (listing_id, image_url, public_id, sort_order) VALUES ?',
        [photoValues]
      );
    }

    // Setting a cover: sort_order -1 always sorts first regardless of what
    // the other photos are currently numbered, so it doesn't need a full
    // renumbering pass. Only applies to a photo that's still actually on
    // this listing (ignores an id that was just removed above, or belongs
    // to a different listing).
    if (setCoverPhotoId && !removePhotoIds.includes(setCoverPhotoId)) {
      await connection.query(
        'UPDATE listing_photos SET sort_order = -1 WHERE id = ? AND listing_id = ?',
        [setCoverPhotoId, id]
      );
    }

    const [[coverRow]] = await connection.query(
      'SELECT image_url, public_id FROM listing_photos WHERE listing_id = ? ORDER BY sort_order ASC, id ASC LIMIT 1',
      [id]
    );
    const newCoverUrl = coverRow ? coverRow.image_url : null;
    const newCoverPublicId = coverRow ? coverRow.public_id : null;

    await connection.query(
      'UPDATE listings SET title = ?, description = ?, area = ?, price = ?, room_type = ?, image_url = ?, image_public_id = ?, distance_minutes = ? WHERE id = ?',
      [title, description || '', area, cheapest.price, cheapest.roomType, newCoverUrl, newCoverPublicId, distance.value, id]
    );

    await connection.commit();

    await Promise.all(removedPublicIds.map((publicId) => deleteFromCloudinary(publicId)));

    res.json({ id, message: 'Listing updated successfully.' });
  } catch (err) {
    await connection.rollback();
    console.error('Error updating listing:', err);
    res.status(500).json({ error: 'Could not update listing.' });
  } finally {
    connection.release();
  }
});

module.exports = router;
