// middleware/upload.js — handles hostel photo uploads to disk
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const uploadDir = path.join(__dirname, '..', 'public', 'uploads');
fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const unique = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    cb(null, `${unique}${path.extname(file.originalname)}`);
  },
});

function fileFilter(req, file, cb) {
  if (file.mimetype.startsWith('image/')) {
    cb(null, true);
  } else {
    cb(new Error('Only image files are allowed.'));
  }
}

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
});

// A browser-reported MIME type can be faked by renaming a file — this checks
// the actual first bytes on disk against known image file signatures.
function isValidImageSignature(filePath) {
  const buffer = Buffer.alloc(12);
  const fd = fs.openSync(filePath, 'r');
  fs.readSync(fd, buffer, 0, 12, 0);
  fs.closeSync(fd);

  const hex = buffer.toString('hex').toUpperCase();
  if (hex.startsWith('FFD8FF')) return true; // JPEG
  if (hex.startsWith('89504E47')) return true; // PNG
  if (hex.startsWith('474946')) return true; // GIF
  if (buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') return true; // WEBP
  return false;
}

// Wraps upload.single so multer errors (too large, wrong type) come back
// as a clean JSON 400, and adds a real signature check after the file lands on disk.
function uploadSingleImage(req, res, next) {
  upload.single('image')(req, res, (err) => {
    if (err) {
      return res.status(400).json({ error: err.message || 'Could not upload image.' });
    }

    if (req.file) {
      const filePath = path.join(uploadDir, req.file.filename);
      if (!isValidImageSignature(filePath)) {
        fs.unlink(filePath, () => {});
        return res.status(400).json({ error: 'That file does not look like a valid image.' });
      }
    }

    next();
  });
}

module.exports = { uploadSingleImage };
