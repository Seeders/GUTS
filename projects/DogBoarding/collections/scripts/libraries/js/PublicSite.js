/**
 * PublicSite - what a dog owner sees.
 *
 * This class builds almost no markup. The markup is the `public` interface; the
 * words are the `content` collection; the registration form is the `intake` and
 * `intakePet` form schemas; the vet-record rows offer whatever is in
 * `recordTypes`. This file's job is to put those together and to post the
 * result to the server.
 */
class PublicSite {
    constructor(app) {
        this.app = app;
        this.api = app.api;
    }

    get ui() { return GUTS.DogBoardUI; }
    get forms() { return this.app.forms; }
    get collections() { return this.app.collections; }

    /** Everything the interface's data-bind hooks can reach. */
    bindingData() {
        const content = this.collections.content || {};
        return {
            business: this.app.info.business,
            home: content.home || {},
            rates: content.rates || {},
            intake: content.intake || {},
            success: content.success || {}
        };
    }

    async render(root, scene) {
        const data = this.bindingData();

        this.ui.bind(root, data);
        this.renderNav(root, scene);
        this.showPage(root, scene.page);

        if (scene.page === 'home') this.renderHome(root, data);
        if (scene.page === 'rates') this.renderRates(root, data);
        if (scene.page === 'intake') this.renderIntake(root, data);
    }

    /** Only the requested page is visible; the rest of the interface stays put. */
    showPage(root, page) {
        root.querySelectorAll('[data-page]').forEach(section => {
            section.hidden = section.dataset.page !== page;
        });
    }

    renderNav(root, scene) {
        const nav = root.querySelector('[data-list="navLinks"]');
        if (!nav) return;

        const content = this.collections.content?.nav;
        if (!content) return;

        const link = (item, staff = false) => {
            const node = this.app.interfaces.template('navLink');
            node.textContent = item.label;
            node.setAttribute('href', `#${item.route}`);
            node.classList.toggle('nav__link--on', item.route === scene.route);
            node.classList.toggle('nav__link--staff', staff);
            return node;
        };

        this.ui.mount(nav,
            ...content.links.map(item => link(item)),
            link(content.staffLink, true));
    }

    /* ---------------- home ---------------- */

    renderHome(root, data) {
        // Required vaccinations: whatever recordTypes says is required.
        const required = this.ui.ordered(this.collections.recordTypes)
            .filter(type => type.required);

        this.ui.mount(root.querySelector('[data-list="requiredVaccines"]'),
            required.map(type => this.ui.el('li', type.title)));

        // The steps.
        const steps = root.querySelector('[data-list="steps"]');
        this.ui.mount(steps, (data.home.steps?.items || []).map((step, i) => {
            const node = this.app.interfaces.template('step');
            node.querySelector('.step__n').textContent = String(i + 1);
            node.querySelector('[data-step-title]').textContent = step.title;
            node.querySelector('[data-step-body]').textContent = step.body;
            return node;
        }));

        // A few services off the rate card.
        const count = data.home.services?.featuredCount ?? 4;
        const featured = this.app.info.services.slice(0, count);

        this.ui.mount(root.querySelector('[data-list="featuredServices"]'),
            featured.map(service => {
                const node = this.app.interfaces.template('serviceCard');
                node.querySelector('[data-service-name]').textContent = service.name;
                node.querySelector('[data-service-description]').textContent = service.description || '';
                node.querySelector('[data-service-price]').textContent = this.ui.money(service.price_cents);
                node.querySelector('[data-service-unit]').textContent = ` / ${this.unitLabel(service.unit)}`;
                return node;
            }));
    }

    unitLabel(unit) {
        return this.collections.serviceUnits?.[unit]?.title?.toLowerCase() || unit;
    }

    /* ---------------- rates ---------------- */

    renderRates(root, data) {
        const groups = root.querySelector('[data-list="rateGroups"]');
        if (!groups) return;

        const headings = data.rates.groupHeadings || {};

        // One section per service unit, in the order the serviceUnits collection
        // gives them. An empty unit renders nothing.
        const sections = this.ui.ordered(this.collections.serviceUnits)
            .map(unit => {
                const services = this.app.info.services.filter(s => s.unit === unit.id);
                if (!services.length) return null;

                const section = this.app.interfaces.template('rateGroup');
                section.querySelector('[data-group-heading]').textContent =
                    headings[unit.id] || unit.title;

                const rows = services.map(service => {
                    const row = this.app.interfaces.template('rateRow');
                    row.querySelector('[data-service-name]').textContent = service.name;
                    row.querySelector('[data-service-description]').textContent = service.description || '';
                    row.querySelector('[data-service-price]').textContent =
                        this.ui.money(service.price_cents);
                    row.querySelector('[data-service-unit]').textContent =
                        ` / ${this.unitLabel(service.unit)}`;
                    return row;
                });

                this.ui.mount(section.querySelector('[data-group-rows]'), rows);
                return section;
            })
            .filter(Boolean);

        this.ui.mount(groups, sections);
    }

    /* ---------------- registration ---------------- */

