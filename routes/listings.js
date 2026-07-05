// routes/listings.js — all REST endpoints for hostel listings
const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const pool = require('../db');
const { requireRole } = require('../middleware/auth');
const { uploadSingleImage } = require('../middleware/upload');

const VALID_AREAS = ['Fante New Town', 'Asafo', 'Amakom'];
const VALID_ROOM_TYPES = [
  'Single (self-contained)',
  'Shared (2 in a room)',
  'Shared (3 in a room)',
  'Shared (4 in a room)',
];
const MIN_PRICE = 3000;

const ROOMS_SUBQUERY = `
  (SELECT COALESCE(SUM(available_quantity), 0) FROM room_types WHERE room_types.listing_id = listings.id) AS rooms_available,
  (SELECT COALESCE(SUM(total_quantity), 0) FROM room_types WHERE room_types.listing_id = listings.id) AS rooms_total
`;

// GET /api/listings — list active listings, with pagination and optional filters
router.get('/', async (req, res) => {
  try {
    const { area, minPrice, maxPrice, page, limit } = req.query;

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

    const [[{ total }]] = await pool.query(
      `SELECT COUNT(*) AS total FROM listings JOIN users ON listings.owner_id = users.id ${whereClause}`,
      params
    );

    const query = `
      SELECT listings.*, users.name AS owner_name, users.phone AS owner_phone,
        ${ROOMS_SUBQUERY}
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

// GET /api/listings/:id — a single listing's full details, including its room type breakdown
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const [rows] = await pool.query(
      `SELECT listings.*, users.name AS owner_name, users.phone AS owner_phone
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

    const listing = rows[0];
    listing.room_types = roomTypes;
    res.json(listing);
  } catch (err) {
    console.error('Error fetching listing:', err);
    res.status(500).json({ error: 'Could not fetch listing.' });
  }
});

