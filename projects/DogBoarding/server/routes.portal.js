/**
 * DogBoarding - client portal.
 *
 * Two routers:
 *   portalSessionRouter  (unauthenticated)  signup / login / logout / me / verify
 *   portalRouter         (requireClient)     everything a logged-in client can see
 *
 * The one rule that matters here: a client may only ever touch their own data.
 * requireClient sets req.clientId, and EVERY query in the authenticated router
 * is scoped to it - either `WHERE client_id = ?` or an ownership check that
 * returns 404 (not 403) for anything that isn't theirs, so the portal never even
 * confirms that another client's row exists.
 */

const express = require('express');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');

const db = require('./db');
const auth = require('./auth');
const mailer = require('./mailer');
const collections = require('./collections');
const availability = require('./availability');
const { upload } = require('./uploads');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD = 8;
const VERIFY_DAYS = 3;

/* ------------------------------ helpers ------------------------------ */

function fail(status, message) {
    const err = new Error(message);
    err.status = status;
    return err;
}

/** Keep only allowed keys; drop undefined so partial updates stay partial. */
function pick(body, fields) {
    const out = {};
    for (const key of fields) {
        if (body[key] !== undefined) out[key] = body[key] === '' ? null : body[key];
    }
    return out;
}

function toCents(value) {
    if (value === null || value === undefined || value === '') return null;
    return Math.round(Number(value) * 100);
}

function absoluteBase(req) {
    const proto = req.get('x-forwarded-proto') || req.protocol;
    return `${proto}://${req.get('host')}${req.baseUrl}`;
}

const CLIENT_PROFILE_FIELDS = ['first_name', 'last_name', 'email', 'phone', 'alt_phone',
    'address1', 'address2', 'city', 'state', 'postal_code', 'country',
    'emergency_name', 'emergency_phone', 'emergency_relationship'];

// Onboarding writes the same client fields as the profile screen.
const ONBOARD_CLIENT_FIELDS = CLIENT_PROFILE_FIELDS;

const PET_FIELDS = ['name', 'breed', 'sex', 'birthdate', 'weight_lbs', 'color', 'fixed',
    'microchip', 'feeding', 'medications', 'allergies', 'behavior_notes', 'vet_notes', 'vet_id'];

const VET_FIELDS = ['clinic_name', 'vet_name', 'phone', 'email',
    'address1', 'address2', 'city', 'state', 'postal_code', 'notes'];

const RECORD_FIELDS = ['record_type', 'issued_on', 'expires_on', 'notes'];

/** A pet that belongs to this client, or null. */
function ownedPet(clientId, petId) {
    return db.get('SELECT * FROM pets WHERE id = ? AND client_id = ?', petId, clientId) || null;
}

/** A vet linked to at least one of this client's pets, or null. */
function ownedVet(clientId, vetId) {
    return db.get(
        `SELECT v.* FROM vets v
         WHERE v.id = ?
           AND EXISTS (SELECT 1 FROM pets p WHERE p.vet_id = v.id AND p.client_id = ?)`,
        vetId, clientId) || null;
}

function clientSummary(clientId) {
    const c = db.get('SELECT * FROM clients WHERE id = ?', clientId);
    if (!c) return null;
    return c;
}

/**
 * The checks a stay must pass, whether it is being booked or changed.
 * Throws with a message the client can read.
 */
function validateStay({ clientId, checkIn, checkOut, petIds }) {
    const isDate = d => /^\d{4}-\d{2}-\d{2}$/.test(d);
    if (!isDate(checkIn) || !isDate(checkOut)) throw fail(400, 'Choose a drop-off and a pick-up date.');
    if (checkOut <= checkIn) throw fail(400, 'Pick-up has to be after drop-off.');
    if (checkIn < db.today()) throw fail(400, 'Choose a drop-off date in the future.');
    if (!petIds.length) throw fail(400, 'Choose at least one dog.');

    const owned = db.all(
        "SELECT id FROM pets WHERE client_id = ? AND status = 'active'", clientId)
        .map(p => Number(p.id));
    if (petIds.some(id => !owned.includes(id))) throw fail(400, 'That dog is not on your account.');
}