    renderIntake(root, data) {
        const petList = root.querySelector('[data-pets]');

        // Kept for the delegated submit handler, which is given only the form.
        this.intakeRoot = root;
        this.intakeData = data;

        // The whole top half of the form is the `intake` schema.
        this.ui.mount(root.querySelector('[data-fieldsets]'),
            this.forms.render('intake'));

        const addPet = root.querySelector('[data-add-pet]');
        addPet.textContent = data.intake.addPetLabel || '+ Add another dog';

        this.petCount = 0;
        this.ui.clear(petList);

        addPet.onclick = () => this.addPetCard(petList, data);
        this.addPetCard(petList, data);

        // The submit is delegated in DogBoardingApp - see submitIntake below.
        // Binding it to this element would be lost the moment the interface is
        // re-injected.
    }

    /** Called by the app's delegated submit listener. */
    submitIntake(form) {
        const root = this.intakeRoot;
        const petList = root.querySelector('[data-pets]');
        return this.submit(root, form, petList, this.intakeData);
    }

    /** One dog. The fields come from the `intakePet` schema. */
    addPetCard(petList, data) {
        const card = this.app.interfaces.template('petCard');
        const index = this.petCount++;

        card.dataset.petIndex = String(index);
        card.querySelector('[data-pet-title]').textContent = `Dog ${index + 1}`;

        this.ui.bind(card, data);

        this.ui.mount(card.querySelector('[data-pet-fields]'),
            this.forms.renderFields('intakePet'));

        card.querySelector('[data-remove-pet]').onclick = () => {
            if (petList.children.length === 1) {
                this.ui.toast('You need at least one dog.', 'warn');
                return;
            }
            card.remove();
            this.renumber(petList);
        };

        const records = card.querySelector('[data-records]');
        const addRecord = card.querySelector('[data-add-record]');
        addRecord.textContent = data.intake.addRecordLabel || '+ Add another record';
        addRecord.onclick = () => records.appendChild(this.recordRow());

        // Pre-seed a row for each vaccination the business requires.
        this.ui.ordered(this.collections.recordTypes)
            .filter(type => type.required)
            .forEach(type => records.appendChild(this.recordRow(type.id)));

        petList.appendChild(card);
        return card;
    }

    /** A vet-record row. Its dropdown is the recordTypes collection. */
    recordRow(selected = '') {
        const row = this.app.interfaces.template('recordRow');
        const select = row.querySelector('[data-options="recordTypes"]');

        this.ui.mount(select, this.ui.ordered(this.collections.recordTypes).map(type =>
            this.ui.el('option', { value: type.id, selected: type.id === selected }, type.title)));

        row.querySelector('[data-remove-record]').onclick = () => row.remove();
        return row;
    }

    renumber(petList) {
        [...petList.children].forEach((card, i) => {
            card.dataset.petIndex = String(i);
            card.querySelector('[data-pet-title]').textContent = `Dog ${i + 1}`;
        });
        this.petCount = petList.children.length;
    }

    /* ---------------- submit ---------------- */

    async submit(root, form, petList, data) {
        const button = form.querySelector('button[type="submit"]');

        // The top-level answers, read back through the schema that produced them.
        const top = this.forms.read('intake', root.querySelector('[data-fieldsets]'));

        const petSpecs = this.forms.fieldSpecs('intakePet');
        const pets = [];
        const withFile = [];
        const withoutFile = [];
        const files = [];

        [...petList.children].forEach((card, petIndex) => {
            const fields = card.querySelector('[data-pet-fields]');
            const pet = {};
            for (const spec of petSpecs) {
                const input = fields.querySelector(`[name="${spec.name}"]`);
                if (!input) continue;
                pet[spec.name] = spec.type === 'checkbox' ? input.checked : input.value.trim();
            }
            pets.push(pet);

            card.querySelectorAll('.record-row').forEach(row => {
                const meta = {
                    petIndex,
                    record_type: row.querySelector('[name="record_type"]').value,
                    issued_on: row.querySelector('[name="issued_on"]').value,
                    expires_on: row.querySelector('[name="expires_on"]').value
                };
                const file = row.querySelector('[name="record_file"]').files[0];

                if (file) {
                    files.push(file);
                    withFile.push(meta);
                } else if (meta.issued_on || meta.expires_on) {
                    // No document, but they gave us dates — worth keeping, and worth chasing.
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
            // file must come first, in the order we appended them.
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
        const original = button.textContent;
        button.textContent = 'Sending…';

        try {
            const result = await this.api.submitIntake(payload, files);

            this.showPage(root, 'success');
            root.querySelector('[data-result-message]').textContent = result.message;
            root.querySelector('[data-result-detail]').textContent =
                `We have ${result.pets} dog${result.pets === 1 ? '' : 's'} on file for you. ` +
                (data.success.body || '');

            window.scrollTo(0, 0);
            window.history.replaceState(null, '', '#/registered');

        } catch (err) {
            this.ui.toast(err.message || 'We could not save that. Please try again.', 'bad');
            button.disabled = false;
            button.textContent = original;
        }
    }
}
