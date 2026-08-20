const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const multer = require('multer');

const IMAGES_DIR = path.join(__dirname, '..', 'uploads', 'images');

function safeSuffix(originalName) {
  const ext = path.extname(originalName || '').toLowerCase();
  const rand = crypto.randomBytes(8).toString('hex');
  return { ext, rand };
}

// Vanzatorul incarca doar imaginea de prezentare a produsului. Fisierul
// digital livrat clientului NU mai e incarcat de vanzator — e generat
// automat de platforma (vezi lib/ticketPdf.js), pe baza numerelor alocate
// comenzii.
function makeImageUploader() {
  return multer({
    storage: multer.diskStorage({
      destination: (req, file, cb) => cb(null, IMAGES_DIR),
      filename: (req, file, cb) => {
        const { ext, rand } = safeSuffix(file.originalname);
        cb(null, `${Date.now()}-${rand}${ext}`);
      },
    }),
    limits: { fileSize: 15 * 1024 * 1024 }, // 15MB
    fileFilter: (req, file, cb) => {
      if (!file.mimetype.startsWith('image/')) {
        return cb(new Error('Imaginea trebuie sa fie un fisier de tip imagine.'));
      }
      cb(null, true);
    },
  });
}

fs.mkdirSync(IMAGES_DIR, { recursive: true });

module.exports = { makeImageUploader, IMAGES_DIR };
