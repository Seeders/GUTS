/**
 * Configuration Parser for GUTS Webpack Build
 * Auto-discovers all collections from source folders and builds everything
 *
 * No external config file required - scans project/scripts folder structure directly
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

        // Cache for object type definitions
        this.objectTypeDefinitions = [];

        // Discovered collections
        this.collections = {};
    }

    /**
     * Load objectTypeDefinitions from Settings/objectTypeDefinitions folder
     */
    loadObjectTypeDefinitions() {
        const defsPath = path.join(this.scriptsRoot, 'Settings', 'objectTypeDefinitions');
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
     * Discover all collections by scanning the folder structure
     */
    discoverCollections() {
        console.log('\n  Discovering collections from folder structure...');

        // Define the parent folders and their structures
        const folderMappings = [
            { parent: 'Scripts', hasJsSubfolder: true },
            { parent: 'Behaviors', hasJsSubfolder: true },
            { parent: 'Data', hasJsSubfolder: false },
            { parent: 'Environment', hasJsSubfolder: false },
            { parent: 'Prefabs', hasJsSubfolder: false },
            { parent: 'Audio', hasJsSubfolder: false },
            { parent: 'Settings', hasJsSubfolder: false },
            { parent: 'Resources', hasJsSubfolder: false },
            { parent: 'Terrain', hasJsSubfolder: false }
        ];

        for (const mapping of folderMappings) {
            const parentPath = path.join(this.scriptsRoot, mapping.parent);
            if (!fs.existsSync(parentPath)) continue;

            const subfolders = fs.readdirSync(parentPath, { withFileTypes: true })
                .filter(d => d.isDirectory())
                .map(d => d.name);

            for (const subfolder of subfolders) {
                const collectionId = subfolder;

                // Determine the path to scan for JS files
                let jsPath;
                if (mapping.hasJsSubfolder) {
                    jsPath = path.join(parentPath, subfolder, 'js');
                } else {
                    // For data folders, check if there's content directly or in subfolders
                    jsPath = path.join(parentPath, subfolder);
                }

                // Check if this collection has JS files
                const jsFiles = this.scanJsFolder(jsPath);

                if (jsFiles.length > 0) {
                    this.collections[collectionId] = {
                        id: collectionId,
                        parent: mapping.parent,
                        jsPath: jsPath,
                        files: jsFiles
                    };
                }
            }
        }

        console.log(`    Found ${Object.keys(this.collections).length} collections with JS files`);
    }

    /**
     * Determine the target for a library based on its metadata
     * Returns 'client', 'server', or 'both'
     */
    getLibraryTarget(libName, metadata) {
        // Check explicit target in metadata
        if (metadata && metadata.target) {
            return metadata.target;
        }

        // Libraries starting with "Server" are server-only
        if (libName.startsWith('Server')) {
            return 'server';
        }

        // Libraries with windowContext or href to CDN are client-only
        if (metadata && (metadata.windowContext || metadata.href)) {
            return 'client';
        }

        // Default to both
        return 'both';
    }

    /**
     * Get ALL library paths - scans global and project libraries
     * @param {string} target - 'client', 'server', or 'all'
     */
    getAllLibraryPaths(target = 'all') {
        const paths = [];
        const seen = new Set();

        // Get all library files from global
        const globalLibPath = path.join(this.globalRoot, 'libraries', 'js');
        const globalLibFiles = this.scanJsFolder(globalLibPath);

        for (const lib of globalLibFiles) {
            if (seen.has(lib.name)) continue;

            const metadata = this.libraryMetadata[lib.name] || {};
            const libTarget = this.getLibraryTarget(lib.name, metadata);

            // Filter based on target
            if (target === 'client' && libTarget === 'server') continue;
            if (target === 'server' && libTarget === 'client') continue;

            seen.add(lib.name);

            paths.push({
                name: lib.name,
                path: lib.path,
                isModule: metadata.isModule || false,
                requireName: metadata.requireName || lib.name,
                fileName: lib.name,
                windowContext: metadata.windowContext,
                target: libTarget
            });
        }

        // Get all library files from project (override global)
        const projectLibPath = path.join(this.scriptsRoot, 'Scripts', 'libraries', 'js');
        const projectLibFiles = this.scanJsFolder(projectLibPath);

        for (const lib of projectLibFiles) {
            const metadata = this.libraryMetadata[lib.name] || {};
            const libTarget = this.getLibraryTarget(lib.name, metadata);

            // Filter based on target
            if (target === 'client' && libTarget === 'server') continue;
            if (target === 'server' && libTarget === 'client') continue;

            if (seen.has(lib.name)) {
                // Override with project version
                const idx = paths.findIndex(p => p.name === lib.name);
                if (idx >= 0) {
                    paths[idx] = {
                        name: lib.name,
                        path: lib.path,
                        isModule: metadata.isModule || false,
                        requireName: metadata.requireName || lib.name,
                        fileName: lib.name,
                        windowContext: metadata.windowContext,
                        target: libTarget
                    };
                }
            } else {
                seen.add(lib.name);
                paths.push({
                    name: lib.name,
                    path: lib.path,
                    isModule: metadata.isModule || false,
                    requireName: metadata.requireName || lib.name,
                    fileName: lib.name,
                    windowContext: metadata.windowContext,
                    target: libTarget
                });
            }
        }

        // Add libraries from metadata that reference npm packages or CDN
        for (const [name, metadata] of Object.entries(this.libraryMetadata)) {
            if (seen.has(name)) continue;

            const libTarget = this.getLibraryTarget(name, metadata);

            // Filter based on target
            if (target === 'client' && libTarget === 'server') continue;
            if (target === 'server' && libTarget === 'client') continue;

            // Handle Three.js npm package
            if (name === 'threejs' || metadata.importName === 'three') {
                const threePath = path.join(__dirname, '..', 'node_modules', 'three', 'build', 'three.module.min.js');
                if (fs.existsSync(threePath)) {
                    seen.add(name);
                    paths.push({
                        name: 'threejs',
                        path: threePath,
                        isModule: true,
                        requireName: 'THREE',
                        fileName: 'threejs',
                        windowContext: 'THREE',
                        target: 'client'
                    });
                }
                continue;
            }

            // Handle Three.js examples/addons from CDN - convert to npm imports
            if (metadata.href && metadata.href.includes('three@') && metadata.href.includes('/examples/jsm/')) {
                const match = metadata.href.match(/\/examples\/jsm\/(.+)\.js$/);
                if (match) {
                    const examplePath = match[1];
                    const absolutePath = path.join(__dirname, '..', 'node_modules', 'three', 'examples', 'jsm', `${examplePath}.js`);

                    if (fs.existsSync(absolutePath)) {
                        seen.add(name);
                        paths.push({
                            name: name,
                            path: absolutePath,
                            isModule: true,
                            requireName: metadata.requireName || name,
                            fileName: metadata.fileName || name,
                            windowContext: metadata.windowContext,
                            target: 'client'
                        });
                    }
                }
                continue;
            }

            // Handle socket.io client
            if (metadata.href && metadata.href.includes('socket.io')) {
                const socketPath = path.join(__dirname, '..', 'node_modules', 'socket.io-client', 'build', 'esm', 'index.js');
                if (fs.existsSync(socketPath) && !seen.has('io')) {
                    seen.add('io');
                    paths.push({
                        name: 'io',
                        path: socketPath,
                        isModule: true,
                        requireName: 'io',
                        fileName: 'socket_io_client',
                        windowContext: 'io',
                        target: 'client'
                    });
                }
                continue;
            }
        }

        return paths;
    }

    /**
     * Get all managers from the discovered collections
     */
    getAllManagers() {
        return this.collections.managers?.files || [];
    }

    /**
     * Get all systems from the discovered collections
     */
    getAllSystems() {
        return this.collections.systems?.files || [];
    }

    /**
     * Get all class collections (abilities, behaviors, etc.)
     */
    getAllClassCollections() {
        const classCollections = {};
        const classMetadata = [];

        // Collections that contain classes (have JS files that define classes)
        const classCollectionIds = [
            'abilities', 'behaviorActions', 'behaviorDecorators', 'behaviorTrees',
            'sequenceBehaviorTrees', 'functions', 'interfaces', 'renderers'
        ];

        for (const id of classCollectionIds) {
            const collection = this.collections[id];
            if (collection && collection.files.length > 0) {
                classCollections[id] = collection.files;

                // Try to find base class (naming convention: Base<CollectionName>)
                const baseClassName = `Base${id.charAt(0).toUpperCase()}${id.slice(1).replace(/s$/, '')}`;
                const hasBaseClass = collection.files.some(f => f.name === baseClassName);

                if (hasBaseClass) {
                    classMetadata.push({
                        collection: id,
                        baseClass: baseClassName,
                        files: collection.files
                    });
                }
            }
        }

        return { classCollections, classMetadata };
    }

    /**
     * Generate client entry point data - includes ALL discovered content
     */
    getClientEntry() {
        console.log('\n  Building client entry (all discovered content)...');

        const libraries = this.getAllLibraryPaths('client');
        const managers = this.getAllManagers();
        const systems = this.getAllSystems();
        const { classCollections, classMetadata } = this.getAllClassCollections();

        console.log(`    Libraries: ${libraries.length}`);
        console.log(`    Managers: ${managers.length}`);
        console.log(`    Systems: ${systems.length}`);
        console.log(`    Class collections: ${Object.keys(classCollections).length}`);

        return {
            libraries,
            managers,
            systems,
            classCollections,
            classMetadata,
            config: {} // No config file needed
        };
    }

    /**
     * Generate server entry point data - includes ALL discovered content
     * (Server uses same classes but different runtime)
     */
    getServerEntry() {
        console.log('\n  Building server entry (all discovered content)...');

        const libraries = this.getAllLibraryPaths('server');
        const managers = this.getAllManagers();
        const systems = this.getAllSystems();
        const { classCollections, classMetadata } = this.getAllClassCollections();

        console.log(`    Server libraries: ${libraries.length}`);
        console.log(`    Managers: ${managers.length}`);
        console.log(`    Systems: ${systems.length}`);

        return {
            libraries,
            managers,
            systems,
            classCollections,
            classMetadata,
            config: { initialScene: 'server' }
        };
    }

    /**
     * Generate editor entry point data
     */
    getEditorEntry() {
        const editorModulesPath = path.join(this.scriptsRoot, 'Settings', 'editorModules');
        const globalModulesPath = path.join(this.globalRoot, 'editorModules');

        // Get list of editor modules
        let editorModules = [];
        if (fs.existsSync(editorModulesPath)) {
            editorModules = fs.readdirSync(editorModulesPath)
                .filter(f => f.endsWith('.json'))
                .map(f => path.basename(f, '.json'));
        }

        const allLibraries = [];
        const allSystems = [];
        const classCollections = {};
        const classMetadata = [];
        const moduleConfigs = {};
        const seen = new Set();

        console.log(`\n  Building editor entry with ${editorModules.length} modules...`);

        // Get all available libraries once
        const availableLibraries = this.getAllLibraryPaths('client');
        const libMap = new Map(availableLibraries.map(l => [l.name, l]));

        for (const moduleName of editorModules) {
            const projectConfigPath = path.join(editorModulesPath, `${moduleName}.json`);
            const globalConfigPath = path.join(globalModulesPath, `${moduleName}.json`);

            let moduleConfigPath;
            if (fs.existsSync(projectConfigPath)) {
                moduleConfigPath = projectConfigPath;
            } else if (fs.existsSync(globalConfigPath)) {
                moduleConfigPath = globalConfigPath;
            } else {
                continue;
            }

            const moduleConfig = JSON.parse(fs.readFileSync(moduleConfigPath, 'utf8'));
            moduleConfigs[moduleName] = moduleConfig;

            // Process libraries from module config
            if (moduleConfig.libraries) {
                for (const libName of moduleConfig.libraries) {
                    if (seen.has(libName)) continue;
                    seen.add(libName);

                    // Find the library from our cached map
                    const lib = libMap.get(libName);
                    if (lib) {
                        allLibraries.push(lib);
                    }
                }
            }
        }

        console.log(`    Editor libraries: ${allLibraries.length}`);

        return {
            libraries: allLibraries,
            systems: allSystems,
            config: { editorModules },
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
            moduleManager: path.join(engineDir, 'ModuleManager.js'),
            baseEngine: path.join(engineDir, 'BaseEngine.js'),
            engine: path.join(engineDir, 'Engine.js')
        };
    }

    /**
     * Generate complete build configuration
     */
    generateBuildConfig() {
        console.log(`\nAuto-discovering source files for ${this.projectName}...`);

        // Load metadata
        this.loadLibraryMetadata();
        this.loadObjectTypeDefinitions();

        // Discover all collections from folder structure
        this.discoverCollections();

        return {
            projectName: this.projectName,
            client: this.getClientEntry(),
            server: this.getServerEntry(),
            editor: this.getEditorEntry(),
            engine: this.getEnginePaths(),
            objectTypeDefinitions: this.objectTypeDefinitions,
            collections: this.collections
        };
    }
}

module.exports = ConfigParser;
