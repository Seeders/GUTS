/**
 * AdminAccounts - the back-office "Accounts" section.
 *
 * Lists the two kinds of login: named staff logins and client portal accounts.
 * Staff create each other's logins here; they approve pending client sign-ups
 * (the fallback when no mailer is configured), reset passwords, and disable or
 * delete accounts. The shared DOGBOARD_ADMIN_PASSWORD keeps working as a
 * bootstrap regardless of what is in this list.
 */
class AdminAccounts {
    constructor(app, console_) {
        this.app = app;
        this.console = console_;
        this.api = app.api;
    }

    get ui() { return GUTS.DogBoardUI; }
    get forms() { return this.app.forms; }

    async render() {
        const { accounts } = await this.api.accounts();
        const { el } = this.ui;

        const staff = accounts.filter(a => a.role === 'staff');
        const clients = accounts.filter(a => a.role === 'client');
        const pending = clients.filter(a => a.status === 'pending');

        return el('div',
            el('header.page-head',
                el('h1', 'Accounts'),
                el('button.btn.btn--primary', { onclick: () => this.addStaff() }, '+ Add staff login')),

            pending.length
                ? el('section.panel',
                    el('header.panel__head', el('h2', `Pending client sign-ups (${pending.length})`)),
                    el('p.muted', 'These clients signed up but their email is not confirmed. Approve to let them in.'),
                    this.table(pending))
                : null,

            el('section.panel',
                el('header.panel__head', el('h2', 'Staff logins')),
                el('p.muted', 'Named staff logins. The shared password from DOGBOARD_ADMIN_PASSWORD still works as a fallback.'),
                this.table(staff)),

            el('section.panel',
                el('header.panel__head', el('h2', 'Client accounts')),
                this.table(clients)));
    }

    table(rows) {
        return this.ui.table({
            columns: [
                { label: 'Email', render: a => a.email },
                { label: 'Name', render: a => a.first_name
                    ? `${a.first_name} ${a.last_name}` : (a.role === 'staff' ? 'Staff' : '—') },
                { label: 'Role', render: a => this.ui.titleCase(a.role) },
                { label: 'Status', render: a => this.ui.badge(a.status, this.ui.statusTone(a.status)) },
                { label: 'Last login', render: a => a.last_login_at ? this.ui.date(a.last_login_at) : '—' },
                { label: '', render: a => this.actions(a) }
            ],
            rows,
            empty: 'None yet.'
        });
    }

    actions(a) {
        const { el } = this.ui;
        const btns = [];
        if (a.status === 'pending') {
            btns.push(el('button.btn.btn--sm.btn--primary', { onclick: () => this.approve(a) }, 'Approve'));
        }
        if (a.status === 'disabled') {
            btns.push(el('button.btn.btn--sm', { onclick: () => this.enable(a) }, 'Enable'));
        } else {
            btns.push(el('button.btn.btn--sm', { onclick: () => this.disable(a) }, 'Disable'));
        }
        btns.push(el('button.btn.btn--sm', { onclick: () => this.reset(a) }, 'Reset password'));
        btns.push(el('button.btn.btn--sm.btn--danger', { onclick: () => this.remove(a) }, 'Delete'));
        return el('div.row-actions', btns);
    }

    reload() { this.app.route(); }

    async approve(a) {
        await this.api.approveAccount(a.id);
        this.ui.toast('Account approved.', 'good');
        this.reload();
    }

    async enable(a) {
        await this.api.enableAccount(a.id);
        this.ui.toast('Account enabled.', 'good');
        this.reload();
    }

    async disable(a) {
        const ok = await this.ui.confirm(
            `Disable ${a.email}? They will be signed out and unable to log in.`,
            { title: 'Disable account', confirmLabel: 'Disable' });
        if (!ok) return;
        await this.api.disableAccount(a.id);
        this.ui.toast('Account disabled.', 'good');
        this.reload();
    }

    async reset(a) {
        const ok = await this.ui.confirm(
            `Reset the password for ${a.email}? A new temporary password will be shown, and they will be signed out.`,
            { title: 'Reset password', confirmLabel: 'Reset', danger: false });
        if (!ok) return;
        const result = await this.api.resetAccount(a.id);
        this.showTempPassword(a.email, result.temp_password);
    }

    async remove(a) {
        const ok = await this.ui.confirm(
            `Delete the login ${a.email}? This removes the account only, not the client's record.`,
            { title: 'Delete account', confirmLabel: 'Delete' });
        if (!ok) return;
        await this.api.deleteAccount(a.id);
        this.ui.toast('Account deleted.', 'good');
        this.reload();
    }

    addStaff() {
        const body = this.forms.renderFields('staffAccount', {});
        this.ui.modal({
            title: 'Add a staff login',
            body,
            confirmLabel: 'Create',
            onConfirm: async (container) => {
                const data = this.forms.read('staffAccount', container);
                if (!data.email || !data.password) {
                    this.ui.toast('Email and password are both required.', 'bad');
                    return false;
                }
                await this.api.createStaffAccount(data);
                this.ui.toast('Staff login created.', 'good');
                this.reload();
            }
        });
    }

    showTempPassword(email, password) {
        const { el } = this.ui;
        this.ui.modal({
            title: 'Temporary password',
            width: 460,
            body: el('div',
                el('p', `Share this temporary password with ${email}. They should change it after signing in.`),
                el('pre.temp-pass',
                    { style: { background: '#f3f4f6', padding: '0.75rem', borderRadius: '8px', fontSize: '1.1rem' } },
                    password)),
            onConfirm: null
        });
        this.reload();
    }
}
