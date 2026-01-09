// ===== server.js =====
// GUTS ECS Boid Simulation Server
// Simple static file server for the client-side boid simulation

import express from 'express';
import { createServer } from 'http';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Set up Express server for serving client files
const app = express();
const server = createServer(app);

// Serve static files - client bundle first, then fallback to project root
app.use(express.static(path.join(__dirname, 'dist/client')));
app.use(express.static(path.join(__dirname, './')));
app.use('/engine', express.static(path.join(__dirname, '../../engine')));
app.use('/global', express.static(path.join(__dirname, '../../global')));

// API endpoint for status
app.get('/api/status', (req, res) => {
    res.json({
        status: 'running',
        title: 'GUTS ECS Boid Simulation',
        boids: 100000
    });
});

// Start server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log('='.repeat(50));
    console.log('GUTS ECS Boid Simulation');
    console.log('='.repeat(50));
    console.log(`Server running on http://localhost:${PORT}`);
    console.log(`Open the URL in your browser to view the simulation`);
    console.log('='.repeat(50));
});

// Graceful shutdown
process.on('SIGINT', () => {
    console.log('Shutting down server...');
    server.close(() => process.exit(0));
});