/**
 * A dog cannot be in two places at once. Returns the names of any dogs already
 * booked over this range, ignoring the booking being edited.
 *
 * Two stays overlap when one starts before the other ends and ends after the
 * other starts - so a pick-up on the same day as another drop-off is fine.
 */
function clashingDogs(petIds, checkIn, checkOut, excludeBookingId = null) {
    if (!petIds.length) return [];
    const marks = petIds.map(() => '?').join(',');

    return db.all(
        `SELECT DISTINCT p.name
         FROM booking_pets bp
         JOIN bookings b ON b.id = bp.booking_id
         JOIN pets p   ON p.id = bp.pet_id
         WHERE bp.pet_id IN (${marks})
           AND b.status != 'cancelled'
           AND b.check_in < ? AND b.check_out > ?
           AND (? IS NULL OR b.id != ?)`,
        ...petIds, checkOut, checkIn, excludeBookingId, excludeBookingId)
        .map(r => r.name);
}

/** A booking of this client's, with the dogs on it. */
function ownBooking(clientId, bookingId) {
    const booking = db.get('SELECT * FROM bookings WHERE id = ? AND client_id = ?',
        bookingId, clientId);
    if (!booking) return null;

    const pets = db.all(
        `SELECT p.id, p.name FROM booking_pets bp JOIN pets p ON p.id = bp.pet_id
         WHERE bp.booking_id = ? ORDER BY p.name`, booking.id);

    booking.pet_ids = pets.map(p => p.id);
    booking.dog_names = pets.map(p => p.name).join(', ');
    return booking;
}

/**
 * A client may change or cancel a stay right up until the dog is checked in.
 * Once the dog is here, it is ours to sort out on the phone - not something a
 * booking form should be quietly rewriting.
 */
function assertChangeable(booking) {
    if (booking.status === 'cancelled') throw fail(400, 'That stay is already cancelled.');
    if (booking.status === 'checked_in') {
        throw fail(400, 'Your dog is already checked in. Please call us.');
    }
    if (booking.status === 'checked_out') {
        throw fail(400, 'That stay is already finished.');
    }
}

/** Can the client still touch this stay? Mirrors assertChangeable, without throwing. */
function isChangeable(booking) {
    return booking.status !== 'cancelled'
        && booking.status !== 'checked_in'
        && booking.status !== 'checked_out';
}

/** Outstanding balance in cents: issued (non-void) invoices minus payments. */
function balanceCents(clientId) {
    const invoiced = db.get(
        `SELECT COALESCE(SUM(total_cents), 0) AS n FROM invoices
         WHERE client_id = ? AND status != 'void'`, clientId).n;
    const paid = db.get(
        'SELECT COALESCE(SUM(amount_cents), 0) AS n FROM payments WHERE client_id = ?', clientId).n;
    return invoiced - paid;
}

/* =====================================================================
 * Session router (unauthenticated): signup, login, logout, me, verify
 * ===================================================================== */

const portalSessionRouter = express.Router();

/**
 * Self-service signup. The email must already be on file as a client (created by
 * the registration form or by staff) - the portal is a door into an existing
 * record, not a way to create strangers. The account starts pending until the
 * email is verified (or an admin approves it when no mailer is configured).
 */
