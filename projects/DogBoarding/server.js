/**
 * DogBoarding - server.
 *
 *   node projects/DogBoarding/server.js
 *
 * Serves the built GUTS client out of dist/client, plus the JSON API that
 * actually runs the business.
 *
 * Requires Node 22+ for the built-in node:sqlite module.
 */

const express = require('express');
const path = require('path');

const db = require('./server/db');
const auth = require('./server/auth');
const publicRoutes = require('./server/routes.public');
const { sessionRouter, adminRouter } = require('./server/routes.admin');
const { handleUploadError } = require('./server/uploads');

const app = express();
const PORT = process.env.PORT || 3000;

app.set('trust proxy', true);
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));

/* ------------------------------------------------------------------ */
/* API                                                                  */
/* ------------------------------------------------------------------ */

app.use('/api/public', publicRoutes);
app.use('/api/admin/session', sessionRouter);
app.use('/api/admin', auth.requireAdmin, adminRouter);

app.get('/api/health', (req, res) => {
    res.json({ ok: true, service: 'dogboarding', time: db.nowIso() });
});

/* ------------------------------------------------------------------ */
/* Static client                                                        */
/* ------------------------------------------------------------------ */

// The built bundle. index.html at the project root references ./dist/client/game.js,
// so we serve the project directory itself.
app.use(express.static(__dirname, {
    index: 'index.html',
    // The uploads live under data/, which must never be reachable this way.
    setHeaders(res, filePath) {
        if (filePath.includes(`${path.sep}data${path.sep}`)) res.status(403).end();
    }
}));

// Never serve the database or uploaded vet records as static files.
app.use('/data', (req, res) => res.status(403).json({ error: 'Forbidden.' }));
app.use('/server', (req, res) => res.status(403).json({ error: 'Forbidden.' }));

// Everything else is client-side routing; hand back the shell.
app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api/')) return next();
    res.sendFile(path.join(__dirname, 'index.html'));
});

/* ------------------------------------------------------------------ */
/* Errors                                                               */
/* ------------------------------------------------------------------ */

app.use(handleUploadError);

app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
    const status = err.status || 500;
    if (status >= 500) console.error('[dogboarding]', err);
    res.status(status).json({ error: err.message || 'Something went wrong.' });
});

/* ------------------------------------------------------------------ */
/* Boot                                                                 */
/* ------------------------------------------------------------------ */

db.open();
auth.ensureAdminPassword();

app.listen(PORT, () => {
    const settings = db.getSettings();
    console.log('');
    console.log(`  ${settings.business_name} - boarding management`);
    console.log(`  Public site:   http://localhost:${PORT}/`);
    console.log(`  Admin console: http://localhost:${PORT}/#/admin`);
    console.log(`  Database:      ${db.DB_PATH}`);
    console.log('');
});
