/**
 * Unified GUTS Server
 * Combines editor functionality and game server into a single deployment
 *
 * Usage:
 *   node server.js [port] [options]
 *
 * Options:
 *   --production, --prod, -p    Run in production mode (skips auto-build/watch)
 *
 * Examples:
 *   node server.js 8080 --prod   # Production on port 8080
 *   node server.js               # Development on port 8080
 */

const express = require('express');
const http = require('http');
const { Server: IOServer } = require('socket.io');
const fs = require('fs').promises;
const fsSync = require('fs');
const multer = require('multer');
const path = require('path');
const chokidar = require('chokidar');
const bodyParser = require('body-parser');
const cors = require('cors');
const vm = require('vm');

// CLI Arguments
const args = process.argv.slice(2);
const portArg = args.find(arg => !arg.startsWith('-'));
const PORT = portArg ? parseInt(portArg, 10) : 8080;
const isProduction = args.includes('--production') || args.includes('--prod') || args.includes('-p');

// Base directory for all file operations
const BASE_DIR = path.join(__dirname, '/');
const PROJS_DIR = path.join(BASE_DIR, 'projects');
const MODULES_DIR = path.join(BASE_DIR, 'global', 'collections');
const CACHE_DIR = path.join(__dirname, 'cache');

const upload = multer({ dest: path.join(BASE_DIR, 'uploads') });

// Create Express app and HTTP server
const app = express();
const server = http.createServer(app);

// Attach Socket.IO for multiplayer games
const io = new IOServer(server, {
    cors: { origin: '*', methods: ['GET', 'POST'] },
    maxHttpBufferSize: 10e6 // 10MB max message size for save files
});
global.io = io;
global._io = io;

// Configure CORS
app.use(cors({
    origin: '*',
    methods: ['GET', 'POST'],
    credentials: true,
}));

// Configure Express middleware
app.use(bodyParser.json({ limit: '50mb' }));
app.use(express.json({ limit: '10mb' }));

// Serve static files from the entire repo
app.use(express.static(BASE_DIR, {
    setHeaders: (res, filePath) => {
        if (filePath.endsWith('.wasm')) {
            res.set('Content-Type', 'application/wasm');
        }
    }
}));

// File watcher variables
const watchers = new Map();
const fileTimestamps = new Map();
const SUPPORTED_EXTENSIONS = ['.json', '.js', '.html', '.css'];

// ===== GAME SERVER FUNCTIONALITY =====

// Store for loaded game servers (one per project)
const gameServers = new Map();

/**
 * Load compiled game for a project
 */
function loadCompiledGame(projectName) {
    const projectPath = path.join(PROJS_DIR, projectName);
    const gamePath = path.join(projectPath, 'dist/server/game.js');

    if (!fsSync.existsSync(gamePath)) {
        console.log(`No compiled server game found for ${projectName}`);
        return null;
    }

    console.log(`Loading compiled game for ${projectName}...`);

    // Set up window-like global context for compiled code
    if (!global.window) global.window = global;

    // Set up CommonJS-like environment for webpack bundle
    global.module = { exports: {} };
    global.exports = global.module.exports;

    try {
        const gameCode = fsSync.readFileSync(gamePath, 'utf8');
        const gameScript = new vm.Script(gameCode);
        gameScript.runInThisContext();
        console.log(`Loaded compiled game for ${projectName}`);
        return true;
    } catch (error) {
        console.error(`Failed to load compiled game for ${projectName}:`, error);
        return null;
    }
}

/**
 * Initialize game server for a project
 */
