// routes/listings.js — all REST endpoints for hostel listings
const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const pool = require('../db');
const { requireRole } = require('../middleware/auth');
const { uploadMultipleImages } = require('../middleware/upload');

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

    res.json({
      listings: rows,
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

// GET /api/listings/:id — a single listing's full details: rooms, photo gallery, rating
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const [rows] = await pool.query(
      `SELECT listings.*, users.name AS owner_name, users.phone AS owner_phone, ${REVIEWS_SUBQUERY}
       FROM listings JOIN users ON listings.owner_id = users.id
       WHERE listings.id = ? AND listings.status = 'active'`,
      [id]
    );

    if (rows.length === 0) {
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

    const listing = rows[0];
    listing.room_types = roomTypes;
    listing.photos = photos;

    res.json(listing);

    // Fire-and-forget view counter — never let a slow/failed increment
    // block or break the response the visitor already received.
    pool.query('UPDATE listings SET views = views + 1 WHERE id = ?', [id]).catch((err) => {
      console.error('Could not increment view count:', err);
    });
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
    const photoUrls = uploadedFiles.map((f) => `/uploads/${f.filename}`);
    const coverUrl = photoUrls[0] || null;

    await connection.beginTransaction();

    const [result] = await connection.query(
      `INSERT INTO listings (title, description, area, price, room_type, owner_id, image_url, distance_minutes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [title, description || '', area, cheapest.price, cheapest.roomType, ownerId, coverUrl, distance.value]
    );

    const listingId = result.insertId;
    const roomTypeValues = cleanRoomTypes.map((rt) => [listingId, rt.roomType, rt.price, rt.quantity, rt.quantity]);

    await connection.query(
      `INSERT INTO room_types (listing_id, room_type, price, total_quantity, available_quantity) VALUES ?`,
      [roomTypeValues]
    );

    if (photoUrls.length > 0) {
      const photoValues = photoUrls.map((url, i) => [listingId, url, i]);
      await connection.query(
        'INSERT INTO listing_photos (listing_id, image_url, sort_order) VALUES ?',
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
// Also deletes every uploaded photo (cover + gallery) from disk.
router.delete('/:id', requireRole('hoster', 'admin'), async (req, res) => {
  try {
    const { id } = req.params;
    const [rows] = await pool.query('SELECT owner_id, image_url FROM listings WHERE id = ?', [id]);

    if (rows.length === 0) {
      return res.status(404).json({ error: 'Listing not found.' });
    }

    const isOwner = rows[0].owner_id === req.session.user.id;
    const isAdmin = req.session.user.role === 'admin';

    if (!isOwner && !isAdmin) {
      return res.status(403).json({ error: 'You can only remove your own listings.' });
    }

    const [photos] = await pool.query('SELECT image_url FROM listing_photos WHERE listing_id = ?', [id]);

    await pool.query('DELETE FROM listings WHERE id = ?', [id]);

    const allUrls = [rows[0].image_url, ...photos.map((p) => p.image_url)];
    for (const url of allUrls) {
      if (url && url.startsWith('/uploads/')) {
        const filePath = path.join(__dirname, '..', 'public', url);
        fs.unlink(filePath, (err) => {
          if (err && err.code !== 'ENOENT') console.error('Could not delete listing photo:', err);
        });
      }
    }

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
      'SELECT id, room_type, total_quantity, available_quantity FROM room_types WHERE listing_id = ?',
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
      } else {
        await connection.query(
          'INSERT INTO room_types (listing_id, room_type, price, total_quantity, available_quantity) VALUES (?, ?, ?, ?, ?)',
          [id, rt.roomType, rt.price, rt.quantity, rt.quantity]
        );
      }
    }

    for (const existing of existingRoomTypes) {
      const stillPresent = cleanRoomTypes.some((rt) => rt.roomType === existing.room_type);
      if (!stillPresent) {
        await connection.query('DELETE FROM room_types WHERE id = ?', [existing.id]);
      }
    }

    const cheapest = cleanRoomTypes.reduce((min, rt) => (rt.price < min.price ? rt : min), cleanRoomTypes[0]);

    // Photo gallery: remove any photos the hoster asked to remove, then
    // append any newly uploaded ones after the current highest sort order.
    let removedPhotoFiles = [];
    if (removePhotoIds.length > 0) {
      const [toRemove] = await connection.query(
        'SELECT id, image_url FROM listing_photos WHERE id IN (?) AND listing_id = ?',
        [removePhotoIds, id]
      );
      if (toRemove.length > 0) {
        await connection.query('DELETE FROM listing_photos WHERE id IN (?) AND listing_id = ?', [removePhotoIds, id]);
        removedPhotoFiles = toRemove.map((p) => p.image_url);
      }
    }

    const uploadedFiles = req.files || [];
    if (uploadedFiles.length > 0) {
      const [[{ maxOrder }]] = await connection.query(
        'SELECT COALESCE(MAX(sort_order), -1) AS maxOrder FROM listing_photos WHERE listing_id = ?',
        [id]
      );
      const photoValues = uploadedFiles.map((f, i) => [id, `/uploads/${f.filename}`, maxOrder + 1 + i]);
      await connection.query(
        'INSERT INTO listing_photos (listing_id, image_url, sort_order) VALUES ?',
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
      'SELECT image_url FROM listing_photos WHERE listing_id = ? ORDER BY sort_order ASC, id ASC LIMIT 1',
      [id]
    );
    const newCoverUrl = coverRow ? coverRow.image_url : null;

    await connection.query(
      'UPDATE listings SET title = ?, description = ?, area = ?, price = ?, room_type = ?, image_url = ?, distance_minutes = ? WHERE id = ?',
      [title, description || '', area, cheapest.price, cheapest.roomType, newCoverUrl, distance.value, id]
    );

    await connection.commit();

    for (const url of removedPhotoFiles) {
      if (url && url.startsWith('/uploads/')) {
        const filePath = path.join(__dirname, '..', 'public', url);
        fs.unlink(filePath, (err) => {
          if (err && err.code !== 'ENOENT') console.error('Could not delete removed photo:', err);
        });
      }
    }

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
