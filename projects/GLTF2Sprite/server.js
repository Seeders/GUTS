// ===== server.js =====
// Simple static file server for GLTF2Sprite
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = 3000;

// Serve static files from this project directory
app.use(express.static(__dirname));

// Also serve global libraries from GUTS root
app.use('/global', express.static(path.join(__dirname, '../../global')));

// Start server
app.listen(PORT, () => {
    console.log(`GLTF2Sprite running at http://localhost:${PORT}`);
    console.log('Press Ctrl+C to stop');
});