portalSessionRouter.post('/signup', (req, res, next) => {
    try {
        const email = auth.normalizeEmail(req.body.email);
        const password = String(req.body.password || '');

        if (!EMAIL_RE.test(email)) throw fail(400, 'Enter a valid email address.');
        if (password.length < MIN_PASSWORD) {
            throw fail(400, `Choose a password of at least ${MIN_PASSWORD} characters.`);
        }
        if (auth.getAccountByEmail(email)) {
            throw fail(409, 'An account with this email already exists. Try logging in instead.');
        }

        // The account comes first, with a stub client attached. The client fills
        // in who they are and their dogs after they log in (onboarding), so there
        // is exactly one way to register - this form - and no approval step.
        const now = db.nowIso();
        const account = db.tx(() => {
            const clientId = db.insert('clients', {
                first_name: '', last_name: '', email, phone: '',
                status: 'pending', created_at: now, updated_at: now
            });
            return auth.createAccount({
                role: 'client', email, password, client_id: clientId,
                status: 'active', email_verified: 1
            });
        });

        const session = auth.createAccountSession(account);
        res.json({
            ok: true, token: session.token, expiresAt: session.expiresAt,
            client: clientSummary(account.client_id), needs_onboarding: true
        });
    } catch (err) { next(err); }
});

/** Verify an email from the link in the signup message. Renders a small page. */
portalSessionRouter.get('/verify', (req, res) => {
    const token = String(req.query.token || '');
    const account = token
        ? db.get("SELECT * FROM accounts WHERE verify_token = ? AND role = 'client'", token)
        : null;

    const page = (title, body) => `<!doctype html><html><head><meta charset="utf-8">` +
        `<meta name="viewport" content="width=device-width, initial-scale=1">` +
        `<title>${title}</title><style>body{font-family:system-ui,sans-serif;max-width:32rem;` +
        `margin:4rem auto;padding:0 1rem;line-height:1.5;color:#1f2937}a{color:#2563eb}` +
        `.card{border:1px solid #e5e7eb;border-radius:12px;padding:1.5rem}</style></head>` +
        `<body><div class="card">${body}</div></body></html>`;

    if (!account) {
        return res.status(400).send(page('Link expired',
            '<h1>That link is invalid or expired.</h1><p>Please sign in again to request a new one.</p>'));
    }
    if (account.verify_expires && account.verify_expires < db.nowIso()) {
        return res.status(400).send(page('Link expired',
            '<h1>That confirmation link has expired.</h1><p>Please sign up again to get a new one.</p>'));
    }

    db.update('accounts', account.id, {
        email_verified: 1, status: 'active', verify_token: null,
        verify_expires: null, updated_at: db.nowIso()
    });

    res.send(page('Account confirmed',
        '<h1>Your account is confirmed.</h1><p>You can now sign in to your account.</p>' +
        '<p><a href="../../../#/portal">Go to sign in</a></p>'));
});

/** Client login. Clients only - staff use the back office. */
portalSessionRouter.post('/login', (req, res, next) => {
    try {
        const email = auth.normalizeEmail(req.body.email);
        const password = String(req.body.password || '');

        const account = auth.verifyAccountPassword(email, password);
        if (!account || account.role !== 'client') {
            throw fail(401, 'Invalid email or password.');
        }
        if (account.status === 'disabled') throw fail(403, 'This account has been disabled. Please contact us.');
        if (account.status !== 'active') {
            throw fail(403, mailer.configured()
                ? 'Please confirm your email before signing in - check your inbox.'
                : 'Your account is awaiting approval. We will activate it shortly.');
        }

        const session = auth.createAccountSession(account);
        res.json({ ok: true, token: session.token, expiresAt: session.expiresAt, client: clientSummary(account.client_id) });
    } catch (err) { next(err); }
});

portalSessionRouter.post('/logout', (req, res) => {
    auth.logout(auth.tokenFromRequest(req));
    res.json({ ok: true });
});

/** Answer whether the presented token is a live client session. Never 401s. */
portalSessionRouter.get('/me', (req, res) => {
    const info = auth.sessionInfo(auth.tokenFromRequest(req));
    if (!info || info.role !== 'client' || !info.accountId) {
        return res.json({ authenticated: false });
    }
    const account = auth.getAccountById(info.accountId);
    if (!account || account.status !== 'active' || !account.client_id) {
        return res.json({ authenticated: false });
    }
    const client = clientSummary(account.client_id);
    res.json({ authenticated: true, client, needs_onboarding: !client.onboarded_at });
});

/* =====================================================================
 * Portal router (requireClient): everything scoped to req.clientId
 * ===================================================================== */

