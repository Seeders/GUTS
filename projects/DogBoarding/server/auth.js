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
 * Make sure an admin password exists.
 *
 * DOGBOARD_ADMIN_PASSWORD wins whenever it is set, on every boot - not just on
 * a fresh database. That makes it the way back in when nobody can remember the
 * password, which beats the alternative of a password that only ever existed in
 * one line of terminal scrollback.
 *
 * With no env var and no password on file, we generate one and print it.
 */
function ensureAdminPassword() {
    const fromEnv = process.env.DOGBOARD_ADMIN_PASSWORD;
    const existing = db.getSetting('admin_password_hash');

    if (fromEnv) {
        // Don't churn sessions on every restart if the password has not changed.
        if (existing && verifyPassword(fromEnv, existing)) {
            console.log('  Admin password: from DOGBOARD_ADMIN_PASSWORD.');
            return;
        }
        setAdminPassword(fromEnv);
        console.log('  Admin password set from DOGBOARD_ADMIN_PASSWORD (everyone logged out).');
        return;
    }

    if (existing) return;

    const password = crypto.randomBytes(6).toString('base64url');
    db.setSetting('admin_password_hash', hashPassword(password));

    console.log('');
    console.log('  ┌────────────────────────────────────────────────────────┐');
    console.log('  │  First run: generated an admin password.               │');
    console.log(`  │  Password: ${password.padEnd(44)}│`);
    console.log('  │                                                        │');
    console.log('  │  Change it in Settings, or set a password of your own  │');
    console.log('  │  with DOGBOARD_ADMIN_PASSWORD and restart.             │');
    console.log('  └────────────────────────────────────────────────────────┘');
    console.log('');
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
