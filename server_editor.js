// merged-server.js
const express = require('express');
const http = require('http');
const fs = require('fs').promises;
const fsSync = require('fs');
const multer = require('multer');
const path = require('path');
const chokidar = require('chokidar');
const bodyParser = require('body-parser');
const cors = require('cors');

// CLI Arguments
const port = process.argv[2] || 443;

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

// File watcher variables
const watchers = new Map();
const fileTimestamps = new Map();
const SUPPORTED_EXTENSIONS = ['.json', '.js', '.html', '.css'];


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

// Endpoint to save compiled game files
app.post('/save-compiled-game', async (req, res) => {
    const { projectName, gameCode, serverGameCode, engineCode, modules } = req.body;
    const projectFolder = path.join(PROJS_DIR, projectName);
    const distFolder = path.join(projectFolder, 'dist');
    const serverDistFolder = path.join(distFolder, 'server');
    const clientDistFolder = path.join(distFolder, 'client');
    const modulesFolder = path.join(clientDistFolder, 'modules');

    console.log(`📦 Saving compiled files for ${projectName}:`);
    console.log(`   - gameCode: ${gameCode ? `${(gameCode.length / 1024).toFixed(1)}KB` : 'missing'}`);
    console.log(`   - serverGameCode: ${serverGameCode ? `${(serverGameCode.length / 1024).toFixed(1)}KB` : 'missing'}`);
    console.log(`   - engineCode: ${engineCode ? `${(engineCode.length / 1024).toFixed(1)}KB` : 'missing'}`);
    console.log(`   - modules: ${modules?.length || 0}`);

    try {
        // Ensure project folder exists
        if (!fsSync.existsSync(projectFolder)) {
            await fs.mkdir(projectFolder, { recursive: true });
        }
        if (!fsSync.existsSync(distFolder)) {
            await fs.mkdir(distFolder, { recursive: true });
        }
        if (!fsSync.existsSync(serverDistFolder)) {
            await fs.mkdir(serverDistFolder, { recursive: true });
        }
        if (!fsSync.existsSync(clientDistFolder)) {
            await fs.mkdir(clientDistFolder, { recursive: true });
        }
        // Save game.js (client version)
        if (gameCode) {
            await fs.writeFile(path.join(clientDistFolder, 'game.js'), gameCode, 'utf8');
            console.log(`✓ Saved game.js for ${projectName}`);
        }

        // Save game_server.js (server version with filtered classes)
        if (serverGameCode) {
            await fs.writeFile(path.join(serverDistFolder, 'game.js'), serverGameCode, 'utf8');
            console.log(`✓ Saved game_server.js for ${projectName}`);
        } else {
            console.log(`⚠️ No serverGameCode received - skipping game_server.js`);
        }

        // Save engine.js
        if (engineCode) {
            await fs.writeFile(path.join(clientDistFolder, 'engine.js'), engineCode, 'utf8');
            console.log(`✓ Saved engine.js for ${projectName}`);
        }

        // Save modules if any
        if (modules && modules.length > 0) {
            if (!fsSync.existsSync(modulesFolder)) {
                await fs.mkdir(modulesFolder, { recursive: true });
            }

            for (const module of modules) {
                const modulePath = path.join(modulesFolder, module.filename);
                await fs.writeFile(modulePath, module.content, 'utf8');
                console.log(`✓ Saved module: ${module.filename}`);
            }
        }

        res.status(200).send('Compiled game files saved successfully!');
    } catch (error) {
        console.error('Error saving compiled game files:', error);
        res.status(500).send('Error saving compiled game files');
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
app.post('/upload-file', upload.single('file'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'No file uploaded.' });
        }

        const projectName = req.body.projectName;
        const objectType = req.body.objectType;
        const uploadedFile = req.file;
        
        // Create the target directory based on object type
        // e.g., animations -> /resources/animations/
        const resourceFolder = path.join(PROJS_DIR, projectName, "resources", objectType);
        const finalFilePath = path.join(resourceFolder, uploadedFile.originalname);

        // Create directory if it doesn't exist
        if (!fsSync.existsSync(resourceFolder)) {
            await fs.mkdir(resourceFolder, { recursive: true });
        }

        // Move file from temp upload location to final location
        await fs.rename(uploadedFile.path, finalFilePath);

        // Create relative path for the game to use
        const relativePath = path.relative(BASE_DIR, finalFilePath).replace(/\\/g, '/');
        
        const gameData = {
            filePath: relativePath,
            fileName: uploadedFile.originalname,
        };

        res.json(gameData);
    } catch (error) {
        console.error('Error uploading file:', error);
        res.status(500).json({ error: error.message });
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

        // Save to flat models/ folder instead of models/modelName/ subfolder
        const modelFolder = path.join(PROJS_DIR, projectName, "resources/models");
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

app.post('/delete-file', async (req, res) => {
    let { path: filePath } = req.body;
    filePath = path.join(PROJS_DIR, filePath);
    console.log('Deleting file:', filePath);
    try {
        if (!fsSync.existsSync(filePath)) {
            return res.status(404).send({ success: false, error: 'File not found' });
        }
        await fs.unlink(filePath);
        fileTimestamps.delete(filePath);
        console.log('File successfully deleted:', filePath);
        res.send({ success: true, message: 'File deleted' });
    } catch (error) {
        console.error('Error deleting file:', error);
        res.status(500).send({ success: false, error: error.message });
    }
});

app.post('/delete-folder', async (req, res) => {
    let { path: folderPath } = req.body;
    folderPath = path.join(PROJS_DIR, folderPath);
    console.log('Deleting folder:', folderPath);
    try {
        if (!fsSync.existsSync(folderPath)) {
            return res.status(404).send({ success: false, error: 'Folder not found' });
        }
        await fs.rm(folderPath, { recursive: true, force: true });
        console.log('Folder successfully deleted:', folderPath);
        res.send({ success: true, message: 'Folder deleted' });
    } catch (error) {
        console.error('Error deleting folder:', error);
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

// Save texture image as PNG file
app.post('/api/save-texture', async (req, res) => {
    const { projectName, textureName, categoryName, collectionName, imageData } = req.body;

    if (!projectName || !textureName || !imageData) {
        return res.status(400).json({ error: 'Missing required fields' });
    }

    try {
        // Determine the folder path based on category and collection
        let texturesFolder;
        let relativePath;

        const fileName = `${textureName}.png`;

        if (categoryName && collectionName) {
            // New organized structure: resources/[category]/[collection]/
            texturesFolder = path.join(PROJS_DIR, projectName, 'resources', categoryName, collectionName);
            relativePath = `${categoryName}/${collectionName}/${fileName}`;
        } else {
            // Fallback to old structure: resources/textures/
            texturesFolder = path.join(PROJS_DIR, projectName, 'resources', 'textures');
            relativePath = `textures/${fileName}`;
        }

        // Create directory if it doesn't exist
        if (!fsSync.existsSync(texturesFolder)) {
            await fs.mkdir(texturesFolder, { recursive: true });
        }

        // Remove data URL prefix if present
        const base64Data = imageData.replace(/^data:image\/\w+;base64,/, '');
        const buffer = Buffer.from(base64Data, 'base64');

        // Save as PNG file
        const filePath = path.join(texturesFolder, fileName);
        await fs.writeFile(filePath, buffer);

        // Return relative path from resources folder
        res.json({ success: true, filePath: relativePath });
    } catch (error) {
        console.error('Error saving texture:', error);
        res.status(500).json({ error: 'Failed to save texture' });
    }
});

// Setup Webpack Build Integration
const WebpackEditorIntegration = require('./build/editor-integration');
const webpackIntegration = new WebpackEditorIntegration();
webpackIntegration.setupRoutes(app);

// Start the server
server.listen(port, () => {
    console.log(`Server running on port ${port}`);
    console.log(`Files will be served from: ${PROJS_DIR}`);
    console.log(`Webpack integration enabled`);
});