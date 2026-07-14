/**
 * DogBoarding - accounting core.
 *
 * The money rules, in one place:
 *
 *  - A *service event* is "we did this thing for this dog on this day". It is
 *    the unit of work and the unit of billing. It starts life unbilled
 *    (invoice_id IS NULL).
 *  - An *invoice* snapshots a set of service events into immutable
 *    invoice_items. Editing a service event afterwards does not silently
 *    rewrite history on an issued invoice.
 *  - A *payment* is money received. It may be applied to an invoice, or left
 *    unapplied (invoice_id NULL), in which case it is a credit on the account.
 *  - An invoice's balance is total - payments applied to it. Status follows
 *    from that, except 'void', which is a human decision.
 *
 * Everything is integer cents. Never floats.
 */

const db = require('./db');
const collections = require('./collections');

function taxRateBps() {
    return collections.business().taxRateBps;
}

function round(n) {
    return Math.round(n);
}

/** Compute the amount for a line: qty * unit price, rounded to the cent. */
function lineAmount(qty, unitPriceCents) {
    return round(Number(qty) * Number(unitPriceCents));
}

/* ------------------------------------------------------------------ */
/* Invoice numbering                                                    */
/* ------------------------------------------------------------------ */

function nextInvoiceNumber() {
    const prefix = collections.business().invoicePrefix;
    const year = new Date().getFullYear();
    const like = `${prefix}-${year}-%`;

    const row = db.get(
        'SELECT number FROM invoices WHERE number LIKE ? ORDER BY id DESC LIMIT 1', like);

    let seq = 1;
    if (row) {
        const tail = parseInt(String(row.number).split('-').pop(), 10);
        if (!Number.isNaN(tail)) seq = tail + 1;
    }
    return `${prefix}-${year}-${String(seq).padStart(4, '0')}`;
}

/* ------------------------------------------------------------------ */
/* Invoice totals & status                                              */
/* ------------------------------------------------------------------ */

/**
 * Recompute an invoice's subtotal/tax/total from its items, then move its
 * status to match what has been paid. Void invoices are left alone.
 */
function recomputeInvoice(invoiceId) {
    const invoice = db.get('SELECT * FROM invoices WHERE id = ?', invoiceId);
    if (!invoice) return null;

    const items = db.all('SELECT * FROM invoice_items WHERE invoice_id = ?', invoiceId);

    const subtotal = items.reduce((sum, i) => sum + i.amount_cents, 0);
    const taxable = items.reduce((sum, i) => sum + (i.taxable ? i.amount_cents : 0), 0);
    const tax = round(taxable * taxRateBps() / 10000);
    const total = subtotal + tax;

    const patch = {
        subtotal_cents: subtotal,
        tax_cents: tax,
        total_cents: total,
        updated_at: db.nowIso()
    };

    if (invoice.status !== 'void' && invoice.status !== 'draft') {
        const paid = amountPaid(invoiceId);
        patch.status = paid >= total && total > 0 ? 'paid' : 'open';
    }

    db.update('invoices', invoiceId, patch);
    return db.get('SELECT * FROM invoices WHERE id = ?', invoiceId);
}

function amountPaid(invoiceId) {
    const row = db.get(
        'SELECT COALESCE(SUM(amount_cents), 0) AS paid FROM payments WHERE invoice_id = ?', invoiceId);
    return row.paid;
}

/** An invoice plus its lines, what has been paid, and what is left. */
function invoiceDetail(invoiceId) {
    const invoice = db.get(`
        SELECT i.*, c.first_name, c.last_name, c.email, c.phone,
               c.address1, c.address2, c.city, c.state, c.postal_code
        FROM invoices i
        JOIN clients c ON c.id = i.client_id
        WHERE i.id = ?`, invoiceId);
    if (!invoice) return null;

    const items = db.all(`
        SELECT ii.*, p.name AS pet_name
        FROM invoice_items ii
        LEFT JOIN pets p ON p.id = ii.pet_id
        WHERE ii.invoice_id = ?
        ORDER BY ii.performed_on, ii.id`, invoiceId);

    const payments = db.all(
        'SELECT * FROM payments WHERE invoice_id = ? ORDER BY paid_on, id', invoiceId);

    const paid = payments.reduce((sum, p) => sum + p.amount_cents, 0);

    return {
        ...invoice,
        items,
        payments,
        amount_paid_cents: paid,
        balance_cents: invoice.status === 'void' ? 0 : invoice.total_cents - paid
    };
}

