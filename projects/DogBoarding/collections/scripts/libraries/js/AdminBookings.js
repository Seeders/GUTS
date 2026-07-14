/**
 * AdminBookings - stays.
 *
 * A booking is a client, a date range, and one or more dogs. Its job in life is
 * to become charges: "4 nights x 2 dogs" is where the money comes from, so the
 * detail view leans hard on the Add boarding charges button.
 */
class AdminBookings {
    constructor(app, console_) {
        this.app = app;
        this.api = app.api;
        this.console = console_;
    }

    get ui() { return GUTS.DogBoardUI; }

    async render(id) {
        if (id === 'new') {
            const view = await this.list();
            this.newBooking();
            return view;
        }
        return id ? this.detail(Number(id)) : this.list();
    }

    reload() {
        this.app.route();
    }

    /* ================= list ================= */

    async list() {
        const { el } = this.ui;

        const results = el('div.results', this.ui.spinner());

        const statusSelect = el('select', { onchange: () => load() },
            [{ value: '', label: 'All bookings' },
             { value: 'requested', label: 'Requested' },
             { value: 'confirmed', label: 'Confirmed' },
             { value: 'checked_in', label: 'On site' },
             { value: 'checked_out', label: 'Finished' },
             { value: 'cancelled', label: 'Cancelled' }].map(o =>
                el('option', { value: o.value }, o.label)));

        const from = el('input', { type: 'date', onchange: () => load() });
        const to = el('input', { type: 'date', onchange: () => load() });

        const load = async () => {
            this.ui.mount(results, this.ui.spinner());
            const bookings = await this.api.bookings({
                status: statusSelect.value,
                from: from.value,
                to: to.value
            });

            this.ui.mount(results, this.ui.table({
                columns: [
                    { label: 'Client', render: b => el('strong', `${b.first_name} ${b.last_name}`) },
                    { label: 'Dogs', key: 'pet_names' },
                    { label: 'In', render: b => this.ui.date(b.check_in) },
                    { label: 'Out', render: b => this.ui.date(b.check_out) },
                    { label: 'Nights', align: 'right',
                      render: b => this.ui.nights(b.check_in, b.check_out) },
                    { label: 'Status',
                      render: b => this.ui.badge(b.status, this.ui.statusTone(b.status)) },
                    { label: 'Charged', align: 'right', render: b => b.charge_count
                        ? this.ui.money(b.charged_cents)
                        : el('span.warn-text', 'not charged') }
                ],
                rows: bookings,
                empty: 'No bookings match.',
                onRowClick: b => this.app.navigate(`/admin/bookings/${b.id}`)
            }));
        };

        await load();

        return el('div',
            el('header.page-head',
                el('h1', 'Bookings'),
                el('div.page-head__actions',
                    el('button.btn.btn--primary',
                        { onclick: () => this.newBooking() }, '+ New booking'))),
            el('div.toolbar',
                statusSelect,
                el('label.inline-field', el('span', 'From'), from),
                el('label.inline-field', el('span', 'To'), to)),
            results);
    }

    /* ================= detail ================= */

