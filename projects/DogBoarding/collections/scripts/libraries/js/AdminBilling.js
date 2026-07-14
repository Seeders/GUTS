/**
 * AdminBilling - money out of the business's point of view.
 *
 * Four tabs:
 *   Ready to bill - clients with unbilled work, one click to invoice them
 *   Invoices      - everything issued, what is paid, what is not
 *   Payments      - money received
 *   Services      - the price list the charges are drawn from
 */
class AdminBilling {
    constructor(app, console_) {
        this.app = app;
        this.api = app.api;
        this.console = console_;
        this.tab = 'billable';
    }

    get ui() { return GUTS.DogBoardUI; }

    render(id) {
        return id ? this.invoiceDetail(Number(id)) : this.hub();
    }

    reload() {
        this.app.route();
    }

    /* ================= hub ================= */

    async hub() {
        const { el } = this.ui;
        const panel = el('div.tab-panel', this.ui.spinner());

        const tabs = [
            ['billable', 'Ready to bill'],
            ['invoices', 'Invoices'],
            ['payments', 'Payments'],
            ['services', 'Services & rates']
        ];

        const tabBar = el('div.tabs');

        const select = async (key) => {
            this.tab = key;
            [...tabBar.children].forEach(btn =>
                btn.classList.toggle('tab--on', btn.dataset.tab === key));

            this.ui.mount(panel, this.ui.spinner());
            const view = await ({
                billable: () => this.billableTab(),
                invoices: () => this.invoicesTab(),
                payments: () => this.paymentsTab(),
                services: () => this.servicesTab()
            })[key]();
            this.ui.mount(panel, view);
        };

        for (const [key, label] of tabs) {
            tabBar.appendChild(el('button.tab', {
                dataset: { tab: key },
                onclick: () => select(key)
            }, label));
        }

        await select(this.tab);

        return el('div',
            el('header.page-head', el('h1', 'Billing')),
            tabBar,
            panel);
    }

    /* ---- ready to bill ---- */

    async billableTab() {
        const { el } = this.ui;
        const rows = await this.api.billable();

        const total = rows.reduce((sum, r) => sum + r.amount_cents, 0);

        return el('div',
            el('p.muted',
                'Work that has been done but not yet put on an invoice. Invoicing a client ' +
                'sweeps up everything outstanding for them.'),

            rows.length
                ? el('div.stat.stat--wide',
                    el('span.stat__label', 'Total unbilled'),
                    el('strong.stat__value.warn-text', this.ui.money(total)))
                : null,

            this.ui.table({
                columns: [
                    { label: 'Client', render: r => el('a',
                        { href: `#/admin/clients/${r.client_id}` },
                        el('strong', `${r.first_name} ${r.last_name}`)) },
                    { label: 'Charges', key: 'event_count', align: 'right' },
                    { label: 'Oldest', render: r => this.ui.date(r.oldest) },
                    { label: 'Newest', render: r => this.ui.date(r.newest) },
                    { label: 'Amount', align: 'right',
                      render: r => el('strong', this.ui.money(r.amount_cents)) },
                    { label: '', render: r => el('button.btn.btn--tiny.btn--primary', {
                        onclick: () => this.createInvoiceFor({
                            id: r.client_id,
                            first_name: r.first_name,
                            last_name: r.last_name
                        })
                      }, 'Invoice') }
                ],
                rows,
                empty: 'Everything that has been done has been billed. Good.'
            }));
    }

    /* ---- invoices ---- */

    async invoicesTab() {
        const { el } = this.ui;

        const results = el('div.results', this.ui.spinner());
        const statusSelect = el('select', { onchange: () => load() },
            [{ value: '', label: 'All invoices' },
             { value: 'open', label: 'Open' },
             { value: 'paid', label: 'Paid' },
             { value: 'draft', label: 'Draft' },
             { value: 'void', label: 'Void' }].map(o => el('option', { value: o.value }, o.label)));

        const load = async () => {
            this.ui.mount(results, this.ui.spinner());
            const invoices = await this.api.invoices({ status: statusSelect.value });

            this.ui.mount(results, this.ui.table({
                columns: [
                    { label: 'Number', render: i => el('strong', i.number) },
                    { label: 'Client', render: i => `${i.first_name} ${i.last_name}` },
                    { label: 'Issued', render: i => this.ui.date(i.issued_on) },
                    { label: 'Due', render: i => this.ui.date(i.due_on) },
                    { label: 'Total', align: 'right', render: i => this.ui.money(i.total_cents) },
                    { label: 'Balance', align: 'right', render: i => {
                        const balance = i.status === 'void' ? 0 : i.total_cents - i.paid_cents;
                        return balance > 0
                            ? el('strong.neg', this.ui.money(balance))
                            : el('span.muted', '—');
                    } },
                    { label: 'Status',
                      render: i => this.ui.badge(i.status, this.ui.statusTone(i.status)) }
                ],
                rows: invoices,
                empty: 'No invoices yet.',
                onRowClick: i => this.app.navigate(`/admin/billing/${i.id}`)
            }));
        };

        await load();
        return el('div', el('div.toolbar', statusSelect), results);
    }

