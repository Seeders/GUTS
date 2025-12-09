/**
 * Configuration Parser for GUTS Webpack Build
 *
 * Builds from source files with config-based filtering:
 * - Libraries, managers, systems: Use what's specified in game.json/server.json/editor.json
 * - Collection data (abilities, items, behaviors, etc.): Include ALL from folders
 */

const fs = require('fs');
const path = require('path');

class ConfigParser {
    constructor(projectName) {
        this.projectName = projectName;
        this.projectRoot = path.join(__dirname, '..', 'projects', projectName);
        this.globalRoot = path.join(__dirname, '..', 'global', 'collections');
        this.collectionsRoot = path.join(this.projectRoot, 'collections');

        // Cache for library metadata loaded from data JSON files
        this.libraryMetadata = {};

        // Cache for object type definitions
        this.objectTypeDefinitions = [];

        // Discovered collections (project)
        this.collections = {};

        // Discovered editor collections
        this.editorCollections = {};

        // Loaded configs from Settings/configs
        this.configs = {};
    }

    /**
     * Load all configs from Settings/configs folder
     */
    loadConfigs() {
        const configsPath = path.join(this.collectionsRoot, 'settings', 'configs');

        if (!fs.existsSync(configsPath)) {
            console.warn('  settings/configs folder not found');
            return;
        }

        // Load ALL JSON files in the configs folder
        const configFiles = fs.readdirSync(configsPath).filter(f => f.endsWith('.json'));
        for (const file of configFiles) {
            const configName = path.basename(file, '.json');
            const configPath = path.join(configsPath, file);
            this.configs[configName] = JSON.parse(fs.readFileSync(configPath, 'utf8'));
            console.log(`  Loaded ${configName}.json`);
        }
    }

    /**
     * Load objectTypeDefinitions from Settings/objectTypeDefinitions folder
     */
    loadObjectTypeDefinitions() {
        const defsPath = path.join(this.collectionsRoot, 'settings', 'objectTypeDefinitions');
        if (!fs.existsSync(defsPath)) {
            console.warn('  objectTypeDefinitions folder not found');
            return;
        }

        const files = fs.readdirSync(defsPath).filter(f => f.endsWith('.json'));
        for (const file of files) {
            const data = JSON.parse(fs.readFileSync(path.join(defsPath, file), 'utf8'));
            this.objectTypeDefinitions.push(data);
        }

        console.log(`  Loaded ${this.objectTypeDefinitions.length} objectTypeDefinitions`);
    }

    /**
     * Load library metadata from data JSON files in discovered 'libraries' collections
     * Scans both global and project collections dynamically
     */
    loadLibraryMetadata() {
        // Load editor library metadata from discovered 'libraries' collection
        const editorLibraries = this.editorCollections['libraries'];
        if (editorLibraries && editorLibraries.dataPath) {
            const dataFiles = this.scanDataFolder(editorLibraries.dataPath);
            for (const fileInfo of dataFiles) {
                const data = JSON.parse(fs.readFileSync(fileInfo.path, 'utf8'));
                const name = data.fileName || fileInfo.name;
                this.libraryMetadata[name] = { ...data, source: 'editor' };

                // Also register with name variants (e.g., three.EffectComposer -> three_EffectComposer)
                const underscoreName = name.replace(/\./g, '_');
                if (underscoreName !== name) {
                    this.libraryMetadata[underscoreName] = { ...data, source: 'editor' };
                }
            }
        }

        // Load project library metadata (overrides global) from discovered 'libraries' collection
        const projectLibraries = this.collections['libraries'];
        if (projectLibraries && projectLibraries.dataPath) {
            const dataFiles = this.scanDataFolder(projectLibraries.dataPath);
            for (const fileInfo of dataFiles) {
                const data = JSON.parse(fs.readFileSync(fileInfo.path, 'utf8'));
                const name = data.fileName || fileInfo.name;
                this.libraryMetadata[name] = { ...data, source: 'project' };

                // Also register with name variants
                const underscoreName = name.replace(/\./g, '_');
                if (underscoreName !== name) {
                    this.libraryMetadata[underscoreName] = { ...data, source: 'project' };
                }
            }
        }

        console.log(`  Loaded ${Object.keys(this.libraryMetadata).length} library metadata entries`);
    }

