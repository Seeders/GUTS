/**
 * DogBoarding - file upload handling (vet records, expense receipts).
 *
 * Uploaded files are stored outside the web root and are never served as
 * static assets. They come back out only through authenticated /api/admin/files
 * routes, because vet records carry client names, addresses and phone numbers.
 */

const multer = require('multer');
const crypto = require('crypto');
const path = require('path');
const db = require('./db');

const MAX_BYTES = 15 * 1024 * 1024; // 15 MB

const ALLOWED = new Set([
    'application/pdf',
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/heic',
    'image/heif'
]);

const EXT_BY_MIME = {
    'application/pdf': '.pdf',
    'image/jpeg': '.jpg',
    'image/png': '.png',
    'image/webp': '.webp',
    'image/heic': '.heic',
    'image/heif': '.heif'
};

const storage = multer.diskStorage({
    destination(req, file, cb) {
        db.open(); // guarantees the upload dir exists
        cb(null, db.UPLOAD_DIR);
    },
    filename(req, file, cb) {
        // Random name: never trust the client's filename on disk.
        const ext = EXT_BY_MIME[file.mimetype] || path.extname(file.originalname).slice(0, 8) || '';
        cb(null, `${Date.now()}-${crypto.randomBytes(8).toString('hex')}${ext}`);
    }
});

function fileFilter(req, file, cb) {
    if (!ALLOWED.has(file.mimetype)) {
        cb(new Error(`Unsupported file type: ${file.mimetype}. Upload a PDF or a photo.`));
        return;
    }
    cb(null, true);
}

const upload = multer({
    storage,
    fileFilter,
    limits: { fileSize: MAX_BYTES, files: 20 }
});

/** Turn a multer error into a clean 400 rather than a stack trace. */
function handleUploadError(err, req, res, next) {
    if (err instanceof multer.MulterError) {
        const message = err.code === 'LIMIT_FILE_SIZE'
            ? 'That file is too large. Maximum size is 15 MB.'
            : `Upload failed: ${err.message}`;
        return res.status(400).json({ error: message });
    }
    if (err && /Unsupported file type/.test(err.message)) {
        return res.status(400).json({ error: err.message });
    }
    return next(err);
}

module.exports = { upload, handleUploadError, MAX_BYTES, ALLOWED };