    /* ---- payments ---- */

    async paymentsTab() {
        const { el } = this.ui;

        const from = el('input', { type: 'date', onchange: () => load() });
        const to = el('input', { type: 'date', onchange: () => load() });
        const results = el('div.results', this.ui.spinner());

        const load = async () => {
            this.ui.mount(results, this.ui.spinner());
            const payments = await this.api.payments({ from: from.value, to: to.value });
            const total = payments.reduce((sum, p) => sum + p.amount_cents, 0);

            this.ui.mount(results,
                el('div.stat.stat--wide',
                    el('span.stat__label', 'Received'),
                    el('strong.stat__value.pos', this.ui.money(total))),
                this.ui.table({
                    columns: [
                        { label: 'Date', render: p => this.ui.date(p.paid_on) },
                        { label: 'Client', render: p => el('a',
                            { href: `#/admin/clients/${p.client_id}` },
                            `${p.first_name} ${p.last_name}`) },
                        { label: 'Amount', align: 'right',
                          render: p => el('strong.pos', this.ui.money(p.amount_cents)) },
                        { label: 'Method', render: p => this.ui.titleCase(p.method) },
                        { label: 'Invoice', render: p => p.invoice_number
                            || this.ui.badge('on account', 'info') },
                        { label: 'Reference', key: 'reference' },
                        { label: '', render: p => el('button.link-btn.danger', {
                            onclick: () => this.deletePayment(p)
                          }, 'Delete') }
                    ],
                    rows: payments,
                    empty: 'No payments in this range.'
                }));
        };

        await load();

        return el('div',
            el('div.toolbar',
                el('label.inline-field', el('span', 'From'), from),
                el('label.inline-field', el('span', 'To'), to),
                el('button.btn.btn--primary', {
                    onclick: () => this.recordPaymentFor(null)
                }, '+ Record payment')),
            results);
    }

    /* ---- services ---- */

    async servicesTab() {
        const { el } = this.ui;
        const services = await this.api.services(true);

        return el('div',
            el('div.toolbar',
                el('p.muted',
                    'The rate card. Charges snapshot the price at the time they are added, ' +
                    'so changing a price here never rewrites an old invoice.'),
                el('button.btn.btn--primary',
                    { onclick: () => this.editService(null) }, '+ New service')),

            this.ui.table({
                columns: [
                    { label: 'Service', render: s => el('div',
                        el('strong', s.name),
                        s.description ? el('p.muted.small', s.description) : null) },
                    { label: 'Code', key: 'code' },
                    { label: 'Unit', render: s => this.ui.titleCase(s.unit) },
                    { label: 'Price', align: 'right',
                      render: s => el('strong', this.ui.money(s.price_cents)) },
                    { label: 'Taxable', render: s => s.taxable ? 'Yes' : 'No' },
                    { label: 'State', render: s => s.active
                        ? this.ui.badge('active', 'good')
                        : this.ui.badge('retired', 'neutral') },
                    { label: '', render: s => el('div.row-actions',
                        el('button.link-btn', { onclick: () => this.editService(s) }, 'Edit'),
                        el('button.link-btn.danger',
                            { onclick: () => this.deleteService(s) }, 'Retire')) }
                ],
                rows: services,
                empty: 'No services defined.'
            }));
    }