    /**
     * Scan a folder for JS files and return file info
     */
    scanJsFolder(folderPath) {
        const files = [];
        if (!fs.existsSync(folderPath)) {
            return files;
        }

        const entries = fs.readdirSync(folderPath).filter(f => f.endsWith('.js'));
        for (const entry of entries) {
            const fullPath = path.join(folderPath, entry);
            const fileName = path.basename(entry, '.js');
            files.push({
                name: fileName,
                fileName: fileName,
                path: fullPath
            });
        }

        return files;
    }

    /**
     * Scan a folder for JSON data files and return file info
     */
    scanDataFolder(folderPath) {
        const files = [];
        if (!fs.existsSync(folderPath)) {
            return files;
        }

        const entries = fs.readdirSync(folderPath).filter(f => f.endsWith('.json'));
        for (const entry of entries) {
            const fullPath = path.join(folderPath, entry);
            const fileName = path.basename(entry, '.json');
            files.push({
                name: fileName,
                fileName: fileName,
                path: fullPath
            });
        }

        return files;
    }

    /**
     * Scan a folder for files with a specific extension
     */
    scanFolderByExtension(folderPath, extension) {
        const files = [];
        if (!fs.existsSync(folderPath)) {
            return files;
        }

        const entries = fs.readdirSync(folderPath).filter(f => f.endsWith(extension));
        for (const entry of entries) {
            const fullPath = path.join(folderPath, entry);
            const fileName = path.basename(entry, extension);
            files.push({
                name: fileName,
                fileName: fileName,
                path: fullPath
            });
        }

        return files;
    }

    /**
     * Discover all collections by scanning the actual folder structure.
     * The folder structure is the source of truth - objectTypeDefinitions are only used for metadata.
     */
    discoverCollections() {
        console.log('\n  Discovering collections from folder structure...');

        // Build a map of objectTypeDefinition id -> definition for metadata lookup
        const objTypeDefMap = new Map();
        for (const def of this.objectTypeDefinitions) {
            objTypeDefMap.set(def.id, def);
        }

        // Scan all top-level directories under scripts/ as potential categories
        if (!fs.existsSync(this.collectionsRoot)) {
            console.warn(`    Scripts root not found: ${this.collectionsRoot}`);
            return;
        }

        const categoryFolders = fs.readdirSync(this.collectionsRoot, { withFileTypes: true })
            .filter(d => d.isDirectory())
            .map(d => d.name);

        console.log(`    Found ${categoryFolders.length} category folders`);

        // Process each category folder
        for (const category of categoryFolders) {
            const categoryPath = path.join(this.collectionsRoot, category);

            // Get all subfolders in this category
            const subfolders = fs.readdirSync(categoryPath, { withFileTypes: true })
                .filter(d => d.isDirectory())
                .map(d => d.name);

            for (const subfolder of subfolders) {
                const collectionId = subfolder;
                const folderPath = path.join(categoryPath, subfolder);

                // Auto-detect if this collection uses js/data/html/css subfolder structure
                // by checking if a 'data' or 'js' subfolder exists
                const potentialJsPath = path.join(folderPath, 'js');
                const potentialDataPath = path.join(folderPath, 'data');
                const hasSubfolderStructure = fs.existsSync(potentialJsPath) || fs.existsSync(potentialDataPath);

                // Determine paths for JS, data, HTML, and CSS files
                let jsPath, dataPath, htmlPath, cssPath;
                if (hasSubfolderStructure) {
                    jsPath = potentialJsPath;
                    dataPath = potentialDataPath;
                    htmlPath = path.join(folderPath, 'html');
                    cssPath = path.join(folderPath, 'css');
                } else {
                    jsPath = folderPath;
                    dataPath = folderPath;
                    htmlPath = null;
                    cssPath = null;
                }

                // Scan for JS files and data files
                const jsFiles = this.scanJsFolder(jsPath);
                const dataFiles = this.scanDataFolder(dataPath);

                // Scan for HTML and CSS files if applicable
                const htmlFiles = htmlPath ? this.scanFolderByExtension(htmlPath, '.html') : [];
                const cssFiles = cssPath ? this.scanFolderByExtension(cssPath, '.css') : [];

                // Include collection if it has JS files OR data files
                if (jsFiles.length > 0 || dataFiles.length > 0) {
                    this.collections[collectionId] = {
                        id: collectionId,
                        parent: category,
                        jsPath: jsPath,
                        dataPath: dataPath,
                        htmlPath: htmlPath,
                        cssPath: cssPath,
                        files: jsFiles,
                        dataFiles: dataFiles,
                        htmlFiles: htmlFiles,
                        cssFiles: cssFiles
                    };
                }
            }
        }

        console.log(`    Found ${Object.keys(this.collections).length} collections`);
    }

