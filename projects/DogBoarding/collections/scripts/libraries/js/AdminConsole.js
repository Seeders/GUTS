/**
 * AdminConsole - the back office shell.
 *
 * Owns the login gate, the sidebar, the dashboard and settings. Everything else
 * is delegated to a module: AdminClients, AdminBookings, AdminBilling,
 * AdminExpenses, AdminReports.
 */
class AdminConsole {
    constructor(app) {
        this.app = app;
        this.api = app.api;

        this.modules = {
            clients: new GUTS.AdminClients(app, this),
            bookings: new GUTS.AdminBookings(app, this),
            billing: new GUTS.AdminBilling(app, this),
            expenses: new GUTS.AdminExpenses(app, this),
            reports: new GUTS.AdminReports(app, this)
        };
    }

    get ui() { return GUTS.DogBoardUI; }

    /** '/admin/clients/12?status=x' -> { section: 'clients', id: '12', query: {status:'x'} } */
    static parse(path) {
        const [route, search] = path.split('?');
        const parts = route.split('/').filter(Boolean); // ['admin', 'clients', '12']
        return {
            section: parts[1] || 'dashboard',
            id: parts[2] || null,
            query: Object.fromEntries(new URLSearchParams(search || ''))
        };
    }

    async render(root, path) {
        if (!this.api.isAuthed) {
            this.ui.mount(root, this.loginScreen());
            return;
        }

        const { section, id, query } = AdminConsole.parse(path);
        this.query = query;

        const content = this.ui.el('div.admin__content', this.ui.spinner());
        this.ui.mount(root, this.ui.el('div.admin',
            this.sidebar(section),
            this.ui.el('div.admin__main', content)));

        try {
            const view = await this.view(section, id);
            this.ui.mount(content, view);
        } catch (err) {
            if (err.status === 401) return; // the unauthorized handler takes it from here
            this.ui.mount(content, this.ui.el('div.error-box',
                this.ui.el('h2', 'Could not load this page'),
                this.ui.el('p', err.message),
                this.ui.el('button.btn', { onclick: () => this.app.route() }, 'Retry')));
        }
    }

    async view(section, id) {
        switch (section) {
            case 'dashboard': return this.dashboard();
            case 'clients': return this.modules.clients.render(id);
            case 'bookings': return this.modules.bookings.render(id);
            case 'billing': return this.modules.billing.render(id);
            case 'expenses': return this.modules.expenses.render(id);
            case 'reports': return this.modules.reports.render(id);
            case 'settings': return this.settings();
            default: return this.ui.empty(`No such page: ${section}`);
        }
    }

    /* ---------------- login ---------------- */

    loginScreen() {
        const { el } = this.ui;

        const password = el('input', {
            type: 'password', name: 'password', required: true,
            placeholder: 'Password', autofocus: true
        });
        const error = el('p.login__error');

        const form = el('form.login__form', {
            onsubmit: async (e) => {
                e.preventDefault();
                const button = form.querySelector('button');
                button.disabled = true;
                button.textContent = 'Checking…';
                error.textContent = '';

                try {
                    await this.api.login(password.value);
                    this.app.route();
                } catch (err) {
                    error.textContent = err.message;
                    password.select();
                    button.disabled = false;
                    button.textContent = 'Log in';
                }
            }
        },
            el('label.field',
                el('span.field__label', 'Staff password'),
                password),
            error,
            el('button.btn.btn--primary.btn--block', { type: 'submit' }, 'Log in'));

        return el('div.login',
            el('div.login__card',
                el('h1', 'Staff login'),
                el('p.muted', 'The back office. Client records, bookings and the books.'),
                form,
                el('a.login__back', { href: '#/' }, '← Back to the public site')));
    }

    /* ---------------- sidebar ---------------- */

    sidebar(current) {
        const { el } = this.ui;

        const item = (section, label, icon) => el('a.side__link', {
            href: `#/admin${section === 'dashboard' ? '' : '/' + section}`,
            class: current === section ? 'side__link--on' : ''
        }, el('span.side__icon', icon), label);

        return el('aside.side',
            el('div.side__brand',
                el('span.side__logo', '🐾'),
                el('div',
                    el('strong', 'Back office'),
                    el('small.muted', 'Boarding management'))),

            el('nav.side__nav',
                item('dashboard', 'Today', '◉'),
                item('clients', 'Clients & Dogs', '☰'),
                item('bookings', 'Bookings', '▤'),
                item('billing', 'Billing', '$'),
                item('expenses', 'Expenses', '↓'),
                item('reports', 'Reports', '◪'),
                item('settings', 'Settings', '⚙')),

            el('div.side__foot',
                el('a.side__link', { href: '#/' }, el('span.side__icon', '↗'), 'Public site'),
                el('button.side__link', {
                    type: 'button',
                    onclick: async () => {
                        await this.api.logout();
                        this.app.navigate('/admin');
                    }
                }, el('span.side__icon', '⏻'), 'Log out')));
    }

