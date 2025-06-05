// merged-server.js
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const fs = require('fs').promises;
const fsSync = require('fs');
const multer = require('multer');
const path = require('path');
const chokidar = require('chokidar');
const bodyParser = require('body-parser');
const puppeteer = require('puppeteer');
const cors = require('cors');

// CLI Arguments
const projectName = process.argv[2];
const gameURL = process.argv[3] || `localhost`;
const port = process.argv[4] || 80;

// Base directory for all file operations
const BASE_DIR = path.join(__dirname, '/');
const PROJS_DIR = path.join(BASE_DIR, 'projects');
const MODULES_DIR = path.join(BASE_DIR, 'global');
const CACHE_DIR = path.join(__dirname, 'cache');

const upload = multer({ dest: path.join(BASE_DIR, 'uploads') });

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

// Socket.IO setup
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST'],
    credentials: true,
  },
});

// File watcher variables
const watchers = new Map();
const fileTimestamps = new Map();
const SUPPORTED_EXTENSIONS = ['.json', '.js', '.html', '.css'];

// Game server variables
let hostSocket = null;

// ===== FILE MANAGEMENT ENDPOINTS =====

// Endpoint to save the config
app.post('/save-project', async (req, res) => {
    const project = JSON.parse(req.body.project);
    const projectName = req.body.projectName;
    const buildFolder = path.join(PROJS_DIR, `${projectName}/config`);
    const fileName = projectName.toUpperCase().replace(/ /g, '_');
    const buildFilePath = path.join(buildFolder, `${fileName}.json`);

    try {
        if (!fsSync.existsSync(buildFolder)) {
            await fs.mkdir(buildFolder, { recursive: true });
        }        
        await fs.writeFile(`${buildFilePath}`, `${JSON.stringify(project, null, 2)}`, 'utf8');
        res.status(200).send('Config saved successfully!');
    } catch (error) {
        console.error('Error saving config:', error);
        res.status(500).send('Error saving config');
    }
});

app.post('/load-project', async (req, res) => {
    const projectName = req.body.projectName;
    const buildFolder = path.join(PROJS_DIR, `${projectName}/config`);
    const fileName = projectName.toUpperCase().replace(/ /g, '_');
    const buildFilePath = path.join(buildFolder, `${fileName}.json`);
    try {
        if (!projectName) {
            return res.status(400).send('Project name is required');
        }
        if (!fsSync.existsSync(buildFilePath)) {
            return res.status(404).send('Config not found');
        }
        const project = JSON.parse(await fsSync.promises.readFile(buildFilePath, 'utf8'));
        res.status(200).json({ project });
    } catch (error) {
        console.error('Error loading config:', error);
        res.status(500).send('Error loading config');
    }
});

app.post('/upload-model', upload.single('gltfFile'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'No file uploaded.' });
        }
        if (!req.file.originalname.endsWith('.gltf') && !req.file.originalname.endsWith('.glb')) {
            return res.status(400).json({ error: `Uploaded file "${req.file.originalname}" is not a .gltf file or .glb file.` });
        }
        const projectName = req.body.projectName;
        const gltfPath = req.file.path;
        const gltfContent = await fs.readFile(gltfPath, 'utf8');

        const modelName = req.file.originalname.endsWith('.gltf') ? path.basename(req.file.originalname, '.gltf') : path.basename(req.file.originalname, '.glb');
        const modelFolder = path.join(PROJS_DIR, projectName, "resources/models", modelName);
        const finalGltfPath = path.join(modelFolder, req.file.originalname);

        if (!fsSync.existsSync(modelFolder)) {
            await fs.mkdir(modelFolder, { recursive: true });
        }
        await fs.rename(gltfPath, finalGltfPath);

        const relativePath = path.relative(BASE_DIR, finalGltfPath).replace(/\\/g, '/');
        const gameData = {
            filePath:  relativePath,
            fileName: req.file.originalname,
        };

        res.json(gameData);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: error.message });
    }
});

