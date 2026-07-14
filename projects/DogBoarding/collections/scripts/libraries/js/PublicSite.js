/**
 * PublicSite - what a dog owner sees.
 *
 * Three pages: a home page, the price list, and the intake form. The intake
 * form is the only thing here that writes to the database, and it is the whole
 * reason this side of the app exists: it collects the owner, their address and
 * contact details, their emergency contact, their vet (name, phone, address),
 * every dog, and the vet records / vaccination certificates that go with them.
 */
class PublicSite {
    constructor(app) {
        this.app = app;
        this.api = app.api;
        this.info = null;
    }

    get ui() { return GUTS.DogBoardUI; }

    async render(root, path) {
        const { el, mount } = this.ui;

        if (!this.info) {
            mount(root, this.ui.spinner());
            this.info = await this.api.info();
        }

        const page = path === '/services' ? this.servicesPage()
            : path === '/register' ? this.intakePage()
            : this.homePage();

        mount(root, el('div.site',
            this.header(path),
            el('main.site__main', page),
            this.footer()));
    }

    /* ---------------- chrome ---------------- */

    header(path) {
        const { el } = this.ui;
        const business = this.info.business;

        const link = (href, label) => el('a.nav__link', {
            href: `#${href}`,
            class: path === href ? 'nav__link--on' : ''
        }, label);

        return el('header.site__header',
            el('a.brand', { href: '#/' },
                el('span.brand__mark', this.pawMark()),
                el('span.brand__name', business.name)),
            el('nav.nav',
                link('/', 'Home'),
                link('/services', 'Services & Rates'),
                link('/register', 'New Client Form'),
                el('a.nav__link.nav__link--staff', { href: '#/admin' }, 'Staff Login')));
    }

    footer() {
        const { el } = this.ui;
        const business = this.info.business;

        return el('footer.site__footer',
            el('div.site__footer-inner',
                el('div',
                    el('strong', business.name),
                    el('p.muted', business.address)),
                el('div',
                    el('p', el('a', { href: `tel:${business.phone}` }, business.phone)),
                    el('p', el('a', { href: `mailto:${business.email}` }, business.email)))));
    }

    pawMark() {
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('viewBox', '0 0 24 24');
        svg.setAttribute('aria-hidden', 'true');
        svg.innerHTML = `
            <circle cx="7" cy="8" r="2.4"/><circle cx="12" cy="6" r="2.4"/>
            <circle cx="17" cy="8" r="2.4"/>
            <path d="M12 11c3.1 0 5.6 2.3 5.6 4.8 0 1.9-1.6 3-3.6 3-1 0-1.4-.4-2-.4s-1 .4-2 .4c-2 0-3.6-1.1-3.6-3C6.4 13.3 8.9 11 12 11z"/>`;
        return svg;
    }

    /* ---------------- home ---------------- */

    homePage() {
        const { el } = this.ui;
        const vaccines = this.info.required_vaccines.map(v => this.ui.titleCase(v));

        const step = (n, title, body) => el('li.step',
            el('span.step__n', String(n)),
            el('div', el('h3', title), el('p.muted', body)));

        return el('div',
            el('section.hero',
                el('div.hero__text',
                    el('p.eyebrow', 'Boarding · Daycare · Grooming'),
                    el('h1', 'Your dog is somebody here.'),
                    el('p.lede',
                        'Small-group boarding with real yard time, individual attention, and staff who ' +
                        'learn your dog’s name before they learn their breed. Every stay is logged, ' +
                        'every service is on the invoice, no surprises.'),
                    el('div.hero__cta',
                        el('a.btn.btn--primary.btn--lg', { href: '#/register' }, 'Register your dog'),
                        el('a.btn.btn--ghost.btn--lg', { href: '#/services' }, 'See rates'))),
                el('div.hero__panel',
                    el('h3', 'Before the first stay'),
                    el('p.muted', 'We need current vet records for every dog. Bring or upload:'),
                    el('ul.tick', vaccines.map(v => el('li', v))),
                    el('p.muted.small',
                        'Upload them with the registration form and we’ll have you checked in ' +
                        'before you reach the front desk.'))),

            el('section.section',
                el('h2', 'How it works'),
                el('ol.steps',
                    step(1, 'Register',
                        'Fill in the new client form: your details, your emergency contact, ' +
                        'your vet, and a profile for each dog.'),
                    step(2, 'Upload records',
                        'Attach vaccination certificates as a photo or PDF. We verify them ' +
                        'before the first stay.'),
                    step(3, 'Book a stay',
                        'Tell us your dates. We confirm by email, usually the same day.'),
                    step(4, 'Pick up a happy, tired dog',
                        'You get an itemized invoice for exactly what we did — nothing else.'))),

            el('section.section.section--split',
                el('div',
                    el('h2', 'What we do'),
                    el('p.muted',
                        'Boarding is the core, but the extras are what make a stay feel like a stay ' +
                        'and not a kennel. Everything below is billed only if you ask for it.'),
                    el('a.btn.btn--ghost', { href: '#/services' }, 'Full rate card')),
                el('ul.cards',
                    this.info.services.slice(0, 4).map(s => el('li.card',
                        el('h4', s.name),
                        el('p.muted.small', s.description),
                        el('p.price', this.ui.money(s.price_cents),
                            el('span.per', ` / ${s.unit}`)))))));
    }