/* ------------------------------------------------------------------ */
/* Building an invoice from unbilled work                               */
/* ------------------------------------------------------------------ */

function unbilledEvents(clientId, throughDate = null) {
    const params = [clientId];
    let sql = `
        SELECT se.*, p.name AS pet_name
        FROM service_events se
        JOIN pets p ON p.id = se.pet_id
        WHERE se.client_id = ? AND se.invoice_id IS NULL`;
    if (throughDate) {
        sql += ' AND se.performed_on <= ?';
        params.push(throughDate);
    }
    sql += ' ORDER BY se.performed_on, se.id';
    return db.all(sql, ...params);
}

/**
 * Snapshot every unbilled service event for a client into a new invoice.
 * Returns the created invoice, or throws if there is nothing to bill.
 */
function createInvoiceFromUnbilled(clientId, opts = {}) {
    const events = unbilledEvents(clientId, opts.through || null);
    if (events.length === 0) {
        const err = new Error('This client has no unbilled services to invoice.');
        err.status = 400;
        throw err;
    }

    const issuedOn = opts.issued_on || db.today();
    const termsDays = collections.business().invoiceTermsDays;
    const dueOn = opts.due_on
        || new Date(new Date(issuedOn).getTime() + termsDays * 86400_000).toISOString().slice(0, 10);

    return db.tx(() => {
        const stamp = db.nowIso();
        const invoiceId = db.insert('invoices', {
            number: nextInvoiceNumber(),
            client_id: clientId,
            issued_on: issuedOn,
            due_on: dueOn,
            status: opts.status === 'draft' ? 'draft' : 'open',
            subtotal_cents: 0,
            tax_cents: 0,
            total_cents: 0,
            notes: opts.notes || null,
            created_at: stamp,
            updated_at: stamp
        });

        for (const ev of events) {
            db.insert('invoice_items', {
                invoice_id: invoiceId,
                service_event_id: ev.id,
                pet_id: ev.pet_id,
                description: `${ev.pet_name}: ${ev.description}`,
                performed_on: ev.performed_on,
                qty: ev.qty,
                unit_price_cents: ev.unit_price_cents,
                amount_cents: ev.amount_cents,
                taxable: ev.taxable
            });
            db.update('service_events', ev.id, { invoice_id: invoiceId });
        }

        recomputeInvoice(invoiceId);
        return invoiceDetail(invoiceId);
    });
}

/**
 * Voiding releases the work back to unbilled so it can be re-invoiced, and
 * detaches payments (they become account credits rather than vanishing).
 */
function voidInvoice(invoiceId) {
    return db.tx(() => {
        db.run('UPDATE service_events SET invoice_id = NULL WHERE invoice_id = ?', invoiceId);
        db.run('UPDATE payments SET invoice_id = NULL WHERE invoice_id = ?', invoiceId);
        db.update('invoices', invoiceId, { status: 'void', updated_at: db.nowIso() });
        return db.get('SELECT * FROM invoices WHERE id = ?', invoiceId);
    });
}

/* ------------------------------------------------------------------ */
/* Balances                                                             */
/* ------------------------------------------------------------------ */

/**
 * What a client owes.
 *   owed   = sum of balances on open invoices
 *   credit = payments not applied to any invoice
 *   net    = owed - credit  (negative means we are holding their money)
 */
function clientBalance(clientId) {
    const owedRow = db.get(`
        SELECT COALESCE(SUM(i.total_cents), 0) AS billed,
               COALESCE((
                   SELECT SUM(p.amount_cents) FROM payments p
                   JOIN invoices i2 ON i2.id = p.invoice_id
                   WHERE i2.client_id = ? AND i2.status != 'void'
               ), 0) AS applied
        FROM invoices i
        WHERE i.client_id = ? AND i.status != 'void'`, clientId, clientId);

    const creditRow = db.get(`
        SELECT COALESCE(SUM(amount_cents), 0) AS credit
        FROM payments WHERE client_id = ? AND invoice_id IS NULL`, clientId);

    const owed = owedRow.billed - owedRow.applied;
    const credit = creditRow.credit;

    const unbilledRow = db.get(`
        SELECT COALESCE(SUM(amount_cents), 0) AS unbilled
        FROM service_events WHERE client_id = ? AND invoice_id IS NULL`, clientId);

    return {
        billed_cents: owedRow.billed,
        applied_cents: owedRow.applied,
        owed_cents: owed,
        credit_cents: credit,
        net_due_cents: owed - credit,
        unbilled_cents: unbilledRow.unbilled
    };
}

