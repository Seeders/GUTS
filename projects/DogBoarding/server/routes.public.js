/**
 * DogBoarding - public routes.
 *
 * These are unauthenticated: anyone on the internet can hit them. So they are
 * deliberately narrow. A member of the public can do exactly two things:
 *   - read the business info and price list
 *   - submit an intake form (themselves, their dogs, their vet, vet records)
 *
 * They cannot read anything back out. Intake creates a client in 'pending'
 * status; a human confirms them in the admin console.
 */

const express = require('express');
const db = require('./db');
const collections = require('./collections');
const { upload } = require('./uploads');

const router = express.Router();

/* ------------------------------------------------------------------ */
/* Crude per-IP rate limiting, so the intake form can't be used to fill */
/* the disk with junk PDFs.                                            */
/* ------------------------------------------------------------------ */

const WINDOW_MS = 60 * 60 * 1000;
const MAX_SUBMISSIONS = 5;
const hits = new Map(); // ip -> timestamps[]

function rateLimit(req, res, next) {
    const ip = req.ip || 'unknown';
    const now = Date.now();
    const recent = (hits.get(ip) || []).filter(t => now - t < WINDOW_MS);

    if (recent.length >= MAX_SUBMISSIONS) {
        return res.status(429).json({
            error: 'Too many submissions from this address. Please call us instead.'
        });
    }

    recent.push(now);
    hits.set(ip, recent);
    next();
}

/* ------------------------------------------------------------------ */
/* Validation                                                          */
/* ------------------------------------------------------------------ */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function clean(value) {
    if (value === undefined || value === null) return null;
    const str = String(value).trim();
    return str === '' ? null : str;
}

function validateIntake(payload) {
    const errors = [];
    const client = payload.client || {};
    const pets = Array.isArray(payload.pets) ? payload.pets : [];

    if (!clean(client.first_name)) errors.push('Your first name is required.');
    if (!clean(client.last_name)) errors.push('Your last name is required.');
    if (!clean(client.email)) errors.push('Your email is required.');
    else if (!EMAIL_RE.test(client.email.trim())) errors.push('That email address does not look right.');
    if (!clean(client.phone)) errors.push('A phone number is required.');
    if (!clean(client.address1)) errors.push('Your street address is required.');
    if (!clean(client.city)) errors.push('Your city is required.');
    if (!clean(client.state)) errors.push('Your state is required.');
    if (!clean(client.postal_code)) errors.push('Your ZIP code is required.');
    if (!clean(client.emergency_name) || !clean(client.emergency_phone)) {
        errors.push('An emergency contact name and phone number are required.');
    }

    if (pets.length === 0) errors.push('Please tell us about at least one dog.');
    pets.forEach((pet, i) => {
        if (!clean(pet.name)) errors.push(`Dog #${i + 1} needs a name.`);
    });

    const vet = payload.vet || {};
    if (!clean(vet.clinic_name)) errors.push("Your veterinarian's clinic name is required.");
    if (!clean(vet.phone)) errors.push("Your veterinarian's phone number is required.");

    return errors;
}

/* ------------------------------------------------------------------ */
/* Routes                                                              */
/* ------------------------------------------------------------------ */

/**
 * Business details and the public price list.
 *
 * Both come from the collections, not the database. The rate card IS
 * serviceCatalog and the business details ARE the business config - copying them
 * into SQLite would only give us a second copy to keep in step, and a price
 * edited in the editor would not show up here. Which is exactly what used to
 * happen.
 */
router.get('/info', (req, res) => {
    const business = collections.business();

    res.json({
        business: {
            name: business.name,
            email: business.email,
            phone: business.phone,
            address: business.address
        },
        required_vaccines: collections.requiredVaccines(),
        services: collections.services()
            .sort((a, b) => b.price_cents - a.price_cents)
    });
});

/**
 * Intake. Multipart, because vet records come along for the ride.
 *
 *   payload  - JSON string: { client, vet, pets[], records[], booking? }
 *   records  - the uploaded files, in the same order as payload.records[]
 *
 * Each payload.records[i] says which pet its file belongs to (petIndex) and
 * what it is (record_type, issued_on, expires_on).
 */
