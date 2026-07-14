/**
 * AdminClients - the client and dog record system.
 *
 * List view: everybody, searchable, with what they owe.
 * Detail view: one client, and everything hanging off them - dogs, vet,
 * vet records, stays, charges, invoices, payments.
 */
class AdminClients {
    constructor(app, console_) {
        this.app = app;
        this.api = app.api;
        this.console = console_;
    }

    get ui() { return GUTS.DogBoardUI; }
    get forms() { return this.app.forms; }
    get collections() { return this.app.collections; }

    render(id) {
        return id ? this.detail(Number(id)) : this.list();
    }

    reload() {
        this.app.route();
    }

    /* ================= list ================= */

    async list() {
        const { el } = this.ui;
        const status = (this.console.query && this.console.query.status) || '';

        const results = el('div.results', this.ui.spinner());

        const search = el('input.search', {
            type: 'search',
            placeholder: 'Search by owner, dog, email or phone…',
            value: ''
        });

        const statusSelect = el('select', {
            onchange: () => load()
        },
            [{ value: '', label: 'All clients' },
             { value: 'pending', label: 'Pending approval' },
             { value: 'active', label: 'Active' },
             { value: 'archived', label: 'Archived' }].map(opt =>
                el('option', { value: opt.value, selected: opt.value === status }, opt.label)));

        const load = async () => {
            this.ui.mount(results, this.ui.spinner());
            const clients = await this.api.clients({
                query: search.value.trim(),
                status: statusSelect.value
            });

            this.ui.mount(results, this.ui.table({
                columns: [
                    { label: 'Client', render: c => el('div',
                        el('strong', `${c.first_name} ${c.last_name}`),
                        c.status === 'pending' ? this.ui.badge('pending', 'warn') : null) },
                    { label: 'Dogs', render: c => c.pet_names || '—' },
                    { label: 'Phone', key: 'phone' },
                    { label: 'Email', key: 'email' },
                    { label: 'Unbilled', align: 'right',
                      render: c => c.balance.unbilled_cents
                          ? el('span.warn-text', this.ui.money(c.balance.unbilled_cents))
                          : '—' },
                    { label: 'Owes', align: 'right', render: c => {
                        const due = c.balance.net_due_cents;
                        if (due > 0) return el('strong.neg', this.ui.money(due));
                        if (due < 0) return el('span.pos', `${this.ui.money(-due)} credit`);
                        return '—';
                    } }
                ],
                rows: clients,
                empty: search.value ? 'Nobody matches that search.' : 'No clients yet.',
                onRowClick: c => this.app.navigate(`/admin/clients/${c.id}`)
            }));
        };

        let timer = null;
        search.addEventListener('input', () => {
            clearTimeout(timer);
            timer = setTimeout(load, 200);
        });

        await load();

        return el('div',
            el('header.page-head',
                el('h1', 'Clients & Dogs'),
                el('div.page-head__actions',
                    el('button.btn.btn--primary', { onclick: () => this.newClient() },
                        '+ New client'))),
            el('div.toolbar', search, statusSelect),
            results);
    }

    /* ================= detail ================= */

