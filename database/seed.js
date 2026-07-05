// database/seed.js — populates demo users, listings, and room-type inventory for KellyLodge
// Run with: npm run seed  (after schema.sql has been applied)
require('dotenv').config();
const bcrypt = require('bcryptjs');
const pool = require('../db');

const DEMO_PASSWORD = 'password123'; // same password for every demo account, for easy testing

const PRICE_BY_TYPE = {
  'Shared (4 in a room)': 3500,
  'Shared (3 in a room)': 4000,
  'Shared (2 in a room)': 5000,
  'Single (self-contained)': 6000,
};

const users = [
  { name: 'Kelly (Admin)', email: 'admin@kellylodge.com', phone: '+233240000000', role: 'admin' },
  { name: 'Mr. Boateng', email: 'boateng@kellylodge.com', phone: '+233241112233', role: 'hoster' },
  { name: 'Mrs. Rhema Owusu', email: 'rhema@kellylodge.com', phone: '+233244556677', role: 'hoster' },
  { name: 'Madam Awo', email: 'awo@kellylodge.com', phone: '+233205000111', role: 'hoster' },
  { name: 'Mr. Chris Mensah', email: 'chris@kellylodge.com', phone: '+233553977756', role: 'hoster' },
  { name: 'Ama Student', email: 'ama@kellylodge.com', phone: '+233241234567', role: 'student' },
];

// Each listing now carries a room-type breakdown instead of one flat price —
// this mirrors what a hoster with hundreds of rooms would actually enter.
const listingsByOwnerEmail = [
  {
    owner: 'boateng@kellylodge.com', title: 'Crystal Hostel', area: 'Fante New Town',
    description: 'Close to KsTU main campus. New block with good room layout. Water flows reliably morning and evening. Game room and free WiFi available.',
    image_url: 'https://images.unsplash.com/photo-1522708323590-d24dbb6b0267?w=600',
    rooms: [
      { room_type: 'Shared (2 in a room)', quantity: 80 },
      { room_type: 'Shared (3 in a room)', quantity: 40 },
    ],
  },
  {
    owner: 'boateng@kellylodge.com', title: 'Liberty Hall KsTU', area: 'Fante New Town',
    description: 'On-campus hostel, great for academic focus. Good lighting, quiet environment.',
    image_url: 'https://images.unsplash.com/photo-1555854877-bab0e564b8d5?w=600',
    rooms: [
      { room_type: 'Shared (3 in a room)', quantity: 60 },
      { room_type: 'Shared (4 in a room)', quantity: 100 },
    ],
  },
  {
    owner: 'rhema@kellylodge.com', title: 'Rhema Jason Hostel', area: 'Fante New Town',
    description: 'Cozy rooms in a serene environment, very close to campus. Well maintained and secure.',
    image_url: 'https://images.unsplash.com/photo-1595526114035-0d45ed16cfbf?w=600',
    rooms: [
      { room_type: 'Single (self-contained)', quantity: 30 },
      { room_type: 'Shared (2 in a room)', quantity: 50 },
    ],
  },
  {
    owner: 'boateng@kellylodge.com', title: 'Cyborg Hostel', area: 'Fante New Town',
    description: 'Affordable option near campus, decent facilities for the price.',
    image_url: 'https://images.unsplash.com/photo-1505693416388-ac5ce068fe85?w=600',
    rooms: [
      { room_type: 'Shared (4 in a room)', quantity: 150 },
    ],
  },
  {
    owner: 'rhema@kellylodge.com', title: 'Classic View Hostel', area: 'Fante New Town',
    description: 'Older building close to campus, budget-friendly, needs minor renovation but functional.',
    image_url: 'https://images.unsplash.com/photo-1598928506311-c55ded91a20c?w=600',
    rooms: [
      { room_type: 'Shared (3 in a room)', quantity: 70 },
      { room_type: 'Shared (4 in a room)', quantity: 90 },
    ],
  },
  {
    owner: 'awo@kellylodge.com', title: "Madam Awo's Hostel", area: 'Asafo',
    description: 'Affordable rent on Asafo Road. Can get noisy at times but generally safe.',
    image_url: 'https://images.unsplash.com/photo-1560448204-e02f11c3d0e2?w=600',
    rooms: [
      { room_type: 'Shared (2 in a room)', quantity: 60 },
    ],
  },
  {
    owner: 'awo@kellylodge.com', title: 'Obaatanpa House', area: 'Asafo',
    description: 'Quiet residence in Asafo with excellent service and clean rooms.',
    image_url: 'https://images.unsplash.com/photo-1502672260266-1c1ef2d93688?w=600',
    rooms: [
      { room_type: 'Single (self-contained)', quantity: 25 },
      { room_type: 'Shared (2 in a room)', quantity: 45 },
    ],
  },
  {
    owner: 'chris@kellylodge.com', title: 'Tumi Student Lodge', area: 'Amakom',
    description: 'Spacious rooms with a homely common area, located in Amakom, short trotro ride to campus.',
    image_url: 'https://images.unsplash.com/photo-1521783988139-89397d761dce?w=600',
    rooms: [
      { room_type: 'Single (self-contained)', quantity: 40 },
    ],
  },
  {
    owner: 'chris@kellylodge.com', title: 'Amakom Student Villas', area: 'Amakom',
    description: 'Modern rooms with reliable water and electricity, popular with final-year students.',
    image_url: 'https://images.unsplash.com/photo-1484154218962-a197022b5858?w=600',
    rooms: [
      { room_type: 'Single (self-contained)', quantity: 35 },
      { room_type: 'Shared (2 in a room)', quantity: 55 },
    ],
  },
  {
    owner: 'rhema@kellylodge.com', title: 'Joy Hostel', area: 'Fante New Town',
    description: 'Calm and quiet environment, basic but reliable, walking distance to campus.',
    image_url: 'https://images.unsplash.com/photo-1586023492125-27b2c045efd7?w=600',
    rooms: [
      { room_type: 'Shared (3 in a room)', quantity: 50 },
      { room_type: 'Shared (4 in a room)', quantity: 120 },
    ],
  },
];

