/**
 * DogBoarding - admin authentication.
 *
 * Single-operator model: one shared admin password, stored as a scrypt hash in
 * the settings table. Sessions are random tokens held in the sessions table.
 *
 * This is deliberately simple, and it is NOT a substitute for real user
 * accounts. If this business ever has more than one staff member who needs an
 * audit trail, replace this with per-user accounts. See README.
 */

const crypto = require('crypto');
const db = require('./db');

const SESSION_DAYS = 14;
const SCRYPT_KEYLEN = 64;

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
    const derived = crypto.scryptSync(password, salt, SCRYPT_KEYLEN).toString('hex');
    return `scrypt$${salt}$${derived}`;
}

function verifyPassword(password, stored) {
    if (!stored || !stored.startsWith('scrypt$')) return false;
    const [, salt, expected] = stored.split('$');
    const derived = crypto.scryptSync(password, salt, SCRYPT_KEYLEN).toString('hex');
    const a = Buffer.from(derived, 'hex');
    const b = Buffer.from(expected, 'hex');
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
}

/**
 * Make sure an admin password exists. On a fresh database we take it from
 * DOGBOARD_ADMIN_PASSWORD, falling back to a generated one that we print once
 * so the operator can log in and change it.
 */
function ensureAdminPassword() {
    const existing = db.getSetting('admin_password_hash');
    if (existing) return;

    const fromEnv = process.env.DOGBOARD_ADMIN_PASSWORD;
    const password = fromEnv || crypto.randomBytes(6).toString('base64url');

    db.setSetting('admin_password_hash', hashPassword(password));

    if (fromEnv) {
        console.log('  Admin password set from DOGBOARD_ADMIN_PASSWORD.');
    } else {
        console.log('');
        console.log('  ┌──────────────────────────────────────────────┐');
        console.log('  │  First run: generated an admin password.      │');
        console.log(`  │  Password: ${password.padEnd(34)}│`);
        console.log('  │  Change it in Settings after you log in.      │');
        console.log('  └──────────────────────────────────────────────┘');
        console.log('');
    }
}

function setAdminPassword(password) {
    db.setSetting('admin_password_hash', hashPassword(password));
    db.run('DELETE FROM sessions'); // force re-login everywhere
}

function login(password) {
    const stored = db.getSetting('admin_password_hash');
    if (!verifyPassword(password, stored)) return null;

    const token = crypto.randomBytes(32).toString('hex');
    const expires = new Date(Date.now() + SESSION_DAYS * 86400_000).toISOString();
    db.run('INSERT INTO sessions (token, created_at, expires_at) VALUES (?, ?, ?)',
        token, db.nowIso(), expires);

    purgeExpired();
    return { token, expiresAt: expires };
}

function logout(token) {
    if (token) db.run('DELETE FROM sessions WHERE token = ?', token);
}

function purgeExpired() {
    db.run('DELETE FROM sessions WHERE expires_at < ?', db.nowIso());
}

function isValidToken(token) {
    if (!token) return false;
    const row = db.get('SELECT expires_at FROM sessions WHERE token = ?', token);
    if (!row) return false;
    if (row.expires_at < db.nowIso()) {
        db.run('DELETE FROM sessions WHERE token = ?', token);
        return false;
    }
    return true;
}

function tokenFromRequest(req) {
    const header = req.get('authorization') || '';
    if (header.startsWith('Bearer ')) return header.slice(7).trim();
    if (req.query && typeof req.query.token === 'string') return req.query.token;
    return null;
}

/** Express middleware guarding every /api/admin route. */
function requireAdmin(req, res, next) {
    const token = tokenFromRequest(req);
    if (!isValidToken(token)) {
        return res.status(401).json({ error: 'Not authorized. Please log in.' });
    }
    req.adminToken = token;
    next();
}

module.exports = {
    ensureAdminPassword, setAdminPassword, verifyPassword,
    login, logout, isValidToken, requireAdmin, tokenFromRequest
};
