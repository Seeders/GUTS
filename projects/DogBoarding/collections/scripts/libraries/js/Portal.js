/**
 * Portal - the client-facing account area.
 *
 * A logged-in client sees only their own dogs, records, vets, bookings and
 * billing. The server enforces that (every /api/portal call is scoped to the
 * session's own client id); this class just renders it. It mirrors AdminConsole:
 * an auth wall when logged out, a tabbed app when logged in, all built from the
 * same DogBoardUI helpers and FormRenderer schemas the rest of the app uses.
 *
 * Login and signup submit through the app's one delegated submit handler
 * (DogBoardingApp), which calls submitLogin / submitSignup here.
 */
class Portal {
    constructor(app) {
        this.app = app;
        this.engine = app.engine;
        this.api = app.api;
        this.ui = app.ui;
        this.forms = app.forms;
    }

    get collections() {
        return this.engine.collections;
    }

    bindingData() {
        return { portal: this.collections.content?.portal || {} };
    }

    section(path) {
        const rest = String(path).replace(/^\/portal\/?/, '');
        return rest.split('/')[0] || 'dashboard';
    }

    async render(root, path) {
        this.root = root;
        this.ui.bind(root, this.bindingData());

        if (!this.api.portalToken) {
            return this.showAuth(root, path);
        }

        let me;
        try {
            me = await this.api.portalMe();
        } catch {
            me = { authenticated: false };
        }
        if (!me || !me.authenticated) {
            this.api.setPortalToken(null);
            return this.showAuth(root, path);
        }

        this.client = me.client;
        if (me.needs_onboarding) return this.showOnboarding(root);
        this.showApp(root, this.section(path));
    }

    /* ---------------- auth wall ---------------- */

    showAuth(root, path = '') {
        const auth = root.querySelector('[data-portal-auth]');
        const app = root.querySelector('[data-portal-app]');
        if (app) app.hidden = true;
        if (!auth) return;
        auth.hidden = false;

        const show = view => {
            auth.querySelectorAll('[data-auth-view]').forEach(node => {
                node.hidden = node.dataset.authView !== view;
            });
            const err = auth.querySelector(`[data-auth-view="${view}"] [data-portal-error]`);
            if (err) err.textContent = '';
        };

        const toSignup = auth.querySelector('[data-show-signup]');
        const toLogin = auth.querySelector('[data-show-login]');
        if (toSignup) toSignup.onclick = () => show('signup');
        if (toLogin) toLogin.onclick = () => show('login');

        // /portal/signup deep-links straight to the create-account view; anything
        // else (/portal) opens sign-in.
        show(this.section(path) === 'signup' ? 'signup' : 'login');
    }

    async submitLogin(form) {
        const errEl = form.querySelector('[data-portal-error]');
        const { email, password } = this.ui.readForm(form);
        try {
            await this.api.portalLogin(email, password);
            this.app.navigate('/portal');
        } catch (err) {
            if (errEl) errEl.textContent = err.message || 'Could not sign in.';
        }
    }

    async submitSignup(form) {
        const errEl = form.querySelector('[data-portal-error]');
        const { email, password } = this.ui.readForm(form);
        try {
            await this.api.portalSignup(email, password); // creates the account and logs in
            this.app.navigate('/portal');                 // -> onboarding, since the client is a stub
        } catch (err) {
            if (errEl) errEl.textContent = err.message || 'Could not create the account.';
        }
    }

    async logout() {
        await this.api.portalLogout();
        this.app.navigate('/portal');
    }

    /* ---------------- signed-in shell ---------------- */

    showApp(root, section) {
        root.querySelector('[data-portal-auth]').hidden = true;
        const app = root.querySelector('[data-portal-app]');
        app.hidden = false;

        const user = root.querySelector('[data-portal-user]');
        if (user) user.textContent = `${this.client.first_name} ${this.client.last_name}`;
        const logout = root.querySelector('[data-portal-logout]');
        if (logout) logout.onclick = () => this.logout();

        this.renderTabs(root, section);

        const content = root.querySelector('[data-portal-content]');
        this.ui.mount(content, this.ui.spinner());
        this.renderSection(section, content);
    }

    renderTabs(root, active) {
        const tabs = [
            { id: 'dashboard', label: 'Overview', route: '/portal' },
            { id: 'book', label: 'Book a Stay', route: '/portal/book' },
            { id: 'dogs', label: 'My Dogs', route: '/portal/dogs' },
            { id: 'billing', label: 'Billing', route: '/portal/billing' },
            { id: 'profile', label: 'Profile', route: '/portal/profile' }
        ];
        const host = root.querySelector('[data-portal-tabs]');
        if (!host) return;
        this.ui.mount(host, tabs.map(tab =>
            this.ui.el('a.portal-tab', {
                href: `#${tab.route}`,
                class: tab.id === active ? 'portal-tab--active' : ''
            }, tab.label)));
    }