    async detail(id) {
        const { el } = this.ui;
        const client = await this.api.client(id);
        const balance = client.balance;

        const fullAddress = [
            client.address1, client.address2,
            [client.city, client.state].filter(Boolean).join(', '),
            client.postal_code
        ].filter(Boolean).join(' · ');

        return el('div',
            el('a.back', { href: '#/admin/clients' }, '← All clients'),

            el('header.page-head',
                el('div',
                    el('h1', `${client.first_name} ${client.last_name}`,
                        client.status !== 'active'
                            ? this.ui.badge(client.status, this.ui.statusTone(client.status))
                            : null),
                    el('p.muted', `Client since ${this.ui.date(client.created_at.slice(0, 10))}`)),
                el('div.page-head__actions',
                    client.status === 'pending'
                        ? el('button.btn.btn--primary', {
                            onclick: () => this.setStatus(client, 'active')
                          }, '✓ Approve client')
                        : null,
                    el('button.btn', { onclick: () => this.editClient(client) }, 'Edit'),
                    el('button.btn.btn--danger-ghost',
                        { onclick: () => this.deleteClient(client) }, 'Delete'))),

            /* ---- money summary ---- */
            el('div.stats',
                el('div.stat',
                    el('span.stat__label', 'Unbilled work'),
                    el('strong.stat__value',
                        { class: balance.unbilled_cents ? 'warn-text' : '' },
                        this.ui.money(balance.unbilled_cents))),
                el('div.stat',
                    el('span.stat__label', 'Owed on invoices'),
                    el('strong.stat__value',
                        { class: balance.owed_cents > 0 ? 'neg' : '' },
                        this.ui.money(balance.owed_cents))),
                el('div.stat',
                    el('span.stat__label', 'Credit on account'),
                    el('strong.stat__value',
                        { class: balance.credit_cents ? 'pos' : '' },
                        this.ui.money(balance.credit_cents))),
                el('div.stat.stat--strong',
                    el('span.stat__label', 'Net due'),
                    el('strong.stat__value',
                        { class: balance.net_due_cents > 0 ? 'neg' : 'pos' },
                        this.ui.money(balance.net_due_cents)))),

            el('div.form-actions.form-actions--left',
                balance.unbilled_cents > 0
                    ? el('button.btn.btn--primary', {
                        onclick: () => this.console.modules.billing.createInvoiceFor(client)
                      }, `Invoice ${this.ui.money(balance.unbilled_cents)} of unbilled work`)
                    : null,
                el('button.btn', {
                    onclick: () => this.console.modules.billing.recordPaymentFor(client)
                }, 'Record a payment'),
                el('button.btn', {
                    onclick: () => this.console.modules.bookings.newBookingFor(client)
                }, 'New booking')),

            /* ---- contact ---- */
            el('section.panel',
                el('h2', 'Contact'),
                el('div.detail-grid',
                    this.detailItem('Email', el('a', { href: `mailto:${client.email}` }, client.email)),
                    this.detailItem('Phone', el('a', { href: `tel:${client.phone}` }, client.phone)),
                    this.detailItem('Other phone', client.alt_phone),
                    this.detailItem('Address', fullAddress),
                    this.detailItem('Emergency contact',
                        client.emergency_name
                            ? `${client.emergency_name} · ${client.emergency_phone || ''}` +
                              (client.emergency_relationship ? ` (${client.emergency_relationship})` : '')
                            : null),
                    this.detailItem('Notes', client.notes))),

            /* ---- vet ---- */
            el('section.panel',
                el('header.panel__head',
                    el('h2', 'Veterinarian'),
                    el('button.btn.btn--tiny', { onclick: () => this.newVet(client) }, '+ Add vet')),
                client.vets.length
                    ? el('div.vet-cards', client.vets.map(v => this.vetCard(v)))
                    : this.ui.empty('No vet on file. Every dog should have one.')),

            /* ---- dogs ---- */
            el('section.panel',
                el('header.panel__head',
                    el('h2', `Dogs (${client.pets.length})`),
                    el('button.btn.btn--tiny.btn--primary',
                        { onclick: () => this.newPet(client) }, '+ Add dog')),
                client.pets.length
                    ? el('div.pet-list', client.pets.map(p => this.petPanel(p, client)))
                    : this.ui.empty('No dogs on file yet.')),

            /* ---- bookings ---- */
            el('section.panel',
                el('h2', 'Stays'),
                this.ui.table({
                    columns: [
                        { label: 'Dates', render: b =>
                            `${this.ui.shortDate(b.check_in)} → ${this.ui.date(b.check_out)}` },
                        { label: 'Nights', align: 'right',
                          render: b => this.ui.nights(b.check_in, b.check_out) },
                        { label: 'Dogs', key: 'pet_names' },
                        { label: 'Status',
                          render: b => this.ui.badge(b.status, this.ui.statusTone(b.status)) },
                        { label: '', render: b => el('a.btn.btn--tiny',
                            { href: `#/admin/bookings/${b.id}` }, 'Open') }
                    ],
                    rows: client.bookings,
                    empty: 'No stays yet.'
                })),

            /* ---- services ---- */
            el('section.panel',
                el('header.panel__head',
                    el('h2', 'Services performed'),
                    el('button.btn.btn--tiny', {
                        onclick: () => this.console.modules.billing.addChargeFor(client)
                    }, '+ Add charge')),
                this.ui.table({
                    columns: [
                        { label: 'Date', render: s => this.ui.date(s.performed_on) },
                        { label: 'Dog', key: 'pet_name' },
                        { label: 'Service', key: 'description' },
                        { label: 'Qty', key: 'qty', align: 'right' },
                        { label: 'Amount', align: 'right',
                          render: s => this.ui.money(s.amount_cents) },
                        { label: 'Invoice', render: s => s.invoice_number
                            ? el('span.muted', s.invoice_number)
                            : this.ui.badge('unbilled', 'warn') }
                    ],
                    rows: client.services,
                    empty: 'Nothing has been done for this client yet.'
                })),

            /* ---- invoices ---- */
            el('section.panel',
                el('h2', 'Invoices'),
                this.ui.table({
                    columns: [
                        { label: 'Number', render: i => el('strong', i.number) },
                        { label: 'Issued', render: i => this.ui.date(i.issued_on) },
                        { label: 'Due', render: i => this.ui.date(i.due_on) },
                        { label: 'Total', align: 'right', render: i => this.ui.money(i.total_cents) },
                        { label: 'Paid', align: 'right', render: i => this.ui.money(i.paid_cents) },
                        { label: 'Status',
                          render: i => this.ui.badge(i.status, this.ui.statusTone(i.status)) },
                        { label: '', render: i => el('a.btn.btn--tiny',
                            { href: `#/admin/billing/${i.id}` }, 'Open') }
                    ],
                    rows: client.invoices,
                    empty: 'No invoices yet.'
                })),

            /* ---- payments ---- */
            el('section.panel',
                el('h2', 'Payments'),
                this.ui.table({
                    columns: [
                        { label: 'Date', render: p => this.ui.date(p.paid_on) },
                        { label: 'Amount', align: 'right',
                          render: p => el('strong.pos', this.ui.money(p.amount_cents)) },
                        { label: 'Method', render: p => this.ui.titleCase(p.method) },
                        { label: 'Applied to', render: p => p.invoice_number
                            || this.ui.badge('on account', 'info') },
                        { label: 'Reference', key: 'reference' }
                    ],
                    rows: client.payments,
                    empty: 'No payments recorded.'
                })));
    }

