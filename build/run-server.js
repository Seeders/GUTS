#!/usr/bin/env node

/**
 * Game Server Runner for GUTS
 * Runs the game server for a specified project
 */

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

// Get project name from command line
const projectName = process.argv[2];

if (!projectName) {
    console.log(`
Usage: node build/run-server.js <project-name>

Examples:
  node build/run-server.js TurnBasedWarfare
  npm run game:server -- TurnBasedWarfare
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

console.log(`Starting game server for: ${projectName}`);

// Run the server script
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