app.post('/save-file', async (req, res) => {
    let { path: filePath, content } = req.body;
    filePath = path.join(PROJS_DIR, filePath);
    console.log('Resolved save path:', filePath);
    try {
        const dir = path.dirname(filePath);
        if (!fsSync.existsSync(dir)) {
            console.log('Creating directory:', dir);
            await fs.mkdir(dir, { recursive: true });
        }
        await fs.writeFile(filePath, content);
        fileTimestamps.set(filePath, Date.now());
        console.log('File successfully saved at:', filePath);
        res.send({ success: true, message: 'File saved' });
    } catch (error) {
        console.error('Error saving file:', error);
        res.status(500).send({ success: false, error: error.message });
    }
});

app.post('/read-file', async (req, res) => {
    let { path: filePath, isModule: isModule } = req.body;
    if(!isModule){
        filePath = path.join(PROJS_DIR, filePath);
    } else {
        filePath = path.join(MODULES_DIR, filePath);
    }
    try {
        if (!fsSync.existsSync(filePath)) {
            return res.status(404).send({ success: false, error: 'File not found' });
        }
        
        const content = await fs.readFile(filePath, 'utf8');
        res.send(content);
    } catch (error) {
        console.error('Error reading file:', error);
        res.status(500).send({ success: false, error: error.message });
    }
});

async function getAllFiles(dirPath, baseDir) {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    const files = await Promise.all(
        entries.map(async (entry) => {
            const fullPath = path.join(dirPath, entry.name);
            if (entry.isDirectory()) {
                return getAllFiles(fullPath, baseDir);
            } else if (entry.isFile() && SUPPORTED_EXTENSIONS.some(ext => entry.name.endsWith(ext))) {
                const stats = await fs.stat(fullPath);
                const timestamp = fileTimestamps.get(fullPath) || stats.mtimeMs;
                const relativePath = path.relative(baseDir, fullPath).replace(/\\/g, '/');
                return {
                    name: relativePath,
                    path: fullPath,
                    modified: timestamp,
                    size: stats.size
                };
            }
            return null;
        })
    );
    return files.flat().filter(file => file !== null);
}

app.post('/list-files', async (req, res) => {
    let { path: dirPath, since, isModule: isModule } = req.body;
    if(!isModule){
        dirPath = path.join(PROJS_DIR, dirPath);
    } else {
        dirPath = path.join(MODULES_DIR, dirPath);
    }
    const sinceTimestamp = since || 0;
    console.log('Listing files in:', dirPath);

    try {
        if (!fsSync.existsSync(dirPath)) {
            console.log('Directory does not exist yet:', dirPath);
            return res.json([]);
        }

        setupWatcher(dirPath);

        const fileDetails = await getAllFiles(dirPath, PROJS_DIR);
        const filteredFiles = fileDetails.filter(file => file.modified > sinceTimestamp);
        res.json(filteredFiles);
    } catch (error) {
        console.error('Error listing files:', error);
        res.status(500).send({ success: false, error: error.message });
    }
});

app.post('/list-modules', async (req, res) => {
    let { path: dirPath, since } = req.body;
    dirPath = path.join(MODULES_DIR, dirPath);
    const sinceTimestamp = since || 0;
    console.log('Listing modules in:', dirPath);

    try {
        if (!fsSync.existsSync(dirPath)) {
            console.log('Directory does not exist yet:', dirPath);
            return res.json([]);
        }

        setupWatcher(dirPath);

        const fileDetails = await getAllFiles(dirPath, MODULES_DIR);
        console.log('All files found:', JSON.stringify(fileDetails));
        const filteredFiles = fileDetails.filter(file => file.modified > sinceTimestamp);
        console.log('Filtered files (modified > since):', JSON.stringify(filteredFiles));
        res.json(filteredFiles);
    } catch (error) {
        console.error('Error listing files:', error);
        res.status(500).send({ success: false, error: error.message });
    }
});