router.post('/intake', rateLimit, upload.array('records', 20), (req, res, next) => {
    const uploaded = req.files || [];

    let payload;
    try {
        payload = JSON.parse(req.body.payload || '{}');
    } catch {
        return res.status(400).json({ error: 'Malformed submission.' });
    }

    const errors = validateIntake(payload);
    if (errors.length) return res.status(400).json({ error: errors[0], errors });

    const stamp = db.nowIso();
    const c = payload.client;
    const v = payload.vet;

    try {
        const result = db.tx(() => {
            const vetId = db.insert('vets', {
                clinic_name: clean(v.clinic_name),
                vet_name: clean(v.vet_name),
                phone: clean(v.phone),
                email: clean(v.email),
                address1: clean(v.address1),
                address2: clean(v.address2),
                city: clean(v.city),
                state: clean(v.state),
                postal_code: clean(v.postal_code),
                notes: clean(v.notes),
                created_at: stamp
            });

            const clientId = db.insert('clients', {
                first_name: clean(c.first_name),
                last_name: clean(c.last_name),
                email: clean(c.email),
                phone: clean(c.phone),
                alt_phone: clean(c.alt_phone),
                address1: clean(c.address1),
                address2: clean(c.address2),
                city: clean(c.city),
                state: clean(c.state),
                postal_code: clean(c.postal_code),
                country: clean(c.country) || 'US',
                emergency_name: clean(c.emergency_name),
                emergency_phone: clean(c.emergency_phone),
                emergency_relationship: clean(c.emergency_relationship),
                notes: clean(c.notes),
                status: 'pending',
                created_at: stamp,
                updated_at: stamp
            });

            const petIds = payload.pets.map(p => db.insert('pets', {
                client_id: clientId,
                vet_id: vetId,
                name: clean(p.name),
                breed: clean(p.breed),
                sex: clean(p.sex),
                birthdate: clean(p.birthdate),
                weight_lbs: p.weight_lbs ? Number(p.weight_lbs) : null,
                color: clean(p.color),
                fixed: p.fixed ? 1 : 0,
                microchip: clean(p.microchip),
                feeding: clean(p.feeding),
                medications: clean(p.medications),
                allergies: clean(p.allergies),
                behavior_notes: clean(p.behavior_notes),
                vet_notes: clean(p.vet_notes),
                status: 'active',
                created_at: stamp,
                updated_at: stamp
            }));

            // Attach each uploaded file to the pet its metadata names.
            const meta = Array.isArray(payload.records) ? payload.records : [];
            uploaded.forEach((file, i) => {
                const m = meta[i] || {};
                const petId = petIds[Number(m.petIndex) || 0];
                if (!petId) return;

                db.insert('vet_records', {
                    pet_id: petId,
                    record_type: clean(m.record_type) || 'other',
                    issued_on: clean(m.issued_on),
                    expires_on: clean(m.expires_on),
                    file_path: file.filename,
                    original_name: file.originalname,
                    mime_type: file.mimetype,
                    size_bytes: file.size,
                    notes: clean(m.notes),
                    verified: 0,
                    created_at: stamp
                });
            });

            // Vaccine dates the owner typed but had no document for still count
            // as a claim we can chase; record them without a file.
            meta.slice(uploaded.length).forEach(m => {
                const petId = petIds[Number(m.petIndex) || 0];
                if (!petId || !clean(m.record_type)) return;
                db.insert('vet_records', {
                    pet_id: petId,
                    record_type: clean(m.record_type),
                    issued_on: clean(m.issued_on),
                    expires_on: clean(m.expires_on),
                    file_path: null,
                    original_name: null,
                    mime_type: null,
                    size_bytes: null,
                    notes: clean(m.notes),
                    verified: 0,
                    created_at: stamp
                });
            });

            let bookingId = null;
            const b = payload.booking;
            if (b && clean(b.check_in) && clean(b.check_out)) {
                bookingId = db.insert('bookings', {
                    client_id: clientId,
                    check_in: clean(b.check_in),
                    check_out: clean(b.check_out),
                    status: 'requested',
                    source: 'public',
                    notes: clean(b.notes),
                    created_at: stamp,
                    updated_at: stamp
                });

                const wanted = Array.isArray(b.petIndexes) && b.petIndexes.length
                    ? b.petIndexes
                    : petIds.map((_, i) => i);

                for (const idx of wanted) {
                    const petId = petIds[Number(idx)];
                    if (petId) {
                        db.run('INSERT OR IGNORE INTO booking_pets (booking_id, pet_id) VALUES (?, ?)',
                            bookingId, petId);
                    }
                }
            }

            return { clientId, petIds, bookingId };
        });

        res.status(201).json({
            ok: true,
            client_id: result.clientId,
            pets: result.petIds.length,
            booking_requested: !!result.bookingId,
            message: result.bookingId
                ? "Thanks! We have your details and your boarding request. We'll confirm by email shortly."
                : "Thanks! We have your details on file. Give us a call to book a stay."
        });
    } catch (err) {
        next(err);
    }
});

module.exports = router;