// POST /api/listings — create a new listing with a photo upload and per-room-type breakdown
router.post('/', requireRole('hoster', 'admin'), uploadSingleImage, async (req, res) => {
  const connection = await pool.getConnection();
  try {
    const { title, description, area } = req.body;
    const ownerId = req.session.user.id;

    let roomTypesInput;
    try {
      roomTypesInput = JSON.parse(req.body.room_types || '[]');
    } catch {
      connection.release();
      return res.status(400).json({ error: 'Invalid room type data.' });
    }

    if (!title || !area) {
      connection.release();
      return res.status(400).json({ error: 'Missing required fields.' });
    }

    if (!VALID_AREAS.includes(area)) {
      connection.release();
      return res.status(400).json({ error: `Area must be one of: ${VALID_AREAS.join(', ')}` });
    }

    if (!Array.isArray(roomTypesInput) || roomTypesInput.length === 0) {
      connection.release();
      return res.status(400).json({ error: 'Add at least one room type with a price and quantity.' });
    }

    const seenTypes = new Set();
    const cleanRoomTypes = [];

    for (const rt of roomTypesInput) {
      const roomType = rt.room_type;
      const price = Number(rt.price);
      const quantity = Number(rt.quantity);

      if (!VALID_ROOM_TYPES.includes(roomType)) {
        connection.release();
        return res.status(400).json({ error: `Room type must be one of: ${VALID_ROOM_TYPES.join(', ')}` });
      }
      if (seenTypes.has(roomType)) {
        connection.release();
        return res.status(400).json({ error: `"${roomType}" was entered more than once. Combine it into a single row.` });
      }
      if (isNaN(price) || price < MIN_PRICE) {
        connection.release();
        return res.status(400).json({ error: `"${roomType}" must be priced at GH₵${MIN_PRICE.toLocaleString()} or more.` });
      }
      if (!Number.isInteger(quantity) || quantity <= 0 || quantity > 2000) {
        connection.release();
        return res.status(400).json({ error: `Enter a valid quantity (1–2000) for "${roomType}".` });
      }

      seenTypes.add(roomType);
      cleanRoomTypes.push({ roomType, price, quantity });
    }

    const cheapest = cleanRoomTypes.reduce((min, rt) => (rt.price < min.price ? rt : min), cleanRoomTypes[0]);
    const imageUrl = req.file ? `/uploads/${req.file.filename}` : null;

    await connection.beginTransaction();

    const [result] = await connection.query(
      `INSERT INTO listings (title, description, area, price, room_type, owner_id, image_url)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [title, description || '', area, cheapest.price, cheapest.roomType, ownerId, imageUrl]
    );

    const listingId = result.insertId;
    const roomTypeValues = cleanRoomTypes.map((rt) => [listingId, rt.roomType, rt.price, rt.quantity, rt.quantity]);

    await connection.query(
      `INSERT INTO room_types (listing_id, room_type, price, total_quantity, available_quantity) VALUES ?`,
      [roomTypeValues]
    );

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

// GET /api/listings/mine/all — a hoster's own listings (any status), with room counts
router.get('/mine/all', requireRole('hoster', 'admin'), async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT listings.*, ${ROOMS_SUBQUERY}
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
// Also deletes the uploaded photo from disk so it doesn't pile up forever.
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

    await pool.query('DELETE FROM listings WHERE id = ?', [id]);

    const imageUrl = rows[0].image_url;
    if (imageUrl && imageUrl.startsWith('/uploads/')) {
      const filePath = path.join(__dirname, '..', 'public', imageUrl);
      fs.unlink(filePath, (err) => {
        if (err && err.code !== 'ENOENT') console.error('Could not delete listing photo:', err);
      });
    }

    res.json({ message: 'Listing removed.' });
  } catch (err) {
    console.error('Error deleting listing:', err);
    res.status(500).json({ error: 'Could not delete listing.' });
  }
});

// PUT /api/listings/:id — edit an existing listing (owner or admin only).
// Room types already booked can't be removed or shrunk below their booked count.
router.put('/:id', requireRole('hoster', 'admin'), uploadSingleImage, async (req, res) => {
  const connection = await pool.getConnection();
  try {
    const { id } = req.params;
    const { title, description, area } = req.body;

    const [existingRows] = await connection.query('SELECT owner_id, image_url FROM listings WHERE id = ?', [id]);
    if (existingRows.length === 0) {
      connection.release();
      return res.status(404).json({ error: 'Listing not found.' });
    }

    const isOwner = existingRows[0].owner_id === req.session.user.id;
    const isAdmin = req.session.user.role === 'admin';
    if (!isOwner && !isAdmin) {
      connection.release();
      return res.status(403).json({ error: 'You can only edit your own listings.' });
    }

    let roomTypesInput;
    try {
      roomTypesInput = JSON.parse(req.body.room_types || '[]');
    } catch {
      connection.release();
      return res.status(400).json({ error: 'Invalid room type data.' });
    }

    if (!title || !area) {
      connection.release();
      return res.status(400).json({ error: 'Missing required fields.' });
    }
    if (!VALID_AREAS.includes(area)) {
      connection.release();
      return res.status(400).json({ error: `Area must be one of: ${VALID_AREAS.join(', ')}` });
    }
    if (!Array.isArray(roomTypesInput) || roomTypesInput.length === 0) {
      connection.release();
      return res.status(400).json({ error: 'Add at least one room type with a price and quantity.' });
    }

    const seenTypes = new Set();
    const cleanRoomTypes = [];
    for (const rt of roomTypesInput) {
      const roomType = rt.room_type;
      const price = Number(rt.price);
      const quantity = Number(rt.quantity);

      if (!VALID_ROOM_TYPES.includes(roomType)) {
        connection.release();
        return res.status(400).json({ error: `Room type must be one of: ${VALID_ROOM_TYPES.join(', ')}` });
      }
      if (seenTypes.has(roomType)) {
        connection.release();
        return res.status(400).json({ error: `"${roomType}" was entered more than once.` });
      }
      if (isNaN(price) || price < MIN_PRICE) {
        connection.release();
        return res.status(400).json({ error: `"${roomType}" must be priced at GH₵${MIN_PRICE.toLocaleString()} or more.` });
      }
      if (!Number.isInteger(quantity) || quantity <= 0 || quantity > 2000) {
        connection.release();
        return res.status(400).json({ error: `Enter a valid quantity (1–2000) for "${roomType}".` });
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
          error: `Cannot remove "${existing.room_type}" — it has ${bookedCount} active booking(s). Cancel those first.`,
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
            error: `"${rt.roomType}" has ${bookedCount} active booking(s) — quantity can't go below that.`,
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

    let imageUrl = existingRows[0].image_url;
    if (req.file) {
      imageUrl = `/uploads/${req.file.filename}`;
    }

    await connection.query(
      'UPDATE listings SET title = ?, description = ?, area = ?, price = ?, room_type = ?, image_url = ? WHERE id = ?',
      [title, description || '', area, cheapest.price, cheapest.roomType, imageUrl, id]
    );

    await connection.commit();

    if (req.file && existingRows[0].image_url && existingRows[0].image_url.startsWith('/uploads/')) {
      const oldPath = path.join(__dirname, '..', 'public', existingRows[0].image_url);
      fs.unlink(oldPath, (err) => {
        if (err && err.code !== 'ENOENT') console.error('Could not delete old listing photo:', err);
      });
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