    editService(service) {
        const { el } = this.ui;
        const isNew = !service;
        const s = service || {};

        const body = el('div',
            this.ui.row(
                this.ui.field({ name: 'name', label: 'Name', required: true, value: s.name }),
                this.ui.field({ name: 'code', label: 'Code', value: s.code,
                    hint: 'Short handle, e.g. BOARD-STD.' })),
            this.ui.field({ name: 'description', label: 'Description', type: 'textarea', rows: 2,
                value: s.description }),
            this.ui.row(
                this.ui.field({ name: 'unit', label: 'Charged per', type: 'select',
                    value: s.unit || 'each',
                    options: [
                        { value: 'night', label: 'Night (boarding)' },
                        { value: 'day', label: 'Day (daycare, meds)' },
                        { value: 'hour', label: 'Hour' },
                        { value: 'each', label: 'Each (one-off)' }
                    ] }),
                this.ui.field({ name: 'price', label: 'Price', type: 'number', step: '0.01', min: 0,
                    value: this.ui.centsToInput(s.price_cents || 0) })),
            this.ui.row(
                this.ui.field({ name: 'taxable', label: 'Taxable', type: 'checkbox',
                    value: s.taxable === undefined ? true : !!s.taxable }),
                this.ui.field({ name: 'active', label: 'Active', type: 'checkbox',
                    value: s.active === undefined ? true : !!s.active })));

        this.ui.modal({
            title: isNew ? 'New service' : `Edit ${s.name}`,
            width: 600,
            body: () => body,
            confirmLabel: isNew ? 'Create' : 'Save',
            onConfirm: async (content) => {
                const data = this.ui.readForm(content);
                const payload = {
                    name: data.name,
                    code: data.code,
                    description: data.description,
                    unit: data.unit,
                    price_cents: this.ui.toCents(data.price),
                    taxable: data.taxable,
                    active: data.active
                };

                if (isNew) await this.api.createService(payload);
                else await this.api.updateService(s.id, payload);

                this.ui.toast('Service saved.', 'good');
                this.reload();
            }
        });
    }

    async deleteService(service) {
        const ok = await this.ui.confirm(
            `Retire "${service.name}"? It stays on past invoices but stops appearing in the picker.`,
            { title: 'Retire service', confirmLabel: 'Retire' });
        if (!ok) return;

        const result = await this.api.deleteService(service.id);
        this.ui.toast(result.message || 'Service removed.', 'good');
        this.reload();
    }

    /* ================= invoice detail ================= */