/* ------------------------------------------------------------------ */
/* Reports                                                              */
/* ------------------------------------------------------------------ */

/** Accounts receivable, bucketed by how overdue each invoice is. */
function arAging(asOf = db.today()) {
    const invoices = db.all(`
        SELECT i.id, i.number, i.client_id, i.issued_on, i.due_on, i.total_cents,
               c.first_name, c.last_name,
               COALESCE((SELECT SUM(p.amount_cents) FROM payments p WHERE p.invoice_id = i.id), 0) AS paid
        FROM invoices i
        JOIN clients c ON c.id = i.client_id
        WHERE i.status IN ('open', 'draft')
        ORDER BY i.due_on`);

    const buckets = { current: 0, d1_30: 0, d31_60: 0, d61_90: 0, d90_plus: 0 };
    const rows = [];
    let total = 0;

    for (const inv of invoices) {
        const balance = inv.total_cents - inv.paid;
        if (balance <= 0) continue;

        const due = inv.due_on || inv.issued_on;
        const daysOverdue = Math.floor(
            (new Date(asOf) - new Date(due)) / 86400_000);

        let bucket;
        if (daysOverdue <= 0) bucket = 'current';
        else if (daysOverdue <= 30) bucket = 'd1_30';
        else if (daysOverdue <= 60) bucket = 'd31_60';
        else if (daysOverdue <= 90) bucket = 'd61_90';
        else bucket = 'd90_plus';

        buckets[bucket] += balance;
        total += balance;

        rows.push({
            invoice_id: inv.id,
            number: inv.number,
            client_id: inv.client_id,
            client_name: `${inv.first_name} ${inv.last_name}`,
            issued_on: inv.issued_on,
            due_on: inv.due_on,
            balance_cents: balance,
            days_overdue: Math.max(0, daysOverdue),
            bucket
        });
    }

    return { as_of: asOf, buckets, total_cents: total, invoices: rows };
}

/**
 * Profit & loss over a date range.
 *
 * We report revenue two ways, because they answer different questions:
 *   accrual - what we billed (invoices issued in the range)
 *   cash    - what actually landed (payments received in the range)
 * Expenses are cash-basis by incurred date.
 */
function profitAndLoss(from, to) {
    const billed = db.get(`
        SELECT COALESCE(SUM(total_cents), 0) AS v FROM invoices
        WHERE status != 'void' AND issued_on BETWEEN ? AND ?`, from, to).v;

    const collected = db.get(`
        SELECT COALESCE(SUM(amount_cents), 0) AS v FROM payments
        WHERE paid_on BETWEEN ? AND ?`, from, to).v;

    const expenses = db.get(`
        SELECT COALESCE(SUM(amount_cents), 0) AS v FROM expenses
        WHERE incurred_on BETWEEN ? AND ?`, from, to).v;

    const byCategory = db.all(`
        SELECT category, SUM(amount_cents) AS amount_cents, COUNT(*) AS count
        FROM expenses WHERE incurred_on BETWEEN ? AND ?
        GROUP BY category ORDER BY amount_cents DESC`, from, to);

    const byService = db.all(`
        SELECT description, SUM(qty) AS qty, SUM(amount_cents) AS amount_cents, COUNT(*) AS count
        FROM service_events WHERE performed_on BETWEEN ? AND ?
        GROUP BY description ORDER BY amount_cents DESC`, from, to);

    const monthly = db.all(`
        SELECT month, SUM(billed) AS billed, SUM(collected) AS collected, SUM(spent) AS spent FROM (
            SELECT substr(issued_on, 1, 7) AS month, total_cents AS billed, 0 AS collected, 0 AS spent
                FROM invoices WHERE status != 'void' AND issued_on BETWEEN ? AND ?
            UNION ALL
            SELECT substr(paid_on, 1, 7), 0, amount_cents, 0
                FROM payments WHERE paid_on BETWEEN ? AND ?
            UNION ALL
            SELECT substr(incurred_on, 1, 7), 0, 0, amount_cents
                FROM expenses WHERE incurred_on BETWEEN ? AND ?
        ) GROUP BY month ORDER BY month`,
        from, to, from, to, from, to);

    const maintenance = db.get(`
        SELECT COALESCE(SUM(amount_cents), 0) AS v FROM expenses
        WHERE is_maintenance = 1 AND incurred_on BETWEEN ? AND ?`, from, to).v;

    return {
        from, to,
        billed_cents: billed,
        collected_cents: collected,
        expenses_cents: expenses,
        maintenance_cents: maintenance,
        net_accrual_cents: billed - expenses,
        net_cash_cents: collected - expenses,
        by_category: byCategory,
        by_service: byService,
        monthly
    };
}