    /**
     * Discover all editor collections by scanning the editor/collections folder structure.
     * Same logic as discoverCollections but for the editor collections.
     */
    discoverEditorCollections() {
        console.log('\n  Discovering editor collections from folder structure...');

        if (!fs.existsSync(this.globalRoot)) {
            console.warn(`    Editor collections root not found: ${this.globalRoot}`);
            return;
        }

        const categoryFolders = fs.readdirSync(this.globalRoot, { withFileTypes: true })
            .filter(d => d.isDirectory())
            .map(d => d.name);

        console.log(`    Found ${categoryFolders.length} editor category folders`);

        // Process each category folder
        for (const category of categoryFolders) {
            const categoryPath = path.join(this.globalRoot, category);

            // Get all subfolders in this category
            const subfolders = fs.readdirSync(categoryPath, { withFileTypes: true })
                .filter(d => d.isDirectory())
                .map(d => d.name);

            for (const subfolder of subfolders) {
                const collectionId = subfolder;
                const folderPath = path.join(categoryPath, subfolder);

                // Auto-detect if this collection uses js/data/html/css subfolder structure
                // by checking if a 'data' or 'js' subfolder exists
                const potentialJsPath = path.join(folderPath, 'js');
                const potentialDataPath = path.join(folderPath, 'data');
                const hasSubfolderStructure = fs.existsSync(potentialJsPath) || fs.existsSync(potentialDataPath);

                // Determine paths for JS, data, HTML, and CSS files
                let jsPath, dataPath, htmlPath, cssPath;
                if (hasSubfolderStructure) {
                    jsPath = potentialJsPath;
                    dataPath = potentialDataPath;
                    htmlPath = path.join(folderPath, 'html');
                    cssPath = path.join(folderPath, 'css');
                } else {
                    jsPath = folderPath;
                    dataPath = folderPath;
                    htmlPath = null;
                    cssPath = null;
                }

                // Scan for JS files and data files
                const jsFiles = this.scanJsFolder(jsPath);
                const dataFiles = this.scanDataFolder(dataPath);

                // Scan for HTML and CSS files if applicable
                const htmlFiles = htmlPath ? this.scanFolderByExtension(htmlPath, '.html') : [];
                const cssFiles = cssPath ? this.scanFolderByExtension(cssPath, '.css') : [];

                // Include collection if it has JS files OR data files
                if (jsFiles.length > 0 || dataFiles.length > 0) {
                    this.editorCollections[collectionId] = {
                        id: collectionId,
                        parent: category,
                        jsPath: jsPath,
                        dataPath: dataPath,
                        htmlPath: htmlPath,
                        cssPath: cssPath,
                        files: jsFiles,
                        dataFiles: dataFiles,
                        htmlFiles: htmlFiles,
                        cssFiles: cssFiles
                    };
                }
            }
        }

        console.log(`    Found ${Object.keys(this.editorCollections).length} editor collections`);
    }

    /**
     * Find a collection by name, checking both editor and project collections
     */
    findCollection(collectionName) {
        // Check editor collections first
        if (this.editorCollections[collectionName]) {
            return { collection: this.editorCollections[collectionName], source: 'editor' };
        }
        // Then check project collections
        if (this.collections[collectionName]) {
            return { collection: this.collections[collectionName], source: 'project' };
        }
        return null;
    }

