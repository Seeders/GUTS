/**
 * GUTS editor filesystem API — mountable and project-scoped.
 *
 * These are the read/write/delete/list endpoints the editor client uses to
 * persist a project's collection JSON, scripts and resources to disk. They used
 * to live inline in the root server (server.js) and could only ever reach
 * projects inside the monorepo's `projects/` folder. This module factors them
 * out so:
 *
 *   1. the root server can keep serving every project under `<GUTS>/projects`
 *      (multi-project mode), exactly as before, and
 *   2. an EXTERNAL project that depends on GUTS as a tarball can mount its own
 *      editor, scoped to just its own files, from its own backend/server
 *      (single-project mode) — see mountEditor().
 *
 * Path model
 * ----------
 * The client always sends paths shaped like `<projectName>/collections/...`,
 * which the server joins under a base directory. Multi-project mode uses
 * `<GUTS>/projects` as that base. Single-project mode uses the PARENT of the one
 * project's root, so the very same `<projectName>/collections/...` path resolves
 * to that project — no client change needed. `confineDir` then pins every
 * resolved path inside the project so a crafted `../` can't escape it.
 *
 * Auth is the caller's job. Under the root server the global editor gate covers
 * the root-mounted endpoints; mountEditor() applies editor-auth's basic gate to
 * everything it mounts. Never expose these unauthenticated on a public host.
 */

const express = require('express');
const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const multer = require('multer');

// chokidar powers change-freshness for /list-files: it stamps edited files so a
// `since`-filtered list returns them immediately. It's optional — without it we
// fall back to the file's mtime, which is correct, just without the in-memory
// cache. Tarball consumers may not have it installed, so never hard-require it.
let chokidar = null;
try { chokidar = require('chokidar'); } catch { /* optional */ }

const SUPPORTED_EXTENSIONS = ['.json', '.js', '.html', '.css'];

/** True if `resolved` is `root` itself or sits inside it. */
function isWithin(root, resolved) {
    const r = path.resolve(root);
    const p = path.resolve(resolved);
    return p === r || p.startsWith(r + path.sep);
}

/**
 * Resolve a client-supplied relative path under `base`, refusing anything that
 * escapes `confine` (defaults to `base`). Throws a 400 on escape.
 */
function safeJoin(base, rel, confine) {
    const resolved = path.resolve(base, rel || '');
    const limit = path.resolve(confine || base);
    if (!isWithin(limit, resolved)) {
        const err = new Error('Path escapes the project directory.');
        err.status = 400;
        throw err;
    }
    return resolved;
}

/**
 * Build an Express router carrying every editor filesystem endpoint.
 *
 * @param {object}   opts
 * @param {string}   opts.projsDir      base dir project ids resolve under (client sends "<project>/collections/...").
 * @param {string}   opts.modulesDir    global editor module collections (`<GUTS>/global/collections`).
 * @param {string}   opts.cacheDir      sprite-atlas cache dir.
 * @param {string}   opts.baseDir       base for the relative paths that upload endpoints return to the client.
 * @param {string}   opts.uploadsDir    multer temp dir.
 * @param {string}   [opts.confineDir]  if set, every resolved project path must stay within it (single-project sandbox). Defaults to projsDir.
 * @param {function} [opts.listProjects] async () => string[] of project names. Defaults to reading projsDir.
 * @returns {import('express').Router}
 */