/** Every service performed for each dog in a range - "what did we do for Rex?" */
function servicesByPet(from, to, petId = null) {
    const params = [from, to];
    let sql = `
        SELECT se.*, p.name AS pet_name, p.breed,
               c.first_name, c.last_name,
               i.number AS invoice_number
        FROM service_events se
        JOIN pets p    ON p.id = se.pet_id
        JOIN clients c ON c.id = se.client_id
        LEFT JOIN invoices i ON i.id = se.invoice_id
        WHERE se.performed_on BETWEEN ? AND ?`;
    if (petId) {
        sql += ' AND se.pet_id = ?';
        params.push(petId);
    }
    sql += ' ORDER BY p.name, se.performed_on, se.id';

    const events = db.all(sql, ...params);

    const byPet = new Map();
    for (const ev of events) {
        if (!byPet.has(ev.pet_id)) {
            byPet.set(ev.pet_id, {
                pet_id: ev.pet_id,
                pet_name: ev.pet_name,
                breed: ev.breed,
                owner: `${ev.first_name} ${ev.last_name}`,
                events: [],
                total_cents: 0
            });
        }
        const entry = byPet.get(ev.pet_id);
        entry.events.push(ev);
        entry.total_cents += ev.amount_cents;
    }

    return { from, to, pets: [...byPet.values()] };
}

/** Dogs on site per day - how full are we. */
function occupancy(from, to) {
    const bookings = db.all(`
        SELECT b.id, b.check_in, b.check_out, b.status, COUNT(bp.pet_id) AS dogs
        FROM bookings b
        LEFT JOIN booking_pets bp ON bp.booking_id = b.id
        WHERE b.status IN ('confirmed', 'checked_in', 'checked_out')
          AND b.check_in <= ? AND b.check_out >= ?
        GROUP BY b.id`, to, from);

    const days = [];
    for (let d = new Date(from); d <= new Date(to); d.setDate(d.getDate() + 1)) {
        const day = d.toISOString().slice(0, 10);
        const dogs = bookings
            .filter(b => b.check_in <= day && b.check_out > day)
            .reduce((sum, b) => sum + b.dogs, 0);
        days.push({ date: day, dogs });
    }

    const peak = days.reduce((max, d) => Math.max(max, d.dogs), 0);
    const avg = days.length ? days.reduce((s, d) => s + d.dogs, 0) / days.length : 0;

    return { from, to, days, peak_dogs: peak, avg_dogs: Math.round(avg * 10) / 10 };
}

/**
 * Vaccination status. A dog is a problem if a required vaccine is missing,
 * expired, or expiring inside the warning window.
 */