    /* ---------------- dashboard ---------------- */

    async dashboard() {
        const { el } = this.ui;
        const data = await this.api.dashboard();

        const stat = (label, value, tone = '', href = null, sub = null) => {
            const inner = el('div.stat', { class: tone ? `stat--${tone}` : '' },
                el('span.stat__label', label),
                el('strong.stat__value', value),
                sub ? el('span.stat__sub', sub) : null);
            return href ? el('a.stat-link', { href: `#${href}` }, inner) : inner;
        };

        const alertTone = data.vaccine_alert_count > 0 ? 'warn' : '';

        const onSiteTable = this.ui.table({
            columns: [
                { label: 'Dog', render: r => el('a', { href: `#/admin/clients/${r.client_id}` },
                    el('strong', r.pet_name)) },
                { label: 'Breed', key: 'breed' },
                { label: 'Owner', render: r => `${r.first_name} ${r.last_name}` },
                { label: 'Phone', key: 'phone' },
                { label: 'Kennel', key: 'kennel' },
                { label: 'Out', render: r => this.ui.date(r.check_out) }
            ],
            rows: data.on_site,
            empty: 'No dogs on site right now.'
        });

        const movements = (rows, kind) => this.ui.table({
            columns: [
                { label: 'Client', render: r => `${r.first_name} ${r.last_name}` },
                { label: 'Dogs', key: 'dogs', align: 'right' },
                { label: 'Phone', key: 'phone' },
                { label: 'Status', render: r => this.ui.badge(r.status, this.ui.statusTone(r.status)) },
                { label: '', render: r => el('a.btn.btn--tiny',
                    { href: `#/admin/bookings/${r.id}` }, 'Open') }
            ],
            rows,
            empty: kind === 'in' ? 'Nobody arriving today.' : 'Nobody leaving today.'
        });

        const alerts = data.vaccine_alerts.length
            ? this.ui.table({
                columns: [
                    { label: 'Dog', render: r => el('a', { href: `#/admin/clients/${r.client_id}` },
                        el('strong', r.pet_name)) },
                    { label: 'Owner', key: 'client_name' },
                    { label: 'Vaccine', render: r => this.ui.titleCase(r.vaccine) },
                    { label: 'Problem', render: r =>
                        this.ui.badge(r.severity, this.ui.statusTone(r.severity)) },
                    { label: 'Expires', render: r => this.ui.date(r.expires_on) }
                ],
                rows: data.vaccine_alerts,
                empty: ''
            })
            : this.ui.el('p.ok-note', 'Every active dog has current vaccinations. Nice.');

        return el('div',
            el('header.page-head',
                el('div',
                    el('h1', 'Today'),
                    el('p.muted', this.ui.date(data.today))),
                el('div.page-head__actions',
                    el('a.btn.btn--primary', { href: '#/admin/bookings/new' }, '+ New booking'))),

            el('div.stats',
                stat('Dogs on site', String(data.on_site.length)),
                stat('Arriving today', String(data.arriving_today.length)),
                stat('Leaving today', String(data.departing_today.length)),
                stat('Unbilled work', this.ui.money(data.unbilled_cents),
                    data.unbilled_cents > 0 ? 'warn' : '', '/admin/billing',
                    `${data.unbilled_count} charge${data.unbilled_count === 1 ? '' : 's'}`),
                stat('Owed to us', this.ui.money(data.ar_total_cents),
                    data.ar_total_cents > 0 ? 'warn' : '', '/admin/reports'),
                stat('Vaccine alerts', String(data.vaccine_alert_count), alertTone)),

            (data.pending_clients > 0 || data.requested_bookings > 0)
                ? el('div.notice',
                    el('strong', 'Needs your attention: '),
                    data.pending_clients > 0
                        ? el('a', { href: '#/admin/clients?status=pending' },
                            `${data.pending_clients} new client${data.pending_clients === 1 ? '' : 's'} to approve`)
                        : null,
                    (data.pending_clients > 0 && data.requested_bookings > 0) ? ' · ' : null,
                    data.requested_bookings > 0
                        ? el('a', { href: '#/admin/bookings' },
                            `${data.requested_bookings} booking request${data.requested_bookings === 1 ? '' : 's'}`)
                        : null)
                : null,

            el('div.month-strip',
                el('h2', 'This month so far'),
                el('div.month-strip__row',
                    el('div', el('span.muted.small', 'Invoiced'),
                        el('strong', this.ui.money(data.month.billed_cents))),
                    el('div', el('span.muted.small', 'Collected'),
                        el('strong', this.ui.money(data.month.collected_cents))),
                    el('div', el('span.muted.small', 'Spent'),
                        el('strong', this.ui.money(data.month.expenses_cents))),
                    el('div', el('span.muted.small', 'Net (cash)'),
                        el('strong', {
                            class: data.month.net_cash_cents < 0 ? 'neg' : 'pos'
                        }, this.ui.money(data.month.net_cash_cents))))),

            el('section.panel',
                el('h2', `On site now (${data.on_site.length})`),
                onSiteTable),

            el('div.two-up',
                el('section.panel',
                    el('h2', 'Arriving today'),
                    movements(data.arriving_today, 'in')),
                el('section.panel',
                    el('h2', 'Leaving today'),
                    movements(data.departing_today, 'out'))),

            el('section.panel',
                el('h2', `Vaccination alerts (${data.vaccine_alert_count})`),
                alerts));
    }