    detailItem(label, value) {
        const { el } = this.ui;
        return el('div.detail-item',
            el('span.detail-item__label', label),
            el('span.detail-item__value', value || '—'));
    }

    vetCard(vet) {
        const { el } = this.ui;
        const address = [vet.address1, [vet.city, vet.state].filter(Boolean).join(', '), vet.postal_code]
            .filter(Boolean).join(' · ');

        return el('div.vet-card',
            el('header',
                el('strong', vet.clinic_name),
                el('button.link-btn', { onclick: () => this.editVet(vet) }, 'Edit')),
            vet.vet_name ? el('p.muted', `Dr. ${vet.vet_name}`) : null,
            el('p', vet.phone ? el('a', { href: `tel:${vet.phone}` }, vet.phone) : '—',
                vet.email ? el('span.muted', ` · ${vet.email}`) : null),
            address ? el('p.muted.small', address) : null);
    }

    /* ================= dogs ================= */

    petPanel(pet, client) {
        const { el } = this.ui;

        const facts = [
            pet.breed,
            pet.sex ? this.ui.titleCase(pet.sex) : null,
            pet.weight_lbs ? `${pet.weight_lbs} lbs` : null,
            pet.birthdate ? `born ${this.ui.date(pet.birthdate)}` : null,
            pet.fixed ? 'spayed/neutered' : null
        ].filter(Boolean).join(' · ');

        const careNote = (label, value, tone = '') => value
            ? el('div.care-note', { class: tone ? `care-note--${tone}` : '' },
                el('span.care-note__label', label),
                el('p', value))
            : null;

        return el('article.pet-panel',
            el('header.pet-panel__head',
                el('div',
                    el('h3', pet.name,
                        pet.status !== 'active' ? this.ui.badge(pet.status, 'neutral') : null),
                    el('p.muted.small', facts || 'No details recorded')),
                el('div.pet-panel__actions',
                    el('button.btn.btn--tiny', { onclick: () => this.editPet(pet, client) }, 'Edit'),
                    el('button.btn.btn--tiny.btn--danger-ghost',
                        { onclick: () => this.deletePet(pet) }, 'Delete'))),

            el('div.care-notes',
                careNote('Feeding', pet.feeding),
                careNote('Medications', pet.medications, pet.medications ? 'alert' : ''),
                careNote('Allergies', pet.allergies, pet.allergies ? 'alert' : ''),
                careNote('Behaviour', pet.behavior_notes),
                careNote('Vet notes', pet.vet_notes)),

            el('div.records-block',
                el('header.records-block__head',
                    el('h4', 'Vet records'),
                    el('button.btn.btn--tiny',
                        { onclick: () => this.addRecord(pet) }, '+ Add record')),
                this.recordsTable(pet)));
    }

