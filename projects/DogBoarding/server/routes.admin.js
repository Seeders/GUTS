/**
 * DogBoarding - admin API.
 *
 * Everything here sits behind requireAdmin (wired up in server.js). Two routers
 * are exported: `sessionRouter` (login, which obviously cannot require a login)
 * and `adminRouter` (everything else).
 */

const express = require('express');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const db = require('./db');
const auth = require('./auth');
const acct = require('./accounting');
const collections = require('./collections');
const availability = require('./availability');
const { upload } = require('./uploads');

const sessionRouter = express.Router();
const adminRouter = express.Router();

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

function clean(value) {
    if (value === undefined || value === null) return null;
    if (typeof value === 'number') return value;
    const str = String(value).trim();
    return str === '' ? null : str;
}

/** Keep only the fields we allow to be written, so a stray key can't sneak in. */
function pick(body, fields) {
    const out = {};
    for (const field of fields) {
        if (Object.prototype.hasOwnProperty.call(body, field)) {
            out[field] = clean(body[field]);
        }
    }
    return out;
}

function cents(value) {
    const n = Math.round(Number(value));
    return Number.isFinite(n) ? n : 0;
}

function bool(value) {
    return value === true || value === 1 || value === '1' || value === 'true' ? 1 : 0;
}

function fail(status, message) {
    const err = new Error(message);
    err.status = status;
    return err;
}

function nightsBetween(checkIn, checkOut) {
    const ms = new Date(checkOut) - new Date(checkIn);
    return Math.max(1, Math.round(ms / 86400_000));
}

