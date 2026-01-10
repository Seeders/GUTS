#!/usr/bin/env node

/**
 * Game Server Runner for GUTS
 * Runs the game server for a specified project
 */

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

// Get project name and flags from command line
const args = process.argv.slice(2);
const projectName = args.find(arg => !arg.startsWith('-'));
const isProduction = args.includes('--production') || args.includes('-p') || args.includes('--prod');

if (!projectName) {
    console.log(`
Usage: node build/run-server.js <project-name> [options]

Options:
  --production, -p    Run in production mode (port 8080)

Examples:
  node build/run-server.js TurnBasedWarfare
  node build/run-server.js TurnBasedWarfare --production
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

console.log(`Starting game server for: ${projectName}${isProduction ? ' (production mode)' : ''}`);

// Build server arguments
const serverArgs = [serverScript];
if (isProduction) {
    serverArgs.push('--production');
}

// Run the server script
const server = spawn('node', serverArgs, {
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