    /* ---------------- settings ---------------- */

    async settings() {
        const { el } = this.ui;
        const settings = await this.api.settings();

        const businessForm = el('div',
            this.ui.field({ name: 'business_name', label: 'Business name', value: settings.business_name }),
            this.ui.row(
                this.ui.field({ name: 'business_phone', label: 'Phone', value: settings.business_phone }),
                this.ui.field({ name: 'business_email', label: 'Email', value: settings.business_email })),
            this.ui.field({ name: 'business_address', label: 'Address', value: settings.business_address }));

        const billingForm = el('div',
            this.ui.row(
                this.ui.field({ name: 'tax_rate_bps', label: 'Sales tax (basis points)',
                    type: 'number', min: 0, value: settings.tax_rate_bps,
                    hint: '725 = 7.25%. Use 0 if you do not charge tax.' }),
                this.ui.field({ name: 'invoice_prefix', label: 'Invoice prefix',
                    value: settings.invoice_prefix }),
                this.ui.field({ name: 'invoice_terms_days', label: 'Payment terms (days)',
                    type: 'number', min: 0, value: settings.invoice_terms_days })));

        const vaccineForm = el('div',
            this.ui.row(
                this.ui.field({ name: 'required_vaccines', label: 'Required vaccinations',
                    value: settings.required_vaccines,
                    hint: 'Comma separated. These are what the intake form asks for and what ' +
                          'the alerts watch.' }),
                this.ui.field({ name: 'vaccine_warn_days', label: 'Warn me this many days ahead',
                    type: 'number', min: 1, value: settings.vaccine_warn_days })));

        const saveAll = async (button) => {
            const data = {
                ...this.ui.readForm(businessForm),
                ...this.ui.readForm(billingForm),
                ...this.ui.readForm(vaccineForm)
            };
            button.disabled = true;
            try {
                await this.api.saveSettings(data);
                this.ui.toast('Settings saved.', 'good');
            } catch (err) {
                this.ui.toast(err.message, 'bad');
            } finally {
                button.disabled = false;
            }
        };

        const saveButton = el('button.btn.btn--primary',
            { onclick: () => saveAll(saveButton) }, 'Save settings');

        return el('div',
            el('header.page-head', el('h1', 'Settings')),

            el('section.panel',
                el('h2', 'Business'),
                businessForm),

            el('section.panel',
                el('h2', 'Billing'),
                billingForm),

            el('section.panel',
                el('h2', 'Vaccinations'),
                vaccineForm),

            el('div.form-actions', saveButton),

            el('section.panel',
                el('h2', 'Change staff password'),
                el('p.muted', 'Changing the password logs everybody out, including you.'),
                this.passwordForm()));
    }

    passwordForm() {
        const { el } = this.ui;

        const form = el('form', {
            onsubmit: async (e) => {
                e.preventDefault();
                const data = this.ui.readForm(form);

                if (data.new_password !== data.confirm_password) {
                    this.ui.toast('The two new passwords do not match.', 'bad');
                    return;
                }

                try {
                    await this.api.changePassword(data.current_password, data.new_password);
                    this.api.setToken(null);
                    this.ui.toast('Password changed. Log in again.', 'good');
                    this.app.navigate('/admin');
                } catch (err) {
                    this.ui.toast(err.message, 'bad');
                }
            }
        },
            this.ui.row(
                this.ui.field({ name: 'current_password', label: 'Current password',
                    type: 'password', required: true }),
                this.ui.field({ name: 'new_password', label: 'New password',
                    type: 'password', required: true, hint: 'At least 8 characters.' }),
                this.ui.field({ name: 'confirm_password', label: 'Confirm new password',
                    type: 'password', required: true })),
            el('button.btn', { type: 'submit' }, 'Change password'));

        return form;
    }
}
