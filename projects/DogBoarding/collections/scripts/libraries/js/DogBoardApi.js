/**
 * Thin wrapper around the JSON API.
 *
 * Holds the admin session token, attaches it to admin calls, and turns a
 * non-2xx response into a thrown Error carrying the server's message - so
 * every caller can just try/catch and show err.message.
 */
class DogBoardApi {
    constructor() {
        this.base = DogBoardApi.detectBase();
        this.token = localStorage.getItem('dogboard_token') || null;
        // The client portal is a separate identity from the staff console, so it
        // holds its own token - a client and a staff member can be signed in in
        // the same browser without one clobbering the other.
        this.portalToken = localStorage.getItem('dogboard_portal_token') || null;
    }

    /**
     * Where our API lives, which depends on who is hosting us.
     *
     *   root server (`npm run server`):  /projects/DogBoarding/index.html
     *                                    -> base '/projects/DogBoarding'
     *   standalone server:               /index.html  -> base ''
     *
     * Deriving it from the URL means the same bundle works under both without a
     * build flag.
     */
    static detectBase() {
        const match = window.location.pathname.match(/^(.*\/projects\/[^/]+)(\/|$)/);
        return match ? match[1] : '';
    }

    /* ---------------- plumbing ---------------- */

    setToken(token) {
        this.token = token;
        if (token) localStorage.setItem('dogboard_token', token);
        else localStorage.removeItem('dogboard_token');
    }

    get isAuthed() {
        return !!this.token;
    }

    async request(method, path, body = null, opts = {}) {
        const headers = {};
        if (this.token) headers.Authorization = `Bearer ${this.token}`;

        let payload = body;
        if (body && !(body instanceof FormData)) {
            headers['Content-Type'] = 'application/json';
            payload = JSON.stringify(body);
        }

        const response = await fetch(`${this.base}${path}`, {
            method,
            headers,
            body: payload
        });

        // A 401 from an admin route means our token is dead: drop it and let the
        // app show the login wall again.
        //
        // The login route is the exception. A 401 from it means "wrong
        // password", not "your session expired" - reporting that as an expired
        // session is both wrong and baffling to whoever just mistyped.
        const isLoginAttempt = path.includes('/session/login');

        if (response.status === 401 && path.startsWith('/api/admin') && !isLoginAttempt) {
            this.setToken(null);
            window.dispatchEvent(new CustomEvent('dogboard:unauthorized'));
        }

        if (opts.raw) return response;

        const isJson = (response.headers.get('content-type') || '').includes('application/json');
        const data = isJson ? await response.json() : await response.text();

        if (!response.ok) {
            const message = (data && data.error) || `Request failed (${response.status}).`;
            const error = new Error(message);
            error.status = response.status;
            throw error;
        }
        return data;
    }

    get(path) { return this.request('GET', path); }
    post(path, body) { return this.request('POST', path, body); }
    put(path, body) { return this.request('PUT', path, body); }
    del(path) { return this.request('DELETE', path); }

    /** Build a query string, dropping empty values. */
    static qs(params) {
        const search = new URLSearchParams();
        for (const [key, value] of Object.entries(params || {})) {
            if (value !== undefined && value !== null && value !== '') search.set(key, value);
        }
        const str = search.toString();
        return str ? `?${str}` : '';
    }

    /* ---------------- public ---------------- */

    info() { return this.get('/api/public/info'); }

    submitIntake(payload, files) {
        const form = new FormData();
        form.append('payload', JSON.stringify(payload));
        for (const file of files) form.append('records', file);
        return this.request('POST', '/api/public/intake', form);
    }

    /* ---------------- session ---------------- */

    async login(password) {
        const session = await this.post('/api/admin/session/login', { password });
        this.setToken(session.token);
        return session;
    }

    async logout() {
        try {
            await this.post('/api/admin/session/logout', {});
        } finally {
            this.setToken(null);
        }
    }

    /**
     * Is the token we are carrying still worth anything?
     *
     * A token in localStorage outlives the database it was issued against - drop
     * the database (or let the session expire) and the browser still holds a key
     * to a lock that no longer exists. Without this check the app would boot,
     * assume it was logged in, ask for the dashboard, and take a 401 in the face.
     *
     * /session/me is deliberately not behind requireAdmin, so it answers the
     * question instead of refusing to.
     */
    async verifySession() {
        if (!this.token) return false;

        try {
            const { authenticated } = await this.get('/api/admin/session/me');
            if (!authenticated) this.setToken(null);
            return !!authenticated;
        } catch {
            // Can't reach the server, or it said no. Either way, don't pretend.
            this.setToken(null);
            return false;
        }
    }

    /* ---------------- admin ---------------- */

    dashboard() { return this.get('/api/admin/dashboard'); }

    /** Read-only: the business config is a collection, edited in the GUTS editor. */
    settings() { return this.get('/api/admin/settings'); }
    changePassword(current, next) {
        return this.post('/api/admin/settings/password',
            { current_password: current, new_password: next });
    }

