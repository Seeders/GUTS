/**
 * Thin wrapper around the JSON API.
 *
 * Holds the admin session token, attaches it to admin calls, and turns a
 * non-2xx response into a thrown Error carrying the server's message - so
 * every caller can just try/catch and show err.message.
 */
class DogBoardApi {
    constructor() {
        this.base = '';
        this.token = localStorage.getItem('dogboard_token') || null;
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

        if (response.status === 401 && path.startsWith('/api/admin')) {
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

    /* ---------------- admin ---------------- */

    dashboard() { return this.get('/api/admin/dashboard'); }

    settings() { return this.get('/api/admin/settings'); }
    saveSettings(data) { return this.put('/api/admin/settings', data); }
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
    recordFileUrl(id) { return `/api/admin/files/record/${id}?token=${this.token}`; }
    receiptFileUrl(id) { return `/api/admin/files/receipt/${id}?token=${this.token}`; }
    invoicePrintUrl(id) { return `/api/admin/invoices/${id}/print?token=${this.token}`; }
    exportUrl(kind, params) {
        return `/api/admin/reports/export/${kind}${DogBoardApi.qs({ ...params, token: this.token })}`;
    }

    bookings(params) { return this.get(`/api/admin/bookings${DogBoardApi.qs(params)}`); }
    booking(id) { return this.get(`/api/admin/bookings/${id}`); }
    createBooking(data) { return this.post('/api/admin/bookings', data); }
    updateBooking(id, data) { return this.put(`/api/admin/bookings/${id}`, data); }
    deleteBooking(id) { return this.del(`/api/admin/bookings/${id}`); }
    addBookingCharges(id, data) { return this.post(`/api/admin/bookings/${id}/charges`, data); }

    services(all) { return this.get(`/api/admin/services${all ? '?all=1' : ''}`); }
    createService(data) { return this.post('/api/admin/services', data); }
    updateService(id, data) { return this.put(`/api/admin/services/${id}`, data); }
    deleteService(id) { return this.del(`/api/admin/services/${id}`); }

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
}