    async renderSection(section, content) {
        try {
            if (section === 'book') return await this.book(content);
            if (section === 'dogs') return await this.dogs(content);
            if (section === 'billing') return await this.billing(content);
            if (section === 'profile') return await this.profile(content);
            return await this.dashboard(content);
        } catch (err) {
            if (err.status === 401) return; // portal-unauthorized event will re-route
            this.ui.mount(content, this.ui.el('div.empty',
                this.ui.el('p', err.message || 'Something went wrong.')));
        }
    }

    /* ---------------- onboarding (first run) ---------------- */

    showOnboarding(root) {
        root.querySelector('[data-portal-auth]').hidden = true;
        root.querySelector('[data-portal-app]').hidden = false;

        const user = root.querySelector('[data-portal-user]');
        if (user) user.textContent = this.client.email || '';
        const logout = root.querySelector('[data-portal-logout]');
        if (logout) logout.onclick = () => this.logout();
        const tabs = root.querySelector('[data-portal-tabs]');
        if (tabs) this.ui.clear(tabs); // no navigation until they finish setup

        this.onboarding(root.querySelector('[data-portal-content]'));
    }

    onboarding(content) {
        const { el } = this.ui;

        const intake = this.forms.render('intake');
        // The account already owns the email address; don't ask for it again.
        // (Onboarding never overwrites the email, so leaving it out is safe.)
        const emailField = intake.querySelector('[name="email"]');
        if (emailField) (emailField.closest('.field') || emailField).remove();

        const dogsHost = el('div.portal-cards');
        let dogCount = 0;

        const addDog = () => {
            const index = dogCount++;
            const card = el('div.portal-card',
                el('header.portal-card__head',
                    el('h3', `Dog ${index + 1}`),
                    el('button.linkbtn.linkbtn--danger', {
                        type: 'button',
                        onclick: () => {
                            if (dogsHost.children.length > 1) card.remove();
                            else this.ui.toast('You need at least one dog.', 'warn');
                        }
                    }, 'Remove')),
                this.forms.renderFields('intakePet'));
            dogsHost.appendChild(card);
        };
        addDog();

        const submit = el('button.btn.btn--primary', { type: 'button' }, 'Finish setup');
        submit.onclick = () => this.submitOnboarding(intake, dogsHost, submit);

        this.ui.mount(content,
            el('div.portal-onboard',
                el('h1', 'Welcome! Let’s set up your account'),
                el('p.muted', `Signed in as ${this.client.email}. Tell us about you and your dogs — you can change any of this later.`),
                intake,
                el('div.portal-actions',
                    el('h2', 'Your dogs'),
                    el('button.btn', { type: 'button', onclick: addDog }, '+ Add another dog')),
                dogsHost,
                el('div.portal-form-actions', submit)));
    }

    async submitOnboarding(intakeContainer, dogsHost, btn) {
        const top = this.forms.read('intake', intakeContainer);
        const specs = this.forms.fieldSpecs('intakePet');

        const pets = [];
        [...dogsHost.children].forEach(card => {
            const pet = {};
            for (const spec of specs) {
                const input = card.querySelector(`[name="${spec.name}"]`);
                if (!input) continue;
                pet[spec.name] = spec.type === 'checkbox' ? input.checked : input.value.trim();
            }
            if (pet.name) pets.push(pet);
        });

        const payload = {
            client: {
                first_name: top.first_name, last_name: top.last_name,
                email: top.email, phone: top.phone, alt_phone: top.alt_phone,
                address1: top.address1, address2: top.address2,
                city: top.city, state: top.state, postal_code: top.postal_code,
                emergency_name: top.emergency_name, emergency_phone: top.emergency_phone,
                emergency_relationship: top.emergency_relationship
            },
            vet: {
                clinic_name: top.vet_clinic_name, vet_name: top.vet_name,
                phone: top.vet_phone, email: top.vet_email,
                address1: top.vet_address1, city: top.vet_city,
                state: top.vet_state, postal_code: top.vet_postal_code
            },
            pets
        };

        if (!payload.client.first_name || !payload.client.last_name) {
            this.ui.toast('Please enter your name.', 'bad'); return;
        }
        if (!payload.client.phone) { this.ui.toast('Please enter a phone number.', 'bad'); return; }
        if (!pets.length) { this.ui.toast('Please add at least one dog.', 'bad'); return; }

        btn.disabled = true;
        const original = btn.textContent;
        btn.textContent = 'Saving…';
        try {
            await this.api.portalOnboarding(payload);
            this.ui.toast('You’re all set!', 'good');
            this.app.navigate('/portal');
        } catch (err) {
            this.ui.toast(err.message || 'Could not save.', 'bad');
            btn.disabled = false;
            btn.textContent = original;
        }
    }

