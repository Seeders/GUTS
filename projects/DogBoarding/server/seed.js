/**
 * DogBoarding - demo data.
 *
 *     node projects/DogBoarding/server/seed.js
 *     node projects/DogBoarding/server/seed.js --wipe    (start from scratch)
 *
 * Fills the database with a plausible few months of a small boarding business,
 * so the back office has something to show. Everything is dated relative to
 * today, so the dashboard is always alive: dogs on site right now, arrivals and
 * departures today, invoices that have gone overdue, vaccinations about to
 * lapse.
 *
 * The books are built through the real accounting code, not by writing rows
 * directly - so the demo data obeys the same rules as real data, and the
 * reports add up.
 *
 * This is obviously fake. Names are invented, and every phone number is in the
 * 555 range.
 */

const fs = require('fs');
const path = require('path');
const db = require('./db');
const acct = require('./accounting');
const collections = require('./collections');

const WIPE = process.argv.includes('--wipe');

/* ------------------------------------------------------------------ */
/* Dates, relative to today                                            */
/* ------------------------------------------------------------------ */

const today = new Date();

function day(offset) {
    const d = new Date(today);
    d.setDate(d.getDate() + offset);
    return d.toISOString().slice(0, 10);
}

const TODAY = day(0);

function pick(list, i) {
    return list[i % list.length];
}

/* ------------------------------------------------------------------ */

function wipe() {
    const tables = ['invoice_items', 'invoices', 'payments', 'service_events',
        'booking_pets', 'bookings', 'vet_records', 'pets', 'clients', 'vets', 'expenses'];
    for (const table of tables) db.run(`DELETE FROM ${table}`);
    console.log('  Wiped existing records.');
}

/** A small PDF, so the "View" button on a vet record opens something real. */
function fakeCertificate(petName, kind) {
    const text = `${kind.toUpperCase()} CERTIFICATE - ${petName} (demo)`;
    const body = `BT /F1 14 Tf 60 700 Td (${text}) Tj ET`;
    const pdf = [
        '%PDF-1.4',
        '1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj',
        '2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj',
        '3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]/Resources<</Font<</F1 4 0 R>>>>/Contents 5 0 R>>endobj',
        '4 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj',
        `5 0 obj<</Length ${body.length}>>stream`,
        body,
        'endstream endobj',
        'trailer<</Root 1 0 R>>'
    ].join('\n');

    const name = `demo-${Date.now()}-${Math.round(performance.now() * 1000)}.pdf`;
    fs.writeFileSync(path.join(db.UPLOAD_DIR, name), pdf);
    return name;
}

/* ------------------------------------------------------------------ */
/* The cast                                                            */
/* ------------------------------------------------------------------ */

const VETS = [
    { clinic_name: 'Cedar Creek Veterinary', vet_name: 'Amara Silva', phone: '(555) 0170',
      email: 'front@cedarcreekvet.example', address1: '2 Mill Street',
      city: 'Fairview', state: 'OR', postal_code: '97024' },
    { clinic_name: 'Riverbend Animal Hospital', vet_name: 'Tom Okafor', phone: '(555) 0188',
      email: 'reception@riverbendvet.example', address1: '415 Ferry Road',
      city: 'Fairview', state: 'OR', postal_code: '97024' },
    { clinic_name: 'Northgate Vet Clinic', vet_name: 'Priya Raman', phone: '(555) 0143',
      email: 'hello@northgatevet.example', address1: '9 Alder Way',
      city: 'Gresham', state: 'OR', postal_code: '97030' }
];

