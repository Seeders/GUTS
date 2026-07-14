/**
 * AdminCalendar - the month view: who is in, and when we are full.
 *
 * Capacity is the sum of the kennels collection, so adding a run is an edit in
 * the GUTS editor rather than a code change. Each cell shows beds taken out of
 * beds available for that NIGHT; clicking one lists the stays that cover it.
 */
class AdminCalendar {
    constructor(app, console_) {
        this.app = app;
        this.console = console_;
        this.api = app.api;
        this.month = null; // 'YYYY-MM'; survives re-renders because the module does
    }

    get ui() { return GUTS.DogBoardUI; }

    async render() {
        const { el } = this.ui;
        const today = this.ui.today();
        if (!this.month) this.month = today.slice(0, 7);

        const [year, month] = this.month.split('-').map(Number);
        const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
        const first = `${this.month}-01`;
        const last = `${this.month}-${String(daysInMonth).padStart(2, '0')}`;

        const data = await this.api.calendar({ from: first, to: last });
        const byDate = new Map(data.days.map(d => [d.date, d]));

        const monthLabel = new Date(Date.UTC(year, month - 1, 1))
            .toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });

        const shift = n => {
            this.month = new Date(Date.UTC(year, month - 1 + n, 1)).toISOString().slice(0, 7);
            this.app.route();
        };

        const cells = [];
        const leading = new Date(Date.UTC(year, month - 1, 1)).getUTCDay(); // 0 = Sunday
        for (let i = 0; i < leading; i++) cells.push(el('div.cal__cell.cal__cell--empty'));

        for (let day = 1; day <= daysInMonth; day++) {
            const date = `${this.month}-${String(day).padStart(2, '0')}`;
            const info = byDate.get(date) ||
                { booked: 0, capacity: data.capacity, available: data.capacity, full: false };

            // "tight" once a fifth or less of the beds are left.
            const tight = !info.full && info.available <= Math.max(1, Math.floor(info.capacity * 0.2));
            const tone = info.full ? 'full' : (tight ? 'tight' : 'open');

            cells.push(el('button.cal__cell', {
                type: 'button',
                class: `cal__cell--${tone}${date === today ? ' cal__cell--today' : ''}`,
                onclick: () => this.dayDetail(date, data)
            },
                el('span.cal__day', String(day)),
                el('span.cal__count', `${info.booked}/${info.capacity}`),
                el('span.cal__free', info.full ? 'Full' : `${info.available} free`)));
        }

        return el('div',
            el('header.page-head',
                el('h1', 'Calendar'),
                el('div.cal__nav',
                    el('button.btn', { onclick: () => shift(-1) }, '‹'),
                    el('strong.cal__month', monthLabel),
                    el('button.btn', { onclick: () => shift(1) }, '›'),
                    el('button.btn', {
                        onclick: () => { this.month = today.slice(0, 7); this.app.route(); }
                    }, 'Today'))),

            el('p.muted', this.capacityLine(data)),

            el('div.cal',
                ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(d => el('div.cal__weekday', d)),
                cells),

            el('section.panel',
                el('header.panel__head', el('h2', 'Kennels')),
                el('p.muted', 'These are the kennels collection — edit them in the GUTS editor and capacity follows.'),
                this.ui.table({
                    columns: [
                        { label: 'Kennel', render: k => el('strong', k.name) },
                        { label: 'Size', render: k => this.ui.badge(k.size, k.size === 'large' ? 'info' : 'neutral') },
                        { label: 'Notes', render: k => el('span.muted.small', k.description || '') }
                    ],
                    rows: data.kennels,
                    empty: 'No kennels defined yet. Add some in the kennels collection.'
                })));
    }

    /** "6 dogs a night — 6 kennels (4 small, 2 large)." One dog per kennel. */
    capacityLine(data) {
        const small = data.kennels.filter(k => k.size !== 'large').length;
        const large = data.kennels.filter(k => k.size === 'large').length;
        const n = data.kennels.length;
        return `${data.capacity} dog${data.capacity === 1 ? '' : 's'} a night — ` +
            `${n} kennel${n === 1 ? '' : 's'} (${small} small, ${large} large), one dog each.`;
    }

    /** Everyone staying on one night. */
    dayDetail(date, data) {
        const { el } = this.ui;
        const info = data.days.find(d => d.date === date) || { booked: 0, capacity: 0, available: 0 };
        const staying = data.bookings.filter(b => b.check_in <= date && b.check_out > date);

        this.ui.modal({
            title: this.ui.date(date),
            width: 640,
            body: el('div',
                el('p.muted',
                    `${info.booked} of ${info.capacity} beds taken · ${info.available} free`),
                this.ui.table({
                    columns: [
                        { label: 'Client', render: b => `${b.first_name} ${b.last_name}` },
                        { label: 'Dogs', render: b => b.dog_names || '—' },
                        { label: 'Stay', render: b => `${this.ui.shortDate(b.check_in)} → ${this.ui.shortDate(b.check_out)}` },
                        { label: 'Status', render: b => this.ui.badge(b.status, this.ui.statusTone(b.status)) }
                    ],
                    rows: staying,
                    empty: 'Nobody is staying this night.',
                    onRowClick: b => this.app.navigate(`/admin/bookings/${b.id}`)
                }))
        });
    }
}