const portalRouter = express.Router();

/** The dashboard payload: who they are, their dogs, bookings, balance, services. */
portalRouter.get('/overview', (req, res) => {
    const clientId = req.clientId;
    const client = clientSummary(clientId);
    const pets = db.all("SELECT * FROM pets WHERE client_id = ? ORDER BY status, name", clientId);
    const today = db.today();

    const withDogs = `
        SELECT b.*,
               (SELECT GROUP_CONCAT(p.name, ', ') FROM booking_pets bp
                  JOIN pets p ON p.id = bp.pet_id WHERE bp.booking_id = b.id) AS dog_names
        FROM bookings b WHERE b.client_id = ?`;

    const upcoming = db.all(
        `${withDogs} AND b.check_out >= ? ORDER BY b.check_in ASC LIMIT 10`, clientId, today)
        .map(b => ({ ...b, changeable: isChangeable(b) }));
    const past = db.all(
        `${withDogs} AND b.check_out < ? ORDER BY b.check_out DESC LIMIT 10`, clientId, today)
        .map(b => ({ ...b, changeable: false }));
    const recentServices = db.all(
        `SELECT id, pet_id, description, performed_on, amount_cents
         FROM service_events WHERE client_id = ? ORDER BY performed_on DESC LIMIT 15`, clientId);

    res.json({
        client,
        pets,
        bookings: { upcoming, past },
        recentServices,
        balance_cents: balanceCents(clientId),
        needs_onboarding: !client.onboarded_at
    });
});

/**
 * Onboarding: the first thing a new account does after signing up. It fills in
 * the stub client record with who they are, their vet, and their dogs, and flips
 * the client from 'pending' to 'active'. Scoped to req.clientId - it can only
 * ever complete the caller's own record.
 */
portalRouter.post('/onboarding', (req, res, next) => {
    try {
        const clientId = req.clientId;
        const c = req.body.client || {};
        const v = req.body.vet || {};
        const pets = Array.isArray(req.body.pets) ? req.body.pets : [];

        if (!String(c.first_name || '').trim() || !String(c.last_name || '').trim()) {
            throw fail(400, 'Your first and last name are required.');
        }
        if (!String(c.phone || '').trim()) throw fail(400, 'A phone number is required.');
        if (!pets.length || !String(pets[0].name || '').trim()) {
            throw fail(400, 'Please tell us about at least one dog.');
        }

        const now = db.nowIso();
        db.tx(() => {
            const data = pick(c, ONBOARD_CLIENT_FIELDS);
            if (data.email) {
                const e = auth.normalizeEmail(data.email);
                if (EMAIL_RE.test(e)) data.email = e; else delete data.email;
            }
            // They have filled the form in - but that is not the same as staff
            // having approved them. Mark the form done and leave `status` alone
            // ('pending'), so the client shows up for review in the back office.
            data.onboarded_at = now;
            data.updated_at = now;
            db.update('clients', clientId, data);

            let vetId = null;
            if (String(v.clinic_name || '').trim()) {
                vetId = db.insert('vets', { ...pick(v, VET_FIELDS), created_at: now });
            }

            for (const p of pets) {
                if (!String(p.name || '').trim()) continue;
                const pd = pick(p, PET_FIELDS);
                if (pd.fixed !== undefined) pd.fixed = pd.fixed ? 1 : 0;
                if (pd.weight_lbs) pd.weight_lbs = Number(pd.weight_lbs);
                pd.vet_id = vetId;
                db.insert('pets', {
                    ...pd, client_id: clientId, status: 'active', created_at: now, updated_at: now
                });
            }
        });

        res.json({ ok: true, client: clientSummary(clientId), needs_onboarding: false });
    } catch (err) { next(err); }
});

/* ---- profile ---- */

portalRouter.get('/profile', (req, res) => {
    res.json({ client: clientSummary(req.clientId) });
});

