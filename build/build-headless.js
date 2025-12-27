#!/usr/bin/env node

/**
 * Build Headless Script for GUTS Game Engine
 * Builds only the headless bundle for running simulations without rendering
 */

const webpack = require('webpack');
const path = require('path');
const fs = require('fs');

// Parse command line arguments
const args = process.argv.slice(2);

// Filter out flags to find project name
const nonFlagArgs = args.filter(arg => !arg.startsWith('-'));
const projectName = nonFlagArgs[0] || 'TurnBasedWarfare';

const production = args.includes('--production') || args.includes('-p');

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
║        GUTS Game Engine - Headless Bundle Build           ║
╟───────────────────────────────────────────────────────────╢
║  Project: ${projectName.padEnd(47)}║
║  Mode:    ${(production ? 'Production' : 'Development').padEnd(47)}║
╚═══════════════════════════════════════════════════════════╝
`);

// Load webpack config
const webpackConfigs = require('../webpack.config.js');

// Find headless config
const headlessConfig = webpackConfigs.find(config => config.name === 'headless');

if (!headlessConfig) {
    console.error('Error: No headless configuration found in webpack.config.js');
    console.error('Make sure the project has a headless entry point.');
    process.exit(1);
}

// Create compiler for headless only
const compiler = webpack(headlessConfig);

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
        console.error('❌ Headless build failed with error:');
        console.error(err.stack || err);
        if (err.details) {
            console.error(err.details);
        }
        process.exit(1);
        return;
    }

    const info = stats.toJson();

    if (stats.hasErrors()) {
        console.error('❌ Headless build failed with errors:');
        info.errors.forEach(error => console.error(error.message));
        process.exit(1);
        return;
    }

    if (stats.hasWarnings()) {
        console.warn('⚠️ Headless build completed with warnings:');
        info.warnings.forEach(warning => console.warn(warning.message));
    }

    console.log(stats.toString(statsConfig));
    console.log('\n✅ Headless build completed successfully!\n');

    // Print output files
    const compilation = stats.compilation;
    const outputPath = compilation.outputOptions.path;

    console.log('📦 Output files:');
    Object.keys(compilation.assets).forEach(filename => {
        const filePath = path.join(outputPath, filename);
        if (fs.existsSync(filePath)) {
            const size = fs.statSync(filePath).size;
            const sizeKB = (size / 1024).toFixed(2);
            console.log(`   ${path.relative(path.join(__dirname, '..'), filePath)} (${sizeKB} KB)`);
        }
    });
    console.log('');

    console.log('Run simulations with:');
    console.log(`   node projects/${projectName}/headless.js --help`);
    console.log('');
}

// Run build
compiler.run((err, stats) => {
    handleBuildResult(err, stats);
    compiler.close((closeErr) => {
        if (closeErr) {
            console.error('❌ Error closing compiler:', closeErr);
            process.exit(1);
        }
    });
});
