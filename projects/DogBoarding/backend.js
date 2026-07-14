/**
 * DogBoarding - backend entry point.
 *
 * This is the convention the root server looks for: any project may export a
 * `mount(app, { base })` from `projects/<Name>/backend.js`, and the root server
 * (`npm run server`) will mount it while it is serving that project's client.
 *
 * `base` is the URL prefix the project is served under:
 *   - under the root server:  '/projects/DogBoarding'
 *   - standalone:             ''
 *
 * Every route is declared relative to that prefix, so the same code serves both
 * without knowing which it is in.
 */

const express = require('express');

const db = require('./server/db');
const auth = require('./server/auth');
const publicRoutes = require('./server/routes.public');
const { sessionRouter, adminRouter } = require('./server/routes.admin');
const { portalSessionRouter, portalRouter } = require('./server/routes.portal');
const { webhook: stripeWebhook } = require('./server/routes.stripe');
const { handleUploadError } = require('./server/uploads');

function mount(app, { base = '' } = {}) {
    db.open();
    auth.ensureAdminPassword();

    const router = express.Router();

    // Stripe verifies its webhook against the exact bytes it sent, so this route
    // must see the RAW body - it goes BEFORE the JSON parser that would otherwise
    // consume and re-shape it. It has no auth of its own; the signature is the auth.
    router.post('/api/stripe/webhook', express.raw({ type: '*/*' }), stripeWebhook);

    // The root server already parses JSON, but a standalone host might not, and
    // parsing twice is harmless.
    router.use(express.json({ limit: '1mb' }));
    router.use(express.urlencoded({ extended: true }));

    /**
     * The bundle must never be served from a stale cache.
     *
     * The interfaces ship real <form> markup now, so a browser holding an old
     * game.js can render a login form that nothing has bound a handler to - and
     * a form nobody bound submits natively, as GET, with the password in the URL.
     * The markup fails safe on its own (see admin.html), but the honest fix is
     * to stop the browser reusing a bundle that no longer matches the app.
     *
     * no-cache means "revalidate before reusing", not "never cache": a 304 is
     * still cheap.
     */
    router.get('/dist/client/game.js', (req, res, next) => {
        res.set('Cache-Control', 'no-cache');
        next();
    });

    router.use('/api/public', publicRoutes);
    router.use('/api/admin/session', sessionRouter);
    router.use('/api/admin', auth.requireAdmin, adminRouter);

    // Client portal: an unauthenticated door (signup/login/verify) and everything
    // behind it scoped, by requireClient, to the logged-in client's own record.
    router.use('/api/portal/session', portalSessionRouter);
    router.use('/api/portal', auth.requireClient, portalRouter);

    router.get('/api/health', (req, res) => {
        res.json({ ok: true, service: 'dogboarding', base, time: db.nowIso() });
    });

    // The database and the uploaded vet records live in this project's secure/
    // folder. They are reachable only through the authenticated
    // /api/admin/files routes - never as static files. The root server already
    // denies projects/*/secure, but a standalone host might not, so say it here
    // too: two locks on the door that matters.
    router.use('/secure', (req, res) => res.status(403).json({ error: 'Forbidden.' }));
    router.use('/server', (req, res) => res.status(403).json({ error: 'Forbidden.' }));

    router.use(handleUploadError);

    // eslint-disable-next-line no-unused-vars
    router.use((err, req, res, next) => {
        const status = err.status || 500;
        if (status >= 500) console.error('[dogboarding]', err);
        res.status(status).json({ error: err.message || 'Something went wrong.' });
    });

    app.use(base || '/', router);

    return {
        name: 'DogBoarding',
        routes: `${base}/api`,
        db: db.DB_PATH
    };
}

module.exports = { mount };