async function seed() {
  try {
    console.log('Hashing passwords and inserting users...');
    const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 10);
    const emailToId = {};

    for (const user of users) {
      await pool.query(
        `INSERT INTO users (name, email, password_hash, phone, role, email_verified) VALUES (?, ?, ?, ?, ?, TRUE)
         ON DUPLICATE KEY UPDATE name = VALUES(name), email_verified = TRUE`,
        [user.name, user.email, passwordHash, user.phone, user.role]
      );
      const [rows] = await pool.query('SELECT id FROM users WHERE email = ?', [user.email]);
      emailToId[user.email] = rows[0].id;
    }
    console.log(`Inserted/verified ${users.length} users. Demo password for all: "${DEMO_PASSWORD}"`);

    console.log('Inserting listings and room types...');
    for (const listing of listingsByOwnerEmail) {
      const ownerId = emailToId[listing.owner];

      const roomsWithPrices = listing.rooms.map((r) => ({
        ...r,
        price: PRICE_BY_TYPE[r.room_type],
      }));
      const cheapest = roomsWithPrices.reduce((min, r) => (r.price < min.price ? r : min), roomsWithPrices[0]);

      const [result] = await pool.query(
        `INSERT INTO listings (title, description, area, price, room_type, owner_id, image_url)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [listing.title, listing.description, listing.area, cheapest.price, cheapest.room_type, ownerId, listing.image_url]
      );

      const listingId = result.insertId;
      const roomTypeValues = roomsWithPrices.map((r) => [listingId, r.room_type, r.price, r.quantity, r.quantity]);

      await pool.query(
        `INSERT INTO room_types (listing_id, room_type, price, total_quantity, available_quantity) VALUES ?`,
        [roomTypeValues]
      );
    }
    console.log(`Inserted ${listingsByOwnerEmail.length} listings with room-type breakdowns.`);

    console.log('\nDemo accounts (all use password: ' + DEMO_PASSWORD + ')');
    users.forEach(u => console.log(`  ${u.role.padEnd(8)} ${u.email}`));

    process.exit(0);
  } catch (err) {
    console.error('Seed failed:', err);
    process.exit(1);
  }
}

seed();
