#!/usr/bin/env node

/**
 * GUTS command-line interface.
 *
 * Lets a project repo that depends on GUTS build itself without living inside
 * the GUTS monorepo. Run from the project's own directory:
 *
 *     npx guts build              # build the client (and server/headless if configured)
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
  guts build [options]     Build the project in the current directory
  guts help                Show this help

Build options:
  --production, -p         Production build (minified)
  --watch, -w              Rebuild on file changes
  --target, -t <target>    Build only one target (client|server|headless|editor)
  --name <name>            Override the project name (defaults to folder name)
`);
}

if (!command || command === 'help' || command === '--help' || command === '-h') {
    usage();
    process.exit(command ? 0 : 1);
}

if (command !== 'build') {
    console.error(`Unknown command: ${command}`);
    usage();
    process.exit(1);
}

// --- build ---------------------------------------------------------------

const projectRoot = process.cwd();

// A GUTS project is identified by its game.json config.
const configPath = path.join(projectRoot, 'collections', 'settings', 'configs', 'game.json');
if (!fs.existsSync(configPath)) {
    console.error(`Error: no GUTS project here.`);
    console.error(`Expected ${path.relative(projectRoot, configPath)} relative to ${projectRoot}`);
    process.exit(1);
}

// Project name: explicit --name, else the folder name.
const nameFlagIdx = argv.findIndex(a => a === '--name');
const projectName = nameFlagIdx !== -1 ? argv[nameFlagIdx + 1] : path.basename(projectRoot);

// Pass through the remaining build flags, minus --name (build.js does not know it).
const passthrough = [];
for (let i = 1; i < argv.length; i++) {
    if (argv[i] === '--name') { i++; continue; }
    passthrough.push(argv[i]);
}

const buildScript = path.join(GUTS_ROOT, 'build', 'build.js');

// Run GUTS's build with this directory as the project root. cwd is GUTS_ROOT so
// webpack and its loaders resolve against the framework's node_modules.
const child = spawn(process.execPath, [buildScript, projectName, ...passthrough], {
    stdio: 'inherit',
    cwd: GUTS_ROOT,
    env: { ...process.env, GUTS_PROJECT_ROOT: projectRoot }
});

child.on('exit', code => process.exit(code == null ? 1 : code));
