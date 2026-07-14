/**
 * AdminConsole - the back office shell.
 *
 * The login wall and the console frame are markup in the `admin` interface. The
 * sidebar is built from the `adminNav` collection - add a nav item there and a
 * link appears here. Copy comes from `content.admin`, the settings form from the
 * `settings` form schema.
 *
 * Section content is delegated to the module registered for that section.
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
    get forms() { return this.app.forms; }
    get collections() { return this.app.collections; }
    get copy() { return this.collections.content?.admin || {}; }

    /** '/admin/clients/12?status=x' -> { section, id, query } */
    static parse(path) {
        const [route, search] = path.split('?');
        const parts = route.split('/').filter(Boolean);
        return {
            section: parts[1] || 'dashboard',
            id: parts[2] || null,
            query: Object.fromEntries(new URLSearchParams(search || ''))
        };
    }

    async render(root, path) {
        this.ui.bind(root, { admin: this.copy });

        const loginPane = root.querySelector('[data-login]');
        const consolePane = root.querySelector('[data-console]');

        if (!this.api.isAuthed) {
            loginPane.hidden = false;
            consolePane.hidden = true;
            this.wireLogin(root);
            return;
        }

        loginPane.hidden = true;
        consolePane.hidden = false;

        const { section, id, query } = AdminConsole.parse(path);
        this.query = query;

        this.renderNav(root, section);
        this.wireLogout(root);

        const content = root.querySelector('[data-content]');
        this.ui.mount(content, this.ui.spinner());

        try {
            this.ui.mount(content, await this.view(section, id));
        } catch (err) {
            if (err.status === 401) return;
            this.ui.mount(content, this.ui.el('div.error-box',
                this.ui.el('h2', 'Could not load this page'),
                this.ui.el('p', err.message),
                this.ui.el('button.btn', { onclick: () => this.app.route() }, 'Retry')));
        }
    }

    /** The sidebar, straight off the adminNav collection. */
    renderNav(root, current) {
        const nav = root.querySelector('[data-list="adminNav"]');

        this.ui.mount(nav, this.ui.ordered(this.collections.adminNav).map(item => {
            const link = this.app.interfaces.template('navLink');
            const isHome = item.section === 'dashboard';

            link.setAttribute('href', `#/admin${isHome ? '' : '/' + item.section}`);
            link.querySelector('.side__icon').textContent = item.icon || '•';
            link.querySelector('[data-nav-label]').textContent = item.title;
            link.classList.toggle('side__link--on', item.section === current);

            return link;
        }));
    }

    wireLogout(root) {
        const button = root.querySelector('[data-logout]');
        button.onclick = async () => {
            await this.api.logout();
            this.app.navigate('/admin');
        };
    }

    /** Clear whatever the last attempt left behind. The submit itself is delegated. */
    wireLogin(root) {
        const error = root.querySelector('[data-login-error]');
        if (error) error.textContent = '';
    }

    /**
     * Called by DogBoardingApp's delegated submit listener, not by a handler
     * bound to the form. The form lives in the interface markup and can be
     * re-injected at any time; a handler bound to the element would go with it.
     */
    async submitLogin(form) {
        const error = form.querySelector('[data-login-error]');
        const password = form.querySelector('input[type="password"]');
        const button = form.querySelector('button[type="submit"]');

        if (button.disabled) return; // already in flight

        button.disabled = true;
        const label = button.textContent;
        button.textContent = 'Checking…';
        error.textContent = '';

        try {
            await this.api.login(password.value);
            this.app.route();
        } catch (err) {
            error.textContent = err.message;
            password.select();
            button.disabled = false;
            button.textContent = label;
        }
    }

    /** Which module owns a section is decided by the adminNav collection. */
    async view(section, id) {
        if (section === 'dashboard') return this.dashboard();
        if (section === 'settings') return this.settings();

        const module = this.modules[section];
        if (!module) return this.ui.empty(`No page is registered for "${section}".`);

        return module.render(id);
    }

    /* ---------------- dashboard ---------------- */

    async dashboard() {
        const { el } = this.ui;
        const data = await this.api.dashboard();
        const copy = this.copy.dashboard || {};

        // The stat tiles are listed in the content collection; this maps each
        // declared key to the number that fills it.
        const values = {
            onSite: { value: String(data.on_site.length) },
            arriving: { value: String(data.arriving_today.length) },
            departing: { value: String(data.departing_today.length) },
            unbilled: {
                value: this.ui.money(data.unbilled_cents),
                tone: data.unbilled_cents > 0 ? 'warn' : '',
                sub: `${data.unbilled_count} charge${data.unbilled_count === 1 ? '' : 's'}`
            },
            ar: {
                value: this.ui.money(data.ar_total_cents),
                tone: data.ar_total_cents > 0 ? 'warn' : ''
            },
            vaccines: {
                value: String(data.vaccine_alert_count),
                tone: data.vaccine_alert_count > 0 ? 'warn' : ''
            }
        };

        const stats = (copy.stats || []).map(spec => {
            const found = values[spec.key] || { value: '—' };
            const tile = this.app.interfaces.template('stat');

            tile.querySelector('.stat__label').textContent = spec.label;
            tile.querySelector('.stat__value').textContent = found.value;

            const sub = tile.querySelector('.stat__sub');
            if (found.sub) sub.textContent = found.sub;
            else sub.remove();

            if (found.tone) tile.classList.add(`stat--${found.tone}`);

            if (spec.route) {
                return el('a.stat-link', { href: `#${spec.route}` }, tile);
            }
            return tile;
        });

        return el('div',
            el('header.page-head',
                el('div',
                    el('h1', copy.heading || 'Today'),
                    el('p.muted', this.ui.date(data.today))),
                el('div.page-head__actions',
                    el('a.btn.btn--primary', { href: '#/admin/bookings/new' },
                        copy.newBookingLabel || '+ New booking'))),

            el('div.stats', stats),

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
                el('h2', copy.monthHeading || 'This month so far'),
                el('div.month-strip__row',
                    el('div', el('span.muted.small', 'Invoiced'),
                        el('strong', this.ui.money(data.month.billed_cents))),
                    el('div', el('span.muted.small', 'Collected'),
                        el('strong', this.ui.money(data.month.collected_cents))),
                    el('div', el('span.muted.small', 'Spent'),
                        el('strong', this.ui.money(data.month.expenses_cents))),
                    el('div', el('span.muted.small', 'Net (cash)'),
                        el('strong', { class: data.month.net_cash_cents < 0 ? 'neg' : 'pos' },
                            this.ui.money(data.month.net_cash_cents))))),

            el('section.panel',
                el('h2', `On site now (${data.on_site.length})`),
                this.ui.table({
                    columns: [
                        { label: 'Dog', render: r => el('a',
                            { href: `#/admin/clients/${r.client_id}` }, el('strong', r.pet_name)) },
                        { label: 'Breed', key: 'breed' },
                        { label: 'Owner', render: r => `${r.first_name} ${r.last_name}` },
                        { label: 'Phone', key: 'phone' },
                        { label: 'Kennel', key: 'kennel' },
                        { label: 'Out', render: r => this.ui.date(r.check_out) }
                    ],
                    rows: data.on_site,
                    empty: 'No dogs on site right now.'
                })),

            el('div.two-up',
                el('section.panel',
                    el('h2', 'Arriving today'),
                    this.movements(data.arriving_today, 'Nobody arriving today.')),
                el('section.panel',
                    el('h2', 'Leaving today'),
                    this.movements(data.departing_today, 'Nobody leaving today.'))),

            el('section.panel',
                el('h2', `Vaccination alerts (${data.vaccine_alert_count})`),
                data.vaccine_alerts.length
                    ? this.vaccineTable(data.vaccine_alerts)
                    : el('p.ok-note', copy.allVaccinesCurrent
                        || 'Every active dog has current vaccinations.')));
    }

    movements(rows, empty) {
        const { el } = this.ui;
        return this.ui.table({
            columns: [
                { label: 'Client', render: r => `${r.first_name} ${r.last_name}` },
                { label: 'Dogs', key: 'dogs', align: 'right' },
                { label: 'Phone', key: 'phone' },
                { label: 'Status', render: r => this.statusBadge(r.status) },
                { label: '', render: r => el('a.btn.btn--tiny',
                    { href: `#/admin/bookings/${r.id}` }, 'Open') }
            ],
            rows,
            empty
        });
    }

    /** Booking status badges take their label and tone from the collection. */
    statusBadge(status) {
        const def = this.collections.bookingStatuses?.[status];
        return this.ui.badge(def?.title || status, def?.tone || this.ui.statusTone(status));
    }

    vaccineTable(alerts) {
        const { el } = this.ui;
        const explain = this.copy.vaccineSeverity || {};

        return this.ui.table({
            columns: [
                { label: 'Dog', render: r => el('a',
                    { href: `#/admin/clients/${r.client_id}` }, el('strong', r.pet_name)) },
                { label: 'Owner', key: 'client_name' },
                { label: 'Vaccine', render: r =>
                    this.collections.recordTypes?.[r.vaccine]?.title || this.ui.titleCase(r.vaccine) },
                { label: 'Problem', render: r =>
                    this.ui.badge(r.severity, this.ui.statusTone(r.severity)) },
                { label: 'Expires', render: r => this.ui.date(r.expires_on) },
                { label: 'What to do', render: r => el('span.muted.small', explain[r.severity] || '') }
            ],
            rows: alerts
        });
    }

    /* ---------------- settings ---------------- */

    /**
     * Settings, read-only.
     *
     * The business details, the tax rate, the invoice terms and the vaccination
     * warning window are the `business` config in the collections - edited in the
     * GUTS editor, like the rate card and the record types. They are not client
     * data and they are not secret, so they have no business being in the
     * database.
     *
     * The one thing this screen still writes is the staff password, which is the
     * only item here that genuinely belongs in secure/.
     */
    async settings() {
        const { el } = this.ui;
        const data = await this.api.settings();
        const b = data.business;

        const row = (label, value) => el('div.detail-item',
            el('span.detail-item__label', label),
            el('span.detail-item__value', value || '—'));

        return el('div',
            el('header.page-head', el('h1', 'Settings')),

            el('div.notice',
                el('strong', 'These are collections, not database rows. '),
                'Edit them in the GUTS editor and they take effect on the next refresh. ',
                el('code', data.editedIn)),

            el('section.panel',
                el('h2', 'Business'),
                el('div.detail-grid',
                    row('Name', b.name),
                    row('Phone', b.phone),
                    row('Email', b.email),
                    row('Address', b.address))),

            el('section.panel',
                el('h2', 'Billing'),
                el('div.detail-grid',
                    row('Sales tax', b.taxRateBps
                        ? `${(b.taxRateBps / 100).toFixed(2)}%  (${b.taxRateBps} bps)`
                        : 'None'),
                    row('Invoice prefix', b.invoicePrefix),
                    row('Payment terms', `${b.invoiceTermsDays} days`))),

            el('section.panel',
                el('header.panel__head',
                    el('h2', 'Required vaccinations'),
                    el('span.muted.small', 'recordTypes collection')),
                el('p.muted',
                    `Anything marked required is asked for on the registration form and watched ` +
                    `by the alerts, which warn ${b.vaccineWarnDays} days before expiry.`),
                this.ui.table({
                    columns: [
                        { label: 'Record', render: t => el('strong', t.title) },
                        { label: 'Required', render: t => t.required
                            ? this.ui.badge('required', 'good')
                            : el('span.muted', 'optional') },
                        { label: 'Typically valid', render: t => t.typicalValidMonths
                            ? `${t.typicalValidMonths} months` : '—' },
                        { label: 'Notes', render: t => el('span.muted.small', t.description || '') }
                    ],
                    rows: this.ui.ordered(this.collections.recordTypes)
                })),

            el('section.panel',
                el('h2', 'Change staff password'),
                el('p.muted',
                    'The one thing on this page that is not a collection. It lives in secure/, ' +
                    'hashed. Changing it logs everybody out, including you.'),
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