    /* ---------------- services ---------------- */

    servicesPage() {
        const { el } = this.ui;

        const groups = { night: [], day: [], each: [], hour: [] };
        for (const service of this.info.services) {
            (groups[service.unit] || groups.each).push(service);
        }

        const groupTitles = {
            night: 'Overnight boarding',
            day: 'Daycare & per-day add-ons',
            each: 'Extras, one at a time',
            hour: 'Hourly'
        };

        const section = (unit) => {
            const list = groups[unit];
            if (!list || !list.length) return null;

            return el('section.rates',
                el('h2', groupTitles[unit]),
                el('table.table.table--rates',
                    el('tbody', list.map(s => el('tr',
                        el('td',
                            el('strong', s.name),
                            s.description ? el('p.muted.small', s.description) : null),
                        el('td.num.price', this.ui.money(s.price_cents),
                            el('span.per', ` / ${s.unit}`)))))));
        };

        return el('div.narrow',
            el('header.page-head',
                el('h1', 'Services & Rates'),
                el('p.lede',
                    'Straightforward pricing. Boarding is charged per night; the night you check out ' +
                    'is not charged. Extras are only billed when you ask for them.')),
            section('night'),
            section('day'),
            section('hour'),
            section('each'),
            el('div.callout',
                el('h3', 'Multi-dog households'),
                el('p', 'Dogs from the same home share a suite at the sibling rate. ' +
                    'If they would rather not share, we will not make them.')),
            el('div.center',
                el('a.btn.btn--primary.btn--lg', { href: '#/register' }, 'Register your dog')));
    }

    /* ---------------- intake ---------------- */

    intakePage() {
        const { el } = this.ui;

        this.petCount = 0;
        const petList = el('div.pets');

        const form = el('form.intake', {
            onsubmit: (e) => { e.preventDefault(); this.submitIntake(form, petList); }
        },
            el('header.page-head',
                el('h1', 'New client registration'),
                el('p.lede',
                    'This is everything we need before your dog’s first stay. It takes about ' +
                    'five minutes. Fields marked * are required.')),

            this.fieldset('About you', [
                this.ui.row(
                    this.ui.field({ name: 'first_name', label: 'First name', required: true }),
                    this.ui.field({ name: 'last_name', label: 'Last name', required: true })),
                this.ui.row(
                    this.ui.field({ name: 'email', label: 'Email', type: 'email', required: true,
                        hint: 'Booking confirmations and invoices go here.' }),
                    this.ui.field({ name: 'phone', label: 'Mobile phone', type: 'tel', required: true })),
                this.ui.field({ name: 'alt_phone', label: 'Another number we can try', type: 'tel' })
            ]),

            this.fieldset('Where you live', [
                this.ui.field({ name: 'address1', label: 'Street address', required: true }),
                this.ui.field({ name: 'address2', label: 'Apartment, suite, etc.' }),
                this.ui.row(
                    this.ui.field({ name: 'city', label: 'City', required: true }),
                    this.ui.field({ name: 'state', label: 'State', required: true }),
                    this.ui.field({ name: 'postal_code', label: 'ZIP', required: true }))
            ], 'If we ever have to bring your dog home, we need to know where home is.'),

            this.fieldset('Emergency contact', [
                this.ui.row(
                    this.ui.field({ name: 'emergency_name', label: 'Name', required: true }),
                    this.ui.field({ name: 'emergency_phone', label: 'Phone', type: 'tel', required: true }),
                    this.ui.field({ name: 'emergency_relationship', label: 'Relationship to you',
                        placeholder: 'Partner, neighbour, sibling…' }))
            ], 'Someone who is not you, who can collect your dog if we cannot reach you.'),

            this.fieldset('Your veterinarian', [
                this.ui.row(
                    this.ui.field({ name: 'vet_clinic_name', label: 'Clinic name', required: true }),
                    this.ui.field({ name: 'vet_name', label: 'Veterinarian’s name' })),
                this.ui.row(
                    this.ui.field({ name: 'vet_phone', label: 'Clinic phone', type: 'tel', required: true }),
                    this.ui.field({ name: 'vet_email', label: 'Clinic email', type: 'email' })),
                this.ui.field({ name: 'vet_address1', label: 'Clinic street address' }),
                this.ui.row(
                    this.ui.field({ name: 'vet_city', label: 'City' }),
                    this.ui.field({ name: 'vet_state', label: 'State' }),
                    this.ui.field({ name: 'vet_postal_code', label: 'ZIP' }))
            ], 'In an emergency we call your vet first. We need to be able to find them.'),

            el('section.fieldset',
                el('header.fieldset__head',
                    el('h2', 'Your dogs'),
                    el('p.muted', 'Add one card per dog. Vet records are attached per dog.')),
                petList,
                el('button.btn.btn--ghost', {
                    type: 'button',
                    onclick: () => petList.appendChild(this.petCard(petList))
                }, '+ Add another dog')),

            this.fieldset('Boarding dates', [
                this.ui.row(
                    this.ui.field({ name: 'check_in', label: 'Drop off', type: 'date' }),
                    this.ui.field({ name: 'check_out', label: 'Pick up', type: 'date' })),
                this.ui.field({ name: 'booking_notes', label: 'Anything we should know about this stay',
                    type: 'textarea', rows: 2 })
            ], 'Optional. Leave blank if you just want to get set up now and book later. ' +
               'Dates are a request — we will confirm by email.'),

            el('div.intake__submit',
                el('button.btn.btn--primary.btn--lg', { type: 'submit' }, 'Submit registration'),
                el('p.muted.small',
                    'We use this information to care for your dog and to bill you. We do not sell it.')));

        petList.appendChild(this.petCard(petList));
        return el('div.narrow', form);
    }