function toCsv(rows) {
    if (!rows.length) return '';
    const headers = Object.keys(rows[0]);
    const escape = v => {
        if (v === null || v === undefined) return '';
        const s = String(v);
        return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    return [
        headers.join(','),
        ...rows.map(r => headers.map(h => escape(r[h])).join(','))
    ].join('\n');
}

/* ------------------------------------------------------------------ */
/* Session                                                             */
/* ------------------------------------------------------------------ */

sessionRouter.post('/login', (req, res) => {
    const password = (req.body && req.body.password) || '';
    const session = auth.login(password);
    if (!session) return res.status(401).json({ error: 'Incorrect password.' });
    res.json(session);
});

sessionRouter.post('/logout', (req, res) => {
    auth.logout(auth.tokenFromRequest(req));
    res.json({ ok: true });
});

sessionRouter.get('/me', (req, res) => {
    res.json({ authenticated: auth.isValidToken(auth.tokenFromRequest(req)) });
});

/* ------------------------------------------------------------------ */
/* Dashboard                                                           */
/* ------------------------------------------------------------------ */

adminRouter.get('/dashboard', (req, res) => {
    const today = db.today();
    const monthStart = today.slice(0, 8) + '01';

    const onSite = db.all(`
        SELECT b.id AS booking_id, b.check_in, b.check_out, bp.kennel,
               p.id AS pet_id, p.name AS pet_name, p.breed,
               c.id AS client_id, c.first_name, c.last_name, c.phone
        FROM bookings b
        JOIN booking_pets bp ON bp.booking_id = b.id
        JOIN pets p    ON p.id = bp.pet_id
        JOIN clients c ON c.id = b.client_id
        WHERE b.status = 'checked_in'
        ORDER BY p.name`);

    const arrivingToday = db.all(`
        SELECT b.id, b.check_in, b.check_out, b.status,
               c.first_name, c.last_name, c.phone,
               (SELECT COUNT(*) FROM booking_pets bp WHERE bp.booking_id = b.id) AS dogs
        FROM bookings b JOIN clients c ON c.id = b.client_id
        WHERE b.check_in = ? AND b.status IN ('confirmed', 'requested')
        ORDER BY c.last_name`, today);

    const departingToday = db.all(`
        SELECT b.id, b.check_in, b.check_out, b.status,
               c.first_name, c.last_name, c.phone,
               (SELECT COUNT(*) FROM booking_pets bp WHERE bp.booking_id = b.id) AS dogs
        FROM bookings b JOIN clients c ON c.id = b.client_id
        WHERE b.check_out = ? AND b.status = 'checked_in'
        ORDER BY c.last_name`, today);

    const pendingClients = db.get(
        "SELECT COUNT(*) AS n FROM clients WHERE status = 'pending'").n;

    const requestedBookings = db.get(
        "SELECT COUNT(*) AS n FROM bookings WHERE status = 'requested'").n;

    const ar = acct.arAging(today);
    const pnl = acct.profitAndLoss(monthStart, today);
    const vaccines = acct.vaccinationAlerts();

    const unbilled = db.get(`
        SELECT COALESCE(SUM(amount_cents), 0) AS v, COUNT(*) AS n
        FROM service_events WHERE invoice_id IS NULL`);

    res.json({
        today,
        on_site: onSite,
        arriving_today: arrivingToday,
        departing_today: departingToday,
        pending_clients: pendingClients,
        requested_bookings: requestedBookings,
        unbilled_cents: unbilled.v,
        unbilled_count: unbilled.n,
        ar_total_cents: ar.total_cents,
        month: {
            from: monthStart,
            to: today,
            billed_cents: pnl.billed_cents,
            collected_cents: pnl.collected_cents,
            expenses_cents: pnl.expenses_cents,
            net_cash_cents: pnl.net_cash_cents
        },
        vaccine_alerts: vaccines.alerts.slice(0, 20),
        vaccine_alert_count: vaccines.alerts.length
    });
});

/* ------------------------------------------------------------------ */
/* Settings                                                            */
/* ------------------------------------------------------------------ */

/** Everything the server reads out of the GUTS collections, for inspection. */
adminRouter.get('/collections', (req, res) => {
    res.json({
        serviceCatalog: collections.serviceCatalog(),
        recordTypes: collections.recordTypes(),
        expenseCategories: collections.expenseCategories(),
        paymentMethods: collections.paymentMethods(),
        bookingStatuses: collections.bookingStatuses(),
        serviceUnits: collections.serviceUnits(),
        requiredVaccines: collections.requiredVaccines()
    });
});

/**
 * The business config, for display.
 *
 * It is not written here. It is a config object in the collections, edited in
 * the GUTS editor like everything else that is not client data. There is no PUT:
 * having two ways to change the same thing is what got us a rate card that
 * ignored the rate card.
 */
adminRouter.get('/settings', (req, res) => {
    res.json({
        business: collections.business(),
        editedIn: 'collections/settings/configs/business.json'
    });
});

adminRouter.post('/settings/password', (req, res, next) => {
    const { current_password: current, new_password: next_ } = req.body || {};
    if (!auth.verifyPassword(current || '', db.getSetting('admin_password_hash'))) {
        return next(fail(401, 'Current password is incorrect.'));
    }
    if (!next_ || String(next_).length < 8) {
        return next(fail(400, 'New password must be at least 8 characters.'));
    }
    auth.setAdminPassword(String(next_));
    res.json({ ok: true, message: 'Password changed. Everyone has been logged out.' });
});

/* ------------------------------------------------------------------ */
/* Clients                                                             */
/* ------------------------------------------------------------------ */

const CLIENT_FIELDS = [
    'first_name', 'last_name', 'email', 'phone', 'alt_phone',
    'address1', 'address2', 'city', 'state', 'postal_code', 'country',
    'emergency_name', 'emergency_phone', 'emergency_relationship',
    'notes', 'status'
];

adminRouter.get('/clients', (req, res) => {
    const { query, status } = req.query;
    const where = [];
    const params = [];

    if (status) { where.push('c.status = ?'); params.push(status); }
    if (query) {
        where.push(`(c.first_name LIKE ? OR c.last_name LIKE ? OR c.email LIKE ?
                     OR c.phone LIKE ? OR EXISTS (
                        SELECT 1 FROM pets p WHERE p.client_id = c.id AND p.name LIKE ?))`);
        const like = `%${query}%`;
        params.push(like, like, like, like, like);
    }

    const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const clients = db.all(`
        SELECT c.*,
               (SELECT COUNT(*) FROM pets p WHERE p.client_id = c.id AND p.status = 'active') AS pet_count,
               (SELECT GROUP_CONCAT(p.name, ', ') FROM pets p
                 WHERE p.client_id = c.id AND p.status = 'active') AS pet_names
        FROM clients c ${clause}
        ORDER BY c.status = 'pending' DESC, c.last_name, c.first_name`, ...params);

    res.json(clients.map(c => ({ ...c, balance: acct.clientBalance(c.id) })));
});

adminRouter.post('/clients', (req, res, next) => {
    const data = pick(req.body, CLIENT_FIELDS);
    if (!data.first_name || !data.last_name) return next(fail(400, 'First and last name are required.'));
    if (!data.email) return next(fail(400, 'An email address is required.'));
    if (!data.phone) return next(fail(400, 'A phone number is required.'));

    const stamp = db.nowIso();
    const id = db.insert('clients', {
        ...data,
        status: data.status || 'active',
        created_at: stamp,
        updated_at: stamp
    });
    res.status(201).json(db.get('SELECT * FROM clients WHERE id = ?', id));
});

adminRouter.get('/clients/:id', (req, res, next) => {
    const id = Number(req.params.id);
    const client = db.get('SELECT * FROM clients WHERE id = ?', id);
    if (!client) return next(fail(404, 'Client not found.'));

    const pets = db.all(`
        SELECT p.*, v.clinic_name, v.vet_name, v.phone AS vet_phone
        FROM pets p LEFT JOIN vets v ON v.id = p.vet_id
        WHERE p.client_id = ? ORDER BY p.status, p.name`, id);

    for (const pet of pets) {
        pet.records = db.all(
            'SELECT * FROM vet_records WHERE pet_id = ? ORDER BY expires_on DESC, id DESC', pet.id);
    }

    const bookings = db.all(`
        SELECT b.*,
               (SELECT GROUP_CONCAT(p.name, ', ') FROM booking_pets bp
                  JOIN pets p ON p.id = bp.pet_id WHERE bp.booking_id = b.id) AS pet_names
        FROM bookings b WHERE b.client_id = ?
        ORDER BY b.check_in DESC`, id);

    const invoices = db.all(`
        SELECT i.*,
               COALESCE((SELECT SUM(p.amount_cents) FROM payments p WHERE p.invoice_id = i.id), 0) AS paid_cents
        FROM invoices i WHERE i.client_id = ? ORDER BY i.issued_on DESC, i.id DESC`, id);

    const payments = db.all(`
        SELECT p.*, i.number AS invoice_number
        FROM payments p LEFT JOIN invoices i ON i.id = p.invoice_id
        WHERE p.client_id = ? ORDER BY p.paid_on DESC, p.id DESC`, id);

    const services = db.all(`
        SELECT se.*, pe.name AS pet_name, i.number AS invoice_number
        FROM service_events se
        JOIN pets pe ON pe.id = se.pet_id
        LEFT JOIN invoices i ON i.id = se.invoice_id
        WHERE se.client_id = ? ORDER BY se.performed_on DESC, se.id DESC`, id);

    const vets = db.all(`
        SELECT DISTINCT v.* FROM vets v
        JOIN pets p ON p.vet_id = v.id WHERE p.client_id = ?`, id);

    res.json({
        ...client,
        pets, bookings, invoices, payments, services, vets,
        balance: acct.clientBalance(id)
    });
});

adminRouter.put('/clients/:id', (req, res, next) => {
    const id = Number(req.params.id);
    if (!db.get('SELECT id FROM clients WHERE id = ?', id)) return next(fail(404, 'Client not found.'));

    const data = pick(req.body, CLIENT_FIELDS);
    data.updated_at = db.nowIso();
    db.update('clients', id, data);
    res.json(db.get('SELECT * FROM clients WHERE id = ?', id));
});

/**
 * Deleting a client cascades to their dogs, records, invoices and payments. That
 * is fine for someone who filled in the form and never showed up, and completely
 * unacceptable for anyone who has ever paid us: it would erase money we have
 * actually received from the books. Once there is financial history, archiving
 * is the only way out.
 */
adminRouter.delete('/clients/:id', (req, res, next) => {
    const id = Number(req.params.id);

    const invoices = db.get(
        'SELECT COUNT(*) AS n FROM invoices WHERE client_id = ?', id).n;
    const payments = db.get(
        'SELECT COUNT(*) AS n FROM payments WHERE client_id = ?', id).n;

    if (invoices > 0 || payments > 0) {
        return next(fail(409,
            'This client has billing history, so deleting them would tear a hole in the books. ' +
            'Set them to archived instead.'));
    }

    db.remove('clients', id);
    res.json({ ok: true });
});

/* ------------------------------------------------------------------ */
/* Vets                                                                */
/* ------------------------------------------------------------------ */

const VET_FIELDS = ['clinic_name', 'vet_name', 'phone', 'email',
    'address1', 'address2', 'city', 'state', 'postal_code', 'notes'];

adminRouter.get('/vets', (req, res) => {
    res.json(db.all(`
        SELECT v.*, (SELECT COUNT(*) FROM pets p WHERE p.vet_id = v.id) AS pet_count
        FROM vets v ORDER BY v.clinic_name`));
});

adminRouter.post('/vets', (req, res, next) => {
    const data = pick(req.body, VET_FIELDS);
    if (!data.clinic_name) return next(fail(400, 'Clinic name is required.'));
    const id = db.insert('vets', { ...data, created_at: db.nowIso() });
    res.status(201).json(db.get('SELECT * FROM vets WHERE id = ?', id));
});

adminRouter.put('/vets/:id', (req, res, next) => {
    const id = Number(req.params.id);
    if (!db.get('SELECT id FROM vets WHERE id = ?', id)) return next(fail(404, 'Vet not found.'));
    db.update('vets', id, pick(req.body, VET_FIELDS));
    res.json(db.get('SELECT * FROM vets WHERE id = ?', id));
});

adminRouter.delete('/vets/:id', (req, res) => {
    db.remove('vets', Number(req.params.id));
    res.json({ ok: true });
});

/* ------------------------------------------------------------------ */
/* Pets                                                                */
/* ------------------------------------------------------------------ */

const PET_FIELDS = ['client_id', 'vet_id', 'name', 'breed', 'sex', 'birthdate',
    'weight_lbs', 'color', 'microchip', 'feeding', 'medications', 'allergies',
    'behavior_notes', 'vet_notes', 'status'];

adminRouter.get('/pets', (req, res) => {
    const { client_id: clientId, query } = req.query;
    const where = [];
    const params = [];

    if (clientId) { where.push('p.client_id = ?'); params.push(Number(clientId)); }
    if (query) { where.push('(p.name LIKE ? OR p.breed LIKE ?)'); params.push(`%${query}%`, `%${query}%`); }

    const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';

    res.json(db.all(`
        SELECT p.*, c.first_name, c.last_name, v.clinic_name
        FROM pets p
        JOIN clients c ON c.id = p.client_id
        LEFT JOIN vets v ON v.id = p.vet_id
        ${clause}
        ORDER BY p.name`, ...params));
});

adminRouter.get('/pets/:id', (req, res, next) => {
    const id = Number(req.params.id);
    const pet = db.get(`
        SELECT p.*, c.first_name, c.last_name, c.phone, c.email,
               v.clinic_name, v.vet_name, v.phone AS vet_phone, v.email AS vet_email,
               v.address1 AS vet_address1, v.city AS vet_city, v.state AS vet_state,
               v.postal_code AS vet_postal_code
        FROM pets p
        JOIN clients c ON c.id = p.client_id
        LEFT JOIN vets v ON v.id = p.vet_id
        WHERE p.id = ?`, id);
    if (!pet) return next(fail(404, 'Dog not found.'));

    pet.records = db.all(
        'SELECT * FROM vet_records WHERE pet_id = ? ORDER BY expires_on DESC, id DESC', id);
    pet.services = db.all(`
        SELECT se.*, i.number AS invoice_number
        FROM service_events se LEFT JOIN invoices i ON i.id = se.invoice_id
        WHERE se.pet_id = ? ORDER BY se.performed_on DESC, se.id DESC`, id);
    pet.bookings = db.all(`
        SELECT b.* FROM bookings b
        JOIN booking_pets bp ON bp.booking_id = b.id
        WHERE bp.pet_id = ? ORDER BY b.check_in DESC`, id);

    res.json(pet);
});

adminRouter.post('/pets', (req, res, next) => {
    const data = pick(req.body, PET_FIELDS);
    if (!data.client_id) return next(fail(400, 'A dog must belong to a client.'));
    if (!data.name) return next(fail(400, "The dog's name is required."));

    const stamp = db.nowIso();
    const id = db.insert('pets', {
        ...data,
        client_id: Number(data.client_id),
        vet_id: data.vet_id ? Number(data.vet_id) : null,
        weight_lbs: data.weight_lbs ? Number(data.weight_lbs) : null,
        fixed: bool(req.body.fixed),
        status: data.status || 'active',
        created_at: stamp,
        updated_at: stamp
    });
    res.status(201).json(db.get('SELECT * FROM pets WHERE id = ?', id));
});

adminRouter.put('/pets/:id', (req, res, next) => {
    const id = Number(req.params.id);
    if (!db.get('SELECT id FROM pets WHERE id = ?', id)) return next(fail(404, 'Dog not found.'));

    const data = pick(req.body, PET_FIELDS);
    if (Object.prototype.hasOwnProperty.call(req.body, 'fixed')) data.fixed = bool(req.body.fixed);
    if (data.vet_id) data.vet_id = Number(data.vet_id);
    if (data.weight_lbs) data.weight_lbs = Number(data.weight_lbs);
    data.updated_at = db.nowIso();

    db.update('pets', id, data);
    res.json(db.get('SELECT * FROM pets WHERE id = ?', id));
});

adminRouter.delete('/pets/:id', (req, res, next) => {
    const id = Number(req.params.id);
    const billed = db.get(
        'SELECT COUNT(*) AS n FROM service_events WHERE pet_id = ? AND invoice_id IS NOT NULL', id).n;
    if (billed > 0) {
        return next(fail(409,
            'This dog appears on invoices. Set the dog to inactive rather than deleting the history.'));
    }
    db.remove('pets', id);
    res.json({ ok: true });
});

/* ------------------------------------------------------------------ */
/* Vet records                                                         */
/* ------------------------------------------------------------------ */

const RECORD_FIELDS = ['record_type', 'issued_on', 'expires_on', 'notes'];

adminRouter.post('/pets/:id/records', upload.single('file'), (req, res, next) => {
    const petId = Number(req.params.id);
    if (!db.get('SELECT id FROM pets WHERE id = ?', petId)) return next(fail(404, 'Dog not found.'));

    const data = pick(req.body, RECORD_FIELDS);
    if (!data.record_type) return next(fail(400, 'What kind of record is this?'));

    const file = req.file;
    const id = db.insert('vet_records', {
        pet_id: petId,
        record_type: data.record_type,
        issued_on: data.issued_on,
        expires_on: data.expires_on,
        notes: data.notes,
        file_path: file ? file.filename : null,
        original_name: file ? file.originalname : null,
        mime_type: file ? file.mimetype : null,
        size_bytes: file ? file.size : null,
        verified: bool(req.body.verified),
        created_at: db.nowIso()
    });

    res.status(201).json(db.get('SELECT * FROM vet_records WHERE id = ?', id));
});

adminRouter.put('/records/:id', (req, res, next) => {
    const id = Number(req.params.id);
    if (!db.get('SELECT id FROM vet_records WHERE id = ?', id)) return next(fail(404, 'Record not found.'));

    const data = pick(req.body, RECORD_FIELDS);
    if (Object.prototype.hasOwnProperty.call(req.body, 'verified')) {
        data.verified = bool(req.body.verified);
    }
    db.update('vet_records', id, data);
    res.json(db.get('SELECT * FROM vet_records WHERE id = ?', id));
});

adminRouter.delete('/records/:id', (req, res) => {
    const id = Number(req.params.id);
    const record = db.get('SELECT file_path FROM vet_records WHERE id = ?', id);

    if (record && record.file_path) {
        const full = path.join(db.UPLOAD_DIR, path.basename(record.file_path));
        fs.rm(full, { force: true }, () => {});
    }
    db.remove('vet_records', id);
    res.json({ ok: true });
});

/* ------------------------------------------------------------------ */
/* Protected file serving                                              */
/* ------------------------------------------------------------------ */

function sendStoredFile(res, next, storedName, downloadName, mime) {
    if (!storedName) return next(fail(404, 'No file attached to this record.'));

    // basename() so a crafted row can never walk out of the upload directory.
    const full = path.join(db.UPLOAD_DIR, path.basename(storedName));
    if (!fs.existsSync(full)) return next(fail(404, 'The stored file is missing from disk.'));

    if (mime) res.type(mime);
    res.setHeader('Content-Disposition',
        `inline; filename="${(downloadName || 'record').replace(/"/g, '')}"`);
    res.sendFile(full);
}

adminRouter.get('/files/record/:id', (req, res, next) => {
    const record = db.get('SELECT * FROM vet_records WHERE id = ?', Number(req.params.id));
    if (!record) return next(fail(404, 'Record not found.'));
    sendStoredFile(res, next, record.file_path, record.original_name, record.mime_type);
});

adminRouter.get('/files/receipt/:id', (req, res, next) => {
    const expense = db.get('SELECT * FROM expenses WHERE id = ?', Number(req.params.id));
    if (!expense) return next(fail(404, 'Expense not found.'));
    sendStoredFile(res, next, expense.receipt_path, expense.receipt_name, null);
});

/* ------------------------------------------------------------------ */
/* Bookings                                                            */
/* ------------------------------------------------------------------ */

// The statuses a booking may hold are the bookingStatuses collection.
const bookingStatusIds = () => collections.ids(collections.bookingStatuses());

adminRouter.get('/bookings', (req, res) => {
    const { status, from, to, client_id: clientId } = req.query;
    const where = [];
    const params = [];

    if (status) { where.push('b.status = ?'); params.push(status); }
    if (clientId) { where.push('b.client_id = ?'); params.push(Number(clientId)); }
    if (from) { where.push('b.check_out >= ?'); params.push(from); }
    if (to) { where.push('b.check_in <= ?'); params.push(to); }

    const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';

    res.json(db.all(`
        SELECT b.*, c.first_name, c.last_name, c.phone,
               (SELECT GROUP_CONCAT(p.name, ', ') FROM booking_pets bp
                  JOIN pets p ON p.id = bp.pet_id WHERE bp.booking_id = b.id) AS pet_names,
               (SELECT COUNT(*) FROM booking_pets bp WHERE bp.booking_id = b.id) AS dogs,
               (SELECT COUNT(*) FROM service_events se WHERE se.booking_id = b.id) AS charge_count,
               (SELECT COALESCE(SUM(se.amount_cents), 0) FROM service_events se
                  WHERE se.booking_id = b.id) AS charged_cents
        FROM bookings b JOIN clients c ON c.id = b.client_id
        ${clause}
        ORDER BY b.check_in DESC, b.id DESC`, ...params));
});

adminRouter.get('/bookings/:id', (req, res, next) => {
    const id = Number(req.params.id);
    const booking = db.get(`
        SELECT b.*, c.first_name, c.last_name, c.phone, c.email
        FROM bookings b JOIN clients c ON c.id = b.client_id WHERE b.id = ?`, id);
    if (!booking) return next(fail(404, 'Booking not found.'));

    booking.pets = db.all(`
        SELECT p.*, bp.kennel FROM booking_pets bp
        JOIN pets p ON p.id = bp.pet_id WHERE bp.booking_id = ?`, id);

    booking.charges = db.all(`
        SELECT se.*, p.name AS pet_name FROM service_events se
        JOIN pets p ON p.id = se.pet_id
        WHERE se.booking_id = ? ORDER BY se.performed_on, se.id`, id);

    booking.nights = nightsBetween(booking.check_in, booking.check_out);
    res.json(booking);
});

adminRouter.post('/bookings', (req, res, next) => {
    const { client_id: clientId, check_in: checkIn, check_out: checkOut, notes, status } = req.body || {};
    const petIds = Array.isArray(req.body.pet_ids) ? req.body.pet_ids.map(Number) : [];

    if (!clientId) return next(fail(400, 'Which client is this booking for?'));
    if (!checkIn || !checkOut) return next(fail(400, 'Check-in and check-out dates are required.'));
    if (checkOut < checkIn) return next(fail(400, 'Check-out cannot be before check-in.'));
    if (petIds.length === 0) return next(fail(400, 'A booking needs at least one dog.'));

    // Staff are warned, not stopped: the owner is often standing there with the
    // paperwork. Send override:true to book anyway.
    if (!req.body.override) {
        const blockers = acct.vaccinationBlockers(petIds, checkOut);
        if (blockers.length) {
            return res.status(409).json({
                error: acct.vaccinationBlockerMessage(blockers),
                vaccination_blockers: blockers,
                overridable: true
            });
        }
    }

    const stamp = db.nowIso();
    const id = db.tx(() => {
        const bookingId = db.insert('bookings', {
            client_id: Number(clientId),
            check_in: checkIn,
            check_out: checkOut,
            status: bookingStatusIds().includes(status) ? status : 'confirmed',
            source: 'admin',
            notes: clean(notes),
            created_at: stamp,
            updated_at: stamp
        });
        for (const petId of petIds) {
            db.run('INSERT OR IGNORE INTO booking_pets (booking_id, pet_id) VALUES (?, ?)',
                bookingId, petId);
        }
        return bookingId;
    });

    res.status(201).json(db.get('SELECT * FROM bookings WHERE id = ?', id));
});

adminRouter.put('/bookings/:id', (req, res, next) => {
    const id = Number(req.params.id);
    const booking = db.get('SELECT * FROM bookings WHERE id = ?', id);
    if (!booking) return next(fail(404, 'Booking not found.'));

    const data = pick(req.body, ['check_in', 'check_out', 'status', 'notes']);
    if (data.status && !bookingStatusIds().includes(data.status)) {
        return next(fail(400, `Unknown booking status: ${data.status}`));
    }
    data.updated_at = db.nowIso();

    db.tx(() => {
        db.update('bookings', id, data);

        if (Array.isArray(req.body.pet_ids)) {
            db.run('DELETE FROM booking_pets WHERE booking_id = ?', id);
            for (const petId of req.body.pet_ids.map(Number)) {
                db.run('INSERT OR IGNORE INTO booking_pets (booking_id, pet_id) VALUES (?, ?)',
                    id, petId);
            }
        }

        if (req.body.kennels && typeof req.body.kennels === 'object') {
            // A kennel is one bed for one dog, so it cannot hold two dogs on the
            // same night. Read the dates back AFTER the update above, so moving a
            // booking and its kennel in one request is checked against the new dates.
            const known = new Set(collections.kennels().map(k => k.name));
            const stay = db.get('SELECT check_in, check_out FROM bookings WHERE id = ?', id);

            for (const [petId, raw] of Object.entries(req.body.kennels)) {
                const kennel = clean(raw);

                if (kennel && !known.has(kennel)) {
                    throw fail(400, `There is no kennel called "${kennel}".`);
                }

                if (kennel) {
                    const taken = db.get(
                        `SELECT p.name AS dog
                         FROM booking_pets bp
                         JOIN bookings b ON b.id = bp.booking_id
                         JOIN pets p     ON p.id = bp.pet_id
                         WHERE bp.kennel = ?
                           AND b.status != 'cancelled'
                           AND b.check_in < ? AND b.check_out > ?
                           AND NOT (bp.booking_id = ? AND bp.pet_id = ?)
                         LIMIT 1`,
                        kennel, stay.check_out, stay.check_in, id, Number(petId));

                    if (taken) {
                        throw fail(409, `${kennel} is already taken by ${taken.dog} on those nights.`);
                    }
                }

                db.run('UPDATE booking_pets SET kennel = ? WHERE booking_id = ? AND pet_id = ?',
                    kennel, id, Number(petId));
            }
        }
    });

    res.json(db.get('SELECT * FROM bookings WHERE id = ?', id));
});

adminRouter.delete('/bookings/:id', (req, res, next) => {
    const id = Number(req.params.id);
    const charged = db.get(
        'SELECT COUNT(*) AS n FROM service_events WHERE booking_id = ? AND invoice_id IS NOT NULL', id).n;
    if (charged > 0) {
        return next(fail(409, 'This booking has invoiced charges. Cancel it instead of deleting it.'));
    }
    db.remove('bookings', id);
    res.json({ ok: true });
});

/**
 * Turn a stay into money: one charge line per dog per service.
 *
 * For per-night services the quantity is the number of nights, so a 4-night
 * stay for 2 dogs becomes 2 lines of qty 4 - which is exactly how it should
 * read on the invoice.
 */
adminRouter.post('/bookings/:id/charges', (req, res, next) => {
    const id = Number(req.params.id);
    const booking = db.get('SELECT * FROM bookings WHERE id = ?', id);
    if (!booking) return next(fail(404, 'Booking not found.'));

    // A service id is now its name in the collection ("nailTrim"), not a row id.
    const serviceId = clean(req.body.service_id);
    const service = collections.service(serviceId);
    if (!service) return next(fail(400, 'Pick a service to charge.'));

    const requested = Array.isArray(req.body.pet_ids) && req.body.pet_ids.length
        ? req.body.pet_ids.map(Number)
        : db.all('SELECT pet_id FROM booking_pets WHERE booking_id = ?', id).map(r => r.pet_id);

    if (requested.length === 0) return next(fail(400, 'This booking has no dogs on it.'));

    const nights = nightsBetween(booking.check_in, booking.check_out);

    // Whether a service multiplies by the nights stayed is a property of its
    // unit - see the serviceUnits collection.
    const units = collections.load('data', 'serviceUnits');
    const perNight = !!units[service.unit]?.perNight;

    const qty = perNight ? nights : (Number(req.body.qty) || 1);
    const unitPrice = req.body.unit_price_cents !== undefined
        ? cents(req.body.unit_price_cents)
        : service.price_cents;

    const created = [];
    const skipped = [];
    const stamp = db.nowIso();

    db.tx(() => {
        for (const petId of requested) {
            const existing = db.get(`
                SELECT id FROM service_events
                WHERE booking_id = ? AND pet_id = ? AND service_id = ?`, id, petId, serviceId);

            if (existing) {
                skipped.push(petId);
                continue;
            }

            const eventId = db.insert('service_events', {
                client_id: booking.client_id,
                pet_id: petId,
                booking_id: id,
                service_id: serviceId,
                invoice_id: null,
                description: service.name,
                performed_on: booking.check_in,
                qty,
                unit_price_cents: unitPrice,
                amount_cents: acct.lineAmount(qty, unitPrice),
                taxable: service.taxable,
                staff: clean(req.body.staff),
                notes: clean(req.body.notes),
                created_at: stamp
            });
            created.push(eventId);
        }
    });

    res.status(201).json({
        created: created.length,
        skipped: skipped.length,
        message: skipped.length
            ? `Added ${created.length} charge(s). Skipped ${skipped.length} dog(s) already charged for this service on this booking.`
            : `Added ${created.length} charge(s).`
    });
});

/* ------------------------------------------------------------------ */
/* Services catalog                                                    */
/* ------------------------------------------------------------------ */

const SERVICE_FIELDS = ['code', 'name', 'description', 'unit'];

/**
 * The rate card. Read-only, because it is not ours to write: it is the
 * serviceCatalog collection, edited in the GUTS editor.
 *
 * There used to be a services table here, and create/update/delete routes to go
 * with it. That was a second copy of the collection, and it drifted: editing a
 * price in the editor changed nothing, because the app was reading the copy.
 */
adminRouter.get('/services', (req, res) => {
    res.json(collections.services({ includeInactive: req.query.all === '1' }));
});

/* ------------------------------------------------------------------ */
/* Service events (the service log)                                    */
/* ------------------------------------------------------------------ */

adminRouter.get('/service-events', (req, res) => {
    const { client_id: clientId, pet_id: petId, from, to, unbilled } = req.query;
    const where = [];
    const params = [];

    if (clientId) { where.push('se.client_id = ?'); params.push(Number(clientId)); }
    if (petId) { where.push('se.pet_id = ?'); params.push(Number(petId)); }
    if (from) { where.push('se.performed_on >= ?'); params.push(from); }
    if (to) { where.push('se.performed_on <= ?'); params.push(to); }
    if (unbilled === '1') where.push('se.invoice_id IS NULL');

    const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';

    res.json(db.all(`
        SELECT se.*, p.name AS pet_name, c.first_name, c.last_name, i.number AS invoice_number
        FROM service_events se
        JOIN pets p    ON p.id = se.pet_id
        JOIN clients c ON c.id = se.client_id
        LEFT JOIN invoices i ON i.id = se.invoice_id
        ${clause}
        ORDER BY se.performed_on DESC, se.id DESC`, ...params));
});

adminRouter.post('/service-events', (req, res, next) => {
    const petId = Number(req.body.pet_id);
    const pet = db.get('SELECT * FROM pets WHERE id = ?', petId);
    if (!pet) return next(fail(400, 'Which dog was this service for?'));

    const service = req.body.service_id
        ? collections.service(clean(req.body.service_id))
        : null;

    const description = clean(req.body.description) || (service && service.name);
    if (!description) return next(fail(400, 'Describe the service.'));

    const qty = Number(req.body.qty) || 1;
    const unitPrice = req.body.unit_price_cents !== undefined
        ? cents(req.body.unit_price_cents)
        : (service ? service.price_cents : 0);

    const id = db.insert('service_events', {
        client_id: pet.client_id,
        pet_id: petId,
        booking_id: req.body.booking_id ? Number(req.body.booking_id) : null,
        service_id: service ? service.id : null,
        invoice_id: null,
        description,
        performed_on: clean(req.body.performed_on) || db.today(),
        qty,
        unit_price_cents: unitPrice,
        amount_cents: acct.lineAmount(qty, unitPrice),
        taxable: service ? service.taxable : bool(req.body.taxable ?? 1),
        staff: clean(req.body.staff),
        notes: clean(req.body.notes),
        created_at: db.nowIso()
    });

    res.status(201).json(db.get('SELECT * FROM service_events WHERE id = ?', id));
});

adminRouter.put('/service-events/:id', (req, res, next) => {
    const id = Number(req.params.id);
    const event = db.get('SELECT * FROM service_events WHERE id = ?', id);
    if (!event) return next(fail(404, 'Charge not found.'));
    if (event.invoice_id) {
        return next(fail(409,
            'This charge is already on an invoice. Void the invoice first if it needs to change.'));
    }

    const data = pick(req.body, ['description', 'performed_on', 'staff', 'notes']);
    const qty = req.body.qty !== undefined ? Number(req.body.qty) : event.qty;
    const unitPrice = req.body.unit_price_cents !== undefined
        ? cents(req.body.unit_price_cents) : event.unit_price_cents;

    data.qty = qty;
    data.unit_price_cents = unitPrice;
    data.amount_cents = acct.lineAmount(qty, unitPrice);
    if (req.body.taxable !== undefined) data.taxable = bool(req.body.taxable);

    db.update('service_events', id, data);
    res.json(db.get('SELECT * FROM service_events WHERE id = ?', id));
});

adminRouter.delete('/service-events/:id', (req, res, next) => {
    const id = Number(req.params.id);
    const event = db.get('SELECT invoice_id FROM service_events WHERE id = ?', id);
    if (!event) return next(fail(404, 'Charge not found.'));
    if (event.invoice_id) {
        return next(fail(409, 'This charge is on an invoice. Void the invoice first.'));
    }
    db.remove('service_events', id);
    res.json({ ok: true });
});

/* ------------------------------------------------------------------ */
/* Invoices                                                            */
/* ------------------------------------------------------------------ */

adminRouter.get('/invoices', (req, res) => {
    const { status, client_id: clientId } = req.query;
    const where = [];
    const params = [];

    if (status) { where.push('i.status = ?'); params.push(status); }
    if (clientId) { where.push('i.client_id = ?'); params.push(Number(clientId)); }

    const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';

    res.json(db.all(`
        SELECT i.*, c.first_name, c.last_name, c.email,
               COALESCE((SELECT SUM(p.amount_cents) FROM payments p WHERE p.invoice_id = i.id), 0) AS paid_cents
        FROM invoices i JOIN clients c ON c.id = i.client_id
        ${clause}
        ORDER BY i.issued_on DESC, i.id DESC`, ...params));
});

/** What could we bill right now, and for whom. */
adminRouter.get('/invoices/billable', (req, res) => {
    res.json(db.all(`
        SELECT c.id AS client_id, c.first_name, c.last_name,
               COUNT(se.id) AS event_count,
               SUM(se.amount_cents) AS amount_cents,
               MIN(se.performed_on) AS oldest,
               MAX(se.performed_on) AS newest
        FROM service_events se
        JOIN clients c ON c.id = se.client_id
        WHERE se.invoice_id IS NULL
        GROUP BY c.id
        ORDER BY amount_cents DESC`));
});

adminRouter.get('/invoices/:id', (req, res, next) => {
    const invoice = acct.invoiceDetail(Number(req.params.id));
    if (!invoice) return next(fail(404, 'Invoice not found.'));
    res.json(invoice);
});

adminRouter.post('/invoices', (req, res, next) => {
    const clientId = Number(req.body.client_id);
    if (!clientId) return next(fail(400, 'Which client are we invoicing?'));

    try {
        const invoice = acct.createInvoiceFromUnbilled(clientId, {
            through: clean(req.body.through),
            issued_on: clean(req.body.issued_on),
            due_on: clean(req.body.due_on),
            notes: clean(req.body.notes),
            status: clean(req.body.status)
        });
        res.status(201).json(invoice);
    } catch (err) {
        next(err);
    }
});

adminRouter.post('/invoices/:id/void', (req, res, next) => {
    const id = Number(req.params.id);
    if (!db.get('SELECT id FROM invoices WHERE id = ?', id)) return next(fail(404, 'Invoice not found.'));
    res.json(acct.voidInvoice(id));
});

adminRouter.post('/invoices/:id/issue', (req, res, next) => {
    const id = Number(req.params.id);
    const invoice = db.get('SELECT * FROM invoices WHERE id = ?', id);
    if (!invoice) return next(fail(404, 'Invoice not found.'));
    if (invoice.status !== 'draft') return next(fail(400, 'Only draft invoices can be issued.'));

    db.update('invoices', id, { status: 'open', updated_at: db.nowIso() });
    res.json(acct.recomputeInvoice(id));
});

/** A printable invoice: open it and hit Ctrl-P. */
adminRouter.get('/invoices/:id/print', (req, res, next) => {
    const invoice = acct.invoiceDetail(Number(req.params.id));
    if (!invoice) return next(fail(404, 'Invoice not found.'));

    const settings = db.getSettings();
    const money = c => `$${(c / 100).toFixed(2)}`;
    const esc = s => String(s ?? '').replace(/[&<>"]/g,
        ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));

    const rows = invoice.items.map(item => `
        <tr>
          <td>${esc(item.performed_on)}</td>
          <td>${esc(item.description)}</td>
          <td class="num">${item.qty}</td>
          <td class="num">${money(item.unit_price_cents)}</td>
          <td class="num">${money(item.amount_cents)}</td>
        </tr>`).join('');

    const payments = invoice.payments.map(p => `
        <tr>
          <td>${esc(p.paid_on)}</td>
          <td>Payment received - ${esc(p.method)}${p.reference ? ` (${esc(p.reference)})` : ''}</td>
          <td class="num">-${money(p.amount_cents)}</td>
        </tr>`).join('');

    res.type('html').send(`<!doctype html>
<html><head><meta charset="utf-8"><title>${esc(invoice.number)}</title>
<style>
  body { font: 14px/1.5 -apple-system, Segoe UI, Roboto, sans-serif; color: #1a1a1a;
         max-width: 760px; margin: 40px auto; padding: 0 24px; }
  header { display: flex; justify-content: space-between; align-items: flex-start;
           border-bottom: 3px solid #1a1a1a; padding-bottom: 16px; margin-bottom: 28px; }
  h1 { margin: 0; font-size: 28px; letter-spacing: -0.02em; }
  .muted { color: #666; }
  .meta { text-align: right; }
  .parties { display: flex; gap: 48px; margin-bottom: 28px; }
  .parties h3 { margin: 0 0 6px; font-size: 11px; text-transform: uppercase;
                letter-spacing: 0.08em; color: #888; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 20px; }
  th { text-align: left; font-size: 11px; text-transform: uppercase; letter-spacing: 0.06em;
       color: #888; border-bottom: 2px solid #ddd; padding: 8px 6px; }
  td { padding: 9px 6px; border-bottom: 1px solid #eee; }
  .num { text-align: right; font-variant-numeric: tabular-nums; }
  .totals { margin-left: auto; width: 280px; }
  .totals td { border: none; padding: 5px 6px; }
  .totals .grand td { border-top: 2px solid #1a1a1a; font-weight: 700; font-size: 17px; padding-top: 10px; }
  .due { background: #fff6e5; border: 1px solid #f0c674; border-radius: 6px;
         padding: 12px 16px; margin-top: 24px; }
  .paid { background: #eaf7ee; border-color: #8fce9f; }
  footer { margin-top: 40px; color: #888; font-size: 12px; border-top: 1px solid #eee; padding-top: 14px; }
  @media print { body { margin: 0; } .noprint { display: none; } }
</style></head>
<body>
<header>
  <div>
    <h1>${esc(settings.business_name)}</h1>
    <div class="muted">${esc(settings.business_address)}<br>
      ${esc(settings.business_phone)} &middot; ${esc(settings.business_email)}</div>
  </div>
  <div class="meta">
    <h1>INVOICE</h1>
    <div class="muted"><strong>${esc(invoice.number)}</strong><br>
      Issued ${esc(invoice.issued_on)}<br>
      Due ${esc(invoice.due_on || '-')}</div>
  </div>
</header>

<div class="parties">
  <div>
    <h3>Bill to</h3>
    ${esc(invoice.first_name)} ${esc(invoice.last_name)}<br>
    ${esc(invoice.address1 || '')}${invoice.address2 ? '<br>' + esc(invoice.address2) : ''}<br>
    ${esc(invoice.city || '')}, ${esc(invoice.state || '')} ${esc(invoice.postal_code || '')}<br>
    <span class="muted">${esc(invoice.email)} &middot; ${esc(invoice.phone)}</span>
  </div>
</div>

<table>
  <thead><tr><th>Date</th><th>Service</th><th class="num">Qty</th>
    <th class="num">Rate</th><th class="num">Amount</th></tr></thead>
  <tbody>${rows}</tbody>
</table>

<table class="totals">
  <tr><td>Subtotal</td><td class="num">${money(invoice.subtotal_cents)}</td></tr>
  ${invoice.tax_cents ? `<tr><td>Tax</td><td class="num">${money(invoice.tax_cents)}</td></tr>` : ''}
  <tr class="grand"><td>Total</td><td class="num">${money(invoice.total_cents)}</td></tr>
</table>

${payments ? `<h3>Payments</h3><table><tbody>${payments}</tbody></table>` : ''}

<div class="due ${invoice.balance_cents <= 0 ? 'paid' : ''}">
  ${invoice.balance_cents <= 0
      ? '<strong>Paid in full.</strong> Thank you!'
      : `<strong>Balance due: ${money(invoice.balance_cents)}</strong>`}
</div>

<footer>
  ${invoice.notes ? esc(invoice.notes) + '<br><br>' : ''}
  Thank you for trusting us with your dog.
</footer>

<p class="noprint"><button onclick="window.print()">Print</button></p>
</body></html>`);
});

/* ------------------------------------------------------------------ */
/* Payments                                                            */
/* ------------------------------------------------------------------ */

adminRouter.get('/payments', (req, res) => {
    const { client_id: clientId, from, to } = req.query;
    const where = [];
    const params = [];

    if (clientId) { where.push('p.client_id = ?'); params.push(Number(clientId)); }
    if (from) { where.push('p.paid_on >= ?'); params.push(from); }
    if (to) { where.push('p.paid_on <= ?'); params.push(to); }

    const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';

    res.json(db.all(`
        SELECT p.*, c.first_name, c.last_name, i.number AS invoice_number
        FROM payments p
        JOIN clients c ON c.id = p.client_id
        LEFT JOIN invoices i ON i.id = p.invoice_id
        ${clause}
        ORDER BY p.paid_on DESC, p.id DESC`, ...params));
});

adminRouter.post('/payments', (req, res, next) => {
    const clientId = Number(req.body.client_id);
    if (!clientId) return next(fail(400, 'Who paid?'));

    const amount = cents(req.body.amount_cents);
    if (!amount) return next(fail(400, 'A payment needs an amount.'));

    const invoiceId = req.body.invoice_id ? Number(req.body.invoice_id) : null;
    if (invoiceId) {
        const invoice = db.get('SELECT client_id FROM invoices WHERE id = ?', invoiceId);
        if (!invoice) return next(fail(400, 'That invoice does not exist.'));
        if (invoice.client_id !== clientId) {
            return next(fail(400, "That invoice belongs to a different client."));
        }
    }

    const id = db.insert('payments', {
        client_id: clientId,
        invoice_id: invoiceId,
        paid_on: clean(req.body.paid_on) || db.today(),
        amount_cents: amount,
        method: clean(req.body.method) || 'cash',
        reference: clean(req.body.reference),
        notes: clean(req.body.notes),
        created_at: db.nowIso()
    });

    if (invoiceId) acct.recomputeInvoice(invoiceId);
    res.status(201).json(db.get('SELECT * FROM payments WHERE id = ?', id));
});

adminRouter.put('/payments/:id', (req, res, next) => {
    const id = Number(req.params.id);
    const payment = db.get('SELECT * FROM payments WHERE id = ?', id);
    if (!payment) return next(fail(404, 'Payment not found.'));

    const data = pick(req.body, ['paid_on', 'method', 'reference', 'notes']);
    if (req.body.amount_cents !== undefined) data.amount_cents = cents(req.body.amount_cents);
    if (req.body.invoice_id !== undefined) {
        data.invoice_id = req.body.invoice_id ? Number(req.body.invoice_id) : null;
    }

    db.update('payments', id, data);

    // Both the invoice it left and the one it joined need their status redone.
    if (payment.invoice_id) acct.recomputeInvoice(payment.invoice_id);
    if (data.invoice_id) acct.recomputeInvoice(data.invoice_id);

    res.json(db.get('SELECT * FROM payments WHERE id = ?', id));
});

adminRouter.delete('/payments/:id', (req, res, next) => {
    const id = Number(req.params.id);
    const payment = db.get('SELECT invoice_id FROM payments WHERE id = ?', id);
    if (!payment) return next(fail(404, 'Payment not found.'));

    db.remove('payments', id);
    if (payment.invoice_id) acct.recomputeInvoice(payment.invoice_id);
    res.json({ ok: true });
});

/* ------------------------------------------------------------------ */
/* Expenses (including maintenance)                                    */
/* ------------------------------------------------------------------ */

const EXPENSE_FIELDS = ['incurred_on', 'category', 'vendor', 'description',
    'payment_method', 'asset', 'recurring', 'notes'];

/** The categories, straight from the collection the editor edits. */
adminRouter.get('/expenses/categories', (req, res) => {
    res.json(collections.expenseCategories());
});

adminRouter.get('/expenses', (req, res) => {
    const { from, to, category, maintenance } = req.query;
    const where = [];
    const params = [];

    if (from) { where.push('incurred_on >= ?'); params.push(from); }
    if (to) { where.push('incurred_on <= ?'); params.push(to); }
    if (category) { where.push('category = ?'); params.push(category); }
    if (maintenance === '1') where.push('is_maintenance = 1');

    const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const expenses = db.all(
        `SELECT * FROM expenses ${clause} ORDER BY incurred_on DESC, id DESC`, ...params);
    const total = expenses.reduce((sum, e) => sum + e.amount_cents, 0);

    res.json({ expenses, total_cents: total, count: expenses.length });
});

adminRouter.post('/expenses', upload.single('receipt'), (req, res, next) => {
    const data = pick(req.body, EXPENSE_FIELDS);
    const amount = cents(req.body.amount_cents);

    if (!amount) return next(fail(400, 'An expense needs an amount.'));
    if (!data.category) return next(fail(400, 'Pick a category for this expense.'));

    const categories = collections.load('data', 'expenseCategories');
    const category = categories[data.category];
    if (!category) {
        return next(fail(400, `Unknown expense category: ${data.category}`));
    }

    // A category may declare itself maintenance (see the expenseCategories
    // collection), and the operator may also tick the box by hand.
    const isMaintenance = bool(req.body.is_maintenance) || (category.maintenance ? 1 : 0);

    const file = req.file;
    const id = db.insert('expenses', {
        incurred_on: data.incurred_on || db.today(),
        category: data.category,
        vendor: data.vendor,
        description: data.description,
        amount_cents: amount,
        payment_method: data.payment_method,
        receipt_path: file ? file.filename : null,
        receipt_name: file ? file.originalname : null,
        is_maintenance: isMaintenance,
        asset: data.asset,
        recurring: data.recurring || 'none',
        notes: data.notes,
        created_at: db.nowIso()
    });

    res.status(201).json(db.get('SELECT * FROM expenses WHERE id = ?', id));
});

adminRouter.put('/expenses/:id', upload.single('receipt'), (req, res, next) => {
    const id = Number(req.params.id);
    if (!db.get('SELECT id FROM expenses WHERE id = ?', id)) return next(fail(404, 'Expense not found.'));

    const data = pick(req.body, EXPENSE_FIELDS);
    if (req.body.amount_cents !== undefined) data.amount_cents = cents(req.body.amount_cents);
    if (req.body.is_maintenance !== undefined) data.is_maintenance = bool(req.body.is_maintenance);

    if (req.file) {
        data.receipt_path = req.file.filename;
        data.receipt_name = req.file.originalname;
    }

    db.update('expenses', id, data);
    res.json(db.get('SELECT * FROM expenses WHERE id = ?', id));
});

adminRouter.delete('/expenses/:id', (req, res) => {
    const id = Number(req.params.id);
    const expense = db.get('SELECT receipt_path FROM expenses WHERE id = ?', id);

    if (expense && expense.receipt_path) {
        const full = path.join(db.UPLOAD_DIR, path.basename(expense.receipt_path));
        fs.rm(full, { force: true }, () => {});
    }
    db.remove('expenses', id);
    res.json({ ok: true });
});

/* ------------------------------------------------------------------ */
/* Reports                                                             */
/* ------------------------------------------------------------------ */

function range(req) {
    const to = req.query.to || db.today();
    const from = req.query.from || (to.slice(0, 4) + '-01-01');
    return { from, to };
}

adminRouter.get('/reports/pnl', (req, res) => {
    const { from, to } = range(req);
    res.json(acct.profitAndLoss(from, to));
});

adminRouter.get('/reports/ar', (req, res) => {
    res.json(acct.arAging(req.query.as_of || db.today()));
});

adminRouter.get('/reports/services', (req, res) => {
    const { from, to } = range(req);
    res.json(acct.servicesByPet(from, to, req.query.pet_id ? Number(req.query.pet_id) : null));
});

adminRouter.get('/reports/occupancy', (req, res) => {
    const { from, to } = range(req);
    res.json(acct.occupancy(from, to));
});

adminRouter.get('/reports/vaccinations', (req, res) => {
    res.json(acct.vaccinationAlerts());
});

/** CSV exports, for the accountant who wants it in a spreadsheet. */
adminRouter.get('/reports/export/:kind', (req, res, next) => {
    const { from, to } = range(req);
    const { kind } = req.params;
    let rows;

    if (kind === 'expenses') {
        rows = db.all(`
            SELECT incurred_on AS date, category, vendor, description,
                   amount_cents / 100.0 AS amount, payment_method, asset,
                   CASE is_maintenance WHEN 1 THEN 'yes' ELSE 'no' END AS maintenance
            FROM expenses WHERE incurred_on BETWEEN ? AND ?
            ORDER BY incurred_on`, from, to);
    } else if (kind === 'payments') {
        rows = db.all(`
            SELECT p.paid_on AS date, c.first_name || ' ' || c.last_name AS client,
                   i.number AS invoice, p.amount_cents / 100.0 AS amount,
                   p.method, p.reference
            FROM payments p
            JOIN clients c ON c.id = p.client_id
            LEFT JOIN invoices i ON i.id = p.invoice_id
            WHERE p.paid_on BETWEEN ? AND ? ORDER BY p.paid_on`, from, to);
    } else if (kind === 'services') {
        rows = db.all(`
            SELECT se.performed_on AS date, pe.name AS dog,
                   c.first_name || ' ' || c.last_name AS client,
                   se.description AS service, se.qty,
                   se.unit_price_cents / 100.0 AS rate,
                   se.amount_cents / 100.0 AS amount,
                   COALESCE(i.number, 'unbilled') AS invoice, se.staff
            FROM service_events se
            JOIN pets pe   ON pe.id = se.pet_id
            JOIN clients c ON c.id = se.client_id
            LEFT JOIN invoices i ON i.id = se.invoice_id
            WHERE se.performed_on BETWEEN ? AND ? ORDER BY se.performed_on`, from, to);
    } else if (kind === 'invoices') {
        rows = db.all(`
            SELECT i.number, i.issued_on, i.due_on, i.status,
                   c.first_name || ' ' || c.last_name AS client,
                   i.total_cents / 100.0 AS total,
                   COALESCE((SELECT SUM(p.amount_cents) FROM payments p
                             WHERE p.invoice_id = i.id), 0) / 100.0 AS paid
            FROM invoices i JOIN clients c ON c.id = i.client_id
            WHERE i.issued_on BETWEEN ? AND ? ORDER BY i.issued_on`, from, to);
    } else {
        return next(fail(404, `Unknown export: ${kind}`));
    }

    res.type('text/csv');
    res.setHeader('Content-Disposition',
        `attachment; filename="${kind}-${from}-to-${to}.csv"`);
    res.send(toCsv(rows));
});

/* ------------------------------------------------------------------ */
/* Calendar - who is in, and when we are full                          */
/* ------------------------------------------------------------------ */

adminRouter.get('/calendar', (req, res, next) => {
    try {
        const from = String(req.query.from || db.today()).slice(0, 10);
        const to = String(req.query.to || availability.addDays(from, 30)).slice(0, 10);
        if (to < from) return next(fail(400, 'That date range is backwards.'));
        if (availability.nights(from, to).length > 400) {
            return next(fail(400, 'That date range is too long.'));
        }

        const bookings = db.all(
            `SELECT b.*, c.first_name, c.last_name,
                    (SELECT GROUP_CONCAT(p.name, ', ') FROM booking_pets bp
                       JOIN pets p ON p.id = bp.pet_id WHERE bp.booking_id = b.id) AS dog_names,
                    (SELECT COUNT(*) FROM booking_pets bp WHERE bp.booking_id = b.id) AS dogs
             FROM bookings b JOIN clients c ON c.id = b.client_id
             WHERE b.status != 'cancelled' AND b.check_in <= ? AND b.check_out > ?
             ORDER BY b.check_in`, to, from);

        res.json({
            from, to,
            capacity: collections.capacity(),
            kennels: collections.kennels(),
            days: availability.days(from, to),
            bookings
        });
    } catch (err) { next(err); }
});

/* ------------------------------------------------------------------ */
/* Accounts - staff logins and client portal logins                    */
/* ------------------------------------------------------------------ */

const ACCOUNT_EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function tempPassword() {
    return crypto.randomBytes(6).toString('base64url');
}

function accountRow(id) {
    return db.get(
        `SELECT a.id, a.role, a.email, a.status, a.email_verified, a.client_id,
                a.created_at, a.updated_at, a.last_login_at,
                c.first_name, c.last_name
         FROM accounts a LEFT JOIN clients c ON c.id = a.client_id
         WHERE a.id = ?`, id);
}

adminRouter.get('/accounts', (req, res) => {
    const accounts = db.all(
        `SELECT a.id, a.role, a.email, a.status, a.email_verified, a.client_id,
                a.created_at, a.last_login_at,
                c.first_name, c.last_name
         FROM accounts a LEFT JOIN clients c ON c.id = a.client_id
         ORDER BY a.role, a.status, a.email`);
    const pending = accounts.filter(a => a.role === 'client' && a.status === 'pending').length;
    res.json({ accounts, pending });
});

/** Create a named staff login (active immediately). */
adminRouter.post('/accounts/staff', (req, res, next) => {
    try {
        const email = auth.normalizeEmail(req.body.email);
        const password = String(req.body.password || '');
        if (!ACCOUNT_EMAIL_RE.test(email)) throw fail(400, 'Enter a valid email address.');
        if (password.length < 8) throw fail(400, 'Choose a password of at least 8 characters.');
        if (auth.getAccountByEmail(email)) throw fail(409, 'An account with that email already exists.');
        const account = auth.createAccount({
            role: 'staff', email, password, client_id: null, status: 'active', email_verified: 1
        });
        res.json({ ok: true, account: accountRow(account.id) });
    } catch (err) { next(err); }
});

/** Create a portal login for an existing client and hand back a temp password. */
adminRouter.post('/accounts/client', (req, res, next) => {
    try {
        const clientId = Number(req.body.client_id);
        const client = db.get('SELECT * FROM clients WHERE id = ?', clientId);
        if (!client) throw fail(404, 'Client not found.');
        const email = auth.normalizeEmail(req.body.email || client.email);
        if (!ACCOUNT_EMAIL_RE.test(email)) throw fail(400, 'Enter a valid email address.');
        if (auth.getAccountByEmail(email)) throw fail(409, 'An account with that email already exists.');
        const password = tempPassword();
        const account = auth.createAccount({
            role: 'client', email, password, client_id: clientId, status: 'active', email_verified: 1
        });
        res.json({ ok: true, account: accountRow(account.id), temp_password: password });
    } catch (err) { next(err); }
});

/** Approve a pending client signup (the fallback when no mailer is configured). */
adminRouter.post('/accounts/:id/approve', (req, res, next) => {
    try {
        const account = auth.getAccountById(req.params.id);
        if (!account) throw fail(404, 'Not found.');
        db.update('accounts', account.id, {
            status: 'active', email_verified: 1, verify_token: null,
            verify_expires: null, updated_at: db.nowIso()
        });
        res.json({ ok: true, account: accountRow(account.id) });
    } catch (err) { next(err); }
});

adminRouter.post('/accounts/:id/disable', (req, res, next) => {
    try {
        const account = auth.getAccountById(req.params.id);
        if (!account) throw fail(404, 'Not found.');
        db.update('accounts', account.id, { status: 'disabled', updated_at: db.nowIso() });
        db.run('DELETE FROM sessions WHERE account_id = ?', account.id);
        res.json({ ok: true, account: accountRow(account.id) });
    } catch (err) { next(err); }
});

adminRouter.post('/accounts/:id/enable', (req, res, next) => {
    try {
        const account = auth.getAccountById(req.params.id);
        if (!account) throw fail(404, 'Not found.');
        db.update('accounts', account.id, { status: 'active', updated_at: db.nowIso() });
        res.json({ ok: true, account: accountRow(account.id) });
    } catch (err) { next(err); }
});

/** Reset an account's password to a fresh temporary one and log it out. */
adminRouter.post('/accounts/:id/reset', (req, res, next) => {
    try {
        const account = auth.getAccountById(req.params.id);
        if (!account) throw fail(404, 'Not found.');
        const password = tempPassword();
        auth.setAccountPassword(account.id, password);
        res.json({ ok: true, temp_password: password });
    } catch (err) { next(err); }
});

adminRouter.delete('/accounts/:id', (req, res, next) => {
    try {
        const account = auth.getAccountById(req.params.id);
        if (!account) throw fail(404, 'Not found.');
        db.run('DELETE FROM sessions WHERE account_id = ?', account.id);
        db.remove('accounts', account.id);
        res.json({ ok: true });
    } catch (err) { next(err); }
});

module.exports = { sessionRouter, adminRouter };