    clients(params) { return this.get(`/api/admin/clients${DogBoardApi.qs(params)}`); }
    client(id) { return this.get(`/api/admin/clients/${id}`); }
    createClient(data) { return this.post('/api/admin/clients', data); }
    updateClient(id, data) { return this.put(`/api/admin/clients/${id}`, data); }
    deleteClient(id) { return this.del(`/api/admin/clients/${id}`); }

    vets() { return this.get('/api/admin/vets'); }
    createVet(data) { return this.post('/api/admin/vets', data); }
    updateVet(id, data) { return this.put(`/api/admin/vets/${id}`, data); }
    deleteVet(id) { return this.del(`/api/admin/vets/${id}`); }

    pets(params) { return this.get(`/api/admin/pets${DogBoardApi.qs(params)}`); }
    pet(id) { return this.get(`/api/admin/pets/${id}`); }
    createPet(data) { return this.post('/api/admin/pets', data); }
    updatePet(id, data) { return this.put(`/api/admin/pets/${id}`, data); }
    deletePet(id) { return this.del(`/api/admin/pets/${id}`); }

    addRecord(petId, formData) {
        return this.request('POST', `/api/admin/pets/${petId}/records`, formData);
    }
    updateRecord(id, data) { return this.put(`/api/admin/records/${id}`, data); }
    deleteRecord(id) { return this.del(`/api/admin/records/${id}`); }

    /** Files need the token in the URL, since they open in a new tab. */
    recordFileUrl(id) { return `${this.base}/api/admin/files/record/${id}?token=${this.token}`; }
    receiptFileUrl(id) { return `${this.base}/api/admin/files/receipt/${id}?token=${this.token}`; }
    invoicePrintUrl(id) { return `${this.base}/api/admin/invoices/${id}/print?token=${this.token}`; }
    exportUrl(kind, params) {
        return `${this.base}/api/admin/reports/export/${kind}` +
            DogBoardApi.qs({ ...params, token: this.token });
    }

    bookings(params) { return this.get(`/api/admin/bookings${DogBoardApi.qs(params)}`); }
    booking(id) { return this.get(`/api/admin/bookings/${id}`); }
    createBooking(data) { return this.post('/api/admin/bookings', data); }
    updateBooking(id, data) { return this.put(`/api/admin/bookings/${id}`, data); }
    deleteBooking(id) { return this.del(`/api/admin/bookings/${id}`); }
    addBookingCharges(id, data) { return this.post(`/api/admin/bookings/${id}/charges`, data); }

    /** Read-only: the rate card IS the serviceCatalog collection. */
    services(all) { return this.get(`/api/admin/services${all ? '?all=1' : ''}`); }

    serviceEvents(params) { return this.get(`/api/admin/service-events${DogBoardApi.qs(params)}`); }
    createServiceEvent(data) { return this.post('/api/admin/service-events', data); }
    updateServiceEvent(id, data) { return this.put(`/api/admin/service-events/${id}`, data); }
    deleteServiceEvent(id) { return this.del(`/api/admin/service-events/${id}`); }

    invoices(params) { return this.get(`/api/admin/invoices${DogBoardApi.qs(params)}`); }
    billable() { return this.get('/api/admin/invoices/billable'); }
    invoice(id) { return this.get(`/api/admin/invoices/${id}`); }
    createInvoice(data) { return this.post('/api/admin/invoices', data); }
    voidInvoice(id) { return this.post(`/api/admin/invoices/${id}/void`, {}); }
    issueInvoice(id) { return this.post(`/api/admin/invoices/${id}/issue`, {}); }

    payments(params) { return this.get(`/api/admin/payments${DogBoardApi.qs(params)}`); }
    createPayment(data) { return this.post('/api/admin/payments', data); }
    updatePayment(id, data) { return this.put(`/api/admin/payments/${id}`, data); }
    deletePayment(id) { return this.del(`/api/admin/payments/${id}`); }

    expenses(params) { return this.get(`/api/admin/expenses${DogBoardApi.qs(params)}`); }
    expenseCategories() { return this.get('/api/admin/expenses/categories'); }
    createExpense(formData) { return this.request('POST', '/api/admin/expenses', formData); }
    updateExpense(id, formData) { return this.request('PUT', `/api/admin/expenses/${id}`, formData); }
    deleteExpense(id) { return this.del(`/api/admin/expenses/${id}`); }

    reportPnl(params) { return this.get(`/api/admin/reports/pnl${DogBoardApi.qs(params)}`); }
    reportAr() { return this.get('/api/admin/reports/ar'); }
    reportServices(params) { return this.get(`/api/admin/reports/services${DogBoardApi.qs(params)}`); }
    reportOccupancy(params) { return this.get(`/api/admin/reports/occupancy${DogBoardApi.qs(params)}`); }
    reportVaccinations() { return this.get('/api/admin/reports/vaccinations'); }

    /** The month view: per-night occupancy against the kennels' capacity. */
    calendar(params) { return this.get(`/api/admin/calendar${DogBoardApi.qs(params)}`); }

    /* ---------------- accounts (staff-managed) ---------------- */

