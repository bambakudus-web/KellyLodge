// utils/cloudinary.js — configures the Cloudinary SDK and wraps its
// callback-based upload API in a Promise so routes/middleware can just await it.
require('dotenv').config();
const cloudinary = require('cloudinary').v2;

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

// Uploads an in-memory file buffer (from multer's memoryStorage) straight to
// Cloudinary, no local disk involved, so nothing is lost on a redeploy.
function uploadBufferToCloudinary(buffer, folder = 'kellylodge') {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        folder,
        resource_type: 'image',
        // A reasonable cap on stored dimensions — a hoster's raw phone photo
        // can be 4000px+ wide, which is wasted bandwidth for a listing card.
        // Cloudinary handles the actual resizing/compression for us.
        transformation: [{ width: 1600, height: 1600, crop: 'limit', quality: 'auto', fetch_format: 'auto' }],
      },
      (err, result) => {
        if (err) return reject(err);
        resolve(result);
      }
    );
    stream.end(buffer);
  });
}

function deleteFromCloudinary(publicId) {
  if (!publicId) return Promise.resolve();
  return cloudinary.uploader.destroy(publicId).catch((err) => {
    console.error(`Could not delete Cloudinary asset "${publicId}":`, err);
  });
}

module.exports = { uploadBufferToCloudinary, deleteFromCloudinary };