    /* ---------------- dashboard ---------------- */

    async dashboard(content) {
        const data = await this.api.portalOverview();
        const { el, money, date } = this.ui;

        const stat = (label, value, tone) => el('div.portal-stat',
            el('span.portal-stat__label', label),
            el('strong.portal-stat__value', { class: tone ? `portal-stat__value--${tone}` : '' }, value));

        const balance = data.balance_cents || 0;

        const bookingRows = [...(data.bookings.upcoming || [])].map(b =>
            el('li.portal-line',
                el('span', `${date(b.check_in)} → ${date(b.check_out)}`),
                this.ui.badge(b.status, this.ui.statusTone(b.status))));

        const serviceRows = (data.recentServices || []).slice(0, 8).map(s =>
            el('li.portal-line',
                el('span', s.description),
                el('span.muted', `${date(s.performed_on)} · ${money(s.amount_cents)}`)));

        this.ui.mount(content,
            el('div.portal-grid',
                stat('Dogs on file', String((data.pets || []).filter(p => p.status !== 'archived').length)),
                stat('Upcoming stays', String((data.bookings.upcoming || []).length)),
                stat('Balance due', money(balance), balance > 0 ? 'due' : 'ok')),

            el('section.portal-panel',
                el('header.portal-panel__head', el('h2', 'Upcoming stays')),
                bookingRows.length
                    ? el('ul.portal-list', bookingRows)
                    : this.ui.empty('No upcoming stays booked.')),

            el('section.portal-panel',
                el('header.portal-panel__head', el('h2', 'Recent services')),
                serviceRows.length
                    ? el('ul.portal-list', serviceRows)
                    : this.ui.empty('No services yet.')));
    }

    /* ---------------- book a stay ---------------- */