    async detail(id) {
        const { el } = this.ui;
        const booking = await this.api.booking(id);
        const nights = booking.nights;

        const charged = booking.charges.reduce((sum, c) => sum + c.amount_cents, 0);
        const unbilled = booking.charges.filter(c => !c.invoice_id)
            .reduce((sum, c) => sum + c.amount_cents, 0);

        return el('div',
            el('a.back', { href: '#/admin/bookings' }, '← All bookings'),

            el('header.page-head',
                el('div',
                    el('h1', `${booking.first_name} ${booking.last_name}`,
                        this.ui.badge(booking.status, this.ui.statusTone(booking.status))),
                    el('p.muted',
                        `${this.ui.date(booking.check_in)} → ${this.ui.date(booking.check_out)} · ` +
                        `${nights} night${nights === 1 ? '' : 's'} · ` +
                        `${booking.pets.length} dog${booking.pets.length === 1 ? '' : 's'}`)),
                el('div.page-head__actions', this.statusActions(booking))),

            el('div.stats',
                el('div.stat',
                    el('span.stat__label', 'Nights'),
                    el('strong.stat__value', String(nights))),
                el('div.stat',
                    el('span.stat__label', 'Charged so far'),
                    el('strong.stat__value', this.ui.money(charged))),
                el('div.stat',
                    el('span.stat__label', 'Not yet invoiced'),
                    el('strong.stat__value', { class: unbilled ? 'warn-text' : '' },
                        this.ui.money(unbilled)))),

            el('div.form-actions.form-actions--left',
                el('button.btn.btn--primary',
                    { onclick: () => this.addBoardingCharges(booking) },
                    '+ Add boarding charges'),
                el('button.btn',
                    { onclick: () => this.console.modules.billing.addChargeForBooking(booking) },
                    '+ Add an extra'),
                el('a.btn', { href: `#/admin/clients/${booking.client_id}` },
                    'Open client record'),
                el('button.btn', { onclick: () => this.editBooking(booking) }, 'Edit dates'),
                el('button.btn.btn--danger-ghost',
                    { onclick: () => this.deleteBooking(booking) }, 'Delete')),

            booking.notes
                ? el('div.notice', el('strong', 'Notes: '), booking.notes)
                : null,

            el('section.panel',
                el('h2', 'Dogs on this stay'),
                this.ui.table({
                    columns: [
                        { label: 'Dog', render: p => el('strong', p.name) },
                        { label: 'Breed', key: 'breed' },
                        { label: 'Medications', render: p => p.medications
                            ? el('span.warn-text', p.medications) : '—' },
                        { label: 'Allergies', render: p => p.allergies
                            ? el('span.warn-text', p.allergies) : '—' },
                        { label: 'Feeding', key: 'feeding' },
                        { label: 'Kennel', render: p => this.kennelInput(booking, p) }
                    ],
                    rows: booking.pets,
                    empty: 'No dogs on this booking.'
                })),

            el('section.panel',
                el('h2', 'Charges from this stay'),
                this.ui.table({
                    columns: [
                        { label: 'Date', render: c => this.ui.date(c.performed_on) },
                        { label: 'Dog', key: 'pet_name' },
                        { label: 'Service', key: 'description' },
                        { label: 'Qty', key: 'qty', align: 'right' },
                        { label: 'Rate', align: 'right',
                          render: c => this.ui.money(c.unit_price_cents) },
                        { label: 'Amount', align: 'right',
                          render: c => el('strong', this.ui.money(c.amount_cents)) },
                        { label: 'Invoice', render: c => c.invoice_id
                            ? el('a', { href: `#/admin/billing/${c.invoice_id}` }, 'invoiced')
                            : this.ui.badge('unbilled', 'warn') },
                        { label: '', render: c => c.invoice_id ? null
                            : el('button.link-btn.danger', {
                                onclick: () => this.deleteCharge(c)
                              }, 'Remove') }
                    ],
                    rows: booking.charges,
                    empty: 'Nothing charged yet. Use "Add boarding charges" to bill the nights.',
                    footer: booking.charges.length
                        ? el('tr',
                            el('td', { colspan: 5 }, el('strong', 'Total')),
                            el('td.num', el('strong', this.ui.money(charged))),
                            el('td'), el('td'))
                        : null
                })));
    }

    kennelInput(booking, pet) {
        const { el } = this.ui;
        const input = el('input.kennel-input', {
            type: 'text',
            value: pet.kennel || '',
            placeholder: '—',
            onchange: async () => {
                try {
                    await this.api.updateBooking(booking.id, {
                        kennels: { [pet.id]: input.value }
                    });
                    this.ui.toast(`${pet.name} → ${input.value || 'unassigned'}`, 'good');
                } catch (err) {
                    this.ui.toast(err.message, 'bad');
                }
            }
        });
        return input;
    }

    statusActions(booking) {
        const { el } = this.ui;

        const move = (status, label, primary = false) => el('button.btn', {
            class: primary ? 'btn--primary' : '',
            onclick: async () => {
                try {
                    await this.api.updateBooking(booking.id, { status });
                    this.ui.toast(`Booking ${this.ui.titleCase(status)}.`, 'good');
                    this.reload();
                } catch (err) {
                    this.ui.toast(err.message, 'bad');
                }
            }
        }, label);

        switch (booking.status) {
            case 'requested':
                return [move('confirmed', '✓ Confirm', true), move('cancelled', 'Decline')];
            case 'confirmed':
                return [move('checked_in', '→ Check in', true), move('cancelled', 'Cancel')];
            case 'checked_in':
                return [move('checked_out', '← Check out', true)];
            case 'checked_out':
                return [move('checked_in', 'Undo check-out')];
            default:
                return [move('confirmed', 'Reinstate')];
        }
    }

