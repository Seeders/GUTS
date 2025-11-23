/**
 * Configuration Parser for GUTS Webpack Build
 * Parses project config JSON and generates entry points for webpack
 */

const fs = require('fs');
const path = require('path');

class ConfigParser {
    constructor(projectName) {
        this.projectName = projectName;
        this.projectRoot = path.join(__dirname, '..', 'projects', projectName);
        this.configPath = path.join(this.projectRoot, 'config', `${projectName.toUpperCase()}.json`);
        this.config = null;
    }

    loadConfig() {
        if (!fs.existsSync(this.configPath)) {
            throw new Error(`Config not found: ${this.configPath}`);
        }

        const configContent = fs.readFileSync(this.configPath, 'utf8');
        this.config = JSON.parse(configContent);
        console.log(`✅ Loaded config for ${this.projectName}`);
        return this.config;
    }

    /**
     * Get library file paths from library names
     */
    getLibraryPaths(libraryNames) {
        const paths = [];
        const libraries = this.config.objectTypes.libraries || {};

        for (const libName of libraryNames) {
            const lib = libraries[libName];
            if (!lib) {
                console.warn(`⚠️ Library not found: ${libName}`);
                continue;
            }

            // Handle Three.js examples/addons from CDN - convert to npm imports
            if (lib.href && lib.href.includes('three@') && lib.href.includes('/examples/jsm/')) {
                // Extract the path from CDN URL
                // Example: https://cdn.jsdelivr.net/npm/three@0.176.0/examples/jsm/controls/OrbitControls.js
                const match = lib.href.match(/\/examples\/jsm\/(.+)\.js$/);
                if (match) {
                    const examplePath = match[1]; // e.g., "controls/OrbitControls"
                    const absolutePath = path.join(__dirname, '..', 'node_modules', 'three', 'examples', 'jsm', `${examplePath}.js`);

                    if (fs.existsSync(absolutePath)) {
                        console.log(`✓ Using npm package for Three.js addon: ${libName}`);
                        paths.push({
                            name: libName,
                            path: absolutePath,
                            isModule: true,
                            requireName: lib.requireName || lib.fileName || libName,
                            windowContext: lib.windowContext
                        });
                        continue;
                    }
                }
            }

            // Handle socket.io from CDN - use socket.io-client npm package
            if (lib.href && lib.href.includes('socket.io')) {
                const socketPath = path.join(__dirname, '..', 'node_modules', 'socket.io-client', 'build', 'esm', 'index.js');
                console.log(`✓ Using npm package for socket.io-client`);
                paths.push({
                    name: 'io',  // socket.io-client default export
                    path: socketPath,  // Use ESM build
                    isModule: true,  // ES module
                    requireName: 'io',
                    fileName: 'socket_io_client',  // Use underscores to avoid invalid var names
                    windowContext: 'io'
                });
                continue;
            }

            // Skip other external CDN libraries (href)
            if (lib.href) {
                console.log(`⚠️ Skipping external library: ${libName} (${lib.href})`);
                continue;
            }

            if (lib.filePath) {
                // Convert absolute path to relative from project root
                const absolutePath = path.join(__dirname, '..', lib.filePath);
                if (fs.existsSync(absolutePath)) {
                    paths.push({
                        name: libName,
                        path: absolutePath,
                        isModule: lib.isModule || false,
                        requireName: lib.requireName || lib.fileName || libName,
                        windowContext: lib.windowContext
                    });
                } else {
                    console.warn(`⚠️ Library file not found: ${absolutePath}`);
                }
            }
        }

        return paths;
    }

    /**
     * Get script file paths for a collection (managers, systems, etc.)
     */
    getScriptPaths(collectionName, scriptNames) {
        const paths = [];
        const collection = this.config.objectTypes[collectionName] || {};

        for (const scriptName of scriptNames) {
            const script = collection[scriptName];
            if (!script) {
                console.warn(`⚠️ ${collectionName} not found: ${scriptName}`);
                continue;
            }

            if (script.filePath) {
                const absolutePath = path.join(__dirname, '..', script.filePath);
                if (fs.existsSync(absolutePath)) {
                    paths.push({
                        name: scriptName,
                        path: absolutePath,
                        fileName: script.fileName || scriptName
                    });
                } else {
                    console.warn(`⚠️ Script file not found: ${absolutePath}`);
                }
            }
        }

        return paths;
    }

