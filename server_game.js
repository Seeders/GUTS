const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const puppeteer = require('puppeteer');

// Get project name from CLI argument
const projectName = process.argv[2];
const gameURL = process.argv[3];
if (!projectName) {
  console.error('Please provide a project name as a CLI argument (e.g., node server.js myProject)');
  process.exit(1);
}

// Create Express app and HTTP server
const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*', // Allow all origins (for development only)
    methods: ['GET', 'POST'],
    credentials: true,
  },
});

let hostSocket = null;

// Simulate host client using JSDOM
async function createHostClient() {
  try {
    // Launch headless browser
    const browser = await puppeteer.launch({
      headless: true, // Headless mode
      args: ['--no-sandbox', '--disable-setuid-sandbox'], // Required for some server environments
    });

    // Log to confirm Puppeteer environment is set up
    console.log('Puppeteer host client initialized...');
 
    // Create a new page
    const page = await browser.newPage();
    page.on('console', msg => console.log('Page Console:', msg.text()));
    page.on('pageerror', error => console.error('Page Error:', error));
    const url = `http://${gameURL}/projects/${projectName}/game.html`;
    console.log('loading', url, '...');
    // Load game.html
    const response = await page.goto(url, { waitUntil: 'networkidle2' });
    console.log('Status:', response.status(), response.statusText());
    console.log('Headers:', response.headers());    
    const content = await page.content();
    console.log(content);
    
    // Keep browser open until disconnect (handled by socket logic)
    // Optionally, close browser on process exit
    process.on('SIGINT', async () => {
      await browser.close();
      process.exit();
    });
  } catch (error) {
    console.error('Error creating Puppeteer host client:', error);
    // Retry after 5 seconds
    setTimeout(createHostClient, 5000);
  }
}
// Handle new connections
io.on('connection', (socket) => {
  if (!hostSocket) {
    console.log(`Host connected: ${socket.id}`);
    // First client (JSDOM client) is the host
    hostSocket = socket;

    hostSocket.emit('setHost', { isHost: true });

    hostSocket.on('gameState', (data) => {
      io.emit('gameState', data);
    });

    hostSocket.on('playerConnected', (data) => {
      io.emit('playerConnected', data);
    });

    hostSocket.on('playerDisconnected', (data) => {
      console.log(`Removing Player: ${data.networkId}`);
      io.emit('playerDisconnected', data);
    });

    hostSocket.on('disconnect', () => {
      console.log(`Host disconnected: ${socket.id}`);
      hostSocket = null;
      // Restart JSDOM host client
      createHostClient();
    });
  } else {
    console.log(`Player connected: ${socket.id}`);

    hostSocket?.emit('playerConnected', {
      networkId: socket.id,
    });

    socket.on('playerInput', (data) => {
      hostSocket?.emit('playerInput', data);
    });

    socket.on('disconnect', () => {
      console.log(`Player disconnected: ${socket.id}`);
      hostSocket?.emit('playerDisconnected', { networkId: socket.id });
    });
  }
});

// Start the server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Game server running on port ${PORT}`);
  // Start the host client after the server is ready
  createHostClient();
});