    async invoiceDetail(id) {
        const { el } = this.ui;
        const invoice = await this.api.invoice(id);

        const isVoid = invoice.status === 'void';

        return el('div',
            el('a.back', { href: '#/admin/billing' }, '← Billing'),

            el('header.page-head',
                el('div',
                    el('h1', invoice.number,
                        this.ui.badge(invoice.status, this.ui.statusTone(invoice.status))),
                    el('p.muted',
                        el('a', { href: `#/admin/clients/${invoice.client_id}` },
                            `${invoice.first_name} ${invoice.last_name}`),
                        ` · issued ${this.ui.date(invoice.issued_on)}` +
                        ` · due ${this.ui.date(invoice.due_on)}`)),
                el('div.page-head__actions',
                    el('a.btn', {
                        href: this.api.invoicePrintUrl(invoice.id),
                        target: '_blank', rel: 'noopener'
                    }, 'Print / PDF'),
                    invoice.status === 'draft'
                        ? el('button.btn.btn--primary',
                            { onclick: () => this.issueInvoice(invoice) }, 'Issue')
                        : null,
                    (!isVoid && invoice.balance_cents > 0)
                        ? el('button.btn.btn--primary', {
                            onclick: () => this.recordPaymentFor(
                                { id: invoice.client_id,
                                  first_name: invoice.first_name,
                                  last_name: invoice.last_name },
                                invoice)
                          }, 'Record payment')
                        : null,
                    !isVoid
                        ? el('button.btn.btn--danger-ghost',
                            { onclick: () => this.voidInvoice(invoice) }, 'Void')
                        : null)),

            isVoid
                ? el('div.notice.notice--bad',
                    el('strong', 'This invoice is void. '),
                    'Its charges went back to unbilled and any payments became account credit.')
                : null,

            el('div.stats',
                el('div.stat',
                    el('span.stat__label', 'Subtotal'),
                    el('strong.stat__value', this.ui.money(invoice.subtotal_cents))),
                invoice.tax_cents
                    ? el('div.stat',
                        el('span.stat__label', 'Tax'),
                        el('strong.stat__value', this.ui.money(invoice.tax_cents)))
                    : null,
                el('div.stat',
                    el('span.stat__label', 'Total'),
                    el('strong.stat__value', this.ui.money(invoice.total_cents))),
                el('div.stat',
                    el('span.stat__label', 'Paid'),
                    el('strong.stat__value.pos', this.ui.money(invoice.amount_paid_cents))),
                el('div.stat.stat--strong',
                    el('span.stat__label', 'Balance'),
                    el('strong.stat__value',
                        { class: invoice.balance_cents > 0 ? 'neg' : 'pos' },
                        this.ui.money(invoice.balance_cents)))),

            el('section.panel',
                el('h2', 'Lines'),
                this.ui.table({
                    columns: [
                        { label: 'Date', render: i => this.ui.date(i.performed_on) },
                        { label: 'Description', key: 'description' },
                        { label: 'Qty', key: 'qty', align: 'right' },
                        { label: 'Rate', align: 'right',
                          render: i => this.ui.money(i.unit_price_cents) },
                        { label: 'Amount', align: 'right',
                          render: i => el('strong', this.ui.money(i.amount_cents)) }
                    ],
                    rows: invoice.items,
                    empty: 'This invoice has no lines.',
                    footer: el('tr',
                        el('td', { colspan: 4 }, el('strong', 'Total')),
                        el('td.num', el('strong', this.ui.money(invoice.total_cents))))
                })),

            el('section.panel',
                el('h2', 'Payments against this invoice'),
                this.ui.table({
                    columns: [
                        { label: 'Date', render: p => this.ui.date(p.paid_on) },
                        { label: 'Amount', align: 'right',
                          render: p => el('strong.pos', this.ui.money(p.amount_cents)) },
                        { label: 'Method', render: p => this.ui.titleCase(p.method) },
                        { label: 'Reference', key: 'reference' },
                        { label: '', render: p => el('button.link-btn.danger', {
                            onclick: () => this.deletePayment(p)
                          }, 'Delete') }
                    ],
                    rows: invoice.payments,
                    empty: 'Nothing paid yet.'
                })),

            invoice.notes ? el('div.notice', el('strong', 'Notes: '), invoice.notes) : null);
    }

    /* ================= actions ================= */

    async createInvoiceFor(client) {
        const { el } = this.ui;

        const events = await this.api.serviceEvents({ client_id: client.id, unbilled: '1' });
        if (!events.length) {
            this.ui.toast('Nothing to invoice for this client.', 'warn');
            return;
        }

        const total = events.reduce((sum, e) => sum + e.amount_cents, 0);

        const body = el('div',
            el('p.muted',
                `Everything below goes onto one invoice for ${client.first_name} ${client.last_name}.`),

            this.ui.table({
                columns: [
                    { label: 'Date', render: e => this.ui.shortDate(e.performed_on) },
                    { label: 'Dog', key: 'pet_name' },
                    { label: 'Service', key: 'description' },
                    { label: 'Qty', key: 'qty', align: 'right' },
                    { label: 'Amount', align: 'right',
                      render: e => this.ui.money(e.amount_cents) }
                ],
                rows: events,
                footer: el('tr',
                    el('td', { colspan: 4 }, el('strong', 'Total')),
                    el('td.num', el('strong', this.ui.money(total))))
            }),

            this.ui.row(
                this.ui.field({ name: 'issued_on', label: 'Issue date', type: 'date',
                    value: this.ui.today() }),
                this.ui.field({ name: 'status', label: 'Issue as', type: 'select',
                    options: [
                        { value: 'open', label: 'Open (billed, awaiting payment)' },
                        { value: 'draft', label: 'Draft (not sent yet)' }
                    ] })),
            this.ui.field({ name: 'notes', label: 'Note on the invoice', type: 'textarea', rows: 2 }));

        this.ui.modal({
            title: `Invoice ${this.ui.money(total)}`,
            width: 720,
            body: () => body,
            confirmLabel: 'Create invoice',
            onConfirm: async (content) => {
                const data = this.ui.readForm(content);
                const invoice = await this.api.createInvoice({
                    client_id: client.id,
                    issued_on: data.issued_on,
                    status: data.status,
                    notes: data.notes
                });

                this.ui.toast(`${invoice.number} created.`, 'good');
                this.app.navigate(`/admin/billing/${invoice.id}`);
            }
        });
    }