const CLIENTS = [
    {
        first_name: 'Dana', last_name: 'Okonkwo', email: 'dana.okonkwo@example.com',
        phone: '(555) 0142', address1: '19 Larkspur Lane', city: 'Fairview', state: 'OR',
        postal_code: '97024', emergency_name: 'Ruth Okonkwo', emergency_phone: '(555) 0199',
        emergency_relationship: 'Sister', status: 'active',
        pets: [
            { name: 'Rex', breed: 'German Shepherd', sex: 'male', weight_lbs: 78, fixed: 1,
              birthdate: day(-2200), color: 'Black and tan',
              medications: 'Carprofen 75mg with breakfast',
              allergies: 'Chicken', feeding: '2 cups twice a day, own food supplied',
              behavior_notes: 'Wary of men in hats. Fine once he has met you.' },
            { name: 'Pip', breed: 'Jack Russell', sex: 'female', weight_lbs: 16, fixed: 1,
              birthdate: day(-1400), color: 'White with tan patches',
              feeding: '1 cup twice a day', behavior_notes: 'Escape artist. Check the latch twice.' }
        ]
    },
    {
        first_name: 'Marcus', last_name: 'Rowe', email: 'm.rowe@example.com',
        phone: '(555) 0117', address1: '88 Fern Hollow Road', city: 'Gresham', state: 'OR',
        postal_code: '97030', emergency_name: 'Elena Rowe', emergency_phone: '(555) 0118',
        emergency_relationship: 'Wife', status: 'active',
        pets: [
            { name: 'Biscuit', breed: 'Golden Retriever', sex: 'female', weight_lbs: 64, fixed: 1,
              birthdate: day(-1800), color: 'Golden',
              feeding: '3 cups morning and evening. Will eat anything, including things she should not.',
              behavior_notes: 'Relentlessly friendly.' }
        ]
    },
    {
        first_name: 'Ivy', last_name: 'Castellanos', email: 'ivy.c@example.com',
        phone: '(555) 0164', address1: '7 Quarry Court', city: 'Fairview', state: 'OR',
        postal_code: '97024', emergency_name: 'Rafael Castellanos', emergency_phone: '(555) 0165',
        emergency_relationship: 'Brother', status: 'active',
        pets: [
            { name: 'Juno', breed: 'Border Collie', sex: 'female', weight_lbs: 41, fixed: 1,
              birthdate: day(-900), color: 'Black and white',
              behavior_notes: 'Needs a job. Gets restless without work; loves the flirt pole.' },
            { name: 'Wren', breed: 'Border Collie', sex: 'female', weight_lbs: 38, fixed: 1,
              birthdate: day(-900), color: 'Merle', feeding: 'Raw, sent with her.',
              behavior_notes: 'Juno’s littermate. Housed together.' }
        ]
    },
    {
        first_name: 'Harold', last_name: 'Benn', email: 'h.benn@example.com',
        phone: '(555) 0102', address1: '204 Sycamore Avenue', city: 'Portland', state: 'OR',
        postal_code: '97220', emergency_name: 'Sadie Benn', emergency_phone: '(555) 0103',
        emergency_relationship: 'Daughter', status: 'active',
        pets: [
            { name: 'Duchess', breed: 'Standard Poodle', sex: 'female', weight_lbs: 52, fixed: 1,
              birthdate: day(-3000), color: 'Apricot',
              medications: 'Gabapentin 100mg at night, for her hips',
              behavior_notes: 'Elderly and dignified. Prefers a quiet run away from the puppies.' }
        ]
    },
    {
        first_name: 'Tessa', last_name: 'Lindqvist', email: 'tessa.l@example.com',
        phone: '(555) 0151', address1: '31 Harbour View', city: 'Fairview', state: 'OR',
        postal_code: '97024', emergency_name: 'Nils Lindqvist', emergency_phone: '(555) 0152',
        emergency_relationship: 'Father', status: 'active',
        pets: [
            { name: 'Bear', breed: 'Newfoundland', sex: 'male', weight_lbs: 138, fixed: 0,
              birthdate: day(-1100), color: 'Black',
              feeding: '4 cups twice daily. Slow-feeder bowl, he inhales it.',
              behavior_notes: 'Enormous and gentle. Drools. Will lean on you.' }
        ]
    },
    {
        first_name: 'Owen', last_name: 'Achebe', email: 'owen.achebe@example.com',
        phone: '(555) 0176', address1: '6 Blackthorn Close', city: 'Gresham', state: 'OR',
        postal_code: '97030', emergency_name: 'Grace Achebe', emergency_phone: '(555) 0177',
        emergency_relationship: 'Mother', status: 'active',
        pets: [
            { name: 'Momo', breed: 'Shiba Inu', sex: 'male', weight_lbs: 23, fixed: 1,
              birthdate: day(-700), color: 'Red',
              behavior_notes: 'Opinionated. Does not care for being picked up, and will tell you so.' }
        ]
    },
    {
        first_name: 'Nadia', last_name: 'Petrova', email: 'nadia.petrova@example.com',
        phone: '(555) 0133', address1: '77 Kestrel Rise', city: 'Portland', state: 'OR',
        postal_code: '97220', emergency_name: 'Sam Petrova', emergency_phone: '(555) 0134',
        emergency_relationship: 'Husband', status: 'pending',
        pets: [
            { name: 'Clementine', breed: 'Beagle', sex: 'female', weight_lbs: 27, fixed: 1,
              birthdate: day(-1300), color: 'Tricolour',
              behavior_notes: 'Nose first, brain second. Do not trust her recall off lead.' }
        ]
    },
    {
        first_name: 'Gerald', last_name: 'Mbeki', email: 'g.mbeki@example.com',
        phone: '(555) 0198', address1: '12 Willowmere', city: 'Fairview', state: 'OR',
        postal_code: '97024', emergency_name: 'Anne Mbeki', emergency_phone: '(555) 0197',
        emergency_relationship: 'Wife', status: 'active',
        pets: [
            { name: 'Sable', breed: 'Weimaraner', sex: 'female', weight_lbs: 60, fixed: 1,
              birthdate: day(-1600), color: 'Grey',
              behavior_notes: 'Separation anxiety. Settles best with a radio on.' }
        ]
    }
];