    /**
     * Get library paths for specified library names (from config)
     */
    getLibraryPaths(libraryNames) {
        const paths = [];

        for (const libName of libraryNames) {
            const metadata = this.libraryMetadata[libName];

            // Handle threejs special case - npm package
            if (libName === 'threejs' || libName === 'THREE') {
                const threePath = path.join(__dirname, '..', 'node_modules', 'three', 'build', 'three.module.min.js');
                if (fs.existsSync(threePath)) {
                    console.log(`    Library THREE: npm three`);
                    paths.push({
                        name: 'threejs',
                        path: threePath,
                        isModule: true,
                        requireName: 'THREE',
                        fileName: 'threejs',
                        windowContext: 'THREE'
                    });
                    continue;
                }
            }

            // Handle Rapier special case (check before CDN skip)
            if (libName === 'Rapier' || (metadata && metadata.href && (metadata.href.includes('rapier3d') || metadata.href.includes('rapier')))) {
                let rapierPath = path.join(__dirname, '..', 'node_modules', '@dimforge', 'rapier3d', 'rapier.es.js');
                if (!fs.existsSync(rapierPath)) {
                    rapierPath = path.join(__dirname, '..', 'node_modules', '@dimforge', 'rapier3d-compat', 'rapier.es.js');
                }
                if (fs.existsSync(rapierPath)) {
                    console.log(`    Library Rapier: npm @dimforge/rapier3d`);
                    paths.push({
                        name: 'Rapier',
                        path: rapierPath,
                        isModule: true,
                        requireName: 'RAPIER',
                        fileName: 'Rapier'
                    });
                    continue;
                }
            }

            // Handle Three.js examples/addons from CDN - convert to npm imports
            if (metadata && metadata.href && metadata.href.includes('three@') && metadata.href.includes('/examples/jsm/')) {
                const match = metadata.href.match(/\/examples\/jsm\/(.+)\.js$/);
                if (match) {
                    const examplePath = match[1];
                    const absolutePath = path.join(__dirname, '..', 'node_modules', 'three', 'examples', 'jsm', `${examplePath}.js`);

                    if (fs.existsSync(absolutePath)) {
                        console.log(`    Library ${libName}: npm three.js addon`);
                        paths.push({
                            name: libName,
                            path: absolutePath,
                            isModule: true,
                            requireName: metadata.requireName || metadata.fileName || libName,
                            windowContext: metadata.windowContext
                        });
                        continue;
                    }
                }
            }

            // Handle socket.io from CDN - use socket.io-client npm package
            if (metadata && metadata.href && metadata.href.includes('socket.io')) {
                const socketPath = path.join(__dirname, '..', 'node_modules', 'socket.io-client', 'build', 'esm', 'index.js');
                if (fs.existsSync(socketPath)) {
                    console.log(`    Library io: npm socket.io-client`);
                    paths.push({
                        name: 'io',
                        path: socketPath,
                        isModule: true,
                        requireName: 'io',
                        fileName: 'socket_io_client',
                        windowContext: 'io'
                    });
                    continue;
                }
            }

            // Skip other external CDN libraries (href without special handling)
            if (metadata && metadata.href) {
                console.log(`    Skipping external library: ${libName} (${metadata.href})`);
                continue;
            }

            // Try to find the library file using discovered collections
            let foundPath = null;
            let source = null;

            // Search project libraries first (higher priority for project-specific overrides)
            const projectLibraries = this.collections['libraries'];
            if (projectLibraries) {
                const libFile = projectLibraries.files.find(f => f.name === libName || f.fileName === libName);
                if (libFile) {
                    foundPath = libFile.path;
                    source = 'project';
                }
            }

            // Then search editor libraries if not found in project
            if (!foundPath) {
                const editorLibraries = this.editorCollections['libraries'];
                if (editorLibraries) {
                    const libFile = editorLibraries.files.find(f => f.name === libName || f.fileName === libName);
                    if (libFile) {
                        foundPath = libFile.path;
                        source = 'editor';
                    }
                }
            }

            // If metadata has a filePath, use that as fallback
            if (!foundPath && metadata && metadata.filePath) {
                const configuredPath = path.join(__dirname, '..', metadata.filePath);
                if (fs.existsSync(configuredPath)) {
                    foundPath = configuredPath;
                    source = 'configured';
                }
            }

            if (foundPath) {
                console.log(`    Library ${libName}: ${source}`);
                paths.push({
                    name: libName,
                    path: foundPath,
                    isModule: metadata?.isModule || false,
                    requireName: metadata?.requireName || libName,
                    fileName: metadata?.fileName || libName,
                    windowContext: metadata?.windowContext
                });
            } else {
                console.warn(`    Library not found: ${libName}`);
            }
        }

        return paths;
    }