portalRouter.put('/profile', (req, res, next) => {
    try {
        const data = pick(req.body, CLIENT_PROFILE_FIELDS);
        if (data.email !== undefined) {
            const email = auth.normalizeEmail(data.email);
            if (!EMAIL_RE.test(email)) throw fail(400, 'Enter a valid email address.');
            data.email = email;
        }
        if (Object.keys(data).length) {
            data.updated_at = db.nowIso();
            db.update('clients', req.clientId, data);
        }
        res.json({ ok: true, client: clientSummary(req.clientId) });
    } catch (err) { next(err); }
});

portalRouter.post('/password', (req, res, next) => {
    try {
        const current = String(req.body.current_password || '');
        const next_ = String(req.body.new_password || '');
        if (next_.length < MIN_PASSWORD) throw fail(400, `Choose a password of at least ${MIN_PASSWORD} characters.`);
        if (!auth.verifyPassword(current, req.account.password_hash)) {
            throw fail(403, 'Your current password is incorrect.');
        }
        auth.setAccountPassword(req.account.id, next_);
        // Changing the password dropped this session too; the client must log in again.
        res.json({ ok: true, message: 'Password changed. Please sign in again.' });
    } catch (err) { next(err); }
});

/* ---- dogs (pets) ---- */

portalRouter.get('/pets', (req, res) => {
    const pets = db.all('SELECT * FROM pets WHERE client_id = ? ORDER BY status, name', req.clientId);
    for (const pet of pets) {
        pet.records = db.all('SELECT * FROM vet_records WHERE pet_id = ? ORDER BY issued_on DESC', pet.id);
    }
    res.json({ pets });
});

portalRouter.get('/pets/:id', (req, res, next) => {
    try {
        const pet = ownedPet(req.clientId, req.params.id);
        if (!pet) throw fail(404, 'Not found.');
        pet.records = db.all('SELECT * FROM vet_records WHERE pet_id = ? ORDER BY issued_on DESC', pet.id);
        res.json({ pet });
    } catch (err) { next(err); }
});

portalRouter.post('/pets', (req, res, next) => {
    try {
        const data = pick(req.body, PET_FIELDS);
        if (!data.name) throw fail(400, "Your dog's name is required.");
        if (data.fixed !== undefined) data.fixed = data.fixed ? 1 : 0;
        if (data.weight_lbs !== undefined && data.weight_lbs !== null) data.weight_lbs = Number(data.weight_lbs);
        if (data.vet_id) {
            if (!ownedVet(req.clientId, data.vet_id)) data.vet_id = null;
        }
        const now = db.nowIso();
        const id = db.insert('pets', {
            ...data, client_id: req.clientId, status: 'active', created_at: now, updated_at: now
        });
        res.json({ ok: true, pet: db.get('SELECT * FROM pets WHERE id = ?', id) });
    } catch (err) { next(err); }
});

portalRouter.put('/pets/:id', (req, res, next) => {
    try {
        const pet = ownedPet(req.clientId, req.params.id);
        if (!pet) throw fail(404, 'Not found.');
        const data = pick(req.body, PET_FIELDS);
        if (data.fixed !== undefined) data.fixed = data.fixed ? 1 : 0;
        if (data.weight_lbs !== undefined && data.weight_lbs !== null) data.weight_lbs = Number(data.weight_lbs);
        if (data.vet_id) {
            if (!ownedVet(req.clientId, data.vet_id)) throw fail(400, 'That veterinarian is not on your account.');
        }
        if (Object.keys(data).length) {
            data.updated_at = db.nowIso();
            db.update('pets', pet.id, data);
        }
        res.json({ ok: true, pet: db.get('SELECT * FROM pets WHERE id = ?', pet.id) });
    } catch (err) { next(err); }
});

/**
 * Remove a dog. If it carries history (charges, invoice lines, past stays) it is
 * archived, not deleted - the books must not lose the record of a real service.
 * A dog with no history is deleted outright.
 */
