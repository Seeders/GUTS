/**
 * DogBoarding - standalone server.
 *
 * Optional. The usual way to run this is from the repo root:
 *
 *     npm run server        # hosts every project, including this one
 *
 * ...which mounts backend.js automatically. This file exists for running the
 * project on its own (a deploy that ships only the boarding app, say). It uses
 * the same backend.js, so the two hosts cannot drift apart.
 *
 *     node projects/DogBoarding/server.js
 *
 * Requires Node 22+ for the built-in node:sqlite.
 */

const express = require('express');
const path = require('path');

const db = require('./server/db');
const backend = require('./backend');

const app = express();
const PORT = process.env.PORT || 3000;

app.set('trust proxy', true);

// The API, served at the root: this project is the only thing here.
backend.mount(app, { base: '' });

// The built client. index.html references ./dist/client/game.js, so the project
// directory itself is what gets served.
app.use(express.static(__dirname, { index: 'index.html' }));

// Client-side routing: anything that is not an API call gets the shell.
app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api/')) return next();
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, () => {
    const settings = db.getSettings();
    console.log('');
    console.log(`  ${settings.business_name} - boarding management (standalone)`);
    console.log(`  Public site:   http://localhost:${PORT}/`);
    console.log(`  Admin console: http://localhost:${PORT}/#/admin`);
    console.log(`  Database:      ${db.DB_PATH}`);
    console.log('');
});
