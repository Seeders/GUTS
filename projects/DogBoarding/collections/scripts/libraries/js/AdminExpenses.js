/**
 * AdminExpenses - what the business spends.
 *
 * Two flavours of the same table: ordinary running costs (food, utilities,
 * payroll) and maintenance (the fence, the HVAC, kennel run 3). Maintenance is
 * flagged rather than living in a separate table, so it can be reported on
 * either as its own thing or as part of the wider cost picture.
 */
class AdminExpenses {
    constructor(app, console_) {
        this.app = app;
        this.api = app.api;
        this.console = console_;
    }

    get ui() { return GUTS.DogBoardUI; }

    async render() {
        const { el } = this.ui;

        const categories = await this.api.expenseCategories();
        this.categories = categories;

        const today = this.ui.today();
        const yearStart = `${today.slice(0, 4)}-01-01`;

        const from = el('input', { type: 'date', value: yearStart, onchange: () => load() });
        const to = el('input', { type: 'date', value: today, onchange: () => load() });

        const categorySelect = el('select', { onchange: () => load() },
            [el('option', { value: '' }, 'All categories'),
             ...categories.map(c => el('option', { value: c }, this.ui.titleCase(c)))]);

        const maintenanceOnly = el('input', { type: 'checkbox', onchange: () => load() });

        const results = el('div.results', this.ui.spinner());

        const load = async () => {
            this.ui.mount(results, this.ui.spinner());

            const data = await this.api.expenses({
                from: from.value,
                to: to.value,
                category: categorySelect.value,
                maintenance: maintenanceOnly.checked ? '1' : ''
            });

            // Roll up by category for the little breakdown bar.
            const byCategory = new Map();
            for (const expense of data.expenses) {
                byCategory.set(expense.category,
                    (byCategory.get(expense.category) || 0) + expense.amount_cents);
            }
            const breakdown = [...byCategory.entries()]
                .map(([category, cents]) => ({ category, cents }))
                .sort((a, b) => b.cents - a.cents);

            const maintenanceTotal = data.expenses
                .filter(e => e.is_maintenance)
                .reduce((sum, e) => sum + e.amount_cents, 0);

            this.ui.mount(results,
                el('div.stats',
                    el('div.stat',
                        el('span.stat__label', 'Total spent'),
                        el('strong.stat__value.neg', this.ui.money(data.total_cents))),
                    el('div.stat',
                        el('span.stat__label', 'Of which maintenance'),
                        el('strong.stat__value', this.ui.money(maintenanceTotal))),
                    el('div.stat',
                        el('span.stat__label', 'Entries'),
                        el('strong.stat__value', String(data.count)))),

                breakdown.length ? this.breakdownBar(breakdown, data.total_cents) : null,

                this.ui.table({
                    columns: [
                        { label: 'Date', render: e => this.ui.date(e.incurred_on) },
                        { label: 'Category', render: e => el('span',
                            this.ui.badge(e.category, e.is_maintenance ? 'info' : 'neutral')) },
                        { label: 'Vendor', key: 'vendor' },
                        { label: 'Description', render: e => el('div',
                            e.description || '—',
                            e.asset ? el('p.muted.small', `Asset: ${e.asset}`) : null) },
                        { label: 'Amount', align: 'right',
                          render: e => el('strong.neg', this.ui.money(e.amount_cents)) },
                        { label: 'Receipt', render: e => e.receipt_path
                            ? el('a.btn.btn--tiny', {
                                href: this.api.receiptFileUrl(e.id),
                                target: '_blank', rel: 'noopener'
                              }, 'View')
                            : el('span.muted', '—') },
                        { label: '', render: e => el('div.row-actions',
                            el('button.link-btn', { onclick: () => this.editExpense(e) }, 'Edit'),
                            el('button.link-btn.danger',
                                { onclick: () => this.deleteExpense(e) }, 'Delete')) }
                    ],
                    rows: data.expenses,
                    empty: 'No expenses in this range.'
                }));
        };

        await load();

        return el('div',
            el('header.page-head',
                el('h1', 'Expenses'),
                el('div.page-head__actions',
                    el('a.btn', {
                        href: this.api.exportUrl('expenses', { from: from.value, to: to.value })
                    }, 'Export CSV'),
                    el('button.btn.btn--primary',
                        { onclick: () => this.editExpense(null) }, '+ Record expense'))),

            el('div.toolbar',
                el('label.inline-field', el('span', 'From'), from),
                el('label.inline-field', el('span', 'To'), to),
                categorySelect,
                el('label.inline-field.check',
                    maintenanceOnly, el('span', 'Maintenance only'))),

            results);
    }

    reload() {
        this.app.route();
    }

