/**
 * Editor authentication for the GUTS root server.
 *
 * The root server exposes the editor's filesystem endpoints — /save-file,
 * /delete-folder, /read-file, /save-compiled-game and friends — which can write,
 * read and delete arbitrary files under projects/ and compile game bundles the
 * server then serves. On localhost that is a convenience. Facing the internet it
 * is remote code execution and data exfiltration for anyone who finds the port.
 *
 * This gate stands in front of every editor surface (the endpoints AND the
 * /projects/Editor page) and lets nothing through without a credential. Games,
 * static game assets, the sprite-atlas READ endpoint, the multiplayer sockets
 * and each project's own backend are deliberately left open — they are the
 * public face of the server and carry their own auth where they need it.
 *
 * Mechanism: HTTP Basic Auth, so the browser shows its native login dialog on
 * the editor page and NO editor client code has to change. On the first correct
 * Basic credential we also drop an httpOnly session cookie, so every subsequent
 * XHR/fetch the editor makes is authorized deterministically by the cookie
 * rather than relying on the browser to re-attach Basic credentials per path.
 *
 * Configuration (environment):
 *   GUTS_EDITOR_PASSWORD   enables the gate. Required to expose the editor.
 *   GUTS_EDITOR_USER       username for the Basic prompt (default "admin").
 *
 * When GUTS_EDITOR_PASSWORD is unset:
 *   - production (--prod): editor endpoints are refused (503). Fail closed —
 *     an unauthenticated write endpoint must never reach the internet.
 *   - development: the editor stays open so the local workflow is unchanged, and
 *     the server warns at boot. Do not expose a dev server without setting it.
 */

const crypto = require('crypto');

const USER = process.env.GUTS_EDITOR_USER || 'admin';
const PASSWORD = process.env.GUTS_EDITOR_PASSWORD || null;
const ENABLED = !!PASSWORD;

const REALM = 'GUTS Editor';
const COOKIE = 'guts_editor';
const TTL_MS = 12 * 60 * 60 * 1000; // 12h

// token -> expiry (ms). In-memory: restart logs everyone out, which is fine.
const sessions = new Map();

function newSession() {
    const token = crypto.randomBytes(32).toString('hex');
    sessions.set(token, Date.now() + TTL_MS);
    return token;
}

function validSession(token) {
    if (!token) return false;
    const expires = sessions.get(token);
    if (!expires) return false;
    if (Date.now() > expires) {
        sessions.delete(token);
        return false;
    }
    return true;
}

/** Constant-time string compare that does not leak length via early return. */
function safeEqual(a, b) {
    const ab = Buffer.from(String(a), 'utf8');
    const bb = Buffer.from(String(b), 'utf8');
    if (ab.length !== bb.length) {
        // Compare something of equal length so the timing does not reveal it.
        crypto.timingSafeEqual(ab, ab);
        return false;
    }
    return crypto.timingSafeEqual(ab, bb);
}

function parseCookies(header) {
    const out = {};
    (header || '').split(';').forEach(part => {
        const eq = part.indexOf('=');
        if (eq === -1) return;
        out[part.slice(0, eq).trim()] = decodeURIComponent(part.slice(eq + 1).trim());
    });
    return out;
}

// The editor's write/read/delete/compile endpoints. GET /api/cache/:prefix is
// NOT here on purpose: the game runtime reads sprite atlases from it. Only the
// POST /api/cache write is an editor action (handled by method below).
const ENDPOINTS = new Set([
    '/save-project', '/save-compiled-game', '/load-project',
    '/upload-file', '/upload-model',
    '/save-file', '/delete-file', '/delete-folder',
    '/read-file', '/read-files', '/list-files', '/list-modules',
    '/browse-directory', '/list-projects',
    '/api/save-texture', '/api/save-isometric-sprites'
]);

/** Is this request aimed at an editor surface (page or endpoint)? */
function isEditorRequest(req) {
    const p = req.path;
    if (p === '/projects/Editor' || p.startsWith('/projects/Editor/')) return true;
    if (ENDPOINTS.has(p)) return true;
    if (req.method === 'POST' && p === '/api/cache') return true;
    return false;
}

function challenge(res) {
    res.set('WWW-Authenticate', `Basic realm="${REALM}", charset="UTF-8"`);
    return res.status(401).json({ error: 'Editor authentication required.' });
}

/**
 * Build the gate middleware. Non-editor requests pass straight through, so this
 * is safe to mount globally ahead of express.static.
 */
function makeEditorGate({ isProduction } = {}) {
    if (ENABLED) {
        console.log(`[editor-auth] Editor authentication is ON (user "${USER}").`);
    } else if (isProduction) {
        console.warn('[editor-auth] GUTS_EDITOR_PASSWORD is not set — editor endpoints are DISABLED (production).');
    } else {
        console.warn('[editor-auth] GUTS_EDITOR_PASSWORD is not set — editor is OPEN (dev). Set it before exposing this server.');
    }

    return function editorGate(req, res, next) {
        if (!isEditorRequest(req)) return next();

        if (!ENABLED) {
            if (isProduction) {
                return res.status(503).json({
                    error: 'Editor is disabled. Set GUTS_EDITOR_PASSWORD to enable it.'
                });
            }
            return next(); // dev convenience, localhost only
        }

        // Already carrying a good session cookie? Let it through.
        const cookies = parseCookies(req.headers.cookie);
        if (validSession(cookies[COOKIE])) return next();

        // Otherwise require a Basic credential, and on success mint the cookie.
        const auth = req.headers.authorization || '';
        if (auth.startsWith('Basic ')) {
            let decoded = '';
            try {
                decoded = Buffer.from(auth.slice(6), 'base64').toString('utf8');
            } catch { /* malformed header */ }
            const sep = decoded.indexOf(':');
            const user = sep === -1 ? '' : decoded.slice(0, sep);
            const pass = sep === -1 ? '' : decoded.slice(sep + 1);

            // Bitwise & (not &&) so both compares always run — no early-out leak.
            const ok = safeEqual(user, USER) & safeEqual(pass, PASSWORD);
            if (ok) {
                const token = newSession();
                const secure = req.secure || req.headers['x-forwarded-proto'] === 'https';
                res.cookie(COOKIE, token, {
                    httpOnly: true,
                    sameSite: 'Strict',
                    secure,
                    maxAge: TTL_MS,
                    path: '/'
                });
                return next();
            }
        }

        return challenge(res);
    };
}

module.exports = { makeEditorGate, isEditorRequest, ENABLED };