    /* ================= mutations ================= */

    async newBooking() {
        const clients = await this.api.clients({});
        this.bookingModal(null, clients);
    }

    async newBookingFor(client) {
        this.bookingModal(null, null, client);
    }

    /**
     * The booking form. Picking a client loads their dogs, because you cannot
     * board a dog that does not belong to the person booking.
     */
    async bookingModal(booking, clients = null, presetClient = null) {
        const { el } = this.ui;

        const clientList = clients || await this.api.clients({});
        const petBox = el('div.pet-picker');

        const clientSelect = el('select', { name: 'client_id', required: true },
            [el('option', { value: '' }, '— pick a client —'),
             ...clientList.map(c => el('option', {
                value: c.id,
                selected: presetClient ? c.id === presetClient.id : false
             }, `${c.first_name} ${c.last_name}`))]);

        const loadPets = async () => {
            const clientId = Number(clientSelect.value);
            if (!clientId) {
                this.ui.mount(petBox, el('p.muted', 'Pick a client first.'));
                return;
            }

            this.ui.mount(petBox, this.ui.spinner('Loading dogs…'));
            const pets = await this.api.pets({ client_id: clientId });
            const active = pets.filter(p => p.status === 'active');

            if (!active.length) {
                this.ui.mount(petBox,
                    el('p.warn-text', 'This client has no active dogs on file.'));
                return;
            }

            this.ui.mount(petBox, active.map(pet => el('label.pet-pick',
                el('input', {
                    type: 'checkbox', value: pet.id, name: 'pet',
                    checked: active.length === 1
                }),
                el('span',
                    el('strong', pet.name),
                    pet.breed ? el('small.muted', ` ${pet.breed}`) : null))));
        };

        clientSelect.addEventListener('change', loadPets);

        const checkIn = el('input', { type: 'date', name: 'check_in', required: true,
            value: this.ui.today() });
        const checkOut = el('input', { type: 'date', name: 'check_out', required: true,
            value: this.ui.addDays(this.ui.today(), 2) });

        const nightsLabel = el('p.muted.small');
        const updateNights = () => {
            if (checkIn.value && checkOut.value) {
                const n = this.ui.nights(checkIn.value, checkOut.value);
                nightsLabel.textContent =
                    `${n} night${n === 1 ? '' : 's'} — you do not charge for the checkout day.`;
            }
        };
        checkIn.addEventListener('change', updateNights);
        checkOut.addEventListener('change', updateNights);
        updateNights();

        const body = el('div',
            el('label.field',
                el('span.field__label', 'Client', el('em.req', '*')),
                clientSelect),
            el('div.field',
                el('span.field__label', 'Dogs'),
                petBox),
            el('div.field-row',
                el('label.field',
                    el('span.field__label', 'Check in', el('em.req', '*')), checkIn),
                el('label.field',
                    el('span.field__label', 'Check out', el('em.req', '*')), checkOut)),
            nightsLabel,
            this.ui.field({ name: 'notes', label: 'Notes', type: 'textarea', rows: 2 }));

        if (presetClient) await loadPets();
        else this.ui.mount(petBox, el('p.muted', 'Pick a client first.'));

        this.ui.modal({
            title: 'New booking',
            width: 620,
            body: () => body,
            confirmLabel: 'Create booking',
            onConfirm: async (content) => {
                const clientId = Number(clientSelect.value);
                if (!clientId) throw new Error('Pick a client.');

                const petIds = [...content.querySelectorAll('input[name="pet"]:checked')]
                    .map(input => Number(input.value));
                if (!petIds.length) throw new Error('Pick at least one dog.');

                const created = await this.api.createBooking({
                    client_id: clientId,
                    pet_ids: petIds,
                    check_in: checkIn.value,
                    check_out: checkOut.value,
                    notes: content.querySelector('[name="notes"]').value
                });

                this.ui.toast('Booking created.', 'good');
                this.app.navigate(`/admin/bookings/${created.id}`);
            }
        });
    }