    recordsTable(pet) {
        const { el } = this.ui;
        const today = this.ui.today();

        const state = (record) => {
            if (!record.expires_on) return this.ui.badge('no expiry', 'warn');
            if (record.expires_on < today) return this.ui.badge('expired', 'bad');
            if (record.expires_on <= this.ui.addDays(today, 30)) {
                return this.ui.badge('expiring', 'warn');
            }
            return this.ui.badge('current', 'good');
        };

        return this.ui.table({
            columns: [
                { label: 'Type', render: r => el('strong',
                    this.collections.recordTypes?.[r.record_type]?.title
                        || this.ui.titleCase(r.record_type)) },
                { label: 'Issued', render: r => this.ui.date(r.issued_on) },
                { label: 'Expires', render: r => this.ui.date(r.expires_on) },
                { label: 'State', render: state },
                { label: 'Document', render: r => r.file_path
                    ? el('a.btn.btn--tiny', {
                        href: this.api.recordFileUrl(r.id),
                        target: '_blank', rel: 'noopener'
                      }, 'View')
                    : el('span.muted', 'not supplied') },
                { label: 'Verified', render: r => el('label.check-inline',
                    el('input', {
                        type: 'checkbox',
                        checked: !!r.verified,
                        onchange: async (e) => {
                            try {
                                await this.api.updateRecord(r.id, { verified: e.target.checked });
                                this.ui.toast(
                                    e.target.checked ? 'Record verified.' : 'Verification removed.',
                                    'good');
                            } catch (err) {
                                this.ui.toast(err.message, 'bad');
                                e.target.checked = !e.target.checked;
                            }
                        }
                    })) },
                { label: '', render: r => el('button.link-btn.danger', {
                    onclick: () => this.deleteRecord(r)
                  }, 'Delete') }
            ],
            rows: pet.records,
            empty: 'No vet records on file. The dog cannot board without them.'
        });
    }

    /* ================= mutations ================= */

    /** The dialog's fields are the `client` form schema, not a list in this file. */
    clientFields(client = {}) {
        return this.forms.renderFields('client', client);
    }

    newClient() {
        this.ui.modal({
            title: 'New client',
            width: 680,
            body: () => this.clientFields(),
            confirmLabel: 'Create client',
            onConfirm: async (content) => {
                const data = this.ui.readForm(content);
                const created = await this.api.createClient(data);
                this.ui.toast('Client created.', 'good');
                this.app.navigate(`/admin/clients/${created.id}`);
            }
        });
    }

    editClient(client) {
        this.ui.modal({
            title: `Edit ${client.first_name} ${client.last_name}`,
            width: 680,
            body: () => this.clientFields(client),
            confirmLabel: 'Save changes',
            onConfirm: async (content) => {
                await this.api.updateClient(client.id, this.ui.readForm(content));
                this.ui.toast('Client updated.', 'good');
                this.reload();
            }
        });
    }

    async setStatus(client, status) {
        await this.api.updateClient(client.id, { status });
        this.ui.toast(`Client ${status === 'active' ? 'approved' : status}.`, 'good');
        this.reload();
    }

    async deleteClient(client) {
        const ok = await this.ui.confirm(
            `Delete ${client.first_name} ${client.last_name}, their dogs and all their records? ` +
            'This cannot be undone.',
            { title: 'Delete client' });
        if (!ok) return;

        try {
            await this.api.deleteClient(client.id);
            this.ui.toast('Client deleted.', 'good');
            this.app.navigate('/admin/clients');
        } catch (err) {
            this.ui.toast(err.message, 'bad');
        }
    }