    /**
     * Get script paths for specified script names (managers, systems)
     */
    getScriptPaths(collectionName, scriptNames) {
        const paths = [];

        const collection = this.collections[collectionName];
        if (!collection) {
            console.warn(`    Collection not found: ${collectionName}`);
            return paths;
        }

        for (const scriptName of scriptNames) {
            const file = collection.files.find(f => f.name === scriptName || f.fileName === scriptName);
            if (file) {
                paths.push(file);
            } else {
                console.warn(`    Script not found: ${scriptName} in ${collectionName}`);
            }
        }

        return paths;
    }

    /**
     * Get all class files from a collection (auto-discover all)
     */
    getAllClassesFromCollection(collectionName) {
        const collection = this.collections[collectionName];
        if (!collection) {
            return [];
        }
        return collection.files;
    }

    /**
     * Get all class collections based on config classes array
     */
    getClassCollections(classesConfig) {
        const classCollections = {};
        const classMetadata = [];

        if (!classesConfig || !Array.isArray(classesConfig)) {
            return { classCollections, classMetadata };
        }

        for (const classRef of classesConfig) {
            const collectionName = classRef.collection;
            if (!collectionName) continue;

            const allClasses = this.getAllClassesFromCollection(collectionName);

            if (allClasses.length > 0) {
                if (!classCollections[collectionName]) {
                    classCollections[collectionName] = [];
                }
                classCollections[collectionName].push(...allClasses);

                if (classRef.baseClass) {
                    classMetadata.push({
                        collection: collectionName,
                        baseClass: classRef.baseClass,
                        files: allClasses
                    });
                }

                console.log(`    Collection ${collectionName}: ${allClasses.length} classes`);
            }
        }

        return { classCollections, classMetadata };
    }

    /**
     * Get all data collections (JSON, HTML, CSS files) for bundling
     * Returns object mapping collectionName -> { dataFiles, htmlFiles, cssFiles }
     */
    getDataCollections() {
        const dataCollections = {};

        for (const [collectionId, collection] of Object.entries(this.collections)) {
            const hasData = collection.dataFiles && collection.dataFiles.length > 0;
            const hasHtml = collection.htmlFiles && collection.htmlFiles.length > 0;
            const hasCss = collection.cssFiles && collection.cssFiles.length > 0;

            if (hasData || hasHtml || hasCss) {
                dataCollections[collectionId] = {
                    dataFiles: collection.dataFiles || [],
                    htmlFiles: collection.htmlFiles || [],
                    cssFiles: collection.cssFiles || []
                };
            }
        }

        console.log(`    Data collections: ${Object.keys(dataCollections).length}`);
        return dataCollections;
    }

    /**
     * Generate client entry point data
     * Uses libraries/managers/systems from game.json config
     * Auto-discovers all classes from specified collections
     */
    getClientEntry() {
        const gameConfig = this.configs.game;
        if (!gameConfig) {
            console.warn('  No game config found');
            return null;
        }

        console.log('\n  Building client entry...');

        const libraries = this.getLibraryPaths(gameConfig.libraries || []);
        const systems = this.getScriptPaths('systems', gameConfig.systems || []);
        const { classCollections, classMetadata } = this.getClassCollections(gameConfig.classes || []);
        const dataCollections = this.getDataCollections();

        console.log(`    Libraries: ${libraries.length}`);
        console.log(`    Systems: ${systems.length}`);
        console.log(`    Class collections: ${Object.keys(classCollections).length}`);

        return {
            libraries,
            systems,
            classCollections,
            classMetadata,
            dataCollections,
            config: gameConfig
        };
    }

