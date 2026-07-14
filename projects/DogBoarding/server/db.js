/**
 * DogBoarding - database layer
 *
 * Uses node:sqlite (built into Node 22+), so there is no native dependency to
 * compile. All money is stored as integer cents. All dates are ISO strings:
 * 'YYYY-MM-DD' for calendar dates, full ISO-8601 for timestamps.
 */

const { DatabaseSync } = require('node:sqlite');
const fs = require('fs');
const path = require('path');
const collections = require('./collections');

/**
 * Secure storage is its own per-project category, a sibling of collections/:
 *
 *     projects/DogBoarding/secure/dogboard.db
 *     projects/DogBoarding/secure/uploads/
 *
 * It deliberately sits OUTSIDE collections/. The build walks every top-level
 * folder under collections/ and inlines what it finds into the client bundle
 * (see ConfigParser.discoverCollections - "the folder structure is the source
 * of truth"), so a secure collection would be compiled straight into the
 * browser. secure/ is the one place that must never happen.
 *
 * It is also denied by the root server's static layer and gitignored, because
 * the uploads here are vet records carrying client home addresses and phone
 * numbers.
 *
 * Point GUTS_SECURE_DIR at a backed-up volume to move it off the repo.
 */
const PROJECT_ROOT = path.join(__dirname, '..');
const SECURE_DIR = process.env.GUTS_SECURE_DIR || path.join(PROJECT_ROOT, 'secure');