    async book(content) {
        const { el, date } = this.ui;
        const today = this.ui.today();
        if (!this.bookMonth) this.bookMonth = today.slice(0, 7);

        const [year, month] = this.bookMonth.split('-').map(Number);
        const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
        const first = `${this.bookMonth}-01`;
        const last = `${this.bookMonth}-${String(daysInMonth).padStart(2, '0')}`;
        const from = first < today ? today : first;

        // Nothing to show for a month that is entirely in the past.
        if (last < today) {
            this.bookMonth = today.slice(0, 7);
            return this.book(content);
        }

        const [avail, { pets }, overview] = await Promise.all([
            this.api.portalAvailability({ from, to: last }),
            this.api.portalPets(),
            this.api.portalOverview()
        ]);

        const dogs = pets.filter(p => p.status !== 'archived');
        const byDate = new Map(avail.days.map(d => [d.date, d]));

        const shift = n => {
            this.bookMonth = new Date(Date.UTC(year, month - 1 + n, 1)).toISOString().slice(0, 7);
            this.route();
        };

        const monthLabel = new Date(Date.UTC(year, month - 1, 1))
            .toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });

        /* Nights this client already has booked -> which dogs are in that night. */
        const mineNights = new Map();
        for (const b of (avail.mine || [])) {
            const end = String(b.check_out).slice(0, 10);
            for (let d = String(b.check_in).slice(0, 10); d < end; d = this.ui.addDays(d, 1)) {
                mineNights.set(d, b.dog_names || 'Your stay');
            }
        }

        // Declared here so the calendar's click handler can drive them.
        let checkIn = null;
        let checkOut = null;
        const cellByDate = new Map();

        /* Re-colour the grid (and the date inputs) for the current selection. */
        const paint = () => {
            for (const [d, cell] of cellByDate) {
                cell.classList.remove('cal__cell--sel', 'cal__cell--sel-start', 'cal__cell--sel-end');
                if (!this.selStart) continue;
                if (d === this.selStart) cell.classList.add('cal__cell--sel-start');
                if (this.selEnd) {
                    if (d > this.selStart && d < this.selEnd) cell.classList.add('cal__cell--sel');
                    if (d === this.selEnd) cell.classList.add('cal__cell--sel-end');
                }
            }
            if (checkIn) checkIn.value = this.selStart || '';
            if (checkOut) checkOut.value = this.selEnd || '';
        };

        /**
         * Click once for drop-off, again for pick-up. Clicking a date on or
         * before the current start begins a new range instead of an empty one.
         */
        const pick = d => {
            // Clicking a date you already picked clears it, so a mis-click is undoable.
            if (d === this.selStart) {
                this.selStart = null;
                this.selEnd = null;
                paint();
                return;
            }
            if (d === this.selEnd) {
                this.selEnd = null;
                paint();
                return;
            }

            // No start yet, a finished range, or a date before the start: begin again.
            if (!this.selStart || this.selEnd || d < this.selStart) {
                this.selStart = d;
                this.selEnd = null;
                paint();
                return;
            }

            // Every night from drop-off up to (not including) pick-up must be free.
            // Nights outside the month we fetched are left to the server to judge.
            const blocked = [];
            for (let n = this.selStart; n < d; n = this.ui.addDays(n, 1)) {
                const info = byDate.get(n);
                if (info && info.full) blocked.push(n);
            }
            if (blocked.length) {
                this.ui.toast(`We are full on ${this.ui.date(blocked[0])}. Try other dates.`, 'bad');
                return;
            }

            this.selEnd = d;
            paint();
        };

        /* the availability grid */
        const cells = [];
        const leading = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
        for (let i = 0; i < leading; i++) cells.push(el('div.cal__cell.cal__cell--empty'));

        for (let day = 1; day <= daysInMonth; day++) {
            const d = `${this.bookMonth}-${String(day).padStart(2, '0')}`;
            const info = byDate.get(d);

            if (d < today || !info) {
                cells.push(el('div.cal__cell.cal__cell--past', el('span.cal__day', String(day))));
                continue;
            }

            const myDogs = mineNights.get(d); // the dogs of theirs staying that night
            const cell = el('button.cal__cell', {
                type: 'button',
                class: `${info.full ? 'cal__cell--full' : 'cal__cell--open'}${myDogs ? ' cal__cell--mine' : ''}`,
                // A night that is full is still selectable if it is already theirs
                // - it is full *because* of them.
                disabled: (info.full && !myDogs) || !avail.can_book,
                onclick: () => pick(d)
            },
                el('span.cal__day', String(day)),
                el('span.cal__free', info.full ? 'Full' : `${info.available} free`),
                myDogs ? el('span.cal__mine', myDogs) : null);

            cellByDate.set(d, cell);
            cells.push(cell);
        }

        const calendar = el('div',
            el('div.portal-actions',
                el('h2', 'Availability'),
                el('div.cal__nav',
                    el('button.btn.btn--sm', { type: 'button', onclick: () => shift(-1) }, '‹'),
                    el('strong.cal__month', monthLabel),
                    el('button.btn.btn--sm', { type: 'button', onclick: () => shift(1) }, '›'))),
            avail.can_book
                ? el('p.muted.small', 'Click a drop-off date, then a pick-up date.')
                : null,
            el('div.cal',
                ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(w => el('div.cal__weekday', w)),
                cells),
            el('div.cal__legend',
                el('span.cal__key.cal__key--open', 'Space free'),
                el('span.cal__key.cal__key--full', 'Full'),
                el('span.cal__key.cal__key--mine', 'Your stay'),
                el('span.cal__key.cal__key--sel', 'Selected')));

        /* upcoming stays, with the option to cancel */
        const upcoming = (overview.bookings?.upcoming || []).filter(b => b.status !== 'cancelled');
        const upcomingPanel = el('section.portal-panel',
            el('header.portal-panel__head', el('h2', 'Your upcoming stays')),
            upcoming.length
                ? el('ul.portal-list', upcoming.map(b => el('li.portal-line',
                    el('span',
                        el('strong', `${date(b.check_in)} → ${date(b.check_out)}`),
                        b.dog_names ? el('span.muted.small', ` · ${b.dog_names}`) : null),
                    el('span.portal-line__actions',
                        this.ui.badge(b.status, this.ui.statusTone(b.status)),
                        // Changeable right up until the dog is checked in.
                        b.changeable
                            ? el('button.linkbtn',
                                { type: 'button', onclick: () => this.editBooking(b) }, 'Change')
                            : null,
                        b.changeable
                            ? el('button.linkbtn.linkbtn--danger',
                                { type: 'button', onclick: () => this.cancelBooking(b) }, 'Cancel')
                            : null))))
                : this.ui.empty('No stays booked yet.'));

        /* the booking form - only for an approved client with a dog on file */
        let form;
        if (!avail.can_book) {
            form = el('div.notice',
                el('strong', 'Your account is awaiting approval. '),
                'You can see what is free, but you cannot book yet. We will be in touch shortly.');
        } else if (!dogs.length) {
            form = this.ui.empty('Add a dog before booking a stay.');
        } else {
            // Typing in the inputs and clicking the calendar drive the same
            // selection, so the two can never disagree.
            checkIn = el('input', {
                type: 'date', min: today,
                onchange: () => {
                    this.selStart = checkIn.value || null;
                    if (this.selEnd && this.selStart && this.selEnd <= this.selStart) this.selEnd = null;
                    paint();
                }
            });
            checkOut = el('input', {
                type: 'date', min: today,
                onchange: () => { this.selEnd = checkOut.value || null; paint(); }
            });
            const boxes = dogs.map(p => el('label.field.field--check',
                el('input', { type: 'checkbox', value: String(p.id), checked: dogs.length === 1 }),
                el('span', p.name)));
            const notes = el('textarea', { rows: 2, placeholder: 'Anything we should know?' });
            const button = el('button.btn.btn--primary', { type: 'button' }, 'Book these dates');

            button.onclick = async () => {
                const petIds = boxes
                    .map(b => b.querySelector('input'))
                    .filter(i => i.checked)
                    .map(i => Number(i.value));

                if (!checkIn.value || !checkOut.value) {
                    return this.ui.toast('Choose a drop-off and a pick-up date.', 'bad');
                }
                if (checkOut.value <= checkIn.value) {
                    return this.ui.toast('Pick-up has to be after drop-off.', 'bad');
                }
                if (!petIds.length) return this.ui.toast('Choose at least one dog.', 'bad');

                button.disabled = true;
                const label = button.textContent;
                button.textContent = 'Booking…';
                try {
                    await this.api.portalCreateBooking({
                        check_in: checkIn.value,
                        check_out: checkOut.value,
                        pet_ids: petIds,
                        notes: notes.value.trim()
                    });
                    this.ui.toast('Booked! We will see you then.', 'good');
                    this.selStart = null;
                    this.selEnd = null;
                    this.route();
                } catch (err) {
                    this.ui.toast(err.message || 'Could not book those dates.', 'bad');
                    button.disabled = false;
                    button.textContent = label;
                }
            };

            form = el('div',
                el('div.field-row',
                    el('label.field', el('span.field__label', 'Drop-off'), checkIn),
                    el('label.field', el('span.field__label', 'Pick-up'), checkOut)),
                el('div.field', el('span.field__label', 'Which dogs?'), el('div', boxes)),
                el('label.field', el('span.field__label', 'Notes'), notes),
                el('div.portal-form-actions', button));
        }

        this.ui.mount(content,
            el('p.muted',
                `We can take ${avail.capacity} dog${avail.capacity === 1 ? '' : 's'} a night.`),
            calendar,
            el('section.portal-panel',
                el('header.portal-panel__head', el('h2', 'Book a stay')),
                form),
            upcomingPanel);

        // Restore any selection made before the month was flipped.
        paint();
    }

    /** Change a stay: new dates, different dogs, or both. Only before check-in. */
    async editBooking(booking) {
        const { el } = this.ui;
        const today = this.ui.today();

        const [{ booking: stay }, { pets }] = await Promise.all([
            this.api.portalBooking(booking.id),
            this.api.portalPets()
        ]);
        const dogs = pets.filter(p => p.status !== 'archived');

        const checkIn = el('input', { type: 'date', min: today, value: stay.check_in });
        const checkOut = el('input', { type: 'date', min: today, value: stay.check_out });
        const boxes = dogs.map(p => el('label.field.field--check',
            el('input', {
                type: 'checkbox',
                value: String(p.id),
                checked: stay.pet_ids.includes(p.id)
            }),
            el('span', p.name)));
        const notes = el('textarea', { rows: 2, value: stay.notes || '' });

        this.ui.modal({
            title: 'Change your stay',
            width: 520,
            confirmLabel: 'Save changes',
            body: el('div',
                el('div.field-row',
                    el('label.field', el('span.field__label', 'Drop-off'), checkIn),
                    el('label.field', el('span.field__label', 'Pick-up'), checkOut)),
                el('div.field', el('span.field__label', 'Which dogs?'), el('div', boxes)),
                el('label.field', el('span.field__label', 'Notes'), notes)),
            onConfirm: async () => {
                const petIds = boxes
                    .map(b => b.querySelector('input'))
                    .filter(i => i.checked)
                    .map(i => Number(i.value));

                if (!checkIn.value || !checkOut.value) {
                    this.ui.toast('Choose both dates.', 'bad'); return false;
                }
                if (checkOut.value <= checkIn.value) {
                    this.ui.toast('Pick-up has to be after drop-off.', 'bad'); return false;
                }
                if (!petIds.length) {
                    this.ui.toast('Choose at least one dog.', 'bad'); return false;
                }

                // A failure here throws, which the modal catches and shows -
                // so a clash or a full night keeps the dialog open to fix.
                await this.api.portalUpdateBooking(stay.id, {
                    check_in: checkIn.value,
                    check_out: checkOut.value,
                    pet_ids: petIds,
                    notes: notes.value.trim()
                });
                this.ui.toast('Your stay is updated.', 'good');
                this.route();
            }
        });
    }

    async cancelBooking(booking) {
        const ok = await this.ui.confirm(
            `Cancel your stay on ${this.ui.date(booking.check_in)}?`,
            { title: 'Cancel stay', confirmLabel: 'Cancel stay' });
        if (!ok) return;
        try {
            await this.api.portalCancelBooking(booking.id);
            this.ui.toast('Your stay is cancelled.', 'good');
            this.route();
        } catch (err) {
            this.ui.toast(err.message || 'Could not cancel that.', 'bad');
        }
    }

    /* ---------------- dogs ---------------- */

    vetOptions() {
        return [{ value: '', label: '— none on file —' }].concat(
            (this.vets || []).map(v => ({ value: String(v.id), label: v.clinic_name })));
    }

    async dogs(content) {
        const [{ pets }, { vets }] = await Promise.all([
            this.api.portalPets(), this.api.portalVets()
        ]);
        this.vets = vets;
        const { el } = this.ui;

        const petCards = pets.map(pet => this.petCard(pet));

        this.ui.mount(content,
            el('div.portal-actions',
                el('h2', 'My Dogs'),
                el('button.btn.btn--primary', { onclick: () => this.editDog(null) }, '+ Add a dog')),
            pets.length
                ? el('div.portal-cards', petCards)
                : this.ui.empty('No dogs on file yet.'),

            el('div.portal-actions',
                el('h2', 'Veterinarians'),
                el('button.btn', { onclick: () => this.editVet(null) }, '+ Add a vet')),
            vets.length
                ? el('div.portal-cards', vets.map(v => this.vetCard(v)))
                : this.ui.empty('No veterinarians on file yet.'));
    }

    petCard(pet) {
        const { el, date } = this.ui;
        const vet = (this.vets || []).find(v => String(v.id) === String(pet.vet_id));

        const records = (pet.records || []).map(r =>
            el('li.portal-line',
                el('span', `${this.ui.titleCase(r.record_type)}${r.expires_on ? ' · exp ' + date(r.expires_on) : ''}`),
                el('span.portal-line__actions',
                    r.file_path
                        ? el('a.linkbtn', { href: this.api.portalRecordFileUrl(r.id), target: '_blank' }, 'View')
                        : null,
                    el('button.linkbtn.linkbtn--danger',
                        { onclick: () => this.removeRecord(r) }, 'Remove'))));

        return el('div.portal-card',
            pet.status === 'archived' ? el('span.badge.badge--neutral', 'Archived') : null,
            el('header.portal-card__head',
                el('h3', pet.name),
                el('span.muted', [pet.breed, pet.sex].filter(Boolean).join(' · ') || '')),
            el('div.portal-card__body',
                el('ul.portal-list',
                    el('li.portal-line', el('span.muted', 'Vet'), el('span', vet ? vet.clinic_name : '—')),
                    records.length ? records : el('li.portal-line', el('span.muted', 'No records on file'), null))),
            el('footer.portal-card__foot',
                el('button.btn.btn--sm', { onclick: () => this.editDog(pet) }, 'Edit'),
                el('button.btn.btn--sm', { onclick: () => this.addRecord(pet) }, 'Add record'),
                el('button.btn.btn--sm.btn--danger', { onclick: () => this.removeDog(pet) }, 'Remove')));
    }

    vetCard(vet) {
        const { el } = this.ui;
        return el('div.portal-card',
            el('header.portal-card__head', el('h3', vet.clinic_name),
                el('span.muted', vet.vet_name || '')),
            el('div.portal-card__body',
                el('ul.portal-list',
                    vet.phone ? el('li.portal-line', el('span.muted', 'Phone'), el('span', vet.phone)) : null,
                    vet.email ? el('li.portal-line', el('span.muted', 'Email'), el('span', vet.email)) : null,
                    el('li.portal-line', el('span.muted', 'City'),
                        el('span', [vet.city, vet.state].filter(Boolean).join(', ') || '—')))),
            el('footer.portal-card__foot',
                el('button.btn.btn--sm', { onclick: () => this.editVet(vet) }, 'Edit')));
    }

    editDog(pet) {
        const values = pet ? { ...pet } : {};
        const body = this.forms.renderFields('portalPet', values, { clientVets: this.vetOptions() });
        this.ui.modal({
            title: pet ? `Edit ${pet.name}` : 'Add a dog',
            body,
            confirmLabel: pet ? 'Save' : 'Add dog',
            onConfirm: async (container) => {
                const data = this.forms.read('portalPet', container);
                if (!data.name) { this.ui.toast('Your dog needs a name.', 'bad'); return false; }
                if (pet) await this.api.portalUpdatePet(pet.id, data);
                else await this.api.portalCreatePet(data);
                this.ui.toast('Saved.', 'good');
                this.route();
            }
        });
    }

    async removeDog(pet) {
        const ok = await this.ui.confirm(
            `Remove ${pet.name}? If ${pet.name} has past stays or charges, the record is archived rather than deleted.`,
            { title: 'Remove dog', confirmLabel: 'Remove' });
        if (!ok) return;
        const result = await this.api.portalDeletePet(pet.id);
        this.ui.toast(result.message || 'Removed.', 'good');
        this.route();
    }

    addRecord(pet) {
        const body = this.forms.renderFields('portalRecord', {});
        this.ui.modal({
            title: `Add a record for ${pet.name}`,
            body,
            confirmLabel: 'Add record',
            onConfirm: async (container) => {
                const data = this.forms.read('portalRecord', container);
                if (!data.record_type) { this.ui.toast('Choose a record type.', 'bad'); return false; }
                const fd = new FormData();
                for (const [k, v] of Object.entries(data)) {
                    if (k === 'file') { if (v) fd.append('file', v); }
                    else if (v !== null && v !== undefined && v !== '') fd.append(k, v);
                }
                await this.api.portalAddRecord(pet.id, fd);
                this.ui.toast('Record added.', 'good');
                this.route();
            }
        });
    }

    async removeRecord(record) {
        const ok = await this.ui.confirm('Remove this record?', { title: 'Remove record', confirmLabel: 'Remove' });
        if (!ok) return;
        await this.api.portalDeleteRecord(record.id);
        this.ui.toast('Removed.', 'good');
        this.route();
    }

    editVet(vet) {
        const body = this.forms.renderFields('portalVet', vet ? { ...vet } : {});
        this.ui.modal({
            title: vet ? `Edit ${vet.clinic_name}` : 'Add a veterinarian',
            body,
            confirmLabel: 'Save',
            onConfirm: async (container) => {
                const data = this.forms.read('portalVet', container);
                if (!data.clinic_name) { this.ui.toast('The clinic name is required.', 'bad'); return false; }
                if (vet) await this.api.portalUpdateVet(vet.id, data);
                else await this.api.portalCreateVet(data);
                this.ui.toast('Saved.', 'good');
                this.route();
            }
        });
    }

    /* ---------------- billing ---------------- */

    async billing(content) {
        // Coming back from a successful Stripe redirect. The webhook records the
        // payment; this just reassures them while the balance catches up.
        if (window.location.hash.includes('paid=1')) {
            this.ui.toast('Payment received — thank you! Your balance will update shortly.', 'good');
            window.history.replaceState(null, '', '#/portal/billing');
        }

        const data = await this.api.portalBilling();
        const { el, money, date } = this.ui;
        const balance = data.balance_cents || 0;
        const payable = i => data.online_pay && i.status !== 'paid' && i.status !== 'void';

        const columns = [
            { label: 'Invoice', render: i => i.number },
            { label: 'Issued', render: i => date(i.issued_on) },
            { label: 'Due', render: i => date(i.due_on) },
            { label: 'Total', align: 'right', render: i => money(i.total_cents) },
            { label: 'Status', render: i => this.ui.badge(i.status, this.ui.statusTone(i.status)) }
        ];
        if (data.online_pay) {
            columns.push({
                label: '', render: i => payable(i)
                    ? el('button.btn.btn--sm.btn--primary', {
                        type: 'button',
                        onclick: e => { e.stopPropagation(); this.payInvoice(i); }
                    }, 'Pay')
                    : null
            });
        }

        const invoices = this.ui.table({
            columns,
            rows: data.invoices,
            empty: 'No invoices yet.',
            onRowClick: i => this.showInvoice(i.id, data.online_pay)
        });

        const payments = this.ui.table({
            columns: [
                { label: 'Date', render: p => date(p.paid_on) },
                { label: 'Method', render: p => this.ui.titleCase(p.method) },
                { label: 'Amount', align: 'right', render: p => money(p.amount_cents) }
            ],
            rows: data.payments,
            empty: 'No payments recorded.'
        });

        this.ui.mount(content,
            el('div.portal-billing-head',
                el('div.portal-stat',
                    el('span.portal-stat__label', 'Balance due'),
                    el('strong.portal-stat__value',
                        { class: balance > 0 ? 'portal-stat__value--due' : 'portal-stat__value--ok' },
                        money(balance)))),
            el('section.portal-panel', el('header.portal-panel__head', el('h2', 'Invoices')), invoices),
            el('section.portal-panel', el('header.portal-panel__head', el('h2', 'Payments')), payments));
    }

    async showInvoice(id, onlinePay = false) {
        const { invoice } = await this.api.portalInvoice(id);
        const { el, money, date } = this.ui;
        const items = this.ui.table({
            columns: [
                { label: 'Description', render: r => r.description },
                { label: 'When', render: r => date(r.performed_on) },
                { label: 'Qty', align: 'right', render: r => r.qty },
                { label: 'Amount', align: 'right', render: r => money(r.amount_cents) }
            ],
            rows: invoice.items,
            empty: 'No line items.'
        });

        const paid = (invoice.payments || []).reduce((s, p) => s + (p.amount_cents || 0), 0);
        const outstanding = invoice.total_cents - paid;
        const canPay = onlinePay && invoice.status !== 'void' && outstanding > 0;

        this.ui.modal({
            title: `Invoice ${invoice.number}`,
            width: 640,
            body: el('div',
                el('p.muted', `Issued ${date(invoice.issued_on)} · Due ${date(invoice.due_on)}`),
                items,
                el('p.portal-invoice-total', el('strong', `Total: ${money(invoice.total_cents)}`)),
                outstanding > 0 && paid > 0
                    ? el('p.portal-invoice-total', el('strong', `Balance due: ${money(outstanding)}`))
                    : null,
                canPay
                    ? el('div.portal-form-actions',
                        el('button.btn.btn--primary', {
                            type: 'button',
                            onclick: () => this.payInvoice(invoice)
                        }, `Pay ${money(outstanding)} online`))
                    : null)
        });
    }

    /** Off to Stripe's hosted page; the webhook records the payment on the way back. */
    async payInvoice(invoice) {
        try {
            const { url } = await this.api.portalInvoiceCheckout(invoice.id);
            window.location.href = url;
        } catch (err) {
            this.ui.toast(err.message || 'Could not start the payment.', 'bad');
        }
    }

    /* ---------------- profile ---------------- */

    async profile(content) {
        const { client } = await this.api.portalProfile();
        const { el } = this.ui;

        const form = el('form.portal-profile-form', { onsubmit: e => e.preventDefault() },
            this.forms.renderFields('portalProfile', client),
            el('div.portal-form-actions',
                el('button.btn.btn--primary', { type: 'submit' }, 'Save changes')));

        form.addEventListener('submit', async () => {
            const data = this.forms.read('portalProfile', form);
            try {
                await this.api.portalUpdateProfile(data);
                this.ui.toast('Profile updated.', 'good');
            } catch (err) {
                this.ui.toast(err.message || 'Could not save.', 'bad');
            }
        });

        this.ui.mount(content,
            el('div.portal-actions',
                el('h2', 'Your details'),
                el('button.btn', { onclick: () => this.changePassword() }, 'Change password')),
            el('section.portal-panel', form));
    }

    changePassword() {
        const body = this.forms.renderFields('portalPassword', {});
        this.ui.modal({
            title: 'Change password',
            body,
            confirmLabel: 'Change password',
            onConfirm: async (container) => {
                const data = this.forms.read('portalPassword', container);
                if (!data.new_password || data.new_password.length < 8) {
                    this.ui.toast('Choose a password of at least 8 characters.', 'bad');
                    return false;
                }
                const result = await this.api.portalChangePassword(data.current_password, data.new_password);
                this.ui.toast(result.message || 'Password changed. Please sign in again.', 'good');
                this.api.setPortalToken(null);
                this.app.navigate('/portal');
            }
        });
    }

    /* ---------------- misc ---------------- */

    route() {
        this.app.route();
    }
}
