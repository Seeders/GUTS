/**
 * Availability - how full the place is on any given night.
 *
 * Capacity is the sum of what the active kennels hold (the kennels collection),
 * so building another run is an edit in the editor, not a migration.
 *
 * A stay occupies a kennel on every NIGHT from check_in up to (but not
 * including) check_out - the same convention the occupancy report already uses.
 * A dog checking out on the 5th does not take a bed on the night of the 5th.
 *
 * Everything on the books holds a bed: a 'requested' stay counts, so a request
 * that is waiting on staff cannot be double-booked over. Only a cancelled stay
 * frees its bed back up.
 */

const db = require('./db');
const collections = require('./collections');

const OCCUPYING = ['requested', 'confirmed', 'checked_in', 'checked_out'];

/** 'YYYY-MM-DD' + n days, done in UTC so a timezone can't shift the date. */
function addDays(iso, n) {
    const [y, m, d] = String(iso).slice(0, 10).split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

/** The nights a stay occupies: [check_in, check_out). */
function nights(checkIn, checkOut) {
    const out = [];
    const end = String(checkOut).slice(0, 10);
    for (let d = String(checkIn).slice(0, 10); d < end; d = addDays(d, 1)) out.push(d);
    return out;
}

/** date -> dogs booked that night, across [from, to]. */
function bookedByNight(from, to, { excludeBookingId = null } = {}) {
    const marks = OCCUPYING.map(() => '?').join(',');
    const rows = db.all(
        `SELECT b.id, b.check_in, b.check_out, COUNT(bp.pet_id) AS dogs
         FROM bookings b
         LEFT JOIN booking_pets bp ON bp.booking_id = b.id
         WHERE b.status IN (${marks})
           AND b.check_in <= ? AND b.check_out > ?
         GROUP BY b.id`,
        ...OCCUPYING, to, from);

    const map = new Map();
    for (const row of rows) {
        if (excludeBookingId && Number(row.id) === Number(excludeBookingId)) continue;
        for (const night of nights(row.check_in, row.check_out)) {
            if (night < from || night > to) continue;
            map.set(night, (map.get(night) || 0) + (row.dogs || 0));
        }
    }
    return map;
}

/** One row per night in [from, to] inclusive. */
function days(from, to) {
    const capacity = collections.capacity();
    const booked = bookedByNight(from, to);

    const out = [];
    for (let d = String(from).slice(0, 10); d <= String(to).slice(0, 10); d = addDays(d, 1)) {
        const dogs = booked.get(d) || 0;
        out.push({
            date: d,
            capacity,
            booked: dogs,
            available: Math.max(0, capacity - dogs),
            full: dogs >= capacity
        });
    }
    return out;
}

/**
 * Can this many dogs stay every night of the range? Returns the nights that
 * cannot take them, so the caller can say exactly which dates are the problem.
 * excludeBookingId lets a booking be re-checked without competing with itself.
 */
function checkRange(checkIn, checkOut, dogs, { excludeBookingId = null } = {}) {
    const capacity = collections.capacity();
    const list = nights(checkIn, checkOut);

    if (!list.length) return { ok: false, capacity, full: [], reason: 'Check-out must be after check-in.' };
    if (dogs < 1) return { ok: false, capacity, full: [], reason: 'Choose at least one dog.' };
    if (dogs > capacity) {
        return { ok: false, capacity, full: [], reason: `We can only take ${capacity} dogs a night.` };
    }

    const booked = bookedByNight(list[0], list[list.length - 1], { excludeBookingId });
    const full = list.filter(night => (capacity - (booked.get(night) || 0)) < dogs);

    return { ok: full.length === 0, capacity, full };
}

module.exports = { days, checkRange, nights, addDays, bookedByNight, OCCUPYING };