async function initGameServer(projectName) {
    if (gameServers.has(projectName)) {
        return gameServers.get(projectName);
    }

    // Load the compiled game
    const loaded = loadCompiledGame(projectName);
    if (!loaded) {
        return null;
    }

    // Dynamic import of ServerEngine (ES module)
    const { default: ServerEngine } = await import('./engine/ServerEngine.js');

    // Merge server infrastructure classes into global.GUTS
    Object.assign(global.GUTS, {
        ServerEngine,
        getCollections: () => global.COMPILED_GAME?.collections
    });

    // Initialize the game server
    const gameServer = new ServerEngine();
    await gameServer.init(projectName);

    if (global.window.COMPILED_GAME && !global.window.COMPILED_GAME.initialized) {
        global.window.COMPILED_GAME.init(gameServer);
    }

    gameServers.set(projectName, gameServer);
    global.serverEngine = gameServer;

    console.log(`Game server initialized for ${projectName}`);
    return gameServer;
}

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

    console.log(`Saving compiled files for ${projectName}:`);
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
            console.log(`Saved game.js for ${projectName}`);
        }

        // Save game_server.js (server version with filtered classes)
        if (serverGameCode) {
            await fs.writeFile(path.join(serverDistFolder, 'game.js'), serverGameCode, 'utf8');
            console.log(`Saved game_server.js for ${projectName}`);
        } else {
            console.log(`No serverGameCode received - skipping game_server.js`);
        }

        // Save engine.js
        if (engineCode) {
            await fs.writeFile(path.join(clientDistFolder, 'engine.js'), engineCode, 'utf8');
            console.log(`Saved engine.js for ${projectName}`);
        }

        // Save modules if any
        if (modules && modules.length > 0) {
            if (!fsSync.existsSync(modulesFolder)) {
                await fs.mkdir(modulesFolder, { recursive: true });
            }

            for (const module of modules) {
                const modulePath = path.join(modulesFolder, module.filename);
                await fs.writeFile(modulePath, module.content, 'utf8');
                console.log(`Saved module: ${module.filename}`);
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

        // Save to flat models/ folder
        const modelFolder = path.join(PROJS_DIR, projectName, "resources/models");
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
    if (!isModule) {
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

// Batch read multiple files in one request for faster loading
app.post('/read-files', async (req, res) => {
    const { files, isModule } = req.body;

    if (!Array.isArray(files)) {
        return res.status(400).json({ success: false, error: 'files must be an array' });
    }

    try {
        const results = {};
        const baseDir = isModule ? MODULES_DIR : PROJS_DIR;
        const CHUNK_SIZE = 50;

        // Process files in chunks
        for (let i = 0; i < files.length; i += CHUNK_SIZE) {
            const chunk = files.slice(i, i + CHUNK_SIZE);
            await Promise.all(chunk.map(async (filePath) => {
                const fullPath = path.join(baseDir, filePath);
                try {
                    if (fsSync.existsSync(fullPath)) {
                        results[filePath] = await fs.readFile(fullPath, 'utf8');
                    }
                } catch (err) {
                    console.warn(`Failed to read ${filePath}:`, err.message);
                }
            }));
        }

        res.json({ success: true, files: results });
    } catch (error) {
        console.error('Error reading files:', error);
        res.status(500).json({ success: false, error: error.message });
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
    if (!isModule) {
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

        const baseDir = isModule ? MODULES_DIR : PROJS_DIR;
        const fileDetails = await getAllFiles(dirPath, baseDir);
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
        const filteredFiles = fileDetails.filter(file => file.modified > sinceTimestamp);
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
        ignored: /(^|[\/\\])\../,
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

// List all available projects from the filesystem
app.get('/list-projects', async (req, res) => {
    try {
        console.log('Listing projects from:', PROJS_DIR);

        // Check if directory exists
        if (!fsSync.existsSync(PROJS_DIR)) {
            console.error('Projects directory does not exist:', PROJS_DIR);
            return res.json({ projects: [], error: 'Projects directory not found' });
        }

        const entries = await fs.readdir(PROJS_DIR, { withFileTypes: true });
        const projects = entries
            .filter(entry => entry.isDirectory())
            .map(entry => entry.name);

        console.log('Available projects:', projects);
        res.json({ projects });
    } catch (error) {
        console.error('Error listing projects:', error);
        console.error('PROJS_DIR was:', PROJS_DIR);
        res.status(500).json({ error: error.message, projects: [] });
    }
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
        let texturesFolder;
        let relativePath;
        const fileName = `${textureName}.png`;

        if (collectionName) {
            texturesFolder = path.join(PROJS_DIR, projectName, 'resources', collectionName);
            relativePath = `${collectionName}/${fileName}`;
        } else {
            texturesFolder = path.join(PROJS_DIR, projectName, 'resources', 'textures');
            relativePath = `textures/${fileName}`;
        }

        if (!fsSync.existsSync(texturesFolder)) {
            await fs.mkdir(texturesFolder, { recursive: true });
        }

        const base64Data = imageData.replace(/^data:image\/\w+;base64,/, '');
        const buffer = Buffer.from(base64Data, 'base64');

        const filePath = path.join(texturesFolder, fileName);
        await fs.writeFile(filePath, buffer);

        res.json({ success: true, filePath: relativePath });
    } catch (error) {
        console.error('Error saving texture:', error);
        res.status(500).json({ error: 'Failed to save texture' });
    }
});

// Save isometric sprites with all data files
app.post('/api/save-isometric-sprites', async (req, res) => {
    try {
        const { projectName, baseName, collectionName, spriteSheet, spriteMetadata,
                ballisticSpriteMetadata, ballisticAngleNames, groundLevelSpriteMetadata,
                generatorSettings, spriteOffset, groundLevelSpriteOffset } = req.body;

        const spritesFolder = path.join(PROJS_DIR, projectName, 'resources', 'sprites', collectionName);
        const scriptsSpriteAnimationSetsFolder = path.join(PROJS_DIR, projectName, 'collections', 'data', 'spriteAnimationSets');

        await fs.mkdir(spritesFolder, { recursive: true });
        await fs.mkdir(scriptsSpriteAnimationSetsFolder, { recursive: true });

        // Save single sprite sheet image
        const sheetName = `${baseName}Sheet`;
        const base64Data = spriteSheet.replace(/^data:image\/\w+;base64,/, '');
        const buffer = Buffer.from(base64Data, 'base64');
        await fs.writeFile(path.join(spritesFolder, `${sheetName}.png`), buffer);

        const spriteSheetPath = `sprites/${collectionName}/${sheetName}.png`;

        // Build frame coordinates object
        const frames = {};
        let totalFrameCount = 0;

        // Process each animation type
        for (const animType in spriteMetadata) {
            const metadata = spriteMetadata[animType];
            for (const animationName in metadata.animations) {
                const frameList = metadata.animations[animationName];
                for (let i = 0; i < frameList.length; i++) {
                    const frame = frameList[i];
                    const spriteName = `${animationName}_${i}`;
                    frames[spriteName] = {
                        x: frame.x,
                        y: frame.y,
                        w: frame.width,
                        h: frame.height
                    };
                    totalFrameCount++;
                }
            }
        }

        // Create sprite animation set JSON
        const animationSetJson = {
            title: baseName.charAt(0).toUpperCase() + baseName.slice(1),
            spriteSheet: spriteSheetPath,
            spriteOffset: spriteOffset ?? 0,
            groundLevelSpriteOffset: groundLevelSpriteOffset ?? null,
            generatorSettings: generatorSettings ? {
                ...generatorSettings,
                animationTypes: Object.keys(spriteMetadata)
            } : undefined,
            frames: frames
        };

        if (!animationSetJson.generatorSettings) {
            delete animationSetJson.generatorSettings;
        }

        // Process ballistic sprites if present
        let ballisticFrameCount = 0;
        if (ballisticSpriteMetadata && ballisticAngleNames) {
            for (const angleName of ballisticAngleNames) {
                const angleData = ballisticSpriteMetadata[angleName];
                if (!angleData) continue;
                for (const animType in angleData) {
                    const metadata = angleData[animType];
                    for (const animationName in metadata.animations) {
                        const frameList = metadata.animations[animationName];
                        for (let i = 0; i < frameList.length; i++) {
                            const frame = frameList[i];
                            const spriteName = `${animationName}_${i}`;
                            frames[spriteName] = {
                                x: frame.x,
                                y: frame.y,
                                w: frame.width,
                                h: frame.height
                            };
                            ballisticFrameCount++;
                        }
                    }
                }
            }
        }

        // Process ground-level sprites if present
        let groundLevelFrameCount = 0;
        if (groundLevelSpriteMetadata) {
            for (const animType in groundLevelSpriteMetadata) {
                const metadata = groundLevelSpriteMetadata[animType];
                for (const animationName in metadata.animations) {
                    const frameList = metadata.animations[animationName];
                    for (let i = 0; i < frameList.length; i++) {
                        const frame = frameList[i];
                        const spriteName = `${animationName}_${i}`;
                        frames[spriteName] = {
                            x: frame.x,
                            y: frame.y,
                            w: frame.width,
                            h: frame.height
                        };
                        groundLevelFrameCount++;
                    }
                }
            }
        }

        // Write animation set JSON
        await fs.writeFile(
            path.join(scriptsSpriteAnimationSetsFolder, `${baseName}.json`),
            JSON.stringify(animationSetJson, null, 2)
        );

        console.log(`Saved sprite data: ${totalFrameCount + ballisticFrameCount + groundLevelFrameCount} frames`);

        res.json({
            success: true,
            frameCount: totalFrameCount + ballisticFrameCount + groundLevelFrameCount,
            groundLevelFrameCount: groundLevelFrameCount,
            format: 'stripped'
        });
    } catch (error) {
        console.error('Error saving isometric sprites:', error);
        res.status(500).json({ error: error.message });
    }
});

// ===== GAME SERVER API ENDPOINTS =====

app.get('/api/server-status', (req, res) => {
    const gameServer = gameServers.get('TurnBasedWarfare');
    if (!gameServer) {
        return res.json({ status: 'not_initialized', rooms: 0, activePlayers: 0 });
    }
    res.json({
        status: 'running',
        rooms: gameServer.gameRooms?.size || 0,
        activePlayers: Array.from(gameServer.gameRooms?.values() || [])
            .reduce((total, room) => total + room.players.size, 0)
    });
});

app.get('/api/rooms', (req, res) => {
    const gameServer = gameServers.get('TurnBasedWarfare');
    if (!gameServer) {
        return res.json([]);
    }
    console.log('[/api/rooms] gameServer.gameRooms size:', gameServer.gameRooms?.size);
    console.log('[/api/rooms] gameServer === global.serverEngine:', gameServer === global.serverEngine);
    const rooms = Array.from(gameServer.gameRooms?.entries() || [])
        .filter(([id, room]) => room.players.size > 0)
        .map(([id, room]) => ({
            id,
            playerCount: room.players.size,
            maxPlayers: room.maxPlayers,
            isActive: room.isActive
        }));
    console.log('[/api/rooms] Returning rooms:', rooms);
    res.json(rooms);
});

app.get('/api/stats', (req, res) => {
    const gameServer = gameServers.get('TurnBasedWarfare');
    if (!gameServer || !gameServer.serverNetworkManager) {
        return res.json({ connectedPlayers: 0 });
    }
    const stats = gameServer.serverNetworkManager.getServerStats();
    res.json(stats);
});


// ===== START SERVER =====

async function startServer() {
    const defaultProject = 'TurnBasedWarfare';

    console.log(`
╔═══════════════════════════════════════════════════════════╗
║              GUTS Unified Server                          ║
╟───────────────────────────────────────────────────────────╢
║  Port:    ${String(PORT).padEnd(47)}║
║  Mode:    ${(isProduction ? 'Production' : 'Development').padEnd(47)}║
╚═══════════════════════════════════════════════════════════╝
`);

    // Initialize game server for TurnBasedWarfare
    try {
        await initGameServer(defaultProject);
        console.log(`Game server ready for ${defaultProject}`);
    } catch (error) {
        console.error(`Failed to initialize game server for ${defaultProject}:`, error);
        // Continue anyway - editor will still work
    }

    // Skip auto-build - use `npm run build` separately
    console.log(`\nServer started without auto-build. Use 'npm run build' to build projects.`);

    server.listen(PORT, () => {
        console.log(`\nServer running on port ${PORT}`);
        console.log(`Editor: http://localhost:${PORT}/projects/Editor/index.html`);
        console.log(`Game:   http://localhost:${PORT}/projects/TurnBasedWarfare/index.html`);
    });
}

// Start the server
startServer();

// Graceful shutdown
process.on('SIGINT', () => {
    console.log('\nShutting down server...');
    for (const [name, gameServer] of gameServers) {
        try { gameServer.stop?.(); } catch (e) { /* noop */ }
    }
    try { io?.close(); } catch (e) { /* noop */ }
    server.close(() => process.exit(0));
});

process.on('uncaughtException', (error) => {
    console.error('Uncaught Exception:', error);
    process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
    process.exit(1);
});