    /**
     * Get all scripts for a scene based on its managers and systems
     */
    getSceneScripts(sceneName) {
        const scenes = this.config.objectTypes.scenes || {};
        const scene = scenes[sceneName];

        if (!scene || !scene.sceneData || !scene.sceneData[0]) {
            console.warn(`⚠️ Scene not found or empty: ${sceneName}`);
            return { managers: [], systems: [], classes: [] };
        }

        const sceneData = scene.sceneData[0];
        const managerNames = (sceneData.managers || []).map(m => m.type);
        const systemNames = (sceneData.systems || []).map(s => s.type);
        const classCollections = sceneData.classes || [];

        return {
            managers: this.getScriptPaths('managers', managerNames),
            systems: this.getScriptPaths('systems', systemNames),
            classes: classCollections
        };
    }

    /**
     * Get all class files from a collection (e.g., all abilities)
     */
    getAllClassesFromCollection(collectionName) {
        const collection = this.config.objectTypes[collectionName] || {};
        const classNames = Object.keys(collection);
        return this.getScriptPaths(collectionName, classNames);
    }

    /**
     * Generate client entry point data
     */
    getClientEntry() {
        const gameConfig = this.config.objectTypes.configs?.game;
        if (!gameConfig) {
            throw new Error('Game config not found');
        }

        // Get the initial scene from game config (don't hardcode "client")
        const initialScene = gameConfig.initialScene;
        if (!initialScene) {
            throw new Error('Game config missing initialScene');
        }

        const clientLibraries = this.getLibraryPaths(gameConfig.libraries || []);
        const clientScripts = this.getSceneScripts(initialScene);

        // Get all classes from each collection, track base classes
        const classCollections = {}; // Dynamic collections: { abilities: [...], items: [...], etc }
        const classMetadata = []; // Track base classes for each collection

        // Process each collection dynamically (NO hardcoding of collection names!)
        for (const classRef of clientScripts.classes) {
            const collectionName = classRef.collection;
            if (!collectionName) {
                console.warn('⚠️ Class reference missing collection name');
                continue;
            }

            // Get all classes from this collection
            const allClasses = this.getAllClassesFromCollection(collectionName);

            // Store in dynamic collection
            if (!classCollections[collectionName]) {
                classCollections[collectionName] = [];
            }
            classCollections[collectionName].push(...allClasses);

            // Track base class if specified
            if (classRef.baseClass) {
                classMetadata.push({
                    collection: collectionName,
                    baseClass: classRef.baseClass,
                    files: allClasses
                });
            }
        }

        return {
            libraries: clientLibraries,
            managers: clientScripts.managers,
            systems: clientScripts.systems,
            classCollections: classCollections, // Dynamic collections
            classMetadata: classMetadata, // Base class metadata
            config: gameConfig
        };
    }

    /**
     * Generate server entry point data
     */
    getServerEntry() {
        const serverConfig = this.config.objectTypes.configs?.server;
        if (!serverConfig) {
            console.warn('⚠️ No server config found');
            return null;
        }

        // Get the initial scene from server config (don't hardcode "server")
        const initialScene = serverConfig.initialScene;
        if (!initialScene) {
            console.warn('⚠️ Server config missing initialScene');
            return null;
        }

        const serverLibraries = this.getLibraryPaths(serverConfig.libraries || []);
        const serverScripts = this.getSceneScripts(initialScene);

        // Get all classes from each collection, track base classes
        const classCollections = {}; // Dynamic collections: { abilities: [...], items: [...], etc }
        const classMetadata = []; // Track base classes for each collection

        // Process each collection dynamically (NO hardcoding of collection names!)
        for (const classRef of serverScripts.classes) {
            const collectionName = classRef.collection;
            if (!collectionName) {
                console.warn('⚠️ Class reference missing collection name');
                continue;
            }

            // Get all classes from this collection
            const allClasses = this.getAllClassesFromCollection(collectionName);

            // Store in dynamic collection
            if (!classCollections[collectionName]) {
                classCollections[collectionName] = [];
            }
            classCollections[collectionName].push(...allClasses);

            // Track base class if specified
            if (classRef.baseClass) {
                classMetadata.push({
                    collection: collectionName,
                    baseClass: classRef.baseClass,
                    files: allClasses
                });
            }
        }

        return {
            libraries: serverLibraries,
            managers: serverScripts.managers,
            systems: serverScripts.systems,
            classCollections: classCollections, // Dynamic collections
            classMetadata: classMetadata, // Base class metadata
            config: serverConfig
        };
    }