/* Vaccination state per dog, chosen so the alerts have something to say. */
const VACCINE_PLAN = {
    Rex:        { rabies: 900,  dhpp: 200,  bordetella: 120 },
    Pip:        { rabies: -20,  dhpp: 150,  bordetella: 90 },   // rabies EXPIRED
    Biscuit:    { rabies: 600,  dhpp: 15,   bordetella: 200 },  // dhpp expiring soon
    Juno:       { rabies: 800,  dhpp: 300,  bordetella: 250 },
    Wren:       { rabies: 800,  dhpp: 300,  bordetella: 250 },
    Duchess:    { rabies: 400,  dhpp: 180,  bordetella: null }, // bordetella MISSING
    Bear:       { rabies: 1000, dhpp: 220,  bordetella: 25 },   // bordetella expiring soon
    Momo:       { rabies: 500,  dhpp: 260,  bordetella: 310 },
    Clementine: { rabies: 700,  dhpp: null, bordetella: null }, // new client, records missing
    Sable:      { rabies: -60,  dhpp: 90,   bordetella: 45 }    // rabies EXPIRED
};

/* ------------------------------------------------------------------ */

function seed() {
    db.open();

    const existing = db.get('SELECT COUNT(*) AS n FROM clients').n;
    if (existing > 0 && !WIPE) {
        console.log(`\n  There are already ${existing} clients in the database.`);
        console.log('  Re-run with --wipe to replace them with the demo data.\n');
        process.exit(0);
    }
    if (WIPE) wipe();

    const stamp = db.nowIso();

    /* ---- vets ---- */
    const vetIds = VETS.map(v => db.insert('vets', { ...v, created_at: stamp }));

    /* ---- clients, dogs, vet records ---- */
    const petIdByName = {};
    const clientIds = [];

    CLIENTS.forEach((c, ci) => {
        const { pets, ...client } = c;

        const clientId = db.insert('clients', {
            ...client,
            country: 'US',
            created_at: stamp,
            updated_at: stamp
        });
        clientIds.push(clientId);

        for (const pet of pets) {
            const petId = db.insert('pets', {
                ...pet,
                client_id: clientId,
                vet_id: pick(vetIds, ci),
                status: 'active',
                created_at: stamp,
                updated_at: stamp
            });
            petIdByName[pet.name] = petId;

            const plan = VACCINE_PLAN[pet.name] || {};
            for (const [kind, expiresInDays] of Object.entries(plan)) {
                if (expiresInDays === null) continue; // deliberately missing

                // Half the records get a real document, so some rows show "View"
                // and some show "not supplied" - which is what real life looks like.
                const withFile = (petId + kind.length) % 2 === 0;

                db.insert('vet_records', {
                    pet_id: petId,
                    record_type: kind,
                    issued_on: day(expiresInDays - 365),
                    expires_on: day(expiresInDays),
                    file_path: withFile ? fakeCertificate(pet.name, kind) : null,
                    original_name: withFile ? `${pet.name.toLowerCase()}-${kind}.pdf` : null,
                    mime_type: withFile ? 'application/pdf' : null,
                    size_bytes: withFile ? 420 : null,
                    verified: withFile ? 1 : 0,
                    notes: null,
                    created_at: stamp
                });
            }
        }
    });

    /* ---- the rate card: the serviceCatalog collection, not a table ---- */
    const svc = {};
    for (const s of collections.services({ includeInactive: true })) svc[s.code] = s;

    const board = svc['BOARD-STD'];
    const luxury = svc['BOARD-LUX'];
    const sibling = svc['BOARD-2ND'];
    const daycare = svc['DAYCARE'];
    const bath = svc['BATH'];
    const nails = svc['NAILS'];
    const meds = svc['MEDS'];
    const walk = svc['WALK-30'];

    /* ---- bookings ----------------------------------------------------
       Dated so that the dashboard is never empty: dogs on site now, someone
       arriving today, someone leaving today, and history behind it.        */

    const BOOKINGS = [
        // history - finished, billed, mostly paid
        { client: 0, pets: ['Rex', 'Pip'], in: day(-38), out: day(-33), status: 'checked_out',
          charges: [[board, ['Rex']], [sibling, ['Pip']], [bath, ['Rex']]] },
        { client: 1, pets: ['Biscuit'], in: day(-30), out: day(-27), status: 'checked_out',
          charges: [[board, ['Biscuit']], [nails, ['Biscuit']]] },
        { client: 3, pets: ['Duchess'], in: day(-24), out: day(-17), status: 'checked_out',
          charges: [[luxury, ['Duchess']], [meds, ['Duchess']]] },
        { client: 2, pets: ['Juno', 'Wren'], in: day(-20), out: day(-14), status: 'checked_out',
          charges: [[board, ['Juno']], [sibling, ['Wren']], [walk, ['Juno', 'Wren']]] },
        { client: 5, pets: ['Momo'], in: day(-12), out: day(-9), status: 'checked_out',
          charges: [[board, ['Momo']]] },
        { client: 7, pets: ['Sable'], in: day(-9), out: day(-4), status: 'checked_out',
          charges: [[board, ['Sable']], [bath, ['Sable']]] },

        // on site right now
        { client: 4, pets: ['Bear'], in: day(-2), out: day(3), status: 'checked_in',
          kennels: { Bear: 'Run 1' },
          charges: [[luxury, ['Bear']], [meds, ['Bear']]] },
        { client: 2, pets: ['Juno', 'Wren'], in: day(-1), out: day(2), status: 'checked_in',
          kennels: { Juno: 'Run 4', Wren: 'Run 4' },
          charges: [[board, ['Juno']], [sibling, ['Wren']]] },

        // leaving today
        { client: 1, pets: ['Biscuit'], in: day(-3), out: TODAY, status: 'checked_in',
          kennels: { Biscuit: 'Run 2' },
          charges: [[board, ['Biscuit']], [bath, ['Biscuit']]] },

        // arriving today
        { client: 0, pets: ['Rex', 'Pip'], in: TODAY, out: day(5), status: 'confirmed',
          charges: [] },

        // future, confirmed
        { client: 3, pets: ['Duchess'], in: day(9), out: day(16), status: 'confirmed', charges: [] },
        { client: 7, pets: ['Sable'], in: day(12), out: day(15), status: 'confirmed', charges: [] },

        // a request off the public site, waiting on a human
        { client: 6, pets: ['Clementine'], in: day(7), out: day(11), status: 'requested',
          source: 'public', notes: 'First stay. Asked whether we can send a photo.', charges: [] }
    ];

    const bookingIds = [];

    for (const b of BOOKINGS) {
        const clientId = clientIds[b.client];
        const bookingId = db.insert('bookings', {
            client_id: clientId,
            check_in: b.in,
            check_out: b.out,
            status: b.status,
            source: b.source || 'admin',
            notes: b.notes || null,
            created_at: stamp,
            updated_at: stamp
        });
        bookingIds.push(bookingId);

        for (const petName of b.pets) {
            db.run('INSERT INTO booking_pets (booking_id, pet_id, kennel) VALUES (?, ?, ?)',
                bookingId, petIdByName[petName], (b.kennels || {})[petName] || null);
        }

        const nights = Math.max(1,
            Math.round((new Date(b.out) - new Date(b.in)) / 86400_000));

        for (const [service, petNames] of b.charges) {
            const perNight = service.unit === 'night' || service.unit === 'day';
            const qty = perNight ? nights : 1;

            for (const petName of petNames) {
                db.insert('service_events', {
                    client_id: clientId,
                    pet_id: petIdByName[petName],
                    booking_id: bookingId,
                    service_id: service.id,
                    invoice_id: null,
                    description: service.name,
                    performed_on: b.in,
                    qty,
                    unit_price_cents: service.price_cents,
                    amount_cents: acct.lineAmount(qty, service.price_cents),
                    taxable: service.taxable,
                    staff: pick(['Marco', 'Jules', 'Ada'], petName.length),
                    notes: null,
                    created_at: stamp
                });
            }
        }
    }

    // A couple of daycare days, unattached to any stay.
    for (const [petName, offset] of [['Momo', -5], ['Biscuit', -6], ['Momo', -19]]) {
        const petId = petIdByName[petName];
        const pet = db.get('SELECT client_id FROM pets WHERE id = ?', petId);
        db.insert('service_events', {
            client_id: pet.client_id, pet_id: petId, booking_id: null,
            service_id: daycare.id, invoice_id: null,
            description: daycare.name, performed_on: day(offset),
            qty: 1, unit_price_cents: daycare.price_cents,
            amount_cents: daycare.price_cents, taxable: daycare.taxable,
            staff: 'Ada', notes: null, created_at: stamp
        });
    }

    /* ---- invoices and payments ---------------------------------------
       Built through the real accounting code, so the reports add up.      */

    // Dana: invoiced a month ago, paid in full.
    const inv1 = acct.createInvoiceFromUnbilled(clientIds[0],
        { issued_on: day(-33), through: day(-30) });
    db.insert('payments', {
        client_id: clientIds[0], invoice_id: inv1.id, paid_on: day(-31),
        amount_cents: inv1.total_cents, method: 'card', reference: 'visa 4021',
        notes: null, created_at: stamp
    });
    acct.recomputeInvoice(inv1.id);

    // Marcus: invoiced, paid part of it.
    const inv2 = acct.createInvoiceFromUnbilled(clientIds[1],
        { issued_on: day(-26), through: day(-25) });
    db.insert('payments', {
        client_id: clientIds[1], invoice_id: inv2.id, paid_on: day(-20),
        amount_cents: Math.round(inv2.total_cents * 0.6), method: 'cash',
        reference: null, notes: 'Paying the rest at pickup.', created_at: stamp
    });
    acct.recomputeInvoice(inv2.id);

    // Harold: invoiced six weeks ago and never paid. This is the overdue one.
    const inv3 = acct.createInvoiceFromUnbilled(clientIds[3],
        { issued_on: day(-45), through: day(-16) });
    db.update('invoices', inv3.id, { due_on: day(-31) });
    acct.recomputeInvoice(inv3.id);

    // Ivy: invoiced, paid on time.
    const inv4 = acct.createInvoiceFromUnbilled(clientIds[2],
        { issued_on: day(-13), through: day(-13) });
    db.insert('payments', {
        client_id: clientIds[2], invoice_id: inv4.id, paid_on: day(-11),
        amount_cents: inv4.total_cents, method: 'ach', reference: 'transfer 8871',
        notes: null, created_at: stamp
    });
    acct.recomputeInvoice(inv4.id);

    // Gerald: invoiced last week, due but not yet late.
    const inv5 = acct.createInvoiceFromUnbilled(clientIds[7],
        { issued_on: day(-3), through: day(-3) });
    void inv5;

    // Tessa is paying ahead: money on account, no invoice yet. Shows as credit.
    db.insert('payments', {
        client_id: clientIds[4], invoice_id: null, paid_on: day(-2),
        amount_cents: 20000, method: 'check', reference: 'cheque 1042',
        notes: 'Deposit towards Bear’s stay.', created_at: stamp
    });

    // Everything else - the current stays, the daycare days - stays UNBILLED,
    // so the "Ready to bill" queue has something in it.

    /* ---- expenses ---- */
    const EXPENSES = [
        [-58, 'food', 'Cascade Pet Supply', '12 bags of kibble', 24500, 0, null],
        [-52, 'utilities', 'Fairview Power', 'Electricity, February', 18700, 0, null],
        [-47, 'cleaning', 'Bright & Co', 'Disinfectant, laundry powder', 8900, 0, null],
        [-45, 'maintenance', 'Ridgeline Fencing', 'Rebuilt the north run gate', 68000, 1, 'North kennel run'],
        [-40, 'payroll', 'Staff', 'Wages, first half of the month', 312000, 0, null],
        [-38, 'insurance', 'Mutual of Oregon', 'Liability, quarterly', 43000, 0, null],
        [-31, 'food', 'Cascade Pet Supply', 'Kibble and treats', 21200, 0, null],
        [-28, 'equipment', 'KennelWorks', 'Two replacement cots', 24000, 1, 'Suites 2 and 3'],
        [-25, 'utilities', 'Fairview Power', 'Electricity, March', 19400, 0, null],
        [-22, 'marketing', 'Local Herald', 'Quarter-page advert', 15000, 0, null],
        [-20, 'payroll', 'Staff', 'Wages, second half', 318000, 0, null],
        [-16, 'maintenance', 'Ace Plumbing', 'Blocked drain in the wash room', 22500, 1, 'Wash room'],
        [-12, 'supplies', 'Cascade Pet Supply', 'Bowls, leads, poop bags', 6400, 0, null],
        [-9,  'software', 'Boarding Software Co', 'Monthly subscription', 4900, 0, null],
        [-7,  'food', 'Cascade Pet Supply', 'Kibble', 22800, 0, null],
        [-5,  'fuel', 'Shell', 'Pickup and drop-off runs', 7600, 0, null],
        [-3,  'maintenance', 'Ridgeline Fencing', 'Serviced the perimeter fence', 14000, 1, 'Perimeter fence'],
        [-1,  'cleaning', 'Bright & Co', 'Laundry powder, bleach', 5200, 0, null]
    ];

    for (const [offset, category, vendor, description, amount, maintenance, asset] of EXPENSES) {
        db.insert('expenses', {
            incurred_on: day(offset),
            category, vendor, description,
            amount_cents: amount,
            payment_method: pick(['card', 'ach', 'card', 'check'], amount),
            receipt_path: null, receipt_name: null,
            is_maintenance: maintenance,
            asset,
            recurring: ['payroll', 'utilities', 'insurance', 'software'].includes(category)
                ? 'monthly' : 'none',
            notes: null,
            created_at: stamp
        });
    }

    // The business details are not seeded: they are the `business` config in the
    // collections, edited in the GUTS editor.

    /* ---- what we made ---- */
    const count = t => db.get(`SELECT COUNT(*) AS n FROM ${t}`).n;
    const ar = acct.arAging(TODAY);
    const unbilled = db.get(
        'SELECT COALESCE(SUM(amount_cents), 0) AS v FROM service_events WHERE invoice_id IS NULL').v;
    const alerts = acct.vaccinationAlerts().alerts.length;
    const onSite = db.get(
        "SELECT COUNT(*) AS n FROM booking_pets bp JOIN bookings b ON b.id = bp.booking_id WHERE b.status = 'checked_in'").n;

    console.log('');
    console.log('  Demo data loaded.');
    console.log('');
    console.log(`    clients            ${count('clients')}  (1 pending approval)`);
    console.log(`    dogs               ${count('pets')}`);
    console.log(`    vets               ${count('vets')}`);
    console.log(`    vet records        ${count('vet_records')}`);
    console.log(`    bookings           ${count('bookings')}  (${onSite} dogs on site right now)`);
    console.log(`    services performed ${count('service_events')}`);
    console.log(`    invoices           ${count('invoices')}`);
    console.log(`    payments           ${count('payments')}`);
    console.log(`    expenses           ${count('expenses')}`);
    console.log('');
    console.log(`    owed to us         ${(ar.total_cents / 100).toFixed(2)}`);
    console.log(`    unbilled work      ${(unbilled / 100).toFixed(2)}`);
    console.log(`    vaccination alerts ${alerts}`);
    console.log('');
}

seed();