function vaccinationAlerts() {
    // Both of these are collections, not settings: the warning window is business
    // config, and which vaccinations are required is a property of the record type.
    const warnDays = collections.business().vaccineWarnDays;
    const required = collections.requiredVaccines();

    const today = db.today();
    const horizon = new Date(Date.now() + warnDays * 86400_000).toISOString().slice(0, 10);

    const pets = db.all(`
        SELECT p.id, p.name, p.client_id, c.first_name, c.last_name, c.email, c.phone
        FROM pets p JOIN clients c ON c.id = p.client_id
        WHERE p.status = 'active'`);

    const alerts = [];

    for (const pet of pets) {
        const records = db.all(
            'SELECT * FROM vet_records WHERE pet_id = ? ORDER BY expires_on DESC', pet.id);

        for (const vaccine of required) {
            const match = records
                .filter(r => (r.record_type || '').toLowerCase() === vaccine)
                .sort((a, b) => String(b.expires_on || '').localeCompare(String(a.expires_on || '')))[0];

            let severity = null;
            if (!match) severity = 'missing';
            else if (!match.expires_on) severity = 'no_expiry';
            else if (match.expires_on < today) severity = 'expired';
            else if (match.expires_on <= horizon) severity = 'expiring';

            if (severity) {
                alerts.push({
                    pet_id: pet.id,
                    pet_name: pet.name,
                    client_id: pet.client_id,
                    client_name: `${pet.first_name} ${pet.last_name}`,
                    email: pet.email,
                    phone: pet.phone,
                    vaccine,
                    severity,
                    expires_on: match ? match.expires_on : null,
                    record_id: match ? match.id : null,
                    verified: match ? !!match.verified : false
                });
            }
        }
    }

    const rank = { expired: 0, missing: 1, no_expiry: 2, expiring: 3 };
    alerts.sort((a, b) => (rank[a.severity] - rank[b.severity])
        || String(a.expires_on).localeCompare(String(b.expires_on)));

    return { as_of: today, warn_days: warnDays, required, alerts };
}

/**
 * Which required vaccinations stand between these dogs and a stay that runs
 * until `throughDate`.
 *
 * This is NOT the same question as "is the vaccine valid today". A rabies shot
 * that lapses halfway through a two-week stay is no good for that stay, so the
 * date we measure against is the day the dog goes home.
 *
 * A required record type that carries an expiry (typicalValidMonths) needs a
 * date, and that date has to outlast the stay - otherwise an uploaded record
 * with the expiry left blank would quietly walk straight through this check.
 * A required type with no expiry at all just needs a record on file.
 */
function vaccinationBlockers(petIds, throughDate) {
    if (!petIds || !petIds.length) return [];

    const required = collections.requiredVaccines();
    if (!required.length) return [];

    const types = new Map(collections.recordTypes().map(t => [t.id, t]));
    const blockers = [];

    for (const petId of petIds) {
        const pet = db.get('SELECT id, name FROM pets WHERE id = ?', petId);
        if (!pet) continue;

        const records = db.all('SELECT * FROM vet_records WHERE pet_id = ?', pet.id);

        for (const vaccine of required) {
            const type = types.get(vaccine) || {};
            const title = type.title || vaccine;

            const match = records
                .filter(r => (r.record_type || '').toLowerCase() === vaccine)
                .sort((a, b) => String(b.expires_on || '').localeCompare(String(a.expires_on || '')))[0];

            const flag = severity => blockers.push({
                pet_id: pet.id,
                pet_name: pet.name,
                vaccine,
                vaccine_title: title,
                severity,
                expires_on: match ? match.expires_on : null
            });

            if (!match) { flag('missing'); continue; }
            if (!type.typicalValidMonths) continue;         // never expires; having it is enough
            if (!match.expires_on) { flag('no_expiry'); continue; }
            if (match.expires_on < throughDate) flag('expired');
        }
    }

    return blockers;
}

/** The blockers as one sentence a dog owner can act on. */
function vaccinationBlockerMessage(blockers) {
    const bits = blockers.map(b => {
        if (b.severity === 'missing') return `${b.pet_name} has no ${b.vaccine_title} record on file`;
        if (b.severity === 'no_expiry') return `${b.pet_name}'s ${b.vaccine_title} record has no expiry date`;
        return `${b.pet_name}'s ${b.vaccine_title} expires ${b.expires_on}, before the stay ends`;
    });
    return `${bits.join('; ')}. Please add an up-to-date record before booking.`;
}

module.exports = {
    lineAmount, taxRateBps, nextInvoiceNumber,
    recomputeInvoice, amountPaid, invoiceDetail,
    unbilledEvents, createInvoiceFromUnbilled, voidInvoice,
    clientBalance,
    arAging, profitAndLoss, servicesByPet, occupancy, vaccinationAlerts,
    vaccinationBlockers, vaccinationBlockerMessage
};
