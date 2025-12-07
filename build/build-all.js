#!/usr/bin/env node

/**
 * Build All Projects Script for GUTS Game Engine
 * Discovers all projects in the projects/ folder and builds each one
 */

const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

// Parse command line arguments
const args = process.argv.slice(2);
const production = args.includes('--production') || args.includes('-p');

const projectsDir = path.join(__dirname, '..', 'projects');

// Discover all project folders
function discoverProjects() {
    try {
        const entries = fs.readdirSync(projectsDir, { withFileTypes: true });
        return entries
            .filter(entry => entry.isDirectory())
            .filter(entry => {
                // Check if it has a valid game.json config
                const configPath = path.join(projectsDir, entry.name, 'scripts', 'Settings', 'configs', 'game.json');
                return fs.existsSync(configPath);
            })
            .map(entry => entry.name);
    } catch (error) {
        console.error('Error discovering projects:', error.message);
        return [];
    }
}

const projects = discoverProjects();

if (projects.length === 0) {
    console.log('No valid projects found in projects/ folder');
    process.exit(1);
}

console.log(`
╔═══════════════════════════════════════════════════════════╗
║           GUTS Game Engine - Build All Projects           ║
╟───────────────────────────────────────────────────────────╢
║  Projects found: ${projects.length.toString().padEnd(40)}║
║  Mode: ${(production ? 'Production' : 'Development').padEnd(51)}║
╚═══════════════════════════════════════════════════════════╝
`);

console.log('Projects to build:');
projects.forEach((project, index) => {
    console.log(`  ${index + 1}. ${project}`);
});
console.log('');

// Build each project sequentially
let successCount = 0;
let failCount = 0;

for (const project of projects) {
    console.log(`\n${'═'.repeat(60)}`);
    console.log(`Building: ${project}`);
    console.log(`${'═'.repeat(60)}\n`);

    try {
        const buildArgs = production ? '--production' : '';
        execSync(`node build/build.js ${project} ${buildArgs}`, {
            cwd: path.join(__dirname, '..'),
            stdio: 'inherit'
        });
        successCount++;
        console.log(`✅ ${project} built successfully\n`);
    } catch (error) {
        failCount++;
        console.error(`❌ ${project} build failed\n`);
    }
}

// Summary
console.log(`
╔═══════════════════════════════════════════════════════════╗
║                    Build Summary                          ║
╟───────────────────────────────────────────────────────────╢
║  Successful: ${successCount.toString().padEnd(45)}║
║  Failed:     ${failCount.toString().padEnd(45)}║
╚═══════════════════════════════════════════════════════════╝
`);

if (failCount > 0) {
    process.exit(1);
}