function setupWatcher(dirPath) {
    if (watchers.has(dirPath)) {
        return;
    }

    console.log(`Setting up watcher for ${dirPath}`);

    if (!fsSync.existsSync(dirPath)) {
        fsSync.mkdirSync(dirPath, { recursive: true });
    }

    const watcher = chokidar.watch(dirPath, {
        ignored: /(^|[\/\\])\../, // Ignore dotfiles
        persistent: true
    });

    watcher
        .on('add', filePath => {
            if (SUPPORTED_EXTENSIONS.some(ext => filePath.endsWith(ext))) {
                fileTimestamps.set(filePath, Date.now());
            }
        })
        .on('change', filePath => {
            if (SUPPORTED_EXTENSIONS.some(ext => filePath.endsWith(ext))) {
                console.log(`File changed: ${filePath}`);
                fileTimestamps.set(filePath, Date.now());
            }
        })
        .on('unlink', filePath => {
            console.log(`File removed: ${filePath}`);
            fileTimestamps.delete(filePath);
        });

    watchers.set(dirPath, watcher);
}

app.get('/browse-directory', (req, res) => {
    const directories = [
        'configs',
        'scripts',
        'data'
    ].map(dir => path.join(PROJS_DIR, dir).replace(/\\/g, '/'));
    
    res.json({ 
        path: directories[0],
        options: directories 
    });
});

async function ensureCacheDir() {
    try {
        await fs.mkdir(CACHE_DIR, { recursive: true });
    } catch (error) {
        if (error.code !== 'EEXIST') throw error;
    }
}

// Get cached images
app.get('/api/cache/:prefix', async (req, res) => {
    const { prefix } = req.params;
    const cacheFile = path.join(CACHE_DIR, `${prefix}.json`);
    
    try {
        const data = await fs.readFile(cacheFile, 'utf8');
        res.json(JSON.parse(data));
    } catch (error) {
        res.status(404).json({ error: 'Cache not found' });
    }
});

// Save cached images
app.post('/api/cache', async (req, res) => {
    const { prefix, images } = req.body;
    const cacheFile = path.join(CACHE_DIR, `${prefix}.json`);
    
    try {
        await ensureCacheDir();
        await fs.writeFile(cacheFile, JSON.stringify({ images }, null, 2));
        res.json({ success: true });
    } catch (error) {
        console.error('Error saving cache:', error);
        res.status(500).json({ error: 'Failed to save cache' });
    }
});

// ===== GAME NETWORKING WITH SOCKET.IO =====

// Simulate host client using Puppeteer (optional)
async function createHostClient() {
  if (!projectName) {
    console.log('No project name provided - skipping host client creation');
    return;
  }
  
  try {
    const browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });

    console.log('Puppeteer host client initialized...');
 
    const page = await browser.newPage();
    page.on('console', msg => console.log('Page Console:', msg.text()));
    page.on('pageerror', error => console.error('Page Error:', error));
    
    const url = `http://${gameURL}${port != 80 ? ':' + port : ''}/projects/${projectName}/game.html`;
    console.log('Loading', url, '...');
    
    const response = await page.goto(url, { waitUntil: 'networkidle2' });
    console.log('Status:', response.status(), response.statusText());
    console.log('Headers:', response.headers());    
    const content = await page.content();
    console.log(content);
    
    process.on('SIGINT', async () => {
      await browser.close();
      process.exit();
    });
  } catch (error) {
    console.error('Error creating Puppeteer host client:', error);
    setTimeout(createHostClient, 5000);
  }
}

// Handle Socket.IO connections
io.on('connection', (socket) => {
  if (!hostSocket) {
    console.log(`Host connected: ${socket.id}`);
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
server.listen(port, () => {
    console.log(`Server running on port ${port}`);
    console.log(`Files will be served from: ${PROJS_DIR}`);
    
    if (projectName) {
        console.log(`Game networking enabled for project: ${projectName}`);
        // Optionally start the host client
        // createHostClient();
    } else {
        console.log('Game networking available - provide project name as 3rd argument to enable host client');
    }
    
    console.log('Usage: node server.js [projectName] [gameURL] [port]');
    console.log(`Example: node server.js myProject localhost 5000`);
});