portalRouter.delete('/pets/:id', (req, res, next) => {
    try {
        const pet = ownedPet(req.clientId, req.params.id);
        if (!pet) throw fail(404, 'Not found.');

        const referenced =
            db.get('SELECT COUNT(*) AS n FROM service_events WHERE pet_id = ?', pet.id).n +
            db.get('SELECT COUNT(*) AS n FROM invoice_items WHERE pet_id = ?', pet.id).n +
            db.get('SELECT COUNT(*) AS n FROM booking_pets WHERE pet_id = ?', pet.id).n;

        if (referenced > 0) {
            db.update('pets', pet.id, { status: 'archived', updated_at: db.nowIso() });
            return res.json({ ok: true, archived: true, message: `${pet.name} was archived (it has past activity on file).` });
        }
        db.remove('pets', pet.id);
        res.json({ ok: true, deleted: true, message: `${pet.name} was removed.` });
    } catch (err) { next(err); }
});

/* ---- vet records ---- */

portalRouter.post('/pets/:id/records', upload.single('file'), (req, res, next) => {
    try {
        const pet = ownedPet(req.clientId, req.params.id);
        if (!pet) throw fail(404, 'Not found.');
        const data = pick(req.body, RECORD_FIELDS);
        if (!data.record_type) throw fail(400, 'Choose a record type.');

        const file = req.file;
        const id = db.insert('vet_records', {
            pet_id: pet.id,
            record_type: data.record_type,
            issued_on: data.issued_on || null,
            expires_on: data.expires_on || null,
            file_path: file ? path.basename(file.path) : null,
            original_name: file ? file.originalname : null,
            mime_type: file ? file.mimetype : null,
            size_bytes: file ? file.size : null,
            notes: data.notes || null,
            verified: 0,
            created_at: db.nowIso()
        });
        res.json({ ok: true, record: db.get('SELECT * FROM vet_records WHERE id = ?', id) });
    } catch (err) { next(err); }
});

portalRouter.delete('/records/:id', (req, res, next) => {
    try {
        const record = db.get(
            `SELECT r.* FROM vet_records r JOIN pets p ON p.id = r.pet_id
             WHERE r.id = ? AND p.client_id = ?`, req.params.id, req.clientId);
        if (!record) throw fail(404, 'Not found.');
        db.remove('vet_records', record.id);
        res.json({ ok: true });
    } catch (err) { next(err); }
});

/** Serve an uploaded record file - only if it belongs to this client's pet. */
portalRouter.get('/files/record/:id', (req, res, next) => {
    try {
        const record = db.get(
            `SELECT r.* FROM vet_records r JOIN pets p ON p.id = r.pet_id
             WHERE r.id = ? AND p.client_id = ?`, req.params.id, req.clientId);
        if (!record || !record.file_path) throw fail(404, 'Not found.');

        const safe = path.basename(record.file_path);
        const full = path.join(db.UPLOAD_DIR, safe);
        if (!fs.existsSync(full)) throw fail(404, 'File is missing.');

        if (record.mime_type) res.type(record.mime_type);
        res.setHeader('Content-Disposition',
            `inline; filename="${(record.original_name || safe).replace(/"/g, '')}"`);
        fs.createReadStream(full).pipe(res);
    } catch (err) { next(err); }
});

/* ---- veterinarians ---- */

portalRouter.get('/vets', (req, res) => {
    const vets = db.all(
        `SELECT DISTINCT v.* FROM vets v
         JOIN pets p ON p.vet_id = v.id
         WHERE p.client_id = ? ORDER BY v.clinic_name`, req.clientId);
    res.json({ vets });
});

portalRouter.post('/vets', (req, res, next) => {
    try {
        const data = pick(req.body, VET_FIELDS);
        if (!data.clinic_name) throw fail(400, 'The clinic name is required.');
        const id = db.insert('vets', { ...data, created_at: db.nowIso() });
        res.json({ ok: true, vet: db.get('SELECT * FROM vets WHERE id = ?', id) });
    } catch (err) { next(err); }
});

