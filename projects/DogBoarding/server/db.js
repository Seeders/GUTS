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

const DATA_DIR = path.join(__dirname, '..', 'data');
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
const DB_PATH = process.env.DOGBOARD_DB || path.join(DATA_DIR, 'dogboard.db');

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

CREATE TABLE IF NOT EXISTS services (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    code        TEXT UNIQUE,
    name        TEXT NOT NULL,
    description TEXT,
    unit        TEXT NOT NULL DEFAULT 'each',
    price_cents INTEGER NOT NULL DEFAULT 0,
    taxable     INTEGER NOT NULL DEFAULT 1,
    active      INTEGER NOT NULL DEFAULT 1,
    created_at  TEXT NOT NULL
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
    service_id       INTEGER REFERENCES services(id) ON DELETE SET NULL,
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

const DEFAULT_SERVICES = [
    ['BOARD-STD',  'Boarding - Standard Suite', 'Overnight boarding, standard kennel run.',      'night', 4500],
    ['BOARD-LUX',  'Boarding - Luxury Suite',   'Overnight boarding, private suite with cot.',   'night', 6500],
    ['BOARD-2ND',  'Boarding - Sibling Dog',    'Second dog from same household, shared suite.', 'night', 3000],
    ['DAYCARE',    'Daycare - Full Day',        'Supervised play, up to 10 hours.',              'day',   3500],
    ['DAYCARE-HF', 'Daycare - Half Day',        'Supervised play, up to 5 hours.',               'day',   2200],
    ['WALK-30',    'Solo Walk (30 min)',        'One-on-one leashed walk.',                      'each',  1500],
    ['PLAY-1X1',   'One-on-One Play Session',   '20 minutes of individual attention.',           'each',  1200],
    ['BATH',       'Bath & Brush',              'Shampoo, blow dry, brush out.',                 'each',  3000],
    ['NAILS',      'Nail Trim',                 'Nail trim and file.',                           'each',  1500],
    ['MEDS',       'Medication Administration', 'Per day, any number of doses.',                 'day',    500],
    ['FOOD',       'House Food',                'Per day, if owner food not supplied.',          'day',    400],
    ['LATE',       'Late Pickup Fee',           'Pickup after posted closing time.',             'each',  2500],
    ['HOLIDAY',    'Holiday Surcharge',         'Per night, on posted holidays.',                'night', 1000]
];

const DEFAULT_SETTINGS = {
    business_name: 'Happy Tails Boarding',
    business_email: 'hello@happytails.example',
    business_phone: '(555) 012-3456',
    business_address: '148 Old Mill Road, Fairview, OR 97024',
    tax_rate_bps: '0',            // basis points; 725 = 7.25%
    invoice_prefix: 'INV',
    invoice_terms_days: '14',
    vaccine_warn_days: '30',
    required_vaccines: 'rabies,dhpp,bordetella'
};

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

    seed();
    return db;
}

function seed() {
    const stamp = nowIso();

    const settingCount = db.prepare('SELECT COUNT(*) AS n FROM settings').get().n;
    if (settingCount === 0) {
        const ins = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)');
        for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) ins.run(key, value);
    }

    const serviceCount = db.prepare('SELECT COUNT(*) AS n FROM services').get().n;
    if (serviceCount === 0) {
        const ins = db.prepare(`
            INSERT INTO services (code, name, description, unit, price_cents, taxable, active, created_at)
            VALUES (?, ?, ?, ?, ?, 1, 1, ?)`);
        for (const [code, name, description, unit, price] of DEFAULT_SERVICES) {
            ins.run(code, name, description, unit, price, stamp);
        }
    }
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
