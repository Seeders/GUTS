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

/**
 * Issue a session row.
 *
 * A session now records who it belongs to: an account id and a role. The
 * bootstrap operator (the shared DOGBOARD_ADMIN_PASSWORD login) has no account
 * row, so its account_id is NULL and its role is 'staff'. A client login carries
 * that client's account id and role 'client'. That tag is what keeps a client's
 * token from ever passing the staff gate, and vice versa - the two share one
 * table but never one door.
 */
function issueSession({ accountId = null, role = 'staff' } = {}) {
    const token = crypto.randomBytes(32).toString('hex');
    const expires = new Date(Date.now() + SESSION_DAYS * 86400_000).toISOString();
    db.run('INSERT INTO sessions (token, created_at, expires_at, account_id, role) VALUES (?, ?, ?, ?, ?)',
        token, db.nowIso(), expires, accountId, role);
    purgeExpired();
    return { token, expiresAt: expires };
}

/** The bootstrap operator login (shared password). Always a staff session. */
function login(password) {
    const stored = db.getSetting('admin_password_hash');
    if (!verifyPassword(password, stored)) return null;
    return issueSession({ accountId: null, role: 'staff' });
}

function logout(token) {
    if (token) db.run('DELETE FROM sessions WHERE token = ?', token);
}

function purgeExpired() {
    db.run('DELETE FROM sessions WHERE expires_at < ?', db.nowIso());
}

/**
 * Resolve a token to its session, or null if unknown/expired. A legacy session
 * from before accounts existed has role NULL; treat that as staff.
 */
function sessionInfo(token) {
    if (!token) return null;
    const row = db.get(
        'SELECT token, expires_at, account_id, role FROM sessions WHERE token = ?', token);
    if (!row) return null;
    if (row.expires_at < db.nowIso()) {
        db.run('DELETE FROM sessions WHERE token = ?', token);
        return null;
    }
    return { token: row.token, expiresAt: row.expires_at, accountId: row.account_id, role: row.role };
}

/** A valid STAFF session (bootstrap operator or a staff account). Not a client. */
function isValidToken(token) {
    const info = sessionInfo(token);
    return !!info && info.role !== 'client';
}

function tokenFromRequest(req) {
    const header = req.get('authorization') || '';
    if (header.startsWith('Bearer ')) return header.slice(7).trim();
    if (req.query && typeof req.query.token === 'string') return req.query.token;
    return null;
}

/**
 * Middleware guarding every /api/admin route. A client session is explicitly
 * rejected here - it is a valid row in the same table, so without this check a
 * logged-in client could reach the back office.
 */
function requireAdmin(req, res, next) {
    const token = tokenFromRequest(req);
    const info = sessionInfo(token);
    if (!info || info.role === 'client') {
        return res.status(401).json({ error: 'Not authorized. Please log in.' });
    }
    req.adminToken = token;
    req.session = info;
    next();
}

/* ------------------------------------------------------------------ */
/* Accounts (client self-service logins + named staff logins)          */
/* ------------------------------------------------------------------ */

function normalizeEmail(email) {
    return String(email || '').trim().toLowerCase();
}

function getAccountByEmail(email) {
    return db.get('SELECT * FROM accounts WHERE lower(email) = ?', normalizeEmail(email)) || null;
}

function getAccountById(id) {
    return db.get('SELECT * FROM accounts WHERE id = ?', id) || null;
}

function createAccount({ role = 'client', email, password, client_id = null,
    status = 'pending', email_verified = 0, verify_token = null, verify_expires = null }) {
    const now = db.nowIso();
    const id = db.insert('accounts', {
        role,
        email: normalizeEmail(email),
        password_hash: hashPassword(password),
        client_id,
        status,
        email_verified: email_verified ? 1 : 0,
        verify_token,
        verify_expires,
        created_at: now,
        updated_at: now
    });
    return getAccountById(id);
}

/** Set (or reset) an account's password and drop all of its live sessions. */
function setAccountPassword(accountId, password) {
    db.update('accounts', accountId, {
        password_hash: hashPassword(password),
        updated_at: db.nowIso()
    });
    db.run('DELETE FROM sessions WHERE account_id = ?', accountId);
}

/** Verify a password against an account. Returns the account row or null. */
function verifyAccountPassword(email, password) {
    const account = getAccountByEmail(email);
    if (!account) return null;
    if (!verifyPassword(password, account.password_hash)) return null;
    return account;
}

/** Start a session for an account and stamp its last login. */
function createAccountSession(account) {
    db.update('accounts', account.id, { last_login_at: db.nowIso() });
    return issueSession({ accountId: account.id, role: account.role });
}

/**
 * Middleware guarding every /api/portal route. Requires a client session backed
 * by an active account that is linked to a client record. Sets req.clientId -
 * the ONLY client id downstream handlers may ever scope their queries to.
 */
function requireClient(req, res, next) {
    const token = tokenFromRequest(req);
    const info = sessionInfo(token);
    if (!info || info.role !== 'client' || !info.accountId) {
        return res.status(401).json({ error: 'Not authorized. Please log in.' });
    }
    const account = getAccountById(info.accountId);
    if (!account || account.status !== 'active') {
        return res.status(401).json({ error: 'This account is not active.' });
    }
    if (!account.client_id) {
        return res.status(403).json({ error: 'This account is not linked to a client record.' });
    }
    req.account = account;
    req.clientId = account.client_id;
    req.portalToken = token;
    next();
}

/** Staff gate. Same as requireAdmin today; named for the portal-era vocabulary. */
const requireStaff = requireAdmin;

module.exports = {
    ensureAdminPassword, setAdminPassword, verifyPassword, hashPassword,
    login, logout, isValidToken, requireAdmin, requireStaff, tokenFromRequest,
    sessionInfo, issueSession,
    normalizeEmail, getAccountByEmail, getAccountById, createAccount,
    setAccountPassword, verifyAccountPassword, createAccountSession, requireClient
};