    async issueInvoice(invoice) {
        await this.api.issueInvoice(invoice.id);
        this.ui.toast('Invoice issued.', 'good');
        this.reload();
    }

    async voidInvoice(invoice) {
        const ok = await this.ui.confirm(
            `Void ${invoice.number}? Its charges go back to unbilled so you can re-invoice them, ` +
            'and any payments become credit on the account.',
            { title: 'Void invoice', confirmLabel: 'Void it' });
        if (!ok) return;

        await this.api.voidInvoice(invoice.id);
        this.ui.toast('Invoice voided.', 'good');
        this.reload();
    }

    /**
     * Record a payment. If an invoice is passed we default to settling it in
     * full, which is what happens most of the time.
     */
    async recordPaymentFor(client, invoice = null) {
        const { el } = this.ui;

        const clients = client ? null : await this.api.clients({});

        const clientSelect = client
            ? null
            : el('select', { name: 'client_id', required: true },
                [el('option', { value: '' }, '— pick a client —'),
                 ...clients.map(c => el('option', { value: c.id },
                    `${c.first_name} ${c.last_name}` +
                    (c.balance.net_due_cents > 0
                        ? ` — owes ${this.ui.money(c.balance.net_due_cents)}` : '')))]);

        const invoiceSelect = el('select', { name: 'invoice_id' },
            el('option', { value: '' }, 'On account (no invoice)'));

        const amount = el('input', {
            type: 'number', step: '0.01', min: 0, name: 'amount',
            value: invoice ? this.ui.centsToInput(invoice.balance_cents) : ''
        });

        const loadInvoices = async (clientId) => {
            const open = await this.api.invoices({ client_id: clientId, status: 'open' });
            this.ui.mount(invoiceSelect,
                el('option', { value: '' }, 'On account (no invoice)'),
                open.map(inv => {
                    const balance = inv.total_cents - inv.paid_cents;
                    return el('option', {
                        value: inv.id,
                        selected: invoice ? inv.id === invoice.id : false
                    }, `${inv.number} — ${this.ui.money(balance)} outstanding`);
                }));

            if (!invoice && open.length === 1) {
                invoiceSelect.value = open[0].id;
                amount.value = this.ui.centsToInput(open[0].total_cents - open[0].paid_cents);
            }
        };

        if (client) await loadInvoices(client.id);
        else clientSelect.addEventListener('change', () => {
            if (clientSelect.value) loadInvoices(Number(clientSelect.value));
        });

        const body = el('div',
            clientSelect
                ? el('label.field',
                    el('span.field__label', 'Client', el('em.req', '*')), clientSelect)
                : el('p.muted', `Payment from ${client.first_name} ${client.last_name}.`),

            el('label.field',
                el('span.field__label', 'Apply to'),
                invoiceSelect,
                el('small.hint',
                    'Leave on account if they are paying ahead or you have not invoiced yet.')),

            el('div.field-row',
                el('label.field',
                    el('span.field__label', 'Amount', el('em.req', '*')), amount),
                this.ui.field({ name: 'paid_on', label: 'Received on', type: 'date',
                    value: this.ui.today() }),
                this.ui.field({ name: 'method', label: 'Method', type: 'select',
                    options: ['cash', 'card', 'check', 'ach', 'venmo', 'other'] })),

            this.ui.field({ name: 'reference', label: 'Reference',
                placeholder: 'Check number, last 4 digits, transaction id…' }),
            this.ui.field({ name: 'notes', label: 'Notes', type: 'textarea', rows: 2 }));

        this.ui.modal({
            title: 'Record a payment',
            width: 620,
            body: () => body,
            confirmLabel: 'Save payment',
            onConfirm: async (content) => {
                const data = this.ui.readForm(content);
                const clientId = client ? client.id : Number(clientSelect.value);

                if (!clientId) throw new Error('Pick a client.');
                const centsAmount = this.ui.toCents(data.amount);
                if (!centsAmount) throw new Error('Enter an amount.');

                await this.api.createPayment({
                    client_id: clientId,
                    invoice_id: invoiceSelect.value ? Number(invoiceSelect.value) : null,
                    amount_cents: centsAmount,
                    paid_on: data.paid_on,
                    method: data.method,
                    reference: data.reference,
                    notes: data.notes
                });

                this.ui.toast(`Payment of ${this.ui.money(centsAmount)} recorded.`, 'good');
                this.reload();
            }
        });
    }