    fieldset(title, fields, hint = null) {
        const { el } = this.ui;
        return el('section.fieldset',
            el('header.fieldset__head',
                el('h2', title),
                hint ? el('p.muted', hint) : null),
            el('div.fieldset__body', fields));
    }

    /** One dog. Repeatable. Carries its own vet-record rows. */
    petCard(petList) {
        const { el } = this.ui;
        const index = this.petCount++;

        const recordRows = el('div.records');
        const card = el('div.pet-card', { dataset: { petIndex: String(index) } });

        const addRecordRow = (type = '') => {
            recordRows.appendChild(this.recordRow(type, recordRows));
        };

        const header = el('header.pet-card__head',
            el('h3', `Dog ${index + 1}`),
            el('button.link-btn', {
                type: 'button',
                onclick: () => {
                    if (petList.children.length === 1) {
                        this.ui.toast('You need at least one dog.', 'warn');
                        return;
                    }
                    card.remove();
                    this.renumberPets(petList);
                }
            }, 'Remove'));

        this.ui.append(card, [
            header,
            el('div.fieldset__body',
                this.ui.row(
                    this.ui.field({ name: 'name', label: 'Name', required: true }),
                    this.ui.field({ name: 'breed', label: 'Breed', placeholder: 'Best guess is fine' })),
                this.ui.row(
                    this.ui.field({ name: 'sex', label: 'Sex', type: 'select',
                        options: [{ value: '', label: '—' }, 'male', 'female'] }),
                    this.ui.field({ name: 'birthdate', label: 'Date of birth', type: 'date' }),
                    this.ui.field({ name: 'weight_lbs', label: 'Weight (lbs)', type: 'number',
                        min: 0, step: '0.1' })),
                this.ui.row(
                    this.ui.field({ name: 'color', label: 'Colour / markings' }),
                    this.ui.field({ name: 'microchip', label: 'Microchip number' })),
                this.ui.field({ name: 'fixed', label: 'Spayed or neutered', type: 'checkbox' }),
                this.ui.field({ name: 'feeding', label: 'Feeding instructions', type: 'textarea', rows: 2,
                    placeholder: 'How much, how often, and whether you are sending their own food.' }),
                this.ui.field({ name: 'medications', label: 'Medications', type: 'textarea', rows: 2,
                    placeholder: 'Name, dose, and when. Write "none" if none.' }),
                this.ui.field({ name: 'allergies', label: 'Allergies', type: 'textarea', rows: 2 }),
                this.ui.field({ name: 'behavior_notes', label: 'Behaviour we should know about',
                    type: 'textarea', rows: 2,
                    placeholder: 'Resource guarding, dislikes men in hats, escape artist, ' +
                        'terrified of thunder — the honest version helps us keep them safe.' })),

            el('div.records-block',
                el('header.records-block__head',
                    el('h4', 'Vet records'),
                    el('p.muted.small',
                        'Attach a photo or PDF of each certificate. If you do not have the document ' +
                        'to hand, fill in the dates anyway and bring it with you.')),
                recordRows,
                el('button.link-btn', { type: 'button', onclick: () => addRecordRow() },
                    '+ Add another record'))
        ]);

        for (const vaccine of this.info.required_vaccines) addRecordRow(vaccine);
        return card;
    }