    accounts() { return this.get('/api/admin/accounts'); }
    createStaffAccount(data) { return this.post('/api/admin/accounts/staff', data); }
    createClientAccount(data) { return this.post('/api/admin/accounts/client', data); }
    approveAccount(id) { return this.post(`/api/admin/accounts/${id}/approve`, {}); }
    disableAccount(id) { return this.post(`/api/admin/accounts/${id}/disable`, {}); }
    enableAccount(id) { return this.post(`/api/admin/accounts/${id}/enable`, {}); }
    resetAccount(id) { return this.post(`/api/admin/accounts/${id}/reset`, {}); }
    deleteAccount(id) { return this.del(`/api/admin/accounts/${id}`); }

    /* ---------------- client portal ---------------- */

    setPortalToken(token) {
        this.portalToken = token;
        if (token) localStorage.setItem('dogboard_portal_token', token);
        else localStorage.removeItem('dogboard_portal_token');
    }

    /**
     * The portal's own request path. It carries the portal token (not the staff
     * token), and a 401 from a guarded portal route drops that token and fires
     * dogboard:portal-unauthorized - mirroring how the admin side behaves, but
     * for the client identity, so the two never interfere.
     */
    async portalRequest(method, path, body = null) {
        const headers = {};
        if (this.portalToken) headers.Authorization = `Bearer ${this.portalToken}`;

        let payload = body;
        if (body && !(body instanceof FormData)) {
            headers['Content-Type'] = 'application/json';
            payload = JSON.stringify(body);
        }

        const response = await fetch(`${this.base}${path}`, { method, headers, body: payload });

        const isAuthRoute = path.includes('/session/');
        if (response.status === 401 && path.startsWith('/api/portal') && !isAuthRoute) {
            this.setPortalToken(null);
            window.dispatchEvent(new CustomEvent('dogboard:portal-unauthorized'));
        }

        const isJson = (response.headers.get('content-type') || '').includes('application/json');
        const data = isJson ? await response.json() : await response.text();

        if (!response.ok) {
            const message = (data && data.error) || `Request failed (${response.status}).`;
            const error = new Error(message);
            error.status = response.status;
            throw error;
        }
        return data;
    }

    portalMe() { return this.portalRequest('GET', '/api/portal/session/me'); }
    async portalSignup(email, password) {
        const result = await this.portalRequest('POST', '/api/portal/session/signup', { email, password });
        if (result.token) this.setPortalToken(result.token); // signup logs you straight in
        return result;
    }
    portalOnboarding(payload) { return this.portalRequest('POST', '/api/portal/onboarding', payload); }
    async portalLogin(email, password) {
        const result = await this.portalRequest('POST', '/api/portal/session/login', { email, password });
        this.setPortalToken(result.token);
        return result;
    }
    async portalLogout() {
        try { await this.portalRequest('POST', '/api/portal/session/logout', {}); }
        finally { this.setPortalToken(null); }
    }

    portalOverview() { return this.portalRequest('GET', '/api/portal/overview'); }
    portalProfile() { return this.portalRequest('GET', '/api/portal/profile'); }
    portalUpdateProfile(data) { return this.portalRequest('PUT', '/api/portal/profile', data); }
    portalChangePassword(current, next) {
        return this.portalRequest('POST', '/api/portal/password',
            { current_password: current, new_password: next });
    }

    portalPets() { return this.portalRequest('GET', '/api/portal/pets'); }
    portalCreatePet(data) { return this.portalRequest('POST', '/api/portal/pets', data); }
    portalUpdatePet(id, data) { return this.portalRequest('PUT', `/api/portal/pets/${id}`, data); }
    portalDeletePet(id) { return this.portalRequest('DELETE', `/api/portal/pets/${id}`); }
    portalAddRecord(petId, formData) { return this.portalRequest('POST', `/api/portal/pets/${petId}/records`, formData); }
    portalDeleteRecord(id) { return this.portalRequest('DELETE', `/api/portal/records/${id}`); }
    portalRecordFileUrl(id) { return `${this.base}/api/portal/files/record/${id}?token=${this.portalToken}`; }

    portalVets() { return this.portalRequest('GET', '/api/portal/vets'); }
    portalCreateVet(data) { return this.portalRequest('POST', '/api/portal/vets', data); }
    portalUpdateVet(id, data) { return this.portalRequest('PUT', `/api/portal/vets/${id}`, data); }

    portalBilling() { return this.portalRequest('GET', '/api/portal/billing'); }
    portalInvoice(id) { return this.portalRequest('GET', `/api/portal/invoices/${id}`); }

    portalAvailability(params) {
        return this.portalRequest('GET', `/api/portal/availability${DogBoardApi.qs(params)}`);
    }
    portalCreateBooking(data) { return this.portalRequest('POST', '/api/portal/bookings', data); }
    portalBooking(id) { return this.portalRequest('GET', `/api/portal/bookings/${id}`); }
    portalUpdateBooking(id, data) { return this.portalRequest('PUT', `/api/portal/bookings/${id}`, data); }
    portalCancelBooking(id) { return this.portalRequest('DELETE', `/api/portal/bookings/${id}`); }
}