function createEditorApi(opts) {
    const projsDir = path.resolve(opts.projsDir);
    const modulesDir = path.resolve(opts.modulesDir);
    const cacheDir = path.resolve(opts.cacheDir);
    const baseDir = path.resolve(opts.baseDir || projsDir);
    const uploadsDir = path.resolve(opts.uploadsDir);
    const confineDir = path.resolve(opts.confineDir || projsDir);
    const listProjects = opts.listProjects || (async () => {
        if (!fsSync.existsSync(projsDir)) return [];
        const entries = await fs.readdir(projsDir, { withFileTypes: true });
        return entries.filter(e => e.isDirectory()).map(e => e.name);
    });

    const router = express.Router();
    const upload = multer({ dest: uploadsDir });

    // A standalone host may not have parsed the body yet; the root server has.
    // Parsing twice is harmless. base64 image payloads need the fat limit.
    router.use(express.json({ limit: '50mb' }));
    router.use(express.urlencoded({ extended: true, limit: '50mb' }));

    const watchers = new Map();
    const fileTimestamps = new Map();

    // Resolve a project path (client-supplied), pinned inside confineDir.
    const projPath = (rel) => safeJoin(projsDir, rel, confineDir);
    // Resolve a module path, pinned inside modulesDir.
    const modPath = (rel) => safeJoin(modulesDir, rel, modulesDir);

    async function getAllFiles(dirPath, baseForRel) {
        const entries = await fs.readdir(dirPath, { withFileTypes: true });
        const files = await Promise.all(
            entries.map(async (entry) => {
                const fullPath = path.join(dirPath, entry.name);
                if (entry.isDirectory()) {
                    return getAllFiles(fullPath, baseForRel);
                } else if (entry.isFile() && SUPPORTED_EXTENSIONS.some(ext => entry.name.endsWith(ext))) {
                    const stats = await fs.stat(fullPath);
                    const timestamp = fileTimestamps.get(fullPath) || stats.mtimeMs;
                    const relativePath = path.relative(baseForRel, fullPath).replace(/\\/g, '/');
                    return { name: relativePath, path: fullPath, modified: timestamp, size: stats.size };
                }
                return null;
            })
        );
        return files.flat().filter(file => file !== null);
    }

    function setupWatcher(dirPath) {
        if (!chokidar || watchers.has(dirPath)) return;
        if (!fsSync.existsSync(dirPath)) fsSync.mkdirSync(dirPath, { recursive: true });

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
                    fileTimestamps.set(filePath, Date.now());
                }
            })
            .on('unlink', filePath => {
                fileTimestamps.delete(filePath);
            });
        watchers.set(dirPath, watcher);
    }

    async function ensureCacheDir() {
        try {
            await fs.mkdir(cacheDir, { recursive: true });
        } catch (error) {
            if (error.code !== 'EEXIST') throw error;
        }
    }

    // ===== FILE MANAGEMENT ENDPOINTS =====

    router.post('/save-project', async (req, res) => {
        try {
            const project = JSON.parse(req.body.project);
            const projectName = req.body.projectName;
            const buildFolder = safeJoin(projsDir, `${projectName}/config`, confineDir);
            const fileName = projectName.toUpperCase().replace(/ /g, '_');
            const buildFilePath = path.join(buildFolder, `${fileName}.json`);

            if (!fsSync.existsSync(buildFolder)) await fs.mkdir(buildFolder, { recursive: true });
            await fs.writeFile(buildFilePath, JSON.stringify(project, null, 2), 'utf8');
            res.status(200).send('Config saved successfully!');
        } catch (error) {
            console.error('Error saving config:', error);
            res.status(error.status || 500).send('Error saving config');
        }
    });

    router.post('/save-compiled-game', async (req, res) => {
        const { projectName, gameCode, serverGameCode, engineCode, modules } = req.body;
        try {
            const projectFolder = safeJoin(projsDir, projectName, confineDir);
            const distFolder = path.join(projectFolder, 'dist');
            const serverDistFolder = path.join(distFolder, 'server');
            const clientDistFolder = path.join(distFolder, 'client');
            const modulesFolder = path.join(clientDistFolder, 'modules');

            if (!fsSync.existsSync(projectFolder)) await fs.mkdir(projectFolder, { recursive: true });
            if (!fsSync.existsSync(distFolder)) await fs.mkdir(distFolder, { recursive: true });
            if (!fsSync.existsSync(serverDistFolder)) await fs.mkdir(serverDistFolder, { recursive: true });
            if (!fsSync.existsSync(clientDistFolder)) await fs.mkdir(clientDistFolder, { recursive: true });

            if (gameCode) await fs.writeFile(path.join(clientDistFolder, 'game.js'), gameCode, 'utf8');
            if (serverGameCode) await fs.writeFile(path.join(serverDistFolder, 'game.js'), serverGameCode, 'utf8');
            if (engineCode) await fs.writeFile(path.join(clientDistFolder, 'engine.js'), engineCode, 'utf8');

            if (modules && modules.length > 0) {
                if (!fsSync.existsSync(modulesFolder)) await fs.mkdir(modulesFolder, { recursive: true });
                for (const module of modules) {
                    const modulePath = path.join(modulesFolder, path.basename(module.filename));
                    await fs.writeFile(modulePath, module.content, 'utf8');
                }
            }
            res.status(200).send('Compiled game files saved successfully!');
        } catch (error) {
            console.error('Error saving compiled game files:', error);
            res.status(error.status || 500).send('Error saving compiled game files');
        }
    });

    router.post('/load-project', async (req, res) => {
        const projectName = req.body.projectName;
        try {
            if (!projectName) return res.status(400).send('Project name is required');
            const buildFolder = safeJoin(projsDir, `${projectName}/config`, confineDir);
            const fileName = projectName.toUpperCase().replace(/ /g, '_');
            const buildFilePath = path.join(buildFolder, `${fileName}.json`);
            if (!fsSync.existsSync(buildFilePath)) return res.status(404).send('Config not found');
            const project = JSON.parse(await fs.readFile(buildFilePath, 'utf8'));
            res.status(200).json({ project });
        } catch (error) {
            console.error('Error loading config:', error);
            res.status(error.status || 500).send('Error loading config');
        }
    });

    router.post('/upload-file', upload.single('file'), async (req, res) => {
        try {
            if (!req.file) return res.status(400).json({ error: 'No file uploaded.' });

            const projectName = req.body.projectName;
            const objectType = req.body.objectType;
            const uploadedFile = req.file;

            const resourceFolder = safeJoin(projsDir, path.join(projectName, 'resources', objectType), confineDir);
            const finalFilePath = safeJoin(resourceFolder, uploadedFile.originalname, resourceFolder);

            if (!fsSync.existsSync(resourceFolder)) await fs.mkdir(resourceFolder, { recursive: true });
            await fs.rename(uploadedFile.path, finalFilePath);

            const relativePath = path.relative(baseDir, finalFilePath).replace(/\\/g, '/');
            res.json({ filePath: relativePath, fileName: uploadedFile.originalname });
        } catch (error) {
            console.error('Error uploading file:', error);
            res.status(error.status || 500).json({ error: error.message });
        }
    });

    router.post('/upload-model', upload.single('gltfFile'), async (req, res) => {
        try {
            if (!req.file) return res.status(400).json({ error: 'No file uploaded.' });
            if (!req.file.originalname.endsWith('.gltf') && !req.file.originalname.endsWith('.glb')) {
                return res.status(400).json({ error: `Uploaded file "${req.file.originalname}" is not a .gltf file or .glb file.` });
            }
            const projectName = req.body.projectName;
            const modelFolder = safeJoin(projsDir, path.join(projectName, 'resources', 'models'), confineDir);
            const finalGltfPath = safeJoin(modelFolder, req.file.originalname, modelFolder);

            if (!fsSync.existsSync(modelFolder)) await fs.mkdir(modelFolder, { recursive: true });
            await fs.rename(req.file.path, finalGltfPath);

            const relativePath = path.relative(baseDir, finalGltfPath).replace(/\\/g, '/');
            res.json({ filePath: relativePath, fileName: req.file.originalname });
        } catch (error) {
            console.error(error);
            res.status(error.status || 500).json({ error: error.message });
        }
    });

    router.post('/save-file', async (req, res) => {
        try {
            const { path: relPath, content, encoding } = req.body;
            const filePath = projPath(relPath);
            const dir = path.dirname(filePath);
            if (!fsSync.existsSync(dir)) await fs.mkdir(dir, { recursive: true });
            const data = encoding === 'base64' ? Buffer.from(content, 'base64') : content;
            await fs.writeFile(filePath, data);
            fileTimestamps.set(filePath, Date.now());
            res.send({ success: true, message: 'File saved' });
        } catch (error) {
            console.error('Error saving file:', error);
            res.status(error.status || 500).send({ success: false, error: error.message });
        }
    });

    router.post('/delete-file', async (req, res) => {
        try {
            const filePath = projPath(req.body.path);
            if (!fsSync.existsSync(filePath)) return res.status(404).send({ success: false, error: 'File not found' });
            await fs.unlink(filePath);
            fileTimestamps.delete(filePath);
            res.send({ success: true, message: 'File deleted' });
        } catch (error) {
            console.error('Error deleting file:', error);
            res.status(error.status || 500).send({ success: false, error: error.message });
        }
    });

    router.post('/delete-folder', async (req, res) => {
        try {
            const folderPath = projPath(req.body.path);
            if (!fsSync.existsSync(folderPath)) return res.status(404).send({ success: false, error: 'Folder not found' });
            await fs.rm(folderPath, { recursive: true, force: true });
            res.send({ success: true, message: 'Folder deleted' });
        } catch (error) {
            console.error('Error deleting folder:', error);
            res.status(error.status || 500).send({ success: false, error: error.message });
        }
    });

    router.post('/read-file', async (req, res) => {
        try {
            const { path: relPath, isModule } = req.body;
            const filePath = isModule ? modPath(relPath) : projPath(relPath);
            if (!fsSync.existsSync(filePath)) return res.status(404).send({ success: false, error: 'File not found' });
            res.send(await fs.readFile(filePath, 'utf8'));
        } catch (error) {
            console.error('Error reading file:', error);
            res.status(error.status || 500).send({ success: false, error: error.message });
        }
    });

    router.post('/read-files', async (req, res) => {
        const { files, isModule } = req.body;
        if (!Array.isArray(files)) return res.status(400).json({ success: false, error: 'files must be an array' });
        try {
            const results = {};
            const CHUNK_SIZE = 50;
            for (let i = 0; i < files.length; i += CHUNK_SIZE) {
                const chunk = files.slice(i, i + CHUNK_SIZE);
                await Promise.all(chunk.map(async (filePath) => {
                    try {
                        const fullPath = isModule ? modPath(filePath) : projPath(filePath);
                        if (fsSync.existsSync(fullPath)) results[filePath] = await fs.readFile(fullPath, 'utf8');
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

    router.post('/list-files', async (req, res) => {
        try {
            const { path: relPath, since, isModule } = req.body;
            const dirPath = isModule ? modPath(relPath) : projPath(relPath);
            const baseForRel = isModule ? modulesDir : projsDir;
            const sinceTimestamp = since || 0;

            if (!fsSync.existsSync(dirPath)) return res.json([]);
            setupWatcher(dirPath);
            const fileDetails = await getAllFiles(dirPath, baseForRel);
            res.json(fileDetails.filter(file => file.modified > sinceTimestamp));
        } catch (error) {
            console.error('Error listing files:', error);
            res.status(error.status || 500).send({ success: false, error: error.message });
        }
    });

    router.post('/list-modules', async (req, res) => {
        try {
            const { path: relPath, since } = req.body;
            const dirPath = modPath(relPath);
            const sinceTimestamp = since || 0;
            if (!fsSync.existsSync(dirPath)) return res.json([]);
            setupWatcher(dirPath);
            const fileDetails = await getAllFiles(dirPath, modulesDir);
            res.json(fileDetails.filter(file => file.modified > sinceTimestamp));
        } catch (error) {
            console.error('Error listing modules:', error);
            res.status(error.status || 500).send({ success: false, error: error.message });
        }
    });

    router.get('/browse-directory', (req, res) => {
        const directories = ['configs', 'scripts', 'data']
            .map(dir => path.join(projsDir, dir).replace(/\\/g, '/'));
        res.json({ path: directories[0], options: directories });
    });

    router.get('/list-projects', async (req, res) => {
        try {
            const projects = await listProjects();
            res.json({ projects });
        } catch (error) {
            console.error('Error listing projects:', error);
            res.status(500).json({ error: error.message, projects: [] });
        }
    });

    router.get('/api/cache/:prefix', async (req, res) => {
        try {
            const cacheFile = safeJoin(cacheDir, `${req.params.prefix}.json`, cacheDir);
            const data = await fs.readFile(cacheFile, 'utf8');
            res.json(JSON.parse(data));
        } catch (error) {
            res.status(404).json({ error: 'Cache not found' });
        }
    });

    router.post('/api/cache', async (req, res) => {
        try {
            const { prefix, images } = req.body;
            const cacheFile = safeJoin(cacheDir, `${prefix}.json`, cacheDir);
            await ensureCacheDir();
            await fs.writeFile(cacheFile, JSON.stringify({ images }, null, 2));
            res.json({ success: true });
        } catch (error) {
            console.error('Error saving cache:', error);
            res.status(error.status || 500).json({ error: 'Failed to save cache' });
        }
    });

    router.post('/api/save-texture', async (req, res) => {
        const { projectName, textureName, collectionName, imageData } = req.body;
        if (!projectName || !textureName || !imageData) {
            return res.status(400).json({ error: 'Missing required fields' });
        }
        try {
            const fileName = `${textureName}.png`;
            let texturesFolder, relativePath;
            if (collectionName) {
                texturesFolder = safeJoin(projsDir, path.join(projectName, 'resources', collectionName), confineDir);
                relativePath = `${collectionName}/${fileName}`;
            } else {
                texturesFolder = safeJoin(projsDir, path.join(projectName, 'resources', 'textures'), confineDir);
                relativePath = `textures/${fileName}`;
            }
            if (!fsSync.existsSync(texturesFolder)) await fs.mkdir(texturesFolder, { recursive: true });

            const base64Data = imageData.replace(/^data:image\/\w+;base64,/, '');
            const buffer = Buffer.from(base64Data, 'base64');
            await fs.writeFile(safeJoin(texturesFolder, fileName, texturesFolder), buffer);
            res.json({ success: true, filePath: relativePath });
        } catch (error) {
            console.error('Error saving texture:', error);
            res.status(error.status || 500).json({ error: 'Failed to save texture' });
        }
    });

    router.post('/api/save-isometric-sprites', async (req, res) => {
        try {
            const { projectName, baseName, collectionName, spriteSheet, spriteMetadata,
                    ballisticSpriteMetadata, ballisticAngleNames, groundLevelSpriteMetadata,
                    generatorSettings, spriteOffset, groundLevelSpriteOffset } = req.body;

            const spritesFolder = safeJoin(projsDir, path.join(projectName, 'resources', 'sprites', collectionName), confineDir);
            const scriptsSpriteAnimationSetsFolder = safeJoin(projsDir, path.join(projectName, 'collections', 'data', 'spriteAnimationSets'), confineDir);

            await fs.mkdir(spritesFolder, { recursive: true });
            await fs.mkdir(scriptsSpriteAnimationSetsFolder, { recursive: true });

            const sheetName = `${baseName}Sheet`;
            const base64Data = spriteSheet.replace(/^data:image\/\w+;base64,/, '');
            const buffer = Buffer.from(base64Data, 'base64');
            await fs.writeFile(path.join(spritesFolder, `${sheetName}.png`), buffer);

            const spriteSheetPath = `sprites/${collectionName}/${sheetName}.png`;
            const frames = {};
            let totalFrameCount = 0;

            for (const animType in spriteMetadata) {
                const metadata = spriteMetadata[animType];
                for (const animationName in metadata.animations) {
                    const frameList = metadata.animations[animationName];
                    for (let i = 0; i < frameList.length; i++) {
                        const frame = frameList[i];
                        frames[`${animationName}_${i}`] = { x: frame.x, y: frame.y, w: frame.width, h: frame.height };
                        totalFrameCount++;
                    }
                }
            }

            const animationSetJson = {
                title: baseName.charAt(0).toUpperCase() + baseName.slice(1),
                spriteSheet: spriteSheetPath,
                spriteOffset: spriteOffset ?? 0,
                groundLevelSpriteOffset: groundLevelSpriteOffset ?? null,
                generatorSettings: generatorSettings ? {
                    ...generatorSettings,
                    animationTypes: Object.keys(spriteMetadata)
                } : undefined,
                frames
            };
            if (!animationSetJson.generatorSettings) delete animationSetJson.generatorSettings;

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
                                frames[`${animationName}_${i}`] = { x: frame.x, y: frame.y, w: frame.width, h: frame.height };
                                ballisticFrameCount++;
                            }
                        }
                    }
                }
            }

            let groundLevelFrameCount = 0;
            if (groundLevelSpriteMetadata) {
                for (const animType in groundLevelSpriteMetadata) {
                    const metadata = groundLevelSpriteMetadata[animType];
                    for (const animationName in metadata.animations) {
                        const frameList = metadata.animations[animationName];
                        for (let i = 0; i < frameList.length; i++) {
                            const frame = frameList[i];
                            frames[`${animationName}_${i}`] = { x: frame.x, y: frame.y, w: frame.width, h: frame.height };
                            groundLevelFrameCount++;
                        }
                    }
                }
            }

            await fs.writeFile(
                path.join(scriptsSpriteAnimationSetsFolder, `${baseName}.json`),
                JSON.stringify(animationSetJson, null, 2)
            );

            res.json({
                success: true,
                frameCount: totalFrameCount + ballisticFrameCount + groundLevelFrameCount,
                groundLevelFrameCount,
                format: 'stripped'
            });
        } catch (error) {
            console.error('Error saving isometric sprites:', error);
            res.status(error.status || 500).json({ error: error.message });
        }
    });

    return router;
}

/**
 * Read the canonical Editor page and rewrite it for an external mount: point its
 * asset URLs at the sub-paths this router serves, and inject the runtime config
 * the editor client reads (API base, enabled flag, preselected project).
 */
function editorPageHtml({ base, projectName, gutsRoot }) {
    const src = path.join(gutsRoot, 'projects', 'Editor', 'index.html');
    let html = fsSync.readFileSync(src, 'utf8');

    html = html
        .replace('./dist/editor.js', `${base}/editor/dist/editor.js`)
        .replace(/(href|src)="\/style\//g, `$1="${base}/editor/style/`)
        .replace('src="/version.js"', `src="${base}/editor/version.js"`)
        .replace('src="/logo.png"', `src="${base}/editor/logo.png"`);

    // A classic inline script runs during parse, before the deferred module
    // bundle — so these globals are guaranteed set before the editor boots.
    const inject = `<script>window.GUTS_EDITOR_API_BASE=${JSON.stringify(base)};`
        + `window.GUTS_EDITOR_ENABLED=true;`
        + `window.GUTS_EDITOR_PROJECT=${JSON.stringify(projectName)};</script>`;
    html = html.replace('</title>', `</title>\n    ${inject}`);
    return html;
}

/**
 * Mount a project-scoped editor (page + filesystem API) onto an app, for an
 * external project hosting its own editor.
 *
 *   mountEditor(app, { base, projectRoot: __dirname });
 *
 * Serves, under `base`:
 *   GET  <base>/editor            the editor SPA
 *   GET  <base>/editor/dist/*     the project's built editor bundle
 *   GET  <base>/editor/style/*    framework editor CSS (from the GUTS package)
 *        <base>/save-file etc.    the filesystem API, scoped to this project
 *
 * @param {import('express').Express} app
 * @param {object}   opts
 * @param {string}   opts.projectRoot        the project's own directory (pass __dirname).
 * @param {string}   [opts.base='']          URL prefix the project is served under.
 * @param {string}   [opts.gutsRoot]         GUTS install dir. Defaults to this module's dir.
 * @param {string}   [opts.projectName]      defaults to basename(projectRoot).
 * @param {string}   [opts.editorBundleDir]  built editor bundle dir. Defaults to <projectRoot>/dist/editor.
 * @param {function|null} [opts.gate]         auth middleware. Defaults to editor-auth's basic gate; pass null to disable.
 * @returns {boolean} whether the editor was actually mounted.
 */
function mountEditor(app, opts = {}) {
    const projectRoot = path.resolve(opts.projectRoot);
    const base = opts.base || '';
    const gutsRoot = path.resolve(opts.gutsRoot || __dirname);
    const projectName = opts.projectName || path.basename(projectRoot);
    const bundleDir = opts.editorBundleDir || path.join(projectRoot, 'dist', 'editor');

    let gate = opts.gate;
    if (gate === undefined) {
        // Default gate: the shared editor-auth basic gate. These endpoints read,
        // write and delete files, so this fails CLOSED everywhere — with no
        // password set the editor is simply not mounted, regardless of NODE_ENV
        // (a standalone host may signal production by other means). Set
        // GUTS_EDITOR_PASSWORD to enable it, or pass an explicit `gate`.
        const editorAuth = require('./editor-auth');
        if (!editorAuth.ENABLED) {
            console.warn('[editor-api] GUTS_EDITOR_PASSWORD is not set — project editor not mounted.');
            return false;
        }
        gate = editorAuth.makeBasicGate();
    }

    const router = express.Router();
    if (gate) router.use(gate);

    router.get(['/editor', '/editor/'], (req, res) => {
        try {
            res.type('html').send(editorPageHtml({ base, projectName, gutsRoot }));
        } catch (error) {
            console.error('[editor-api] failed to render editor page:', error.message);
            res.status(500).send('Editor page unavailable.');
        }
    });
    router.use('/editor/dist', express.static(bundleDir));
    router.use('/editor/style', express.static(path.join(gutsRoot, 'style')));
    router.get('/editor/version.js', (req, res) => res.sendFile(path.join(gutsRoot, 'version.js')));
    router.get('/editor/logo.png', (req, res) => res.sendFile(path.join(gutsRoot, 'logo.png')));

    router.use('/', createEditorApi({
        projsDir: path.dirname(projectRoot), // parent → "<name>/collections/..." resolves to this project
        modulesDir: path.join(gutsRoot, 'global', 'collections'),
        cacheDir: path.join(projectRoot, 'cache'),
        baseDir: path.dirname(projectRoot),
        uploadsDir: path.join(projectRoot, 'uploads'),
        confineDir: projectRoot,                 // pin everything inside this project
        listProjects: async () => [projectName]  // the editor only ever sees this one
    }));

    app.use(base || '/', router);
    console.log(`[editor-api] Project editor mounted at ${base || ''}/editor (project "${projectName}").`);
    return true;
}

module.exports = { createEditorApi, mountEditor, SUPPORTED_EXTENSIONS };
