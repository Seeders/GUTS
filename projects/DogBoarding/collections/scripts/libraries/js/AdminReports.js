/**
 * AdminReports - the questions an owner actually asks.
 *
 *   Did we make money?            -> profit & loss
 *   Who owes us?                  -> A/R aging
 *   What did we do for this dog?  -> services by dog
 *   How full were we?             -> occupancy
 *   Whose shots are out of date?  -> vaccinations
 *
 * Charts are hand-drawn SVG. A charting library would be a lot of weight for
 * two bar charts.
 */
class AdminReports {
    constructor(app, console_) {
        this.app = app;
        this.api = app.api;
        this.console = console_;
        this.tab = 'pnl';
    }

    get ui() { return GUTS.DogBoardUI; }

    async render() {
        const { el } = this.ui;

        const today = this.ui.today();
        this.from = `${today.slice(0, 4)}-01-01`;
        this.to = today;

        const panel = el('div.tab-panel', this.ui.spinner());

        const tabs = [
            ['pnl', 'Profit & loss'],
            ['ar', 'Who owes us'],
            ['services', 'Services by dog'],
            ['occupancy', 'Occupancy'],
            ['vaccines', 'Vaccinations']
        ];

        const tabBar = el('div.tabs');

        const fromInput = el('input', { type: 'date', value: this.from,
            onchange: (e) => { this.from = e.target.value; select(this.tab); } });
        const toInput = el('input', { type: 'date', value: this.to,
            onchange: (e) => { this.to = e.target.value; select(this.tab); } });

        const dateBar = el('div.toolbar',
            el('label.inline-field', el('span', 'From'), fromInput),
            el('label.inline-field', el('span', 'To'), toInput),
            el('button.btn.btn--tiny', {
                onclick: () => {
                    const now = this.ui.today();
                    this.from = `${now.slice(0, 7)}-01`;
                    this.to = now;
                    fromInput.value = this.from;
                    toInput.value = this.to;
                    select(this.tab);
                }
            }, 'This month'),
            el('button.btn.btn--tiny', {
                onclick: () => {
                    const now = this.ui.today();
                    this.from = `${now.slice(0, 4)}-01-01`;
                    this.to = now;
                    fromInput.value = this.from;
                    toInput.value = this.to;
                    select(this.tab);
                }
            }, 'This year'));

        const select = async (key) => {
            this.tab = key;
            [...tabBar.children].forEach(btn =>
                btn.classList.toggle('tab--on', btn.dataset.tab === key));

            dateBar.style.display = (key === 'ar' || key === 'vaccines') ? 'none' : '';

            this.ui.mount(panel, this.ui.spinner());
            const view = await ({
                pnl: () => this.pnl(),
                ar: () => this.ar(),
                services: () => this.services(),
                occupancy: () => this.occupancy(),
                vaccines: () => this.vaccines()
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
            el('header.page-head', el('h1', 'Reports')),
            tabBar,
            dateBar,
            panel);
    }

    /* ================= profit & loss ================= */

    async pnl() {
        const { el } = this.ui;
        const data = await this.api.reportPnl({ from: this.from, to: this.to });

        const netCash = data.net_cash_cents;

        return el('div',
            el('div.stats',
                el('div.stat',
                    el('span.stat__label', 'Invoiced (accrual)'),
                    el('strong.stat__value', this.ui.money(data.billed_cents)),
                    el('span.stat__sub', 'work billed in this period')),
                el('div.stat',
                    el('span.stat__label', 'Collected (cash)'),
                    el('strong.stat__value.pos', this.ui.money(data.collected_cents)),
                    el('span.stat__sub', 'money that actually arrived')),
                el('div.stat',
                    el('span.stat__label', 'Expenses'),
                    el('strong.stat__value.neg', this.ui.money(data.expenses_cents)),
                    el('span.stat__sub',
                        `${this.ui.money(data.maintenance_cents)} of it maintenance`)),
                el('div.stat.stat--strong',
                    el('span.stat__label', 'Net (cash basis)'),
                    el('strong.stat__value', { class: netCash < 0 ? 'neg' : 'pos' },
                        this.ui.money(netCash)),
                    el('span.stat__sub', 'collected minus spent'))),

            data.monthly.length ? el('section.panel',
                el('h2', 'Month by month'),
                this.monthlyChart(data.monthly),
                this.ui.table({
                    columns: [
                        { label: 'Month', key: 'month' },
                        { label: 'Invoiced', align: 'right',
                          render: m => this.ui.money(m.billed) },
                        { label: 'Collected', align: 'right',
                          render: m => el('span.pos', this.ui.money(m.collected)) },
                        { label: 'Spent', align: 'right',
                          render: m => el('span.neg', this.ui.money(m.spent)) },
                        { label: 'Net', align: 'right', render: m => {
                            const net = m.collected - m.spent;
                            return el('strong', { class: net < 0 ? 'neg' : 'pos' },
                                this.ui.money(net));
                        } }
                    ],
                    rows: data.monthly
                })) : null,

            el('div.two-up',
                el('section.panel',
                    el('header.panel__head',
                        el('h2', 'Where the money went'),
                        el('a.btn.btn--tiny', {
                            href: this.api.exportUrl('expenses', { from: this.from, to: this.to })
                        }, 'CSV')),
                    this.ui.table({
                        columns: [
                            { label: 'Category',
                              render: c => this.ui.titleCase(c.category) },
                            { label: 'Entries', key: 'count', align: 'right' },
                            { label: 'Amount', align: 'right',
                              render: c => el('strong.neg', this.ui.money(c.amount_cents)) }
                        ],
                        rows: data.by_category,
                        empty: 'No expenses in this period.'
                    })),

                el('section.panel',
                    el('header.panel__head',
                        el('h2', 'Where the money came from'),
                        el('a.btn.btn--tiny', {
                            href: this.api.exportUrl('services', { from: this.from, to: this.to })
                        }, 'CSV')),
                    this.ui.table({
                        columns: [
                            { label: 'Service', key: 'description' },
                            { label: 'Times', key: 'count', align: 'right' },
                            { label: 'Amount', align: 'right',
                              render: s => el('strong.pos', this.ui.money(s.amount_cents)) }
                        ],
                        rows: data.by_service,
                        empty: 'No services performed in this period.'
                    }))));
    }

    /** Grouped bars: collected vs spent, one pair per month. */
    monthlyChart(monthly) {
        const width = 720;
        const height = 220;
        const pad = { top: 16, right: 12, bottom: 30, left: 64 };
        const plotW = width - pad.left - pad.right;
        const plotH = height - pad.top - pad.bottom;

        const max = Math.max(1, ...monthly.flatMap(m => [m.collected, m.spent]));
        const bandW = plotW / monthly.length;
        const barW = Math.min(26, bandW / 3);

        const svgNs = 'http://www.w3.org/2000/svg';
        const svg = document.createElementNS(svgNs, 'svg');
        svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
        svg.setAttribute('class', 'chart');

        const add = (tag, attrs, text) => {
            const node = document.createElementNS(svgNs, tag);
            for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
            if (text !== undefined) node.textContent = text;
            svg.appendChild(node);
            return node;
        };

        // Gridlines + y labels
        for (let i = 0; i <= 4; i++) {
            const y = pad.top + (plotH / 4) * i;
            add('line', { x1: pad.left, y1: y, x2: width - pad.right, y2: y, class: 'chart__grid' });
            add('text', { x: pad.left - 8, y: y + 4, class: 'chart__ylabel' },
                this.ui.money(max * (1 - i / 4)).replace('.00', ''));
        }

        monthly.forEach((m, i) => {
            const x = pad.left + i * bandW;

            const collectedH = (m.collected / max) * plotH;
            const spentH = (m.spent / max) * plotH;

            add('rect', {
                x: x + bandW / 2 - barW - 2,
                y: pad.top + plotH - collectedH,
                width: barW, height: Math.max(0, collectedH),
                class: 'chart__bar chart__bar--in', rx: 2
            }).appendChild(Object.assign(document.createElementNS(svgNs, 'title'),
                { textContent: `Collected ${this.ui.money(m.collected)}` }));

            add('rect', {
                x: x + bandW / 2 + 2,
                y: pad.top + plotH - spentH,
                width: barW, height: Math.max(0, spentH),
                class: 'chart__bar chart__bar--out', rx: 2
            }).appendChild(Object.assign(document.createElementNS(svgNs, 'title'),
                { textContent: `Spent ${this.ui.money(m.spent)}` }));

            add('text', {
                x: x + bandW / 2, y: height - 10, class: 'chart__xlabel'
            }, m.month.slice(5));
        });

        const legend = this.ui.el('div.chart-legend',
            this.ui.el('span', this.ui.el('i.dot.dot--in'), 'Collected'),
            this.ui.el('span', this.ui.el('i.dot.dot--out'), 'Spent'));

        return this.ui.el('div.chart-wrap', svg, legend);
    }

    /* ================= A/R ================= */

    async ar() {
        const { el } = this.ui;
        const data = await this.api.reportAr();
        const b = data.buckets;

        const bucketStat = (label, cents, tone = '') => el('div.stat',
            el('span.stat__label', label),
            el('strong.stat__value', { class: cents > 0 ? tone : '' }, this.ui.money(cents)));

        return el('div',
            el('p.muted',
                `Outstanding invoices as of ${this.ui.date(data.as_of)}. ` +
                'Anything past 60 days is worth a phone call.'),

            el('div.stats',
                bucketStat('Not yet due', b.current),
                bucketStat('1–30 days', b.d1_30, 'warn-text'),
                bucketStat('31–60 days', b.d31_60, 'warn-text'),
                bucketStat('61–90 days', b.d61_90, 'neg'),
                bucketStat('90+ days', b.d90_plus, 'neg'),
                el('div.stat.stat--strong',
                    el('span.stat__label', 'Total owed'),
                    el('strong.stat__value',
                        { class: data.total_cents > 0 ? 'neg' : '' },
                        this.ui.money(data.total_cents)))),

            el('section.panel',
                el('header.panel__head',
                    el('h2', 'Open invoices'),
                    el('a.btn.btn--tiny', {
                        href: this.api.exportUrl('invoices',
                            { from: '2000-01-01', to: this.ui.today() })
                    }, 'CSV')),
                this.ui.table({
                    columns: [
                        { label: 'Invoice', render: r => el('a',
                            { href: `#/admin/billing/${r.invoice_id}` },
                            el('strong', r.number)) },
                        { label: 'Client', render: r => el('a',
                            { href: `#/admin/clients/${r.client_id}` }, r.client_name) },
                        { label: 'Issued', render: r => this.ui.date(r.issued_on) },
                        { label: 'Due', render: r => this.ui.date(r.due_on) },
                        { label: 'Overdue by', render: r => r.days_overdue
                            ? el('span', { class: r.days_overdue > 60 ? 'neg' : 'warn-text' },
                                `${r.days_overdue} days`)
                            : el('span.muted', 'not yet') },
                        { label: 'Balance', align: 'right',
                          render: r => el('strong.neg', this.ui.money(r.balance_cents)) }
                    ],
                    rows: data.invoices,
                    empty: 'Nobody owes you anything. Enjoy it.'
                })));
    }

    /* ================= services by dog ================= */

    async services() {
        const { el } = this.ui;
        const data = await this.api.reportServices({ from: this.from, to: this.to });

        if (!data.pets.length) {
            return this.ui.empty('No services were performed in this period.');
        }

        const grand = data.pets.reduce((sum, p) => sum + p.total_cents, 0);

        return el('div',
            el('div.stat.stat--wide',
                el('span.stat__label',
                    `Services for ${data.pets.length} dog${data.pets.length === 1 ? '' : 's'}`),
                el('strong.stat__value', this.ui.money(grand))),

            el('div.form-actions.form-actions--left',
                el('a.btn.btn--tiny', {
                    href: this.api.exportUrl('services', { from: this.from, to: this.to })
                }, 'Export CSV')),

            data.pets.map(pet => el('section.panel',
                el('header.panel__head',
                    el('div',
                        el('h2', pet.pet_name,
                            el('span.muted.small', ` · ${pet.owner}`)),
                        pet.breed ? el('p.muted.small', pet.breed) : null),
                    el('strong.big-num', this.ui.money(pet.total_cents))),

                this.ui.table({
                    columns: [
                        { label: 'Date', render: e => this.ui.date(e.performed_on) },
                        { label: 'Service', key: 'description' },
                        { label: 'Qty', key: 'qty', align: 'right' },
                        { label: 'Rate', align: 'right',
                          render: e => this.ui.money(e.unit_price_cents) },
                        { label: 'Amount', align: 'right',
                          render: e => el('strong', this.ui.money(e.amount_cents)) },
                        { label: 'Staff', key: 'staff' },
                        { label: 'Invoice', render: e => e.invoice_number
                            ? el('span.muted', e.invoice_number)
                            : this.ui.badge('unbilled', 'warn') }
                    ],
                    rows: pet.events
                }))));
    }

    /* ================= occupancy ================= */

    async occupancy() {
        const { el } = this.ui;
        const data = await this.api.reportOccupancy({ from: this.from, to: this.to });

        return el('div',
            el('div.stats',
                el('div.stat',
                    el('span.stat__label', 'Busiest day'),
                    el('strong.stat__value', `${data.peak_dogs} dogs`)),
                el('div.stat',
                    el('span.stat__label', 'Average per day'),
                    el('strong.stat__value', `${data.avg_dogs} dogs`)),
                el('div.stat',
                    el('span.stat__label', 'Days covered'),
                    el('strong.stat__value', String(data.days.length)))),

            el('section.panel',
                el('h2', 'Dogs on site, day by day'),
                this.occupancyChart(data.days)));
    }

    occupancyChart(days) {
        if (!days.length) return this.ui.empty('No days in this range.');

        const width = 900;
        const height = 200;
        const pad = { top: 12, right: 10, bottom: 26, left: 34 };
        const plotW = width - pad.left - pad.right;
        const plotH = height - pad.top - pad.bottom;

        const max = Math.max(1, ...days.map(d => d.dogs));
        const barW = plotW / days.length;

        const svgNs = 'http://www.w3.org/2000/svg';
        const svg = document.createElementNS(svgNs, 'svg');
        svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
        svg.setAttribute('class', 'chart');

        const add = (tag, attrs, text) => {
            const node = document.createElementNS(svgNs, tag);
            for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
            if (text !== undefined) node.textContent = text;
            svg.appendChild(node);
            return node;
        };

        for (let i = 0; i <= 2; i++) {
            const y = pad.top + (plotH / 2) * i;
            add('line', { x1: pad.left, y1: y, x2: width - pad.right, y2: y, class: 'chart__grid' });
            add('text', { x: pad.left - 8, y: y + 4, class: 'chart__ylabel' },
                String(Math.round(max * (1 - i / 2))));
        }

        days.forEach((day, i) => {
            const h = (day.dogs / max) * plotH;
            const rect = add('rect', {
                x: pad.left + i * barW + 0.5,
                y: pad.top + plotH - h,
                width: Math.max(1, barW - 1),
                height: Math.max(0, h),
                class: 'chart__bar chart__bar--in'
            });
            const title = document.createElementNS(svgNs, 'title');
            title.textContent = `${day.date}: ${day.dogs} dog(s)`;
            rect.appendChild(title);

            // Only label the first of each month, or it turns to mush.
            if (day.date.endsWith('-01') || i === 0) {
                add('text', {
                    x: pad.left + i * barW, y: height - 8, class: 'chart__xlabel chart__xlabel--left'
                }, day.date.slice(5));
            }
        });

        return this.ui.el('div.chart-wrap', svg);
    }

    /* ================= vaccinations ================= */

    async vaccines() {
        const { el } = this.ui;
        const data = await this.api.reportVaccinations();

        if (!data.alerts.length) {
            return el('div',
                el('p.ok-note',
                    `Every active dog has current ${data.required.join(', ')} vaccinations. ` +
                    'Nothing expires in the next ' + data.warn_days + ' days.'));
        }

        const explain = {
            expired: 'Expired. The dog should not board until this is updated.',
            missing: 'No record at all. Ask the owner before the next stay.',
            no_expiry: 'We have a record but no expiry date. Worth chasing.',
            expiring: `Expires within ${data.warn_days} days.`
        };

        return el('div',
            el('p.muted',
                `Required: ${data.required.map(v => this.ui.titleCase(v)).join(', ')}. ` +
                `Warning ${data.warn_days} days ahead of expiry.`),

            this.ui.table({
                columns: [
                    { label: 'Dog', render: r => el('a',
                        { href: `#/admin/clients/${r.client_id}` }, el('strong', r.pet_name)) },
                    { label: 'Owner', key: 'client_name' },
                    { label: 'Contact', render: r => el('div',
                        el('div', r.phone || '—'),
                        el('small.muted', r.email || '')) },
                    { label: 'Vaccine', render: r => this.ui.titleCase(r.vaccine) },
                    { label: 'Problem',
                      render: r => this.ui.badge(r.severity, this.ui.statusTone(r.severity)) },
                    { label: 'Expires', render: r => this.ui.date(r.expires_on) },
                    { label: 'What to do', render: r => el('span.muted.small',
                        explain[r.severity]) }
                ],
                rows: data.alerts
            }));
    }
}