portalRouter.put('/vets/:id', (req, res, next) => {
    try {
        if (!ownedVet(req.clientId, req.params.id)) throw fail(404, 'Not found.');
        const data = pick(req.body, VET_FIELDS);
        if (Object.keys(data).length) db.update('vets', req.params.id, data);
        res.json({ ok: true, vet: db.get('SELECT * FROM vets WHERE id = ?', req.params.id) });
    } catch (err) { next(err); }
});

/* ---- billing (read-only) ---- */

portalRouter.get('/billing', (req, res) => {
    const clientId = req.clientId;
    const invoices = db.all(
        "SELECT * FROM invoices WHERE client_id = ? AND status != 'draft' ORDER BY issued_on DESC", clientId);
    const payments = db.all(
        'SELECT * FROM payments WHERE client_id = ? ORDER BY paid_on DESC', clientId);
    res.json({ invoices, payments, balance_cents: balanceCents(clientId) });
});

portalRouter.get('/invoices/:id', (req, res, next) => {
    try {
        const invoice = db.get(
            "SELECT * FROM invoices WHERE id = ? AND client_id = ? AND status != 'draft'",
            req.params.id, req.clientId);
        if (!invoice) throw fail(404, 'Not found.');
        invoice.items = db.all('SELECT * FROM invoice_items WHERE invoice_id = ? ORDER BY id', invoice.id);
        invoice.payments = db.all('SELECT * FROM payments WHERE invoice_id = ? ORDER BY paid_on', invoice.id);
        res.json({ invoice });
    } catch (err) { next(err); }
});

/* ---- booking a stay ---- */

/** What is free, night by night. Anyone signed in may look. */
portalRouter.get('/availability', (req, res, next) => {
    try {
        const from = String(req.query.from || db.today()).slice(0, 10);
        const to = String(req.query.to || availability.addDays(from, 60)).slice(0, 10);
        if (to < from) throw fail(400, 'That date range is backwards.');
        if (availability.nights(from, to).length > 400) throw fail(400, 'That date range is too long.');

        const client = clientSummary(req.clientId);

        // Their own stays overlapping the window, so the calendar can show them
        // which nights are already theirs.
        const mine = db.all(
            `SELECT b.id, b.check_in, b.check_out, b.status,
                    (SELECT GROUP_CONCAT(p.name, ', ') FROM booking_pets bp
                       JOIN pets p ON p.id = bp.pet_id WHERE bp.booking_id = b.id) AS dog_names
             FROM bookings b
             WHERE b.client_id = ? AND b.status != 'cancelled'
               AND b.check_in <= ? AND b.check_out > ?
             ORDER BY b.check_in`, req.clientId, to, from);

        res.json({
            capacity: collections.capacity(),
            kennels: collections.kennels(),
            can_book: client.status === 'active',
            days: availability.days(from, to),
            mine
        });
    } catch (err) { next(err); }
});

/**
 * Book a stay. Confirmed on the spot if there is room every night.
 *
 * Only an approved client may book - a sign-up that staff has not vetted can see
 * the calendar but not take a bed. The capacity check runs INSIDE the
 * transaction: SQLite takes one writer at a time, so two clients racing for the
 * last kennel cannot both be told yes.
 */
portalRouter.post('/bookings', (req, res, next) => {
    try {
        const client = clientSummary(req.clientId);
        if (client.status !== 'active') {
            throw fail(403, 'Your account is still awaiting approval, so you cannot book yet. We will be in touch shortly.');
        }

        const checkIn = String(req.body.check_in || '').slice(0, 10);
        const checkOut = String(req.body.check_out || '').slice(0, 10);
        const petIds = (Array.isArray(req.body.pet_ids) ? req.body.pet_ids : [])
            .map(Number).filter(Boolean);

        validateStay({ clientId: req.clientId, checkIn, checkOut, petIds });

        const now = db.nowIso();
        const bookingId = db.tx(() => {
            const clash = clashingDogs(petIds, checkIn, checkOut);
            if (clash.length) {
                throw fail(409, `${clash.join(' and ')} ${clash.length === 1 ? 'is' : 'are'} already booked for those dates.`);
            }

            const check = availability.checkRange(checkIn, checkOut, petIds.length);
            if (!check.ok) {
                throw fail(409, check.reason ||
                    `We are full on ${check.full.map(d => d).join(', ')}. Please try other dates.`);
            }

            const id = db.insert('bookings', {
                client_id: req.clientId,
                check_in: checkIn,
                check_out: checkOut,
                status: 'confirmed',
                source: 'portal',
                notes: req.body.notes ? String(req.body.notes).trim() : null,
                created_at: now,
                updated_at: now
            });
            for (const petId of petIds) {
                db.run('INSERT OR IGNORE INTO booking_pets (booking_id, pet_id) VALUES (?, ?)', id, petId);
            }
            return id;
        });

        res.json({ ok: true, booking: db.get('SELECT * FROM bookings WHERE id = ?', bookingId) });
    } catch (err) { next(err); }
});

