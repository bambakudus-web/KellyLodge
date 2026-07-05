// database/update_prices.js — bumps every room type's price to the new
// GH₵3000+ tiers, and recalculates each listing's "starting from" price.
// Safe to run more than once. Run with: node database/update_prices.js
require('dotenv').config();
const pool = require('../db');

const PRICE_BY_TYPE = {
  'Shared (4 in a room)': 3500,
  'Shared (3 in a room)': 4000,
  'Shared (2 in a room)': 5000,
  'Single (self-contained)': 6000,
};

async function update() {
  for (const [roomType, price] of Object.entries(PRICE_BY_TYPE)) {
    const [result] = await pool.query(
      'UPDATE room_types SET price = ? WHERE room_type = ?',
      [price, roomType]
    );
    console.log(`Set ${roomType} to GH₵${price} (${result.affectedRows} row(s) updated)`);
  }

  const [listings] = await pool.query('SELECT id FROM listings');
  for (const listing of listings) {
    const [roomTypes] = await pool.query(
      'SELECT room_type, price FROM room_types WHERE listing_id = ? ORDER BY price ASC LIMIT 1',
      [listing.id]
    );
    if (roomTypes.length === 0) continue;

    await pool.query(
      'UPDATE listings SET price = ?, room_type = ? WHERE id = ?',
      [roomTypes[0].price, roomTypes[0].room_type, listing.id]
    );
  }
  console.log(`Recalculated "starting from" price for ${listings.length} listing(s).`);

  console.log('Done.');
  process.exit(0);
}

update().catch((err) => {
  console.error(err);
  process.exit(1);
});