    /** A single stacked bar - enough to see where the money went without a chart library. */
    breakdownBar(breakdown, total) {
        const { el } = this.ui;
        if (!total) return null;

        const bar = el('div.breakdown__bar', breakdown.map((entry, i) =>
            el('span.breakdown__seg', {
                style: {
                    width: `${(entry.cents / total) * 100}%`,
                    background: `hsl(${(i * 47) % 360} 45% ${58 - (i % 3) * 6}%)`
                },
                title: `${this.ui.titleCase(entry.category)}: ${this.ui.money(entry.cents)}`
            })));

        const legend = el('ul.breakdown__legend', breakdown.map((entry, i) =>
            el('li',
                el('span.dot', { style: {
                    background: `hsl(${(i * 47) % 360} 45% ${58 - (i % 3) * 6}%)`
                } }),
                el('span', this.ui.titleCase(entry.category)),
                el('strong', this.ui.money(entry.cents)),
                el('span.muted.small', ` ${Math.round((entry.cents / total) * 100)}%`))));

        return el('div.breakdown', bar, legend);
    }

    /* ---- create / edit ---- */

    editExpense(expense) {
        const { el } = this.ui;
        const isNew = !expense;
        const e = expense || {};

        const maintenanceCheck = this.ui.field({
            name: 'is_maintenance', label: 'This is maintenance / repair', type: 'checkbox',
            value: !!e.is_maintenance,
            hint: 'Tick for anything that keeps the facility working: repairs, servicing, upkeep.'
        });

        const assetField = this.ui.field({
            name: 'asset', label: 'What was maintained', value: e.asset,
            placeholder: 'Kennel run 3, HVAC, perimeter fence, van…'
        });

        const body = el('div',
            el('div.field-row',
                this.ui.field({ name: 'incurred_on', label: 'Date', type: 'date',
                    value: e.incurred_on || this.ui.today() }),
                this.ui.field({ name: 'category', label: 'Category', type: 'select',
                    value: e.category || 'supplies',
                    options: (this.categories || []).map(c => ({
                        value: c, label: this.ui.titleCase(c)
                    })) }),
                this.ui.field({ name: 'amount', label: 'Amount', type: 'number',
                    step: '0.01', min: 0,
                    value: e.amount_cents ? this.ui.centsToInput(e.amount_cents) : '' })),

            this.ui.row(
                this.ui.field({ name: 'vendor', label: 'Vendor', value: e.vendor,
                    placeholder: 'Who did you pay?' }),
                this.ui.field({ name: 'payment_method', label: 'Paid by', type: 'select',
                    value: e.payment_method || 'card',
                    options: ['card', 'cash', 'check', 'ach', 'other'] })),

            this.ui.field({ name: 'description', label: 'Description', value: e.description,
                placeholder: '40lb bags of kibble, quarterly HVAC service…' }),

            maintenanceCheck,
            assetField,

            this.ui.field({ name: 'recurring', label: 'Recurs', type: 'select',
                value: e.recurring || 'none',
                options: [
                    { value: 'none', label: 'One off' },
                    { value: 'monthly', label: 'Monthly' },
                    { value: 'quarterly', label: 'Quarterly' },
                    { value: 'annual', label: 'Annually' }
                ],
                hint: 'A label for reporting - it does not create future entries by itself.' }),

            el('label.field',
                el('span.field__label', 'Receipt'),
                el('input', { type: 'file', name: 'receipt', accept: 'application/pdf,image/*' }),
                e.receipt_path
                    ? el('small.hint', 'A receipt is already attached. Choosing a file replaces it.')
                    : null),

            this.ui.field({ name: 'notes', label: 'Notes', type: 'textarea', rows: 2,
                value: e.notes }));

        this.ui.modal({
            title: isNew ? 'Record an expense' : 'Edit expense',
            width: 660,
            body: () => body,
            confirmLabel: isNew ? 'Save expense' : 'Save changes',
            onConfirm: async (content) => {
                const data = this.ui.readForm(content);

                const amount = this.ui.toCents(data.amount);
                if (!amount) throw new Error('Enter an amount.');

                const form = new FormData();
                form.append('incurred_on', data.incurred_on);
                form.append('category', data.category);
                form.append('vendor', data.vendor || '');
                form.append('description', data.description || '');
                form.append('amount_cents', String(amount));
                form.append('payment_method', data.payment_method || '');
                form.append('is_maintenance', data.is_maintenance ? '1' : '0');
                form.append('asset', data.asset || '');
                form.append('recurring', data.recurring || 'none');
                form.append('notes', data.notes || '');

                const fileInput = content.querySelector('input[type="file"]');
                if (fileInput.files[0]) form.append('receipt', fileInput.files[0]);

                if (isNew) await this.api.createExpense(form);
                else await this.api.updateExpense(e.id, form);

                this.ui.toast('Expense saved.', 'good');
                this.reload();
            }
        });
    }

    async deleteExpense(expense) {
        const ok = await this.ui.confirm(
            `Delete this ${this.ui.money(expense.amount_cents)} expense${
                expense.vendor ? ` from ${expense.vendor}` : ''}?`,
            { title: 'Delete expense' });
        if (!ok) return;

        await this.api.deleteExpense(expense.id);
        this.ui.toast('Expense deleted.', 'good');
        this.reload();
    }
}