    async deletePayment(payment) {
        const ok = await this.ui.confirm(
            `Delete this payment of ${this.ui.money(payment.amount_cents)}?`,
            { title: 'Delete payment' });
        if (!ok) return;

        await this.api.deletePayment(payment.id);
        this.ui.toast('Payment deleted.', 'good');
        this.reload();
    }

    /* ---- ad-hoc charges ---- */

    addChargeFor(client) {
        return this.chargeModal({
            clientId: client.id,
            pets: client.pets,
            title: `Add a charge for ${client.first_name} ${client.last_name}`
        });
    }

    addChargeForBooking(booking) {
        return this.chargeModal({
            clientId: booking.client_id,
            pets: booking.pets,
            bookingId: booking.id,
            defaultDate: booking.check_in,
            title: 'Add an extra to this stay'
        });
    }

    async chargeModal({ clientId, pets, bookingId = null, defaultDate = null, title }) {
        const { el } = this.ui;
        const services = await this.api.services();

        const active = pets.filter(p => p.status !== 'inactive');
        if (!active.length) {
            this.ui.toast('This client has no dogs to charge for.', 'warn');
            return;
        }

        const petSelect = el('select', { name: 'pet_id', required: true },
            active.map(p => el('option', { value: p.id }, p.name)));

        const serviceSelect = el('select', { name: 'service_id' },
            [el('option', { value: '' }, '— custom charge —'),
             ...services.map(s => el('option', { value: s.id },
                `${s.name} — ${this.ui.money(s.price_cents)} / ${s.unit}`))]);

        const description = el('input', { type: 'text', name: 'description',
            placeholder: 'What did we do?' });
        const qty = el('input', { type: 'number', name: 'qty', value: '1', min: '0', step: '0.5' });
        const price = el('input', { type: 'number', name: 'price', step: '0.01', min: '0', value: '' });

        const total = el('strong.preview');
        const updateTotal = () => {
            const cents = this.ui.toCents(price.value) * (Number(qty.value) || 0);
            total.textContent = this.ui.money(cents);
        };

        serviceSelect.addEventListener('change', () => {
            const service = services.find(s => s.id === Number(serviceSelect.value));
            if (service) {
                description.value = service.name;
                price.value = this.ui.centsToInput(service.price_cents);
            }
            updateTotal();
        });
        qty.addEventListener('input', updateTotal);
        price.addEventListener('input', updateTotal);
        updateTotal();

        const body = el('div',
            el('div.field-row',
                el('label.field',
                    el('span.field__label', 'Dog', el('em.req', '*')), petSelect),
                el('label.field',
                    el('span.field__label', 'Service'), serviceSelect)),

            el('label.field',
                el('span.field__label', 'Description', el('em.req', '*')), description),

            el('div.field-row',
                this.ui.field({ name: 'performed_on', label: 'Date', type: 'date',
                    value: defaultDate || this.ui.today() }),
                el('label.field', el('span.field__label', 'Quantity'), qty),
                el('label.field', el('span.field__label', 'Unit price'), price)),

            el('div.preview-box', el('span.muted', 'Charge total: '), total),

            this.ui.field({ name: 'staff', label: 'Who did it' }),
            this.ui.field({ name: 'notes', label: 'Notes', type: 'textarea', rows: 2 }));

        this.ui.modal({
            title,
            width: 640,
            body: () => body,
            confirmLabel: 'Add charge',
            onConfirm: async (content) => {
                const data = this.ui.readForm(content);
                if (!description.value.trim()) throw new Error('Describe the charge.');

                await this.api.createServiceEvent({
                    pet_id: Number(petSelect.value),
                    booking_id: bookingId,
                    service_id: serviceSelect.value ? Number(serviceSelect.value) : null,
                    description: description.value.trim(),
                    performed_on: data.performed_on,
                    qty: Number(qty.value) || 1,
                    unit_price_cents: this.ui.toCents(price.value),
                    staff: data.staff,
                    notes: data.notes
                });

                void clientId;
                this.ui.toast('Charge added.', 'good');
                this.reload();
            }
        });
    }
}