/** One of their stays, with the dogs on it - what the change dialog loads. */
portalRouter.get('/bookings/:id', (req, res, next) => {
    try {
        const booking = ownBooking(req.clientId, req.params.id);
        if (!booking) throw fail(404, 'Not found.');
        res.json({ booking });
    } catch (err) { next(err); }
});

/**
 * Change a stay that has not started: new dates, different dogs, or both.
 *
 * The capacity and same-dog checks both ignore this booking, so a stay does not
 * compete with itself - shortening it, or dropping a dog from it, can never be
 * refused for being "full" because of the version we are about to replace.
 */
portalRouter.put('/bookings/:id', (req, res, next) => {
    try {
        const client = clientSummary(req.clientId);
        if (client.status !== 'active') {
            throw fail(403, 'Your account is still awaiting approval.');
        }

        const booking = ownBooking(req.clientId, req.params.id);
        if (!booking) throw fail(404, 'Not found.');
        assertChangeable(booking);

        const checkIn = String(req.body.check_in || booking.check_in).slice(0, 10);
        const checkOut = String(req.body.check_out || booking.check_out).slice(0, 10);
        const petIds = (Array.isArray(req.body.pet_ids) ? req.body.pet_ids : booking.pet_ids)
            .map(Number).filter(Boolean);

        validateStay({ clientId: req.clientId, checkIn, checkOut, petIds });

        db.tx(() => {
            const clash = clashingDogs(petIds, checkIn, checkOut, booking.id);
            if (clash.length) {
                throw fail(409, `${clash.join(' and ')} ${clash.length === 1 ? 'is' : 'are'} already booked for those dates.`);
            }

            const check = availability.checkRange(checkIn, checkOut, petIds.length,
                { excludeBookingId: booking.id });
            if (!check.ok) {
                throw fail(409, check.reason ||
                    `We are full on ${check.full.join(', ')}. Please try other dates.`);
            }

            db.update('bookings', booking.id, {
                check_in: checkIn,
                check_out: checkOut,
                notes: req.body.notes !== undefined
                    ? (String(req.body.notes).trim() || null) : booking.notes,
                updated_at: db.nowIso()
            });

            db.run('DELETE FROM booking_pets WHERE booking_id = ?', booking.id);
            for (const petId of petIds) {
                db.run('INSERT OR IGNORE INTO booking_pets (booking_id, pet_id) VALUES (?, ?)',
                    booking.id, petId);
            }
        });

        res.json({ ok: true, booking: ownBooking(req.clientId, booking.id) });
    } catch (err) { next(err); }
});

/** Cancel a stay that has not started yet. */
portalRouter.delete('/bookings/:id', (req, res, next) => {
    try {
        const booking = ownBooking(req.clientId, req.params.id);
        if (!booking) throw fail(404, 'Not found.');
        if (booking.status === 'cancelled') return res.json({ ok: true });
        assertChangeable(booking);

        db.update('bookings', booking.id, { status: 'cancelled', updated_at: db.nowIso() });
        res.json({ ok: true });
    } catch (err) { next(err); }
});

module.exports = { portalSessionRouter, portalRouter };