    recordRow(type, recordRows) {
        const { el } = this.ui;

        const types = ['rabies', 'dhpp', 'bordetella', 'influenza', 'leptospirosis',
            'exam', 'titer', 'other'];

        const row = el('div.record-row',
            this.ui.field({ name: 'record_type', label: 'Record', type: 'select',
                value: type, options: types }),
            this.ui.field({ name: 'issued_on', label: 'Issued', type: 'date' }),
            this.ui.field({ name: 'expires_on', label: 'Expires', type: 'date' }),
            el('label.field.field--file',
                el('span.field__label', 'Document'),
                el('input', { type: 'file', name: 'record_file',
                    accept: 'application/pdf,image/*' })),
            el('button.record-row__x', {
                type: 'button', title: 'Remove this record',
                onclick: () => row.remove()
            }, '×'));

        void recordRows;
        return row;
    }

    renumberPets(petList) {
        [...petList.children].forEach((card, i) => {
            card.dataset.petIndex = String(i);
            const heading = card.querySelector('.pet-card__head h3');
            if (heading) heading.textContent = `Dog ${i + 1}`;
        });
        this.petCount = petList.children.length;
    }

    /* ---------------- submit ---------------- */

    async submitIntake(form, petList) {
        const { el } = this.ui;
        const button = form.querySelector('button[type="submit"]');

        // Pull the top-level fields, but not the ones inside pet cards - those
        // repeat, so they have to be read card by card.
        const top = {};
        form.querySelectorAll('[name]').forEach(input => {
            if (input.closest('.pet-card')) return;
            top[input.name] = input.type === 'checkbox' ? input.checked : input.value.trim();
        });

        const pets = [];
        const withFile = [];   // record metadata that has a file, in file order
        const withoutFile = []; // record metadata with no file
        const files = [];

        [...petList.children].forEach((card, petIndex) => {
            const pet = {};
            card.querySelectorAll('.fieldset__body [name]').forEach(input => {
                pet[input.name] = input.type === 'checkbox' ? input.checked : input.value.trim();
            });
            pets.push(pet);

            card.querySelectorAll('.record-row').forEach(row => {
                const meta = {
                    petIndex,
                    record_type: row.querySelector('[name="record_type"]').value,
                    issued_on: row.querySelector('[name="issued_on"]').value,
                    expires_on: row.querySelector('[name="expires_on"]').value
                };
                const fileInput = row.querySelector('[name="record_file"]');
                const file = fileInput && fileInput.files[0];

                if (file) {
                    files.push(file);
                    withFile.push(meta);
                } else if (meta.issued_on || meta.expires_on) {
                    // No document, but they gave us dates - worth keeping, and worth chasing.
                    withoutFile.push(meta);
                }
            });
        });

        const payload = {
            client: {
                first_name: top.first_name, last_name: top.last_name,
                email: top.email, phone: top.phone, alt_phone: top.alt_phone,
                address1: top.address1, address2: top.address2,
                city: top.city, state: top.state, postal_code: top.postal_code,
                emergency_name: top.emergency_name,
                emergency_phone: top.emergency_phone,
                emergency_relationship: top.emergency_relationship
            },
            vet: {
                clinic_name: top.vet_clinic_name,
                vet_name: top.vet_name,
                phone: top.vet_phone,
                email: top.vet_email,
                address1: top.vet_address1,
                city: top.vet_city,
                state: top.vet_state,
                postal_code: top.vet_postal_code
            },
            pets,
            // The server pairs files[i] with records[i], so the ones carrying a
            // file must come first and in the same order we appended them.
            records: [...withFile, ...withoutFile],
            booking: (top.check_in && top.check_out)
                ? { check_in: top.check_in, check_out: top.check_out, notes: top.booking_notes }
                : null
        };

        if (payload.booking && payload.booking.check_out < payload.booking.check_in) {
            this.ui.toast('Pick-up cannot be before drop-off.', 'bad');
            return;
        }

        button.disabled = true;
        button.textContent = 'Sending…';

        try {
            const result = await this.api.submitIntake(payload, files);

            this.ui.mount(this.app.root, el('div.site',
                this.header('/register'),
                el('main.site__main',
                    el('div.narrow',
                        el('div.success',
                            el('div.success__mark', '✓'),
                            el('h1', 'You’re registered.'),
                            el('p.lede', result.message),
                            el('p.muted',
                                `We have ${result.pets} dog${result.pets === 1 ? '' : 's'} on file for you. ` +
                                'A member of staff will check your vet records and confirm ' +
                                'everything by email.'),
                            el('a.btn.btn--ghost', { href: '#/' }, 'Back to the home page')))),
                this.footer()));

        } catch (err) {
            this.ui.toast(err.message || 'We could not save that. Please try again.', 'bad');
            button.disabled = false;
            button.textContent = 'Submit registration';
        }
    }
}
