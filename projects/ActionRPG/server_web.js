
import express from 'express';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import bodyParser from 'body-parser';
import cors from 'cors';

// CLI Arguments
const port = process.argv[2] || 443;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// Base directory for all file operations
const BASE_DIR = path.join(__dirname, '/dist/client');


// Create Express app and HTTP server
const app = express();
const server = http.createServer(app);


// Configure CORS
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST'],
  credentials: true,
}));

// Configure Express middleware
app.use(bodyParser.json({ limit: '50mb' }));
app.use(express.json({ limit: '10mb' }));
app.use(express.static(BASE_DIR, {
    setHeaders: (res, path) => {
        if (path.endsWith('.wasm')) {
            res.set('Content-Type', 'application/wasm');
        }
    }
}));

// Start the server
server.listen(port, () => {
    console.log(`Server running on port ${port}`);
    console.log(`Files will be served from: ${BASE_DIR}`);

});