    /**
     * Generate server entry point data
     * Uses libraries/systems from server.json config
     * Auto-discovers all classes from specified collections
     */
    getServerEntry() {
        const serverConfig = this.configs.server;
        if (!serverConfig) {
            console.warn('  No server config found');
            return null;
        }

        console.log('\n  Building server entry...');

        const libraries = this.getLibraryPaths(serverConfig.libraries || []);
        const systems = this.getScriptPaths('systems', serverConfig.systems || []);
        const { classCollections, classMetadata } = this.getClassCollections(serverConfig.classes || []);
        const dataCollections = this.getDataCollections();

        console.log(`    Libraries: ${libraries.length}`);
        console.log(`    Systems: ${systems.length}`);
        console.log(`    Class collections: ${Object.keys(classCollections).length}`);

        return {
            libraries,
            systems,
            classCollections,
            classMetadata,
            dataCollections,
            config: serverConfig
        };
    }

    /**
     * Generate editor entry point data
     */
    getEditorEntry() {
        const editorConfig = this.configs.editor;
        if (!editorConfig) {
            console.warn('  No editor config found');
            return null;
        }

        const editorModules = editorConfig.editorModules || [];

        // Find editorModules collection dynamically from discovered collections
        const editorModulesResult = this.findCollection('editorModules');
        const projectModulesPath = path.join(this.collectionsRoot, 'settings', 'editorModules');

        const allLibraries = [];
        const allSystems = [];
        const classCollections = {};
        const classMetadata = [];
        const moduleConfigs = {};

        console.log(`\n  Building editor entry with ${editorModules.length} modules...`);

        for (const moduleName of editorModules) {
            const projectConfigPath = path.join(projectModulesPath, `${moduleName}.json`);

            let moduleConfigPath;
            let configSource;

            // Check project first
            if (fs.existsSync(projectConfigPath)) {
                moduleConfigPath = projectConfigPath;
                configSource = 'project';
            }
            // Then check discovered editorModules collection
            else if (editorModulesResult) {
                const moduleFile = editorModulesResult.collection.dataFiles.find(f => f.name === moduleName);
                if (moduleFile) {
                    moduleConfigPath = moduleFile.path;
                    configSource = 'editor';
                }
            }

            if (!moduleConfigPath) {
                console.warn(`    Editor module config not found: ${moduleName}`);
                continue;
            }

            const moduleConfig = JSON.parse(fs.readFileSync(moduleConfigPath, 'utf8'));
            moduleConfigs[moduleName] = moduleConfig;
            console.log(`    Module: ${moduleName} (${configSource})`);

            if (moduleConfig.libraries && Array.isArray(moduleConfig.libraries)) {
                const libraryPaths = this.getLibraryPaths(moduleConfig.libraries);
                allLibraries.push(...libraryPaths);
            }

            if (moduleConfig.systems && Array.isArray(moduleConfig.systems)) {
                const systemPaths = this.getScriptPaths('systems', moduleConfig.systems);
                allSystems.push(...systemPaths);
            }

            if (moduleConfig.classes && Array.isArray(moduleConfig.classes)) {
                const { classCollections: modClasses, classMetadata: modMeta } = this.getClassCollections(moduleConfig.classes);
                Object.assign(classCollections, modClasses);
                classMetadata.push(...modMeta);
            }
        }

        console.log(`    Editor libraries: ${allLibraries.length}, systems: ${allSystems.length}`);

        return {
            libraries: allLibraries,
            systems: allSystems,
            config: editorConfig,
            modules: editorModules,
            moduleConfigs,
            classCollections,
            classMetadata
        };
    }

    /**
     * Get engine files
     */
    getEnginePaths() {
        const engineDir = path.join(__dirname, '..', 'engine');
        return {
            baseEngine: path.join(engineDir, 'BaseEngine.js'),
            engine: path.join(engineDir, 'Engine.js')
        };
    }

    /**
     * Generate complete build configuration
     */
    generateBuildConfig() {
        console.log(`\nBuilding from source files for ${this.projectName}...`);

        // Discover all collections from folder structures first (needed for metadata loading)
        this.discoverCollections();
        this.discoverEditorCollections();

        // Load metadata and configs (uses discovered collections)
        this.loadLibraryMetadata();
        this.loadObjectTypeDefinitions();
        this.loadConfigs();

        return {
            projectName: this.projectName,
            client: this.getClientEntry(),
            server: this.getServerEntry(),
            editor: this.getEditorEntry(),
            engine: this.getEnginePaths(),
            objectTypeDefinitions: this.objectTypeDefinitions,
            collections: this.collections,
            editorCollections: this.editorCollections
        };
    }
}

module.exports = ConfigParser;