    /**
     * The `pet` schema. Its vet_id field says optionsFrom: "clientVets", which is
     * not a collection - it is this client's vets, so we hand it in at render time.
     */
    petFields(pet = {}, client) {
        return this.forms.renderFields('pet', pet, {
            clientVets: [
                { value: '', label: '— none —' },
                ...client.vets.map(v => ({ value: v.id, label: v.clinic_name }))
            ]
        });
    }

    newPet(client) {
        this.ui.modal({
            title: `New dog for ${client.first_name} ${client.last_name}`,
            width: 680,
            body: () => this.petFields({}, client),
            confirmLabel: 'Add dog',
            onConfirm: async (content) => {
                const data = this.ui.readForm(content);
                await this.api.createPet({ ...data, client_id: client.id });
                this.ui.toast('Dog added.', 'good');
                this.reload();
            }
        });
    }

    editPet(pet, client) {
        this.ui.modal({
            title: `Edit ${pet.name}`,
            width: 680,
            body: () => this.petFields(pet, client),
            confirmLabel: 'Save changes',
            onConfirm: async (content) => {
                await this.api.updatePet(pet.id, this.ui.readForm(content));
                this.ui.toast('Dog updated.', 'good');
                this.reload();
            }
        });
    }

    async deletePet(pet) {
        const ok = await this.ui.confirm(
            `Delete ${pet.name} and their vet records?`, { title: 'Delete dog' });
        if (!ok) return;

        try {
            await this.api.deletePet(pet.id);
            this.ui.toast('Dog deleted.', 'good');
            this.reload();
        } catch (err) {
            this.ui.toast(err.message, 'bad');
        }
    }

    /** The record dialog is the `vetRecord` schema; its type list is recordTypes. */
    addRecord(pet) {
        const body = this.forms.renderFields('vetRecord', { record_type: '' });

        this.ui.modal({
            title: `Add a vet record for ${pet.name}`,
            width: 620,
            body: () => body,
            confirmLabel: 'Save record',
            onConfirm: async (content) => {
                const data = this.forms.read('vetRecord', content);

                const form = new FormData();
                form.append('record_type', data.record_type);
                form.append('issued_on', data.issued_on || '');
                form.append('expires_on', data.expires_on || '');
                form.append('notes', data.notes || '');
                form.append('verified', data.verified ? '1' : '0');
                if (data.file) form.append('file', data.file);

                await this.api.addRecord(pet.id, form);
                this.ui.toast('Record saved.', 'good');
                this.reload();
            }
        });
    }

    async deleteRecord(record) {
        const ok = await this.ui.confirm(
            `Delete this ${this.collections.recordTypes?.[record.record_type]?.title
                || this.ui.titleCase(record.record_type)} record and its document?`,
            { title: 'Delete record' });
        if (!ok) return;

        await this.api.deleteRecord(record.id);
        this.ui.toast('Record deleted.', 'good');
        this.reload();
    }

    vetFields(vet = {}) {
        return this.forms.renderFields('vet', vet);
    }

    newVet(client) {
        this.ui.modal({
            title: 'Add a veterinarian',
            width: 620,
            body: () => this.vetFields(),
            confirmLabel: 'Add vet',
            onConfirm: async (content) => {
                const vet = await this.api.createVet(this.ui.readForm(content));

                // A vet with no dog attached is just clutter, so attach it to any
                // dog of this client that does not have one yet.
                const orphans = client.pets.filter(p => !p.vet_id);
                for (const pet of orphans) {
                    await this.api.updatePet(pet.id, { vet_id: vet.id });
                }

                this.ui.toast(orphans.length
                    ? `Vet added and linked to ${orphans.length} dog(s).`
                    : 'Vet added.', 'good');
                this.reload();
            }
        });
    }

    editVet(vet) {
        this.ui.modal({
            title: `Edit ${vet.clinic_name}`,
            width: 620,
            body: () => this.vetFields(vet),
            confirmLabel: 'Save changes',
            onConfirm: async (content) => {
                await this.api.updateVet(vet.id, this.ui.readForm(content));
                this.ui.toast('Vet updated.', 'good');
                this.reload();
            }
        });
    }
}
