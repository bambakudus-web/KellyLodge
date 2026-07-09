// middleware/upload.js — handles hostel photo uploads, straight to
// Cloudinary, nothing touches local disk, so nothing is lost when Railway
// redeploys (its filesystem doesn't persist between deploys).
const multer = require('multer');
const { uploadBufferToCloudinary } = require('../utils/cloudinary');

// Files stay in memory only long enough to validate and forward to
// Cloudinary, they're never written to disk.
const storage = multer.memoryStorage();

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

// A browser-reported MIME type can be faked by renaming a file, this checks
// the actual first bytes of the in-memory buffer against known image
// signatures, instead of trusting the extension or Content-Type header.
function isValidImageSignature(buffer) {
  const hex = buffer.subarray(0, 12).toString('hex').toUpperCase();
  if (hex.startsWith('FFD8FF')) return true; // JPEG
  if (hex.startsWith('89504E47')) return true; // PNG
  if (hex.startsWith('474946')) return true; // GIF
  if (buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP') return true; // WEBP
  return false;
}

// Wraps upload.single so multer errors (too large, wrong type) come back as
// a clean JSON 400, validates the real file signature, then uploads to
// Cloudinary and attaches the result (cloudinaryUrl/cloudinaryPublicId) onto
// req.file for the route handler to use.
function uploadSingleImage(req, res, next) {
  upload.single('image')(req, res, async (err) => {
    if (err) {
      return res.status(400).json({ error: err.message || 'Could not upload image.' });
    }

    if (!req.file) return next();

    if (!isValidImageSignature(req.file.buffer)) {
      return res.status(400).json({ error: 'That file does not look like a valid image.' });
    }

    try {
      const result = await uploadBufferToCloudinary(req.file.buffer, 'kellylodge/listings');
      req.file.cloudinaryUrl = result.secure_url;
      req.file.cloudinaryPublicId = result.public_id;
      next();
    } catch (uploadErr) {
      console.error('Cloudinary upload failed:', uploadErr);
      res.status(502).json({ error: 'Could not upload image right now. Please try again.' });
    }
  });
}

// Same idea, but for a hostel's photo gallery, accepts up to 5 files under
// the "photos" field, each validated and uploaded to Cloudinary in parallel.
function uploadMultipleImages(req, res, next) {
  upload.array('photos', 5)(req, res, async (err) => {
    if (err) {
      return res.status(400).json({ error: err.message || 'Could not upload photos.' });
    }

    const files = req.files || [];
    if (files.length === 0) return next();

    for (const file of files) {
      if (!isValidImageSignature(file.buffer)) {
        return res.status(400).json({ error: 'One of those files does not look like a valid image.' });
      }
    }

    try {
      const results = await Promise.all(
        files.map((file) => uploadBufferToCloudinary(file.buffer, 'kellylodge/listings'))
      );
      results.forEach((result, i) => {
        files[i].cloudinaryUrl = result.secure_url;
        files[i].cloudinaryPublicId = result.public_id;
      });
      next();
    } catch (uploadErr) {
      console.error('Cloudinary upload failed:', uploadErr);
      res.status(502).json({ error: 'Could not upload one or more photos right now. Please try again.' });
    }
  });
}

module.exports = { uploadSingleImage, uploadMultipleImages };
