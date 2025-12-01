/**
 * Configuration Parser for GUTS Webpack Build
 * Scans project source files directly and generates entry points for webpack
 *
 * This version builds directly from source files in project/scripts folder
 * instead of reading from a centralized config JSON file.
 */

const fs = require('fs');
const path = require('path');

class ConfigParser {
    constructor(projectName) {
        this.projectName = projectName;
        this.projectRoot = path.join(__dirname, '..', 'projects', projectName);
        this.globalRoot = path.join(__dirname, '..', 'global');
        this.scriptsRoot = path.join(this.projectRoot, 'scripts');

        // Cache for library metadata loaded from data JSON files
        this.libraryMetadata = {};
    }

    /**
     * Load game/server/editor configs from Settings/configs folder
     */
    loadConfigs() {
        const configsPath = path.join(this.scriptsRoot, 'Settings', 'configs');
        const configs = {};

        const configFiles = ['game', 'server', 'editor'];
        for (const configName of configFiles) {
            const configPath = path.join(configsPath, `${configName}.json`);
            if (fs.existsSync(configPath)) {
                configs[configName] = JSON.parse(fs.readFileSync(configPath, 'utf8'));
                console.log(`  Loaded ${configName}.json`);
            }
        }

        return configs;
    }

    /**
     * Load library metadata from data JSON files in global/libraries/data
     * and project scripts/Scripts/libraries/data
     */
    loadLibraryMetadata() {
        // Load global library metadata
        const globalDataPath = path.join(this.globalRoot, 'libraries', 'data');
        if (fs.existsSync(globalDataPath)) {
            const files = fs.readdirSync(globalDataPath).filter(f => f.endsWith('.json'));
            for (const file of files) {
                const data = JSON.parse(fs.readFileSync(path.join(globalDataPath, file), 'utf8'));
                const name = data.fileName || path.basename(file, '.json');
                this.libraryMetadata[name] = { ...data, source: 'global' };

                // Also register with name variants (e.g., three.EffectComposer -> three_EffectComposer)
                const underscoreName = name.replace(/\./g, '_');
                if (underscoreName !== name) {
                    this.libraryMetadata[underscoreName] = { ...data, source: 'global' };
                }
            }
        }

        // Load project library metadata (overrides global)
        const projectDataPath = path.join(this.scriptsRoot, 'Scripts', 'libraries', 'data');
        if (fs.existsSync(projectDataPath)) {
            const files = fs.readdirSync(projectDataPath).filter(f => f.endsWith('.json'));
            for (const file of files) {
                const data = JSON.parse(fs.readFileSync(path.join(projectDataPath, file), 'utf8'));
                const name = data.fileName || path.basename(file, '.json');
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
    scanFolder(folderPath) {
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
     * Get library file paths from library names
     * Uses library metadata from data JSON files to resolve paths
     */
    getLibraryPaths(libraryNames) {
        const paths = [];

        for (const libName of libraryNames) {
            const metadata = this.libraryMetadata[libName];

            // Handle threejs special case - npm package (check early)
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
                // Try rapier3d first, then rapier3d-compat
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

            // Skip other external CDN libraries (href without special handling)
            if (metadata && metadata.href) {
                console.log(`    Skipping external library: ${libName} (${metadata.href})`);
                continue;
            }

            // Try to find the library file by scanning folders
            let foundPath = null;
            let source = null;

            // Check project libraries first
            const projectLibPath = path.join(this.scriptsRoot, 'Scripts', 'libraries', 'js', `${libName}.js`);
            if (fs.existsSync(projectLibPath)) {
                foundPath = projectLibPath;
                source = 'project';
            }

            // Check global libraries
            if (!foundPath) {
                const globalLibPath = path.join(this.globalRoot, 'libraries', 'js', `${libName}.js`);
                if (fs.existsSync(globalLibPath)) {
                    foundPath = globalLibPath;
                    source = 'global';
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
     * Get script file paths for a collection (managers, systems, etc.)
     * by scanning the appropriate folder
     */
    getScriptPaths(collectionName, scriptNames) {
        const paths = [];

        // Determine the folder to scan based on collection name
        let folderPath;
        if (collectionName === 'managers') {
            folderPath = path.join(this.scriptsRoot, 'Scripts', 'managers', 'js');
        } else if (collectionName === 'systems') {
            folderPath = path.join(this.scriptsRoot, 'Scripts', 'systems', 'js');
        } else {
            // For other collections, check both Scripts and Behaviors folders
            const scriptsPath = path.join(this.scriptsRoot, 'Scripts', collectionName, 'js');
            const behaviorsPath = path.join(this.scriptsRoot, 'Behaviors', collectionName, 'js');

            if (fs.existsSync(scriptsPath)) {
                folderPath = scriptsPath;
            } else if (fs.existsSync(behaviorsPath)) {
                folderPath = behaviorsPath;
            }
        }

        if (!folderPath || !fs.existsSync(folderPath)) {
            console.warn(`    Folder not found for collection: ${collectionName}`);
            return paths;
        }

        for (const scriptName of scriptNames) {
            const scriptPath = path.join(folderPath, `${scriptName}.js`);
            if (fs.existsSync(scriptPath)) {
                paths.push({
                    name: scriptName,
                    path: scriptPath,
                    fileName: scriptName
                });
            } else {
                console.warn(`    Script not found: ${scriptName} in ${collectionName}`);
            }
        }

        return paths;
    }

    /**
     * Get all scripts for a config based on its managers and systems
     */
    getScripts(config) {
        const managerNames = config.managers || [];
        const systemNames = config.systems || [];
        const classCollections = config.classes || [];

        return {
            managers: this.getScriptPaths('managers', managerNames),
            systems: this.getScriptPaths('systems', systemNames),
            classes: classCollections
        };
    }

    /**
     * Get all class files from a collection by scanning the folder
     */
    getAllClassesFromCollection(collectionName) {
        // Determine the folder path for this collection
        let folderPath;

        // Check Scripts folder first
        const scriptsPath = path.join(this.scriptsRoot, 'Scripts', collectionName, 'js');
        if (fs.existsSync(scriptsPath)) {
            folderPath = scriptsPath;
        } else {
            // Check Behaviors folder
            const behaviorsPath = path.join(this.scriptsRoot, 'Behaviors', collectionName, 'js');
            if (fs.existsSync(behaviorsPath)) {
                folderPath = behaviorsPath;
            }
        }

        if (!folderPath) {
            console.warn(`    Collection folder not found: ${collectionName}`);
            return [];
        }

        return this.scanFolder(folderPath);
    }

    /**
     * Generate client entry point data
     */
    getClientEntry(configs) {
        const gameConfig = configs.game;
        if (!gameConfig) {
            throw new Error('Game config not found');
        }

        console.log('\n  Building client entry...');
        const clientLibraries = this.getLibraryPaths(gameConfig.libraries || []);
        const clientScripts = this.getScripts(gameConfig);

        // Get all classes from each collection, track base classes
        const classCollections = {};
        const classMetadata = [];

        for (const classRef of clientScripts.classes) {
            const collectionName = classRef.collection;
            if (!collectionName) {
                console.warn('    Class reference missing collection name');
                continue;
            }

            const allClasses = this.getAllClassesFromCollection(collectionName);

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

        return {
            libraries: clientLibraries,
            managers: clientScripts.managers,
            systems: clientScripts.systems,
            classCollections: classCollections,
            classMetadata: classMetadata,
            config: gameConfig
        };
    }

    /**
     * Generate server entry point data
     */
    getServerEntry(configs) {
        const serverConfig = configs.server;
        if (!serverConfig) {
            console.warn('  No server config found');
            return null;
        }

        const initialScene = serverConfig.initialScene;
        if (!initialScene) {
            console.warn('  Server config missing initialScene');
            return null;
        }

        console.log('\n  Building server entry...');
        const serverLibraries = this.getLibraryPaths(serverConfig.libraries || []);
        const serverScripts = this.getScripts(serverConfig);

        const classCollections = {};
        const classMetadata = [];

        for (const classRef of serverScripts.classes) {
            const collectionName = classRef.collection;
            if (!collectionName) {
                console.warn('    Class reference missing collection name');
                continue;
            }

            const allClasses = this.getAllClassesFromCollection(collectionName);

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

        return {
            libraries: serverLibraries,
            managers: serverScripts.managers,
            systems: serverScripts.systems,
            classCollections: classCollections,
            classMetadata: classMetadata,
            config: serverConfig
        };
    }

    /**
     * Generate editor entry point data
     */
    getEditorEntry(configs) {
        const editorConfig = configs.editor;
        if (!editorConfig) {
            console.warn('  Editor config not found');
            return null;
        }

        const editorModules = editorConfig.editorModules || [];
        const globalModulesPath = path.join(this.globalRoot, 'editorModules');
        const projectModulesPath = path.join(this.scriptsRoot, 'Settings', 'editorModules');

        const allLibraries = [];
        const allSystems = [];
        const classCollections = {};
        const classMetadata = [];
        const moduleConfigs = {};

        console.log(`\n  Building editor entry with ${editorModules.length} modules...`);

        for (const moduleName of editorModules) {
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
                for (const classRef of moduleConfig.classes) {
                    const collectionName = classRef.collection;
                    if (!collectionName) continue;

                    const allClasses = this.getAllClassesFromCollection(collectionName);

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
                }
            }
        }

        console.log(`    Editor: ${allLibraries.length} libraries, ${allSystems.length} systems`);

        return {
            libraries: allLibraries,
            systems: allSystems,
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
        console.log(`\nScanning source files for ${this.projectName}...`);

        // Load library metadata first
        this.loadLibraryMetadata();

        // Load configs from Settings/configs
        const configs = this.loadConfigs();

        return {
            projectName: this.projectName,
            client: this.getClientEntry(configs),
            server: this.getServerEntry(configs),
            editor: this.getEditorEntry(configs),
            engine: this.getEnginePaths(),
            projectConfig: configs
        };
    }
}

module.exports = ConfigParser;
