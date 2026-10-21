#!/usr/bin/env node

/**
 * GUTS command-line interface.
 *
 * Lets a project repo that depends on GUTS create, build and run itself
 * without living inside the GUTS monorepo:
 *
 *     npx guts new my-game              # scaffold a project (--template game|app)
 *     npx guts dev                      # build, watch, serve with live reload
 *     npx guts build                    # build the client (and server/headless if configured)
 *     npx guts build --production
 *     npx guts build --watch
 *     npx guts build --target client
 *
 * The project's collections are read from the current working directory; the
 * framework (engine/, global/, node_modules/) is read from the installed GUTS
 * package. The project name defaults to the current directory's name.
 */

const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const { GUTS_ROOT } = require('../build/paths');

const argv = process.argv.slice(2);
const command = argv[0];

function usage() {
    console.log(`
GUTS CLI

Usage:
  guts new <folder> [options]   Create a new project in <folder>
  guts dev [options]            Build, rebuild on change, and serve with live reload
  guts build [options]          Build the project in the current directory
  guts fork-diff [projects...]  Show project files that shadow engine files and how they differ
                                (--out report.md, --engine <dir>; see build/fork-diff.js)
  guts help                     Show this help

New options:
  --template <name>        game (default): an ECS game with a Three.js view
                           app: a plain app with one screen

Dev options:
  --port <n>               Port to serve on (default: PORT or 3000)
  --no-serve               Only build and watch (for projects with their own server.js)

Build options:
  --production, -p         Production build (minified)
  --watch, -w              Rebuild on file changes
  --target, -t <target>    Build only one target (client|server|headless|editor)
  --strict                 Fail if a config names something that doesn't exist
  --name <name>            Override the project name (defaults to folder name)
`);
}

/** Value of a `--flag value` argument, or undefined. */
function flagValue(flag) {
    const i = argv.indexOf(flag);
    return i !== -1 ? argv[i + 1] : undefined;
}

const commands = { new: runNew, dev: runDev, build: runBuild, 'fork-diff': runForkDiff };

if (!command || command === 'help' || command === '--help' || command === '-h') {
    usage();
    process.exit(command ? 0 : 1);
}
if (!commands[command]) {
    console.error(`Unknown command: ${command}`);
    usage();
    process.exit(1);
}
commands[command]();

// --- fork-diff -----------------------------------------------------------

function runForkDiff() {
    const child = spawn(process.execPath, [path.join(GUTS_ROOT, 'build', 'fork-diff.js'), ...argv.slice(1)], { stdio: 'inherit' });
    child.on('exit', code => process.exit(code ?? 1));
}

// --- new -----------------------------------------------------------------

function runNew() {
    const folder = argv[1];
    if (!folder || folder.startsWith('-')) {
        console.error('Usage: guts new <folder> [--template game|app]');
        process.exit(1);
    }

    const template = flagValue('--template') || 'game';
    const templateDir = path.join(GUTS_ROOT, 'templates', template);
    if (!fs.existsSync(templateDir)) {
        const available = fs.readdirSync(path.join(GUTS_ROOT, 'templates')).join(', ');
        console.error(`Unknown template "${template}". Available: ${available}`);
        process.exit(1);
    }

    const target = path.resolve(process.cwd(), folder);
    if (fs.existsSync(target) && fs.readdirSync(target).length > 0) {
        console.error(`Error: ${target} already exists and is not empty.`);
        process.exit(1);
    }

    const base = path.basename(target);
    const version = require('../package.json').version;
    const replacements = {
        __NAME__: base.toLowerCase().replace(/[^a-z0-9._-]+/g, '-'),
        __TITLE__: base
            .replace(/([a-z])([A-Z])/g, '$1 $2')
            .split(/[-_\s]+/)
            .filter(Boolean)
            .map(w => w[0].toUpperCase() + w.slice(1))
            .join(' '),
        __GUTS_DEPENDENCY__: `https://github.com/Seeders/GUTS/releases/download/v${version}/guts-${version}.tgz`
    };

    copyTemplate(templateDir, target, replacements);

    console.log(`
Created ${replacements.__TITLE__} (${template}) in ${target}

  cd ${path.relative(process.cwd(), target) || '.'}
  npm install
  npm run dev
`);
}

function copyTemplate(from, to, replacements) {
    fs.mkdirSync(to, { recursive: true });
    for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
        const src = path.join(from, entry.name);
        // npm drops .gitignore from published packages, so templates ship it as "gitignore".
        const dest = path.join(to, entry.name === 'gitignore' ? '.gitignore' : entry.name);
        if (entry.isDirectory()) {
            copyTemplate(src, dest, replacements);
            continue;
        }
        let text = fs.readFileSync(src, 'utf8');
        for (const [key, value] of Object.entries(replacements)) {
            text = text.split(key).join(value);
        }
        fs.writeFileSync(dest, text);
    }
}

// --- build ---------------------------------------------------------------

/** The project in the current directory, or exit with an error. */
function requireProject() {
    const projectRoot = process.cwd();

    // A GUTS project is identified by its game.json config.
    const configPath = path.join(projectRoot, 'collections', 'settings', 'configs', 'game.json');
    if (!fs.existsSync(configPath)) {
        console.error(`Error: no GUTS project here.`);
        console.error(`Expected ${path.relative(projectRoot, configPath)} relative to ${projectRoot}`);
        console.error(`Create one with: guts new <folder>`);
        process.exit(1);
    }

    // Project name: explicit --name, else the folder name.
    const projectName = flagValue('--name') || path.basename(projectRoot);
    return { projectRoot, projectName };
}

