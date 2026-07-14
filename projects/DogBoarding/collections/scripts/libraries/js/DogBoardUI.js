/**
 * DogBoardUI - the small pile of DOM helpers the rest of the app is built from.
 *
 * Everything user-supplied goes through el()/text nodes rather than innerHTML,
 * so a dog named `<script>` is just a dog with a strange name.
 */
class DogBoardUI {

    /* ---------------- element building ---------------- */

    /**
     * el('div.card', { onclick }, 'text', childNode, [more, nodes])
     * The tag accepts CSS-ish shorthand: 'button.btn.primary', 'span#total'.
     */
    static el(spec, props = null, ...children) {
        const [tag, ...rest] = String(spec).split(/(?=[.#])/);
        const node = document.createElement(tag || 'div');

        for (const token of rest) {
            if (token[0] === '.') node.classList.add(token.slice(1));
            else if (token[0] === '#') node.id = token.slice(1);
        }

        if (props && (props.nodeType || typeof props === 'string' || Array.isArray(props))) {
            children.unshift(props);
            props = null;
        }

        for (const [key, value] of Object.entries(props || {})) {
            if (value === null || value === undefined || value === false) continue;

            if (key === 'class') node.className += (node.className ? ' ' : '') + value;
            else if (key === 'style' && typeof value === 'object') Object.assign(node.style, value);
            else if (key === 'dataset') Object.assign(node.dataset, value);
            else if (key.startsWith('on') && typeof value === 'function') {
                node.addEventListener(key.slice(2).toLowerCase(), value);
            } else if (key === 'html') node.innerHTML = value; // only ever used with our own markup
            else if (key in node && key !== 'list') node[key] = value;
            else node.setAttribute(key, value === true ? '' : value);
        }

        DogBoardUI.append(node, children);
        return node;
    }

    static append(node, children) {
        for (const child of children.flat(4)) {
            if (child === null || child === undefined || child === false) continue;
            node.appendChild(child.nodeType ? child : document.createTextNode(String(child)));
        }
        return node;
    }

    static clear(node) {
        while (node.firstChild) node.removeChild(node.firstChild);
        return node;
    }

    static mount(node, ...children) {
        DogBoardUI.clear(node);
        DogBoardUI.append(node, children);
        return node;
    }

    /* ---------------- formatting ---------------- */

    /** Cents to '$1,234.50'. Negative renders as -$12.00, not $-12.00. */
    static money(cents) {
        const n = Number(cents || 0) / 100;
        const sign = n < 0 ? '-' : '';
        return `${sign}$${Math.abs(n).toLocaleString('en-US', {
            minimumFractionDigits: 2, maximumFractionDigits: 2
        })}`;
    }

    /** '45.00' or '' -> cents. Tolerates '$', commas, spaces. */
    static toCents(value) {
        const cleaned = String(value ?? '').replace(/[^0-9.\-]/g, '');
        if (!cleaned) return 0;
        return Math.round(parseFloat(cleaned) * 100) || 0;
    }

    static centsToInput(cents) {
        return (Number(cents || 0) / 100).toFixed(2);
    }

    /** '2026-07-13' -> 'Jul 13, 2026'. Parsed as local, not UTC. */
    static date(iso) {
        if (!iso) return '—';
        const [y, m, d] = String(iso).slice(0, 10).split('-').map(Number);
        if (!y) return String(iso);
        return new Date(y, m - 1, d).toLocaleDateString('en-US',
            { month: 'short', day: 'numeric', year: 'numeric' });
    }

    static shortDate(iso) {
        if (!iso) return '—';
        const [y, m, d] = String(iso).slice(0, 10).split('-').map(Number);
        if (!y) return String(iso);
        return new Date(y, m - 1, d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    }

    static today() {
        const now = new Date();
        return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    }

    static addDays(iso, days) {
        const [y, m, d] = String(iso).slice(0, 10).split('-').map(Number);
        const date = new Date(y, m - 1, d + days);
        return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    }

    static nights(checkIn, checkOut) {
        const a = new Date(checkIn);
        const b = new Date(checkOut);
        return Math.max(1, Math.round((b - a) / 86400000));
    }

    static titleCase(str) {
        return String(str || '').replace(/_/g, ' ')
            .replace(/\b\w/g, ch => ch.toUpperCase());
    }

    /* ---------------- small components ---------------- */

    static badge(label, tone = 'neutral') {
        return DogBoardUI.el('span.badge', { class: `badge--${tone}` }, DogBoardUI.titleCase(label));
    }

    static statusTone(status) {
        return ({
            active: 'good', confirmed: 'good', paid: 'good', checked_in: 'info',
            pending: 'warn', requested: 'warn', open: 'warn', draft: 'neutral',
            cancelled: 'bad', void: 'bad', expired: 'bad', missing: 'bad',
            expiring: 'warn', no_expiry: 'warn', checked_out: 'neutral', archived: 'neutral'
        })[status] || 'neutral';
    }

    static empty(message, action = null) {
        return DogBoardUI.el('div.empty', DogBoardUI.el('p', message), action);
    }

    static spinner(label = 'Loading…') {
        return DogBoardUI.el('div.loading', DogBoardUI.el('div.spinner'), DogBoardUI.el('span', label));
    }

    /**
     * table({
     *   columns: [{ key, label, align, render(row) }],
     *   rows: [...],
     *   empty: 'Nothing here yet.',
     *   onRowClick(row)
     * })
     */
    static table({ columns, rows, empty = 'Nothing to show.', onRowClick = null, footer = null }) {
        if (!rows || rows.length === 0) return DogBoardUI.empty(empty);

        const head = DogBoardUI.el('tr', columns.map(col =>
            DogBoardUI.el('th', { class: col.align === 'right' ? 'num' : '' }, col.label)));

        const body = rows.map(row => {
            const tr = DogBoardUI.el('tr', {
                class: onRowClick ? 'clickable' : '',
                onclick: onRowClick ? () => onRowClick(row) : null
            }, columns.map(col => {
                const value = col.render ? col.render(row) : row[col.key];
                return DogBoardUI.el('td', { class: col.align === 'right' ? 'num' : '' },
                    value === null || value === undefined || value === '' ? '—' : value);
            }));
            return tr;
        });

        return DogBoardUI.el('div.table-wrap',
            DogBoardUI.el('table.table',
                DogBoardUI.el('thead', head),
                DogBoardUI.el('tbody', body),
                footer ? DogBoardUI.el('tfoot', footer) : null));
    }

    /* ---------------- form fields ---------------- */

    /**
     * field({ name, label, type, value, options, required, hint, placeholder })
     * Returns the wrapper element; read values back with DogBoardUI.readForm(formEl).
     */
    static field(config) {
        const {
            name, label, type = 'text', value = '', options = [],
            required = false, hint = '', placeholder = '', min, max, step, rows = 3
        } = config;

        let input;

        if (type === 'select') {
            input = DogBoardUI.el('select', { name, required },
                options.map(opt => {
                    const optValue = typeof opt === 'object' ? opt.value : opt;
                    const optLabel = typeof opt === 'object' ? opt.label : DogBoardUI.titleCase(opt);
                    return DogBoardUI.el('option', {
                        value: optValue,
                        selected: String(optValue) === String(value ?? '')
                    }, optLabel);
                }));
        } else if (type === 'textarea') {
            input = DogBoardUI.el('textarea', { name, required, placeholder, rows, value: value ?? '' });
        } else if (type === 'checkbox') {
            input = DogBoardUI.el('input', { name, type: 'checkbox', checked: !!value });
            return DogBoardUI.el('label.field.field--check', input,
                DogBoardUI.el('span', label),
                hint ? DogBoardUI.el('small.hint', hint) : null);
        } else {
            input = DogBoardUI.el('input', {
                name, type, placeholder, required,
                value: value ?? '',
                min, max, step
            });
        }

        return DogBoardUI.el('label.field',
            DogBoardUI.el('span.field__label', label,
                required ? DogBoardUI.el('em.req', '*') : null),
            input,
            hint ? DogBoardUI.el('small.hint', hint) : null);
    }

    /** A row of fields side by side. */
    static row(...fields) {
        return DogBoardUI.el('div.field-row', fields);
    }

    /** Read every named input in a container into a plain object. */
    static readForm(container) {
        const data = {};
        container.querySelectorAll('[name]').forEach(input => {
            if (input.type === 'checkbox') data[input.name] = input.checked;
            else data[input.name] = input.value.trim();
        });
        return data;
    }

    /* ---------------- toast & modal ---------------- */

    static toast(message, tone = 'info') {
        let host = document.querySelector('.toasts');
        if (!host) {
            host = DogBoardUI.el('div.toasts');
            document.body.appendChild(host);
        }

        const toast = DogBoardUI.el('div.toast', { class: `toast--${tone}` }, message);
        host.appendChild(toast);

        requestAnimationFrame(() => toast.classList.add('toast--in'));
        setTimeout(() => {
            toast.classList.remove('toast--in');
            setTimeout(() => toast.remove(), 250);
        }, tone === 'bad' ? 6000 : 3200);
    }

    /**
     * modal({ title, body, confirmLabel, onConfirm, width })
     * onConfirm may return false (or throw) to keep the modal open.
     */
    static modal({ title, body, confirmLabel = 'Save', cancelLabel = 'Cancel',
                   onConfirm = null, width = 560, danger = false }) {

        const content = typeof body === 'function' ? body() : body;

        const confirmBtn = onConfirm
            ? DogBoardUI.el('button.btn', { class: danger ? 'btn--danger' : 'btn--primary', type: 'button' },
                confirmLabel)
            : null;

        const overlay = DogBoardUI.el('div.modal-overlay');
        const panel = DogBoardUI.el('div.modal', { style: { maxWidth: `${width}px` } },
            DogBoardUI.el('header.modal__head',
                DogBoardUI.el('h2', title),
                DogBoardUI.el('button.modal__x', { type: 'button', onclick: close, title: 'Close' }, '×')),
            DogBoardUI.el('div.modal__body', content),
            DogBoardUI.el('footer.modal__foot',
                DogBoardUI.el('button.btn', { type: 'button', onclick: close }, cancelLabel),
                confirmBtn));

        overlay.appendChild(panel);
        overlay.addEventListener('mousedown', e => { if (e.target === overlay) close(); });

        function close() {
            overlay.remove();
            document.removeEventListener('keydown', onKey);
        }

        function onKey(e) {
            if (e.key === 'Escape') close();
        }

        if (confirmBtn) {
            confirmBtn.addEventListener('click', async () => {
                confirmBtn.disabled = true;
                const original = confirmBtn.textContent;
                confirmBtn.textContent = 'Working…';
                try {
                    const result = await onConfirm(content);
                    if (result !== false) close();
                } catch (err) {
                    DogBoardUI.toast(err.message || 'That did not work.', 'bad');
                } finally {
                    confirmBtn.disabled = false;
                    confirmBtn.textContent = original;
                }
            });
        }

        document.addEventListener('keydown', onKey);
        document.body.appendChild(overlay);

        const firstInput = panel.querySelector('input, select, textarea');
        if (firstInput) firstInput.focus();

        return { close, panel, content };
    }

    static confirm(message, { title = 'Are you sure?', confirmLabel = 'Delete', danger = true } = {}) {
        return new Promise(resolve => {
            const { close } = DogBoardUI.modal({
                title,
                body: DogBoardUI.el('p.confirm-text', message),
                confirmLabel,
                danger,
                width: 440,
                onConfirm: () => { resolve(true); return true; }
            });

            // If they dismiss it any other way, treat that as "no".
            const overlay = document.querySelector('.modal-overlay:last-of-type');
            if (overlay) {
                const observer = new MutationObserver(() => {
                    if (!document.body.contains(overlay)) {
                        observer.disconnect();
                        resolve(false);
                    }
                });
                observer.observe(document.body, { childList: true });
            }
            void close;
        });
    }
}
