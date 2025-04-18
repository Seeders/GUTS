// server-file-watcher.js
const express = require('express');
const app = express();
const fs = require('fs').promises;
const fsSync = require('fs');
const multer = require('multer');
const path = require('path');
const chokidar = require('chokidar');
const bodyParser = require('body-parser');

// Base directory for all file operations
const BASE_DIR = path.join(__dirname, '/');
const PROJS_DIR = path.join(BASE_DIR, 'projects');
const MODELS_DIR = path.join(BASE_DIR, 'samples/models');
const CONFIG_DIR = path.join(BASE_DIR, 'config');
const upload = multer({ dest: path.join(BASE_DIR, 'uploads') });

const CACHE_DIR = path.join(__dirname, 'cache');
// Configure Express server
app.use(bodyParser.json({ limit: '50mb' }));
app.use(express.json({ limit: '10mb' }));
app.use(express.static(BASE_DIR));

// Map of watchers by directory
const watchers = new Map();
// Map of file timestamps
const fileTimestamps = new Map();

// Supported file extensions (aligned with FileSystemSyncService.propertyConfig)
const SUPPORTED_EXTENSIONS = ['.json', '.js', '.html', '.css']; // Add more if needed

// Endpoint to save the config
app.post('/save-config', async (req, res) => {
    const config = req.body;
    const filePath1 = path.join(CONFIG_DIR, 'default_app_config.js');

    try {
        if (!fsSync.existsSync(CONFIG_DIR)) {
            await fs.mkdir(CONFIG_DIR, { recursive: true });
        }
        await fs.writeFile(filePath1, "const DEFAULT_PROJECT_CONFIG = " + JSON.stringify(config, null, 2) + "; \n\n export { DEFAULT_PROJECT_CONFIG };", 'utf8');
        res.status(200).send('Config saved successfully!');
    } catch (error) {
        console.error('Error saving config:', error);
        res.status(500).send('Error saving config');
    }
});

app.post('/upload-model', upload.single('gltfFile'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'No file uploaded.' });
        }
        if (!req.file.originalname.endsWith('.gltf')) {
            return res.status(400).json({ error: `Uploaded file "${req.file.originalname}" is not a .gltf file.` });
        }

        const gltfPath = req.file.path;
        const gltfContent = await fs.readFile(gltfPath, 'utf8');
        const gltfData = JSON.parse(gltfContent);

        const modelName = path.basename(req.file.originalname, '.gltf');
        const modelFolder = path.join(MODELS_DIR, modelName);
        const finalGltfPath = path.join(modelFolder, req.file.originalname);

        if (!fsSync.existsSync(modelFolder)) {
            await fs.mkdir(modelFolder, { recursive: true });
        }
        await fs.rename(gltfPath, finalGltfPath);

        const relativePath = path.relative(BASE_DIR, finalGltfPath).replace(/\\/g, '/');
        const gameData = {
            filePath: relativePath,
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
    let { path: filePath } = req.body;
    filePath = path.join(PROJS_DIR, filePath);
    console.log('Reading file from:', filePath);
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
    let { path: dirPath, since } = req.body;
    dirPath = path.join(PROJS_DIR, dirPath);
    const sinceTimestamp = since || 0;
    console.log('Listing files in:', dirPath);

    try {
        if (!fsSync.existsSync(dirPath)) {
            console.log('Directory does not exist yet:', dirPath);
            return res.json([]);
        }

        setupWatcher(dirPath);

        const fileDetails = await getAllFiles(dirPath, PROJS_DIR);
        console.log('All files found:', JSON.stringify(fileDetails));
        const filteredFiles = fileDetails.filter(file => file.modified > sinceTimestamp);
        console.log('Filtered files (modified > since):', JSON.stringify(filteredFiles));
        res.json(filteredFiles);
    } catch (error) {
        console.error('Error listing files:', error);
        res.status(500).send({ success: false, error: error.message });
    }
});

// File watcher setup
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
                console.log(`File added: ${filePath}`);
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

// Start the server
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    console.log(`Files will be served from: ${PROJS_DIR}`);
});