/**
 * Run GUTS's build.js for the project; returns the child process. With `ipc`,
 * the child gets a channel to this process and exits when it closes, so a watch
 * build never outlives `guts dev` (Windows doesn't kill child processes with
 * their parent).
 */
function spawnBuild(projectRoot, projectName, flags, { ipc = false } = {}) {
    const buildScript = path.join(GUTS_ROOT, 'build', 'build.js');

    // Run GUTS's build with this directory as the project root. cwd is GUTS_ROOT so
    // webpack and its loaders resolve against the framework's node_modules.
    return spawn(process.execPath, [buildScript, projectName, ...flags], {
        stdio: ipc ? ['inherit', 'inherit', 'inherit', 'ipc'] : 'inherit',
        cwd: GUTS_ROOT,
        env: { ...process.env, GUTS_PROJECT_ROOT: projectRoot }
    });
}

/** argv after the command, minus the flags (and their values) the CLI itself handles. */
function passthroughFlags(ownFlags) {
    const out = [];
    for (let i = 1; i < argv.length; i++) {
        if (ownFlags.includes(argv[i])) {
            if (argv[i] !== '--no-serve') i++;
            continue;
        }
        out.push(argv[i]);
    }
    return out;
}

function runBuild() {
    const { projectRoot, projectName } = requireProject();
    const child = spawnBuild(projectRoot, projectName, passthroughFlags(['--name']));
    child.on('exit', code => process.exit(code == null ? 1 : code));
}

// --- dev -----------------------------------------------------------------

function runDev() {
    const { projectRoot, projectName } = requireProject();
    const flags = passthroughFlags(['--name', '--port', '--no-serve']);
    if (!flags.includes('--target') && !flags.includes('-t')) flags.push('--target', 'client');
    flags.push('--watch');

    // webpack's watcher only sees files the generated entries already import, and the
    // entries are generated when a build starts. Adding or removing a collection file,
    // or editing a config (which lists libraries and systems), needs a fresh build.
    let build = null;
    const start = () => {
        build = spawnBuild(projectRoot, projectName, flags, { ipc: true });
        const self = build;
        build.on('exit', code => { if (build === self) process.exit(code == null ? 1 : code); });
    };
    const restart = (why) => {
        console.log(`\n🔁 ${why}: restarting the build\n`);
        const old = build;
        build = null;
        old.kill();
        start();
    };
    start();

    // Files that exist now. Editors that save by writing a temp file and renaming it fire
    // 'rename' on every save, so only a file appearing or disappearing counts.
    const collectionsDir = path.join(projectRoot, 'collections');
    const known = new Set(fs.readdirSync(collectionsDir, { recursive: true }).map(String));

    let restartTimer = null;
    fs.watch(collectionsDir, { recursive: true }, (event, file) => {
        if (!file) return;
        const isConfig = /settings[\\/]configs[\\/]/.test(file);
        if (event === 'rename') {
            const exists = fs.existsSync(path.join(collectionsDir, file));
            if (exists === known.has(file) && !isConfig) return;
            if (exists) known.add(file); else known.delete(file);
        } else if (!isConfig) {
            return;
        }
        clearTimeout(restartTimer);
        restartTimer = setTimeout(() => restart(isConfig ? `${file} changed` : `${file} added or removed`), 300);
    });

    const stop = (code = 0) => { build?.kill(); process.exit(code); };
    process.on('SIGINT', () => stop());
    process.on('SIGTERM', () => stop());

    if (argv.includes('--no-serve')) return;
    serveWithLiveReload(projectRoot, Number(flagValue('--port') || process.env.PORT || 3000), stop);
}

/**
 * Serve the project folder, and reload open pages whenever the client bundle is
 * rewritten. Pages get a small script (added to index.html as it is served) that
 * listens on a server-sent-events stream.
 */
function serveWithLiveReload(projectRoot, port, stop) {
    const express = require('express');
    const app = express();
    const clients = new Set();

    const reloadScript = `<script>(() => {
    const events = new EventSource('/__guts/reload');
    events.onmessage = () => location.reload();
})();</script>`;

    app.get('/__guts/reload', (req, res) => {
        res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
        res.flushHeaders();
        res.write(': connected\n\n');
        clients.add(res);
        req.on('close', () => clients.delete(res));
    });

    app.get(['/', '/index.html'], (req, res, next) => {
        const indexPath = path.join(projectRoot, 'index.html');
        if (!fs.existsSync(indexPath)) return next();
        const html = fs.readFileSync(indexPath, 'utf8');
        res.type('html').send(html.includes('</body>') ? html.replace('</body>', `${reloadScript}\n</body>`) : html + reloadScript);
    });

    app.use(express.static(projectRoot, { etag: false, lastModified: false, setHeaders: res => res.set('Cache-Control', 'no-store') }));

    // Watch the bundle by polling: it is replaced on every rebuild, and the
    // folder may not exist until the first build finishes.
    const bundle = path.join(projectRoot, 'dist', 'client', 'game.js');
    let timer = null;
    fs.watchFile(bundle, { interval: 300 }, (curr, prev) => {
        if (curr.mtimeMs === prev.mtimeMs || curr.size === 0) return;
        clearTimeout(timer);
        timer = setTimeout(() => {
            for (const res of clients) res.write('data: reload\n\n');
        }, 250);
    });

    const server = app.listen(port, () => {
        console.log(`\n🌐 Serving ${projectRoot}\n   http://localhost:${port}/  (reloads after each rebuild)\n`);
    });
    server.on('error', (error) => {
        if (error.code === 'EADDRINUSE') {
            console.error(`\n❌ Port ${port} is already in use. Stop whatever is using it, or run: guts dev --port <another>\n`);
        } else {
            console.error('\n❌ Dev server failed:', error.message);
        }
        stop(1);
    });
}
