#!/usr/bin/env node

/**
 * Start Project Script for GUTS
 * Builds the project and then launches the server
 */

const { spawn, execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

// Get project name from command line
const projectName = process.argv[2];

if (!projectName) {
    console.log(`
Usage: node build/start-project.js <project-name>

Examples:
  node build/start-project.js TurnBasedWarfare
  npm run start:TurnBasedWarfare
`);
    process.exit(1);
}

const projectPath = path.join(__dirname, '..', 'projects', projectName);
const serverScript = path.join(projectPath, 'server.js');

// Verify project exists
if (!fs.existsSync(projectPath)) {
    console.error(`Error: Project "${projectName}" not found at ${projectPath}`);
    process.exit(1);
}

// Verify server script exists
if (!fs.existsSync(serverScript)) {
    console.error(`Error: Server script not found at ${serverScript}`);
    console.error(`Project "${projectName}" may not have multiplayer support.`);
    process.exit(1);
}

console.log(`\n========================================`);
console.log(`Building project: ${projectName}`);
console.log(`========================================\n`);

// Run the build synchronously
try {
    execSync(`node build/build.js ${projectName}`, {
        stdio: 'inherit',
        cwd: path.join(__dirname, '..')
    });
} catch (error) {
    console.error(`\nBuild failed for project "${projectName}"`);
    process.exit(1);
}

console.log(`\n========================================`);
console.log(`Starting server for: ${projectName}`);
console.log(`========================================\n`);

// Run the server
const server = spawn('node', [serverScript], {
    stdio: 'inherit',
    cwd: projectPath
});

server.on('error', (err) => {
    console.error('Failed to start server:', err);
    process.exit(1);
});

server.on('exit', (code) => {
    process.exit(code || 0);
});