    editBooking(booking) {
        const { el } = this.ui;

        const body = el('div',
            this.ui.row(
                this.ui.field({ name: 'check_in', label: 'Check in', type: 'date',
                    value: booking.check_in }),
                this.ui.field({ name: 'check_out', label: 'Check out', type: 'date',
                    value: booking.check_out })),
            this.ui.field({ name: 'status', label: 'Status', type: 'select',
                value: booking.status,
                options: ['requested', 'confirmed', 'checked_in', 'checked_out', 'cancelled'] }),
            this.ui.field({ name: 'notes', label: 'Notes', type: 'textarea',
                value: booking.notes }),
            booking.charges.length
                ? el('p.hint.warn-text',
                    'Changing the dates does not change charges that have already been added.')
                : null);

        this.ui.modal({
            title: 'Edit booking',
            body: () => body,
            confirmLabel: 'Save',
            onConfirm: async (content) => {
                await this.api.updateBooking(booking.id, this.ui.readForm(content));
                this.ui.toast('Booking updated.', 'good');
                this.reload();
            }
        });
    }

    async deleteBooking(booking) {
        const ok = await this.ui.confirm('Delete this booking and any uninvoiced charges on it?',
            { title: 'Delete booking' });
        if (!ok) return;

        try {
            await this.api.deleteBooking(booking.id);
            this.ui.toast('Booking deleted.', 'good');
            this.app.navigate('/admin/bookings');
        } catch (err) {
            this.ui.toast(err.message, 'bad');
        }
    }

    /**
     * Bill the nights. Per-night services are charged qty = nights, so one line
     * per dog covers the whole stay.
     */
    async addBoardingCharges(booking) {
        const { el } = this.ui;
        const services = await this.api.services();
        const nights = booking.nights;

        const serviceSelect = el('select', { name: 'service_id' },
            services.map(s => el('option', { value: s.id },
                `${s.name} — ${this.ui.money(s.price_cents)} / ${s.unit}`)));

        const petChecks = el('div.pet-picker', booking.pets.map(pet =>
            el('label.pet-pick',
                el('input', { type: 'checkbox', value: pet.id, name: 'pet', checked: true }),
                el('span', el('strong', pet.name)))));

        const preview = el('p.preview');
        const updatePreview = () => {
            const service = services.find(s => s.id === Number(serviceSelect.value));
            const count = petChecks.querySelectorAll('input:checked').length;
            if (!service) return;

            const perNight = service.unit === 'night' || service.unit === 'day';
            const qty = perNight ? nights : 1;
            const each = service.price_cents * qty;

            preview.textContent = perNight
                ? `${count} dog(s) × ${nights} night(s) × ${this.ui.money(service.price_cents)} = ` +
                  `${this.ui.money(each * count)}`
                : `${count} dog(s) × ${this.ui.money(service.price_cents)} = ` +
                  `${this.ui.money(each * count)}`;
        };

        serviceSelect.addEventListener('change', updatePreview);
        petChecks.addEventListener('change', updatePreview);

        const body = el('div',
            el('label.field',
                el('span.field__label', 'Service'),
                serviceSelect),
            el('div.field',
                el('span.field__label', 'Which dogs'),
                petChecks),
            el('div.preview-box', preview),
            el('p.hint',
                'A dog already charged for this service on this booking is skipped, so you ' +
                'cannot double-bill by clicking twice.'));

        updatePreview();

        this.ui.modal({
            title: `Charge ${nights} night${nights === 1 ? '' : 's'}`,
            width: 560,
            body: () => body,
            confirmLabel: 'Add charges',
            onConfirm: async (content) => {
                const petIds = [...content.querySelectorAll('input[name="pet"]:checked')]
                    .map(i => Number(i.value));
                if (!petIds.length) throw new Error('Pick at least one dog.');

                const result = await this.api.addBookingCharges(booking.id, {
                    service_id: Number(serviceSelect.value),
                    pet_ids: petIds
                });

                this.ui.toast(result.message, result.created ? 'good' : 'warn');
                this.reload();
            }
        });
    }

    async deleteCharge(charge) {
        const ok = await this.ui.confirm(
            `Remove "${charge.description}" for ${charge.pet_name}?`, { title: 'Remove charge' });
        if (!ok) return;

        try {
            await this.api.deleteServiceEvent(charge.id);
            this.ui.toast('Charge removed.', 'good');
            this.reload();
        } catch (err) {
            this.ui.toast(err.message, 'bad');
        }
    }
}
