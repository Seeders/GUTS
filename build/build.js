#!/usr/bin/env node

/**
 * Build Script for GUTS Game Engine
 * Can be called from editor or command line
 */

const webpack = require('webpack');
const path = require('path');
const fs = require('fs');

// Parse command line arguments
const args = process.argv.slice(2);
const projectName = args[0] || process.env.PROJECT_NAME || 'TurnBasedWarfare';
const watch = args.includes('--watch') || args.includes('-w');
const production = args.includes('--production') || args.includes('-p');

// Set environment
process.env.PROJECT_NAME = projectName;
process.env.NODE_ENV = production ? 'production' : 'development';

console.log(`
╔═══════════════════════════════════════════════════════════╗
║           GUTS Game Engine - Webpack Build                ║
╟───────────────────────────────────────────────────────────╢
║  Project: ${projectName.padEnd(47)}║
║  Mode:    ${(production ? 'Production' : 'Development').padEnd(47)}║
║  Watch:   ${(watch ? 'Enabled' : 'Disabled').padEnd(47)}║
╚═══════════════════════════════════════════════════════════╝
`);

// Load webpack config
const webpackConfig = require('../webpack.config.js');

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