    /**
     * Generate editor entry point data
     * Loads libraries and classes from editor modules specified in editor config
     */
    getEditorEntry() {
        const editorConfig = this.config.objectTypes.configs?.editor;
        if (!editorConfig) {
            console.warn('⚠️ Editor config not found');
            return null;
        }

        const editorModules = editorConfig.editorModules || [];
        const globalModulesPath = path.join(__dirname, '..', 'global', 'editorModules');
        const projectModulesPath = path.join(this.projectRoot, 'scripts', 'Settings', 'editorModules');

        const allLibraries = [];
        const classCollections = {};
        const classMetadata = [];
        const moduleConfigs = {};

        console.log(`✓ Processing ${editorModules.length} editor modules`);

        // Process each editor module in order
        for (const moduleName of editorModules) {
            // Try project folder first, then fall back to global folder
            const projectConfigPath = path.join(projectModulesPath, `${moduleName}.json`);
            const globalConfigPath = path.join(globalModulesPath, `${moduleName}.json`);

            let moduleConfigPath;
            let configSource;

            if (fs.existsSync(projectConfigPath)) {
                moduleConfigPath = projectConfigPath;
                configSource = 'project';
            } else if (fs.existsSync(globalConfigPath)) {
                moduleConfigPath = globalConfigPath;
                configSource = 'global';
            } else {
                console.warn(`⚠️ Editor module config not found: ${moduleName}`);
                continue;
            }

            const moduleConfig = JSON.parse(fs.readFileSync(moduleConfigPath, 'utf8'));
            moduleConfigs[moduleName] = moduleConfig;
            console.log(`  ✓ Loaded module: ${moduleName} (from ${configSource})`);

            // Add libraries from this module (in order)
            if (moduleConfig.libraries && Array.isArray(moduleConfig.libraries)) {
                const libraryPaths = this.getLibraryPaths(moduleConfig.libraries);
                allLibraries.push(...libraryPaths);
                console.log(`    ↳ Added ${libraryPaths.length} libraries`);
            }

            // Process classes if present
            if (moduleConfig.classes && Array.isArray(moduleConfig.classes)) {
                for (const classRef of moduleConfig.classes) {
                    const collectionName = classRef.collection;
                    if (!collectionName) {
                        console.warn('⚠️ Class reference missing collection name');
                        continue;
                    }

                    // Get all classes from this collection
                    const allClasses = this.getAllClassesFromCollection(collectionName);

                    // Store in dynamic collection
                    if (!classCollections[collectionName]) {
                        classCollections[collectionName] = [];
                    }
                    classCollections[collectionName].push(...allClasses);

                    // Track base class if specified
                    if (classRef.baseClass) {
                        classMetadata.push({
                            collection: collectionName,
                            baseClass: classRef.baseClass,
                            files: allClasses
                        });
                        console.log(`    ↳ Loaded ${allClasses.length} classes from ${collectionName} (base: ${classRef.baseClass})`);
                    } else {
                        console.log(`    ↳ Loaded ${allClasses.length} classes from ${collectionName}`);
                    }
                }
            }
        }

        console.log(`✓ Editor entry complete: ${allLibraries.length} libraries, ${Object.keys(classCollections).length} class collections`);

        return {
            libraries: allLibraries,
            config: editorConfig,
            modules: editorModules,
            moduleConfigs: moduleConfigs,
            classCollections: classCollections,
            classMetadata: classMetadata
        };
    }

    /**
     * Get engine files
     */
    getEnginePaths() {
        const engineDir = path.join(__dirname, '..', 'engine');
        return {
            moduleManager: path.join(engineDir, 'ModuleManager.js'),
            baseEngine: path.join(engineDir, 'BaseEngine.js'),
            engine: path.join(engineDir, 'Engine.js')
        };
    }

    /**
     * Generate complete build configuration
     */
    generateBuildConfig() {
        this.loadConfig();

        return {
            projectName: this.projectName,
            client: this.getClientEntry(),
            server: this.getServerEntry(),
            editor: this.getEditorEntry(),
            engine: this.getEnginePaths(),
            projectConfig: this.config.objectTypes.configs
        };
    }
}

module.exports = ConfigParser;
