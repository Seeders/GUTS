#!/usr/bin/env node

/**
 * Build Script for GUTS Game Engine
 * Can be called from editor or command line
 */

const webpack = require('webpack');
const path = require('path');
const fs = require('fs');
const { copyResources } = require('./copy-resources');

// Parse command line arguments
const args = process.argv.slice(2);

// Filter out flags to find project name
const nonFlagArgs = args.filter(arg => !arg.startsWith('-'));
const projectName = nonFlagArgs[0];

const watch = args.includes('--watch') || args.includes('-w');
const production = args.includes('--production') || args.includes('-p');

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
const projectPath = path.join(__dirname, '..', 'projects', projectName);
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

// Load webpack config
let webpackConfig = require('../webpack.config.js');

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
        console.log(`   ${path.relative(__dirname, file)} (${sizeKB} KB)`);
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
