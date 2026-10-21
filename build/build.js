#!/usr/bin/env node

/**
 * Build Script for GUTS Game Engine
 * Can be called from editor or command line
 */

const webpack = require('webpack');
const path = require('path');
const fs = require('fs');
const { copyResources } = require('./copy-resources');
const { resolveProjectRoot } = require('./paths');

// Parse command line arguments
const args = process.argv.slice(2);

// Filter out flags to find project name
const nonFlagArgs = args.filter(arg => !arg.startsWith('-'));
const projectName = nonFlagArgs[0];

const watch = args.includes('--watch') || args.includes('-w');
const production = args.includes('--production') || args.includes('-p');
const strict = args.includes('--strict');

// Parse --target flag (e.g., --target server)
const targetIndex = args.findIndex(arg => arg === '--target' || arg === '-t');
const targetFilter = targetIndex !== -1 ? args[targetIndex + 1] : null;
const validTargets = ['client', 'server', 'headless', 'editor'];

// Show usage if no project specified
if (!projectName) {
    console.log(`
Usage: node build/build.js <project-name> [options]

Options:
  --watch, -w              Watch for changes and rebuild
  --production, -p         Build in production mode
  --target, -t <target>    Build only one target (client|server|headless|editor)
  --strict                 Fail if a config names a library, system or module that doesn't exist

Examples:
  node build/build.js TurnBasedWarfare
  node build/build.js TurnBasedWarfare --target server
  node build/build.js HelloWorld --watch
  node build/build.js TurnBasedWarfare --production

Or use npm scripts:
  npm run build -- TurnBasedWarfare
  npm run build:watch -- HelloWorld
  npm run build:all              (builds all projects)
`);
    process.exit(1);
}

// Verify project exists
const projectPath = resolveProjectRoot(projectName);
if (!fs.existsSync(projectPath)) {
    console.error(`Error: Project "${projectName}" not found at ${projectPath}`);
    process.exit(1);
}

const configPath = path.join(projectPath, 'collections', 'settings', 'configs', 'game.json');
if (!fs.existsSync(configPath)) {
    console.error(`Error: Project "${projectName}" is missing game.json config at ${configPath}`);
    process.exit(1);
}

// Set environment
process.env.PROJECT_NAME = projectName;
process.env.NODE_ENV = production ? 'production' : 'development';

console.log(`
╔═══════════════════════════════════════════════════════════╗
║           GUTS Game Engine - Webpack Build                ║
╟───────────────────────────────────────────────────────────╢
║  Project: ${projectName.padEnd(47)}║
║  Mode:    ${(production ? 'Production' : 'Development').padEnd(47)}║
║  Target:  ${(targetFilter || 'all').padEnd(47)}║
║  Watch:   ${(watch ? 'Enabled' : 'Disabled').padEnd(47)}║
╚═══════════════════════════════════════════════════════════╝
`);

// Copy resources before webpack build
copyResources(projectName, false);

// Load webpack config (this runs the config parser and generates the entries)
let webpackConfig = require('../webpack.config.js');

/**
 * Names in the configs that resolved to no file. The parser warns about each
 * one as it goes, where they are easy to miss in the log; repeat them together
 * at the end. They only fail at runtime ("GUTS[name] is not a constructor",
 * "System class not found"), so --strict stops the build instead.
 */
// Only the targets this build produces count (the parser reads every config).
const builtTargets = new Set(targetFilter ? [targetFilter] : webpackConfig.map(config => config.name));
const configFor = { client: 'game.json', server: 'server.json', headless: 'headless.json', editor: 'editor.json (its editor modules)' };
const missing = [...require('./config-parser').missing]
    .map(([entry, targets]) => [entry, [...targets].filter(t => builtTargets.has(t))])
    .filter(([, targets]) => targets.length > 0)
    .sort(([a], [b]) => a.localeCompare(b));