const DATA_DIR = SECURE_DIR;
const UPLOAD_DIR = path.join(SECURE_DIR, 'uploads');
const DB_PATH = process.env.DOGBOARD_DB || path.join(SECURE_DIR, 'dogboard.db');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS clients (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    first_name      TEXT NOT NULL,
    last_name       TEXT NOT NULL,
    email           TEXT NOT NULL,
    phone           TEXT NOT NULL,
    alt_phone       TEXT,
    address1        TEXT,
    address2        TEXT,
    city            TEXT,
    state           TEXT,
    postal_code     TEXT,
    country         TEXT DEFAULT 'US',
    emergency_name  TEXT,
    emergency_phone TEXT,
    emergency_relationship TEXT,
    notes           TEXT,
    status          TEXT NOT NULL DEFAULT 'pending',
    created_at      TEXT NOT NULL,
    updated_at      TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS vets (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    clinic_name  TEXT NOT NULL,
    vet_name     TEXT,
    phone        TEXT,
    email        TEXT,
    address1     TEXT,
    address2     TEXT,
    city         TEXT,
    state        TEXT,
    postal_code  TEXT,
    notes        TEXT,
    created_at   TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS pets (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    client_id      INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
    vet_id         INTEGER REFERENCES vets(id) ON DELETE SET NULL,
    name           TEXT NOT NULL,
    breed          TEXT,
    sex            TEXT,
    birthdate      TEXT,
    weight_lbs     REAL,
    color          TEXT,
    fixed          INTEGER NOT NULL DEFAULT 0,
    microchip      TEXT,
    feeding        TEXT,
    medications    TEXT,
    allergies      TEXT,
    behavior_notes TEXT,
    vet_notes      TEXT,
    status         TEXT NOT NULL DEFAULT 'active',
    created_at     TEXT NOT NULL,
    updated_at     TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS vet_records (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    pet_id        INTEGER NOT NULL REFERENCES pets(id) ON DELETE CASCADE,
    record_type   TEXT NOT NULL,
    issued_on     TEXT,
    expires_on    TEXT,
    file_path     TEXT,
    original_name TEXT,
    mime_type     TEXT,
    size_bytes    INTEGER,
    notes         TEXT,
    verified      INTEGER NOT NULL DEFAULT 0,
    created_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS bookings (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    client_id  INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
    check_in   TEXT NOT NULL,
    check_out  TEXT NOT NULL,
    status     TEXT NOT NULL DEFAULT 'requested',
    source     TEXT NOT NULL DEFAULT 'admin',
    notes      TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS booking_pets (
    booking_id INTEGER NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
    pet_id     INTEGER NOT NULL REFERENCES pets(id) ON DELETE CASCADE,
    kennel     TEXT,
    PRIMARY KEY (booking_id, pet_id)
);

CREATE TABLE IF NOT EXISTS invoices (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    number         TEXT UNIQUE NOT NULL,
    client_id      INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
    issued_on      TEXT NOT NULL,
    due_on         TEXT,
    status         TEXT NOT NULL DEFAULT 'open',
    subtotal_cents INTEGER NOT NULL DEFAULT 0,
    tax_cents      INTEGER NOT NULL DEFAULT 0,
    total_cents    INTEGER NOT NULL DEFAULT 0,
    notes          TEXT,
    created_at     TEXT NOT NULL,
    updated_at     TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS service_events (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    client_id        INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
    pet_id           INTEGER NOT NULL REFERENCES pets(id) ON DELETE CASCADE,
    booking_id       INTEGER REFERENCES bookings(id) ON DELETE SET NULL,
    service_id       TEXT,
    invoice_id       INTEGER REFERENCES invoices(id) ON DELETE SET NULL,
    description      TEXT NOT NULL,
    performed_on     TEXT NOT NULL,
    qty              REAL NOT NULL DEFAULT 1,
    unit_price_cents INTEGER NOT NULL DEFAULT 0,
    amount_cents     INTEGER NOT NULL DEFAULT 0,
    taxable          INTEGER NOT NULL DEFAULT 1,
    staff            TEXT,
    notes            TEXT,
    created_at       TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS invoice_items (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    invoice_id       INTEGER NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
    service_event_id INTEGER REFERENCES service_events(id) ON DELETE SET NULL,
    pet_id           INTEGER REFERENCES pets(id) ON DELETE SET NULL,
    description      TEXT NOT NULL,
    performed_on     TEXT,
    qty              REAL NOT NULL DEFAULT 1,
    unit_price_cents INTEGER NOT NULL DEFAULT 0,
    amount_cents     INTEGER NOT NULL DEFAULT 0,
    taxable          INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS payments (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    client_id    INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
    invoice_id   INTEGER REFERENCES invoices(id) ON DELETE SET NULL,
    paid_on      TEXT NOT NULL,
    amount_cents INTEGER NOT NULL,
    method       TEXT NOT NULL DEFAULT 'cash',
    reference    TEXT,
    notes        TEXT,
    created_at   TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS expenses (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    incurred_on    TEXT NOT NULL,
    category       TEXT NOT NULL,
    vendor         TEXT,
    description    TEXT,
    amount_cents   INTEGER NOT NULL,
    payment_method TEXT,
    receipt_path   TEXT,
    receipt_name   TEXT,
    is_maintenance INTEGER NOT NULL DEFAULT 0,
    asset          TEXT,
    recurring      TEXT NOT NULL DEFAULT 'none',
    notes          TEXT,
    created_at     TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT
);

CREATE TABLE IF NOT EXISTS sessions (
    token      TEXT PRIMARY KEY,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_pets_client       ON pets(client_id);
CREATE INDEX IF NOT EXISTS idx_records_pet       ON vet_records(pet_id);
CREATE INDEX IF NOT EXISTS idx_records_expires   ON vet_records(expires_on);
CREATE INDEX IF NOT EXISTS idx_bookings_client   ON bookings(client_id);
CREATE INDEX IF NOT EXISTS idx_bookings_dates    ON bookings(check_in, check_out);
CREATE INDEX IF NOT EXISTS idx_events_client     ON service_events(client_id);
CREATE INDEX IF NOT EXISTS idx_events_pet        ON service_events(pet_id);
CREATE INDEX IF NOT EXISTS idx_events_invoice    ON service_events(invoice_id);
CREATE INDEX IF NOT EXISTS idx_events_performed  ON service_events(performed_on);
CREATE INDEX IF NOT EXISTS idx_items_invoice     ON invoice_items(invoice_id);
CREATE INDEX IF NOT EXISTS idx_payments_client   ON payments(client_id);
CREATE INDEX IF NOT EXISTS idx_payments_invoice  ON payments(invoice_id);
CREATE INDEX IF NOT EXISTS idx_payments_paid_on  ON payments(paid_on);
CREATE INDEX IF NOT EXISTS idx_expenses_date     ON expenses(incurred_on);
CREATE INDEX IF NOT EXISTS idx_invoices_client   ON invoices(client_id);
`;

/*
 * There are no default settings any more.
 *
 * The business name, its address, the tax rate, the invoice prefix and terms,
 * the vaccination warning window - all of that is configuration, and it lives in
 * the `business` config in the collections where it can be edited. The settings
 * table now holds exactly one thing: the admin password hash, which is the only
 * item here that has any business being secret.
 */

let db = null;

function nowIso() {
    return new Date().toISOString();
}

function today() {
    return new Date().toISOString().slice(0, 10);
}

/** Open (and if needed create) the database. Idempotent. */
function open() {
    if (db) return db;

    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.mkdirSync(UPLOAD_DIR, { recursive: true });

    db = new DatabaseSync(DB_PATH);
    db.exec('PRAGMA journal_mode = WAL;');
    db.exec('PRAGMA foreign_keys = ON;');
    db.exec(SCHEMA);

    migrateOffServicesTable();
    seed();
    return db;
}

/**
 * There is nothing to seed any more.
 *
 * The rate card, the business details, the tax rate, the invoice terms and the
 * vaccination window all live in the collections, where they can be edited. What
 * is left in the settings table is the admin password hash, and auth.js writes
 * that itself.
 *
 * Old databases still carry the config rows we used to keep here. Clear them
 * out, so there is exactly one copy of each of these facts and no doubt about
 * which one is being read.
 */
function seed() {
    const stale = ['business_name', 'business_email', 'business_phone', 'business_address',
        'tax_rate_bps', 'invoice_prefix', 'invoice_terms_days', 'vaccine_warn_days',
        'required_vaccines'];

    const remove = db.prepare('DELETE FROM settings WHERE key = ?');
    for (const key of stale) remove.run(key);
}

/**
 * Older databases carry a `services` table - a copy of the serviceCatalog
 * collection. The collection is the rate card now, so the table is dead weight
 * and, worse, a second copy that quietly stopped matching the first.
 *
 * Charges recorded a numeric services.id. Translate those to the collection id
 * (via the code the two share), then drop the table.
 */
function migrateOffServicesTable() {
    const hasTable = db.prepare(
        "SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table' AND name='services'").get().n;
    if (!hasTable) return;

    console.log('  Migrating: the rate card now lives in the serviceCatalog collection.');

    const catalog = collections.services({ includeInactive: true });
    const byCode = new Map(catalog.map(s => [s.code, s.id]));

    // services.id (a number) -> collection id (a string like "nailTrim")
    for (const row of db.prepare('SELECT id, code FROM services').all()) {
        const collectionId = byCode.get(row.code);
        if (!collectionId) continue;
        db.prepare('UPDATE service_events SET service_id = ? WHERE service_id = ?')
            .run(collectionId, String(row.id));
    }

    // The FK on service_events pointed at this table, so it has to come down
    // with the constraint checks off.
    db.exec('PRAGMA foreign_keys = OFF;');
    db.exec('DROP TABLE IF EXISTS services;');
    db.exec('PRAGMA foreign_keys = ON;');
}

/* ------------------------------------------------------------------ */
/* Small query helpers                                                 */
/* ------------------------------------------------------------------ */

/**
 * node:sqlite refuses to bind `undefined` (and booleans), which is exactly what
 * you get from an optional field the caller left out. Normalise on the way in:
 * a missing value is NULL, and a boolean is 0/1.
 */
function bind(value) {
    if (value === undefined) return null;
    if (typeof value === 'boolean') return value ? 1 : 0;
    return value;
}

function all(sql, ...params) {
    return open().prepare(sql).all(...params.map(bind));
}

function get(sql, ...params) {
    return open().prepare(sql).get(...params.map(bind));
}

function run(sql, ...params) {
    return open().prepare(sql).run(...params.map(bind));
}

/** INSERT helper: takes a table and a plain object, returns the new row id. */
function insert(table, data) {
    const keys = Object.keys(data);
    const sql = `INSERT INTO ${table} (${keys.join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`;
    const result = open().prepare(sql).run(...keys.map(k => bind(data[k])));
    return Number(result.lastInsertRowid);
}

/** UPDATE helper: only the provided keys are written. */
function update(table, id, data) {
    const keys = Object.keys(data);
    if (keys.length === 0) return 0;
    const sql = `UPDATE ${table} SET ${keys.map(k => `${k} = ?`).join(', ')} WHERE id = ?`;
    const result = open().prepare(sql).run(...keys.map(k => bind(data[k])), id);
    return Number(result.changes);
}

function remove(table, id) {
    return Number(open().prepare(`DELETE FROM ${table} WHERE id = ?`).run(id).changes);
}

/** Run fn inside a transaction; rolls back if fn throws. */
function tx(fn) {
    const conn = open();
    conn.exec('BEGIN');
    try {
        const result = fn();
        conn.exec('COMMIT');
        return result;
    } catch (err) {
        conn.exec('ROLLBACK');
        throw err;
    }
}

/* ------------------------------------------------------------------ */
/* Settings                                                            */
/* ------------------------------------------------------------------ */

function getSettings() {
    const rows = all('SELECT key, value FROM settings');
    return Object.fromEntries(rows.map(r => [r.key, r.value]));
}

function getSetting(key, fallback = null) {
    const row = open().prepare('SELECT value FROM settings WHERE key = ?').get(key);
    return row ? row.value : fallback;
}

function setSetting(key, value) {
    run('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
        key, String(value));
}

module.exports = {
    open, all, get, run, insert, update, remove, tx,
    getSettings, getSetting, setSetting,
    nowIso, today,
    DATA_DIR, UPLOAD_DIR, DB_PATH
};
