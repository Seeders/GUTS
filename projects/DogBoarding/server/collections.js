/**
 * Reading the GUTS collections from the server.
 *
 * The client gets its collections compiled into the bundle. The server reads the
 * very same JSON files off disk. That is the point: the rate card, the required
 * vaccinations, the expense categories and the booking statuses are defined once,
 * in the editor, and both halves of the app obey them.
 *
 * Collections are cached after the first read. Set DOGBOARD_WATCH_COLLECTIONS=1
 * to re-read them on every call while you are editing.
 */

const fs = require('fs');
const path = require('path');

const COLLECTIONS_DIR = path.join(__dirname, '..', 'collections');
const LIVE = process.env.DOGBOARD_WATCH_COLLECTIONS === '1';

const cache = new Map();

/**
 * Load one collection as { objectId: object }, mirroring the shape the client
 * sees. The object id is the filename, so serviceCatalog/bath.json is `bath`.
 */
function load(category, collectionId) {
    const key = `${category}/${collectionId}`;
    if (!LIVE && cache.has(key)) return cache.get(key);

    const dir = path.join(COLLECTIONS_DIR, category, collectionId);
    const out = {};

    try {
        for (const file of fs.readdirSync(dir)) {
            if (!file.endsWith('.json')) continue;
            const id = path.basename(file, '.json');
            out[id] = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
        }
    } catch (err) {
        console.error(`[collections] Could not read ${key}: ${err.message}`);
    }

    cache.set(key, out);
    return out;
}

/** A collection as an array, ordered by `order`, each object carrying its id. */
function ordered(category, collectionId) {
    return Object.entries(load(category, collectionId))
        .map(([id, item]) => ({ id, ...item }))
        .sort((a, b) => (a.order ?? 999) - (b.order ?? 999));
}

/**
 * Forget what we cached, so the next read comes off disk.
 *
 * Used by the rate-card sync: someone editing a price in the GUTS editor should
 * see it on the site after a refresh, not after a server restart.
 */
function clearCache(category = null, collectionId = null) {
    if (category && collectionId) cache.delete(`${category}/${collectionId}`);
    else cache.clear();
}

/* ------------------------------------------------------------------ */
/* The specific collections the server cares about                     */
/* ------------------------------------------------------------------ */

const serviceCatalog = () => ordered('data', 'serviceCatalog');

/**
 * The rate card, in the shape the rest of the app wants.
 *
 * There is no services table. The serviceCatalog collection IS the rate card -
 * it is not secret, it is not per-client, and it changes when someone edits it
 * in the editor. Copying it into SQLite only bought us a second copy to keep in
 * step, and it silently stopped reflecting edits.
 *
 * A service's `id` is its filename in the collection ("nailTrim"), and that is
 * what a charge records. Prices are dollars in the JSON and cents everywhere
 * else, so the conversion happens once, here.
 */
function services({ includeInactive = false, fresh = true } = {}) {
    if (fresh) clearCache('data', 'serviceCatalog');

    return serviceCatalog()
        .filter(s => includeInactive || s.active !== false)
        .map(s => ({
            id: s.id,
            code: s.code || s.id,
            name: s.title,
            description: s.description || null,
            unit: s.unit || 'each',
            price_cents: Math.round((s.price || 0) * 100),
            taxable: s.taxable === false ? 0 : 1,
            active: s.active === false ? 0 : 1,
            order: s.order ?? 999
        }));
}

/** One service by its collection id. */
function service(id) {
    return services({ includeInactive: true }).find(s => s.id === id) || null;
}
const recordTypes = () => ordered('data', 'recordTypes');
const expenseCategories = () => ordered('data', 'expenseCategories');
const paymentMethods = () => ordered('data', 'paymentMethods');
const bookingStatuses = () => ordered('data', 'bookingStatuses');
const serviceUnits = () => ordered('data', 'serviceUnits');

/**
 * Who the business is and how it bills. A config object in the collections, not
 * a settings table: none of it is secret, none of it is per-client, and it is
 * exactly the sort of thing someone should be able to change in the editor.
 *
 * The database holds only what genuinely cannot live in a JSON file the browser
 * can read: client records, the books, the admin password, sessions.
 */
function business({ fresh = true } = {}) {
    if (fresh) clearCache('settings', 'configs');

    const config = load('settings', 'configs').business || {};

    return {
        name: config.name || 'Dog Boarding',
        email: config.email || '',
        phone: config.phone || '',
        address: config.address || '',
        taxRateBps: Number(config.taxRateBps) || 0,
        invoicePrefix: config.invoicePrefix || 'INV',
        invoiceTermsDays: Number(config.invoiceTermsDays) || 14,
        vaccineWarnDays: Number(config.vaccineWarnDays) || 30
    };
}

/** The vaccinations a dog must have, per the recordTypes collection. */
function requiredVaccines() {
    return recordTypes().filter(type => type.required).map(type => type.id);
}

/**
 * The kennels. A kennel is one sleeping space for one dog - it is a bed, not a
 * room that several dogs share - so a kennel has a name and a size, and never a
 * count. Size says which dogs FIT in it, not how many.
 *
 * Like the rate card, this is configuration rather than data: not secret, not
 * per-client, and exactly the sort of thing someone should be able to change in
 * the editor when they build another one. So it is a collection, not a table.
 */
function kennels({ includeInactive = false, fresh = true } = {}) {
    if (fresh) clearCache('data', 'kennels');

    return ordered('data', 'kennels')
        .filter(k => includeInactive || k.active !== false)
        .map(k => ({
            id: k.id,
            name: k.title,
            size: k.size || 'small',
            description: k.description || null,
            active: k.active === false ? 0 : 1,
            order: k.order ?? 999
        }));
}

/** Dogs we can sleep on one night: one per kennel. */
function capacity() {
    return kennels().length;
}

/** How many of each size, for the calendar's summary line. */
function kennelCounts() {
    const list = kennels();
    return {
        total: list.length,
        small: list.filter(k => k.size !== 'large').length,
        large: list.filter(k => k.size === 'large').length
    };
}

/** Valid ids, for validating what the client sends us. */
const ids = list => list.map(item => item.id);

module.exports = {
    load, ordered, clearCache,
    services, service, business,
    serviceCatalog, recordTypes, expenseCategories, paymentMethods,
    bookingStatuses, serviceUnits, kennels, capacity, kennelCounts,
    requiredVaccines, ids,
    COLLECTIONS_DIR
};