function reportMissing() {
    if (missing.length === 0) return;
    console.warn(`\n⚠️  ${missing.length} name(s) in the configs resolved to nothing:`);
    missing.forEach(([entry, targets]) => {
        const [kind, name] = entry.split(':');
        console.warn(`     ${kind.padEnd(14)} ${name.padEnd(28)} ${targets.map(t => configFor[t] || t).join(', ')}`);
    });
    console.warn('   Create them, or remove them from those configs.');
}
if (strict && missing.length > 0) {
    reportMissing();
    console.error('\n❌ Build stopped (--strict).');
    process.exit(1);
}

// Filter to single target if --target flag is provided
if (targetFilter) {
    if (!validTargets.includes(targetFilter)) {
        console.error(`Error: Invalid target "${targetFilter}". Valid targets: ${validTargets.join(', ')}`);
        process.exit(1);
    }
    const filtered = webpackConfig.filter(config => config.name === targetFilter);
    if (filtered.length === 0) {
        console.error(`Error: Target "${targetFilter}" not found in webpack config. This project may not have a ${targetFilter} configuration.`);
        process.exit(1);
    }
    webpackConfig = filtered;
    console.log(`🎯 Building only: ${targetFilter}\n`);
}

// Create compiler
const compiler = webpack(webpackConfig);

// Statistics configuration
const statsConfig = {
    colors: true,
    modules: false,
    children: false,
    chunks: false,
    chunkModules: false,
    timings: true,
    assets: true,
    warnings: true,
    errors: true,
    errorDetails: true
};

// Build callback
function handleBuildResult(err, stats) {
    if (err) {
        console.error('❌ Build failed with error:');
        console.error(err.stack || err);
        if (err.details) {
            console.error(err.details);
        }
        if (!watch) {
            process.exit(1);
        }
        return;
    }

    const info = stats.toJson();

    if (stats.hasErrors()) {
        console.error('❌ Build failed with errors:');
        info.errors.forEach(error => console.error(error.message));
        if (!watch) {
            process.exit(1);
        }
        return;
    }

    if (stats.hasWarnings()) {
        console.warn('⚠️ Build completed with warnings:');
        info.warnings.forEach(warning => console.warn(warning.message));
    }

    console.log(stats.toString(statsConfig));
    reportMissing();
    console.log('\n✅ Build completed successfully!\n');

    // Print output files
    const outputs = [];
    stats.stats.forEach(stat => {
        const compilation = stat.compilation;
        const outputPath = compilation.outputOptions.path;
        Object.keys(compilation.assets).forEach(filename => {
            outputs.push(path.join(outputPath, filename));
        });
    });

    console.log('📦 Output files:');
    outputs.forEach(file => {
        const size = fs.statSync(file).size;
        const sizeKB = (size / 1024).toFixed(2);
        console.log(`   ${path.relative(projectPath, file)} (${sizeKB} KB)`);
    });
    console.log('');
}

// Run build
if (watch) {
    console.log('👀 Watching for file changes...\n');

    compiler.watch({
        aggregateTimeout: 300,
        poll: undefined,
        ignored: /node_modules/
    }, (err, stats) => {
        console.log(`\n⚡ Rebuild triggered at ${new Date().toLocaleTimeString()}\n`);
        handleBuildResult(err, stats);
        if (!err && !stats.hasErrors()) {
            console.log('👀 Watching for file changes...\n');
        }
    });
} else {
    compiler.run((err, stats) => {
        handleBuildResult(err, stats);
        compiler.close((closeErr) => {
            if (closeErr) {
                console.error('❌ Error closing compiler:', closeErr);
                process.exit(1);
            }
        });
    });
}

// Started by `guts dev` with an IPC channel: exit when that process goes away,
// however it ended, so the watcher is never left running on its own.
if (process.send) {
    process.on('disconnect', () => process.exit(0));
}

// Handle process termination
process.on('SIGINT', () => {
    console.log('\n\n🛑 Build interrupted by user');
    if (watch) {
        compiler.close(() => {
            console.log('👋 Watcher closed');
            process.exit(0);
        });
    } else {
        process.exit(0);
    }
});
