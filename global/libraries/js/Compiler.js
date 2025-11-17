class Compiler {
    constructor(engine) {
        this.engine = engine;
        this.collections = null;
        this.compiledBundle = null;
        this.compiledEngine = null;
        this.objectTypeDefinitions = null;
        this.classRegistry = null; // Will be initialized dynamically based on objectTypeDefinitions
        this.scriptCollectionTypes = null; // Cache of script collection type IDs
    }

    /**
     * Extract all class references from a scene definition
     * @param {Object} sceneData - Scene data from client.json or server.json
     * @returns {Set} - Set of class names referenced in the scene
     */
    extractSceneClasses(sceneData) {
        const classNames = new Set();

        if (!sceneData || !sceneData.sceneData) return classNames;

        sceneData.sceneData.forEach(entity => {
            // Add managers
            if (entity.managers) {
                entity.managers.forEach(m => classNames.add(m.type));
            }
            // Add systems
            if (entity.systems) {
                entity.systems.forEach(s => classNames.add(s.type));
            }
            // Add components
            if (entity.components) {
                entity.components.forEach(c => classNames.add(c.type));
            }
            // Add classes (these reference entire collections)
            if (entity.classes) {
                entity.classes.forEach(cls => {
                    // Add all classes from the referenced collection
                    const collectionName = cls.collection;
                    if (this.collections[collectionName]) {
                        Object.keys(this.collections[collectionName]).forEach(className => {
                            classNames.add(className);
                        });
                    }
                });
            }
        });

        return classNames;
    }

    /**
     * Initialize classRegistry based on objectTypeDefinitions
     * Creates a Map for each collection type in the Scripts category
     * In server mode with scene filter, only includes classes referenced by the scene
     */
    initializeClassRegistry() {
        this.classRegistry = {};

        this.scriptCollectionTypes = this.objectTypeDefinitions
            .filter(def => def.category === 'Scripts')
            .map(def => def.id);

        // Create a Map for each script collection type
        this.scriptCollectionTypes.forEach(type => {
            this.classRegistry[type] = new Map();
        });
    }

    /**
     * Strip script text from collections to reduce bundle size
     * Scripts are already compiled in classRegistry, so we don't need them in collections
     * @param {Object} collections - Original collections object
     * @param {Array} objectTypeDefinitions - Array of collection type definitions with categories
     * @returns {Object} - Stripped collections without script text
     */
    stripScriptsFromCollections(collections, objectTypeDefinitions) {
        const stripped = JSON.parse(JSON.stringify(collections)); // Deep clone

        // Find all collection types in the "Scripts" category
        const scriptCollectionTypes = objectTypeDefinitions
            .filter(def => def.category === 'Scripts')
            .map(def => def.id);

        // Strip script property from all items in Scripts category collections
        scriptCollectionTypes.forEach(type => {
            if (stripped[type]) {
                Object.keys(stripped[type]).forEach(itemName => {
                    if (stripped[type][itemName].script) {
                        delete stripped[type][itemName].script;
                    }
                });
            }
        });

        return stripped;
    }

    /**
     * Main compile method - orchestrates the entire compilation process
     * @param {string} projectName - Name of the project to compile
     * @param {Object} collections - Project collections (objectTypes)
     * @param {Array} objectTypeDefinitions - Collection type definitions with categories
     * @param {Object} engineFilePaths - Optional paths to engine files
     * @param {Object} sceneFilter - Optional scene data (e.g., server.json) to filter compiled classes
     * @returns {Object} - Compilation result with bundle code and metadata
     */
    async compile(projectName, collections, objectTypeDefinitions, engineFilePaths, sceneFilter = null) {
        console.log(`Starting compilation for project: ${projectName}${sceneFilter ? ' (FILTERED BY SCENE)' : ''}`);

        this.collections = collections;
        this.objectTypeDefinitions = objectTypeDefinitions;
        this.sceneFilter = sceneFilter;

        if (!this.collections) {
            throw new Error("Failed to load game configuration");
        }

        // If scene filter provided, extract which classes to compile
        this.allowedClasses = null;
        if (this.sceneFilter) {
            this.allowedClasses = this.extractSceneClasses(this.sceneFilter);
            console.log(`Scene filter: compiling ${this.allowedClasses.size} classes`);
        }

        // Initialize classRegistry dynamically based on objectTypeDefinitions
        this.initializeClassRegistry();

        const result = {
            projectName: projectName,
            timestamp: new Date().toISOString(),
            sections: [],
            code: '',
            classRegistry: {},
            dependencies: [],
            engineCode: null
        };
        
        // Build the bundle in order
        await this.buildHeader(result);
        await this.buildLibraries(result);
        await this.buildGameClasses(result);
        await this.buildClassRegistry(result);
        await this.buildInitializer(result);

        // Combine all sections
        result.code = result.sections.join('\n\n');
        
        // Compile engine if paths provided
        if (engineFilePaths) {
            try {
                result.engineCode = await this.compileEngine(engineFilePaths);
                this.compiledEngine = result.engineCode;
                console.log('✅ Engine bundle compiled');
            } catch (error) {
                console.warn('Could not compile engine bundle:', error.message);
            }
        }
        
        this.compiledBundle = result;
        return result;
    }

    async createZipBundle(result) {
        if (typeof JSZip === 'undefined') {
            throw new Error('JSZip library not loaded. Include jszip.min.js before using this feature.');
        }

        const zip = new JSZip();
        
        // Add game bundle
        zip.file("game.js", result.code);
        
        // Add engine bundle if available
        if (result.engineCode) {
            zip.file('engine.js', result.engineCode);
        }
        
        // Add local module files
        if (result.localModuleFiles && result.localModuleFiles.length > 0) {
            console.log(`Bundling ${result.localModuleFiles.length} local module files...`);
            
            const modulesFolder = zip.folder('modules');
            
            for (const moduleInfo of result.localModuleFiles) {
                if (moduleInfo.libraryDef.isModule) {
                    try {
                        const response = await fetch(moduleInfo.path);
                        const content = await response.text();
                        const filename = moduleInfo.path.split('/').pop();
                        
                        modulesFolder.file(filename, content);
                        console.log(`✓ Bundled module: ${filename}`);
                    } catch (error) {
                        console.error(`Failed to bundle module ${moduleInfo.name}:`, error);
                    }
                }
            }
        }
 
         // Generate zip blob
        const zipBlob = await zip.generateAsync({ type: 'blob' });
        
        console.log('✅ Zip bundle created');
        return zipBlob;
    }

    
    /**
     * Build the header section with metadata and utility functions
     */
    buildHeader(result) {
        // Strip scripts from collections
        const strippedCollections = this.stripScriptsFromCollections(this.collections, this.objectTypeDefinitions);

        // Serialize collections to JSON string
        const collectionsJSON = JSON.stringify(strippedCollections, null, 2);

        const header = `/**
 * Compiled Game Bundle
 * Project: ${result.projectName}
 * Generated: ${result.timestamp}
 */

window.engine = {
        app: {}
};

// Global bundle namespace
window.COMPILED_GAME = {
    projectName: "${result.projectName}",
    version: "${result.timestamp}",
    classRegistry: {},
    libraryClasses: {},
    collections: ${collectionsJSON},
    compiled: true,
    initialized: false
};

// Helper to get collections (replaces core.getCollections() at runtime)
window.COMPILED_GAME.getCollections = function() {
    return window.COMPILED_GAME.collections;
};

// FLAG TO PREVENT DUPLICATE LIBRARY LOADING
window.COMPILED_GAME_LOADED = true;`;
        result.sections.push(header);
    }

async buildLibraries(result) {
    const projectConfig = this.collections.configs.game;
    if (!projectConfig.libraries) {
        console.warn("No libraries defined in game config");
        return;
    }

    const librariesSection = ['// ========== LIBRARIES =========='];
    const externalLibraries = [];
    const importMap = {};
    const localModuleFiles = [];

    // Client-only libraries that should be skipped in server compilation
    const clientOnlyLibraries = [
        'threejs',
        'three_MeshBVH',
        'three_SkeletonUtils',
        'three_OrbitControls',
        'GLTFLoader',
        'three_EffectComposer',
        'three_RenderPixelatedPass',
        'three_OutputPass',
        'UIComponents',
        'NotificationSystem',
        'GameLoader',
        'PlacementPreview',
        'ClientNetworkManager',
        'FantasyUIEnhancements',
        'PerformanceProfiler',
        'ModelManager',
        'ImageManager',
        'CanvasUtility',
        'TerrainImageProcessor',
        'TileMap',
        'ShapeFactory',
        'GameModeConfigs',
        'SceneManager' // client SceneManager, server uses ServerSceneManager
    ];

    for (const libraryName of projectConfig.libraries) {
        // Skip client-only libraries when compiling for server
        if (this.sceneFilter && clientOnlyLibraries.includes(libraryName)) {
            console.log(`Skipping client-only library: ${libraryName}`);
            continue;
        }

        const libraryDef = this.collections.libraries[libraryName];
        if (!libraryDef) {
            console.warn(`Library ${libraryName} not found in collections`);
            continue;
        }
        
        let libraryKey = libraryDef.requireName || libraryName.replace(/-/g, "__").replace(/\./g, "_");
        
        // Handle local files with filePath
        if (libraryDef.filePath && !libraryDef.href) {
            const path = libraryDef.filePath;
            
            // Store local module info for bundling into zip
            localModuleFiles.push({
                name: libraryName,
                path: path,
                libraryDef: libraryDef,
                libraryKey: libraryKey
            });
            
            // For modules, create runtime loader that references bundled file
            if (libraryDef.isModule) {
                const bundledPath = `./modules/${path.split('/').pop()}`;
                
                if (libraryDef.importName) {
                    importMap[libraryDef.importName] = bundledPath;
                }
                
                librariesSection.push(`\n// Library: ${libraryName} (local module - bundled)`);
                librariesSection.push(`// Original path: ${path}`);
                librariesSection.push(`// Bundled path: ${bundledPath}`);
                
                // Create a placeholder that will be filled at runtime
                if (libraryDef.windowContext) {
                    librariesSection.push(`
if (!window["${libraryDef.windowContext}"]) {
    window["${libraryDef.windowContext}"] = {};
}
window["${libraryDef.windowContext}"]["${libraryKey}"] = null; // Will be loaded at runtime
window.COMPILED_GAME.libraryClasses.${libraryKey} = null; // Placeholder
                    `.trim());
                } else {
                    librariesSection.push(`window["${libraryKey}"] = null; // Will be loaded at runtime`);
                    librariesSection.push(`window.COMPILED_GAME.libraryClasses.${libraryKey} = null; // Placeholder`);
                }
                
                externalLibraries.push({
                    name: libraryName,
                    url: bundledPath,
                    isModule: true,
                    requireName: libraryDef.requireName || libraryName,
                    windowContext: libraryDef.windowContext,
                    isLocalModule: true
                });
                
                result.dependencies.push({
                    name: libraryName,
                    type: 'local-module',
                    originalPath: path,
                    bundledPath: bundledPath,
                    isModule: true,
                    requireName: libraryDef.requireName || libraryName
                });
            } else {
                // For non-modules, fetch and include inline
                try {
                    const response = await fetch(path);
                    let fileContent = await response.text();
                    
                    librariesSection.push(`\n// Library: ${libraryName} (non-module - inline)`);
                    librariesSection.push(`// Original path: ${path}`);
                    
                    // Extract class names from the file
                    const classMatches = fileContent.match(/class\s+(\w+)/g);
                    const className = libraryDef.requireName || libraryDef.fileName;
                    
                    // Execute the code and explicitly export classes to global scope
                    librariesSection.push(`
// Execute and register library code
(function() {
    try {
        // Execute the library code
        ${fileContent}
        
        // Explicitly register classes to window
        var className = "${className}";
        if (typeof eval(className) !== 'undefined') {
            window[className] = eval(className);
            console.log("set ", className);
        }
        
    } catch (error) {
        console.error("Error executing ${libraryName}:", error);
    }
})();

// Register library in COMPILED_GAME
(function() {
    var foundLibrary = null;
    var libraryKey = "${libraryKey}";
    var className = "${className}";
    
    // Check for classes defined in the file

    if (window[className]) {
        foundLibrary = window[className];
        
        // Register this class by its actual name
        window.COMPILED_GAME.libraryClasses[className] = window[className];
        window.engine[className] = window[className];
    }
    
    
    if (foundLibrary) {
        window.COMPILED_GAME.libraryClasses.${libraryKey} = foundLibrary;
        window.engine.${libraryKey} = foundLibrary;
        ${libraryDef.windowContext ? `
        if (!window["${libraryDef.windowContext}"]) {
            window["${libraryDef.windowContext}"] = {};
        }
        window["${libraryDef.windowContext}"]["${libraryKey}"] = foundLibrary;
        ` : ''}
    } else {
        console.warn("Could not find ${libraryName} after loading");
    }
})();
                    `.trim());
                    
                    result.dependencies.push({
                        name: libraryName,
                        type: 'inline-file',
                        path: path,
                        key: libraryKey,
                        classes: [className]
                    });
                } catch (error) {
                    console.error(`Failed to load local file ${libraryName}:`, error);
                }
            }
        }
        // Handle external URLs with href - keep as runtime import
        else if (libraryDef.href) {
            const path = libraryDef.href;
            
            // Build import map entry if needed
            if (libraryDef.importName && libraryDef.isModule) {
                importMap[libraryDef.importName] = path;
            }
            
            librariesSection.push(`\n// Library: ${libraryName} (external module - loaded at runtime)`);
            librariesSection.push(`// Loaded from: ${path}`);
            
            // Create a placeholder that will be filled at runtime
            if (libraryDef.windowContext) {
                librariesSection.push(`
if (!window["${libraryDef.windowContext}"]) {
    window["${libraryDef.windowContext}"] = {};
}
window["${libraryDef.windowContext}"]["${libraryKey}"] = null; // Will be loaded at runtime
window.COMPILED_GAME.libraryClasses.${libraryKey} = null; // Placeholder
                `.trim());
            } else {
                librariesSection.push(`window["${libraryKey}"] = null; // Will be loaded at runtime`);
                librariesSection.push(`window.COMPILED_GAME.libraryClasses.${libraryKey} = null; // Placeholder`);
            }
            
            externalLibraries.push({
                name: libraryName,
                url: path,
                isModule: true,
                requireName: libraryDef.requireName || libraryName,
                windowContext: libraryDef.windowContext,
                isLocalModule: false
            });
            
            result.dependencies.push({
                name: libraryName,
                type: 'external-module',
                url: path,
                isModule: true,
                requireName: libraryDef.requireName || libraryName
            });
        }
        // Handle inline scripts (script property)
        else if (libraryDef.script) {
            librariesSection.push(`\n// Library: ${libraryName} (inline script)`);
            
            // Evaluate the script and register it
            librariesSection.push(`(function() {`);
            librariesSection.push(`  var libraryClass = ${libraryDef.script};`);
            librariesSection.push(`  window.COMPILED_GAME.libraryClasses.${libraryKey} = libraryClass;`);
            librariesSection.push(`  window.engine.${libraryKey} = libraryClass;`);
            
            if (libraryDef.windowContext) {
                librariesSection.push(`  if (!window["${libraryDef.windowContext}"]) {`);
                librariesSection.push(`    window["${libraryDef.windowContext}"] = {};`);
                librariesSection.push(`  }`);
                librariesSection.push(`  window["${libraryDef.windowContext}"]["${libraryKey}"] = libraryClass;`);
            } else {
                librariesSection.push(`  window["${libraryKey}"] = libraryClass;`);
            }
            
            librariesSection.push(`})();`);
            
            result.dependencies.push({
                name: libraryName,
                type: 'inline',
                key: libraryKey
            });
        }
    }

    // Add import map if needed
    if (Object.keys(importMap).length > 0) {
        librariesSection.push(`\n// ========== IMPORT MAP ==========`);
        librariesSection.push(`window.COMPILED_GAME.importMap = ${JSON.stringify(importMap, null, 2)};`);
        librariesSection.push(`
// Create and inject import map
(function() {
    if (!document.querySelector('script[type="importmap"]')) {
        const importMapScript = document.createElement('script');
        importMapScript.setAttribute('type', 'importmap');
        importMapScript.textContent = JSON.stringify({ 
            imports: window.COMPILED_GAME.importMap 
        }, null, 2);
        document.head.prepend(importMapScript);
    }
})();
        `.trim());
    }

    // Add external library loader code that runs at bundle load time
    if (externalLibraries.length > 0) {
        librariesSection.push(`\n// ========== EXTERNAL LIBRARY LOADER ==========`);
        librariesSection.push(`window.COMPILED_GAME.externalLibraries = ${JSON.stringify(externalLibraries, null, 2)};`);
        
        librariesSection.push(`
// Load external libraries at bundle initialization
(async function() {
    const loadPromises = [];
    
    for (const lib of window.COMPILED_GAME.externalLibraries) {
        if (lib.isModule) {
            // Import as ES module
            const loadPromise = import(lib.url).then((module) => {
                const libName = lib.requireName || lib.name;
                const loadedModule = module[libName] || module.default || module;
                
                const libraryKey = libName.replace(/-/g, "__").replace(/\\./g, "_");
                
                if (lib.windowContext) {
                    if (!window[lib.windowContext]) {
                        window[lib.windowContext] = {};
                    }
                    window[lib.windowContext][libName] = loadedModule;
                    window.COMPILED_GAME.libraryClasses[libraryKey] = loadedModule;
                    window.engine[libraryKey] = loadedModule;
                } else {
                    window[libName] = loadedModule;
                    window.COMPILED_GAME.libraryClasses[libraryKey] = loadedModule;
                    window.engine[libraryKey] = loadedModule;
                }
                
                console.log(\`Loaded \${lib.isLocalModule ? 'bundled' : 'external'} module: \${lib.name}\`);
            }).catch(error => {
                console.error(\`Failed to load module \${lib.name}:\`, error);
            });
            
            loadPromises.push(loadPromise);
        }
    }
    
    // Wait for all external modules to load
    await Promise.all(loadPromises);
    console.log('All libraries loaded');
    
    // Dispatch event when libraries are ready
    window.dispatchEvent(new CustomEvent('compiled-libraries-ready'));
})();
        `.trim());
    }

    // Store local module files for zip bundling
    result.localModuleFiles = localModuleFiles;
    
    result.sections.push(librariesSection.join('\n'));
}
    /**
     * Build game classes section - compile all systems, managers, components, etc.
     * Dynamically compiles all collection types in the Scripts category
     */
    async buildGameClasses(result) {
        const classesSection = ['// ========== GAME CLASSES =========='];

        // Dynamically create collectedClasses object based on script collection types
        const collectedClasses = {};
        this.scriptCollectionTypes.forEach(type => {
            collectedClasses[type] = new Set();
        });

        // If scene filter is provided, collect classes from that scene only
        if (this.sceneFilter) {
            this.collectClassesFromScene(this.sceneFilter, collectedClasses);
        }
        // Otherwise, scan all scenes to find which classes are used
        else if (this.collections.scenes) {
            for (const sceneName in this.collections.scenes) {
                const scene = this.collections.scenes[sceneName];
                this.collectClassesFromScene(scene, collectedClasses);
            }
        }

        // Compile each script collection type dynamically
        // Note: 'functions' are compiled first if they exist (they might be used by other classes)
        const priorityOrder = ['functions', ...this.scriptCollectionTypes.filter(t => t !== 'functions')];

        for (const collectionType of priorityOrder) {
            if (!this.scriptCollectionTypes.includes(collectionType)) continue;
            if (!this.collections[collectionType]) continue;

            const typeDef = this.objectTypeDefinitions.find(def => def.id === collectionType);
            const typeName = typeDef ? typeDef.name : collectionType.toUpperCase();

            // Check if we should compile all items or only collected ones
            const shouldCompileAll = (collectionType === 'functions');
            const itemsToCompile = shouldCompileAll
                ? Object.keys(this.collections[collectionType])
                : Array.from(collectedClasses[collectionType] || []);

            if (itemsToCompile.length === 0) continue;

            classesSection.push(`\n// ========== ${typeName} ==========`);

            for (const itemName of itemsToCompile) {
                // Skip if scene filter is active and this class is not allowed
                if (this.allowedClasses && !this.allowedClasses.has(itemName)) {
                    continue;
                }

                const itemDef = this.collections[collectionType][itemName];
                if (itemDef && itemDef.script) {
                    const singularName = typeDef?.singular || collectionType.slice(0, -1);
                    classesSection.push(`\n// ${singularName}: ${itemName}`);
                    classesSection.push(`window.engine.app.appClasses = window.engine.app.appClasses || {};`);
                    classesSection.push(`window.engine.app.appClasses['${itemName}'] = ${itemDef.script};`);
                    this.classRegistry[collectionType].set(itemName, true);
                    collectedClasses[collectionType].add(itemName);
                }
            }
        }

        result.sections.push(classesSection.join('\n'));

        // Build dynamic classRegistry result
        result.classRegistry = {};
        this.scriptCollectionTypes.forEach(type => {
            result.classRegistry[type] = Array.from(collectedClasses[type] || []);
        });
    }

    /**
     * Collect all classes referenced in a scene
     * Dynamically collects classes from all script collection types
     */
    collectClassesFromScene(scene, collectedClasses) {
        if (!scene.sceneData || !Array.isArray(scene.sceneData)) return;

        scene.sceneData.forEach(sceneEntity => {
            // Dynamically collect from script collection types
            // Check if sceneEntity has properties matching our script collection types
            this.scriptCollectionTypes.forEach(collectionType => {
                if (sceneEntity[collectionType] && Array.isArray(sceneEntity[collectionType])) {
                    sceneEntity[collectionType].forEach(itemDef => {
                        if (itemDef.type && collectedClasses[collectionType]) {
                            collectedClasses[collectionType].add(itemDef.type);
                        }
                    });
                }
            });

            // Collect classes from ECS scenes (generic class definitions)
            if (sceneEntity.classes) {
                sceneEntity.classes.forEach(classDef => {
                    const collectionName = classDef.collection;
                    const baseClassId = classDef.baseClass;

                    // Add baseClass if it exists and the collection is a script collection
                    if (baseClassId && this.collections[collectionName] && this.scriptCollectionTypes.includes(collectionName)) {
                        if (collectedClasses[collectionName]) {
                            collectedClasses[collectionName].add(baseClassId);
                        }
                    }

                    // Also collect all classes from the collection if it's a script collection
                    if (this.collections[collectionName] && this.scriptCollectionTypes.includes(collectionName)) {
                        for (const classId in this.collections[collectionName]) {
                            if (collectedClasses[collectionName]) {
                                collectedClasses[collectionName].add(classId);
                            }
                        }
                    }
                });
            }
        });
    }

    /**
     * Build class registry accessor functions
     */
    buildClassRegistry(result) {
        const registrySection = `// ========== CLASS REGISTRY ACCESSORS ==========

/**
 * Get a compiled class by name and type
 * This replaces the ModuleManager.getCompiledScript method for compiled bundles
 */
window.COMPILED_GAME.getClass = function(className, collectionType) {
    const collection = window.engine.app[collectionType];
    if (!collection) {
        console.error(\`Collection \${collectionType} not found in compiled bundle\`);
        return null;
    }
    
    const ClassDef = collection[className];
    if (!ClassDef) {
        console.error(\`Class \${className} not found in collection \${collectionType}\`);
        return null;
    }
    
    return ClassDef;
};

/**
 * Check if a class exists in the compiled bundle
 */
window.COMPILED_GAME.hasClass = function(className, collectionType) {
    const collection = window.engine.app[collectionType];
    return collection && collection[className] !== undefined;
};`;
        result.sections.push(registrySection);
    }

    /**
     * Build initialization code that integrates with existing engine
     */
    buildInitializer(result) {
        const initSection = `// ========== INITIALIZATION ==========

/**
 * Initialize the compiled bundle - patches ModuleManager to prevent duplicate loading
 */
window.COMPILED_GAME.init = function(engine) {
    if (window.COMPILED_GAME.initialized) {
        console.log('Compiled game bundle already initialized');
        return;
    }

    console.log('Initializing compiled game bundle...');

    // Store original methods
    const originalGetCompiledScript = ModuleManager.prototype.getCompiledScript;
    const originalCompileScript = ModuleManager.prototype.compileScript;
    const originalCompileFunction = ModuleManager.prototype.compileFunction;

    // Patch getCompiledScript
    ModuleManager.prototype.getCompiledScript = function(typeName, collectionType) {
        if (window.COMPILED_GAME.hasClass(typeName, collectionType)) {
            return window.COMPILED_GAME.getClass(typeName, collectionType);
        }
        return originalGetCompiledScript.call(this, typeName, collectionType);
    };

    // Patch compileScript
    ModuleManager.prototype.compileScript = function(scriptText, typeName) {
        for (const collectionType in window.engine.app) {
            if (window.COMPILED_GAME.hasClass(typeName, collectionType)) {
                return window.COMPILED_GAME.getClass(typeName, collectionType);
            }
        }
        return originalCompileScript.call(this, scriptText, typeName);
    };

    // Patch compileFunction
    ModuleManager.prototype.compileFunction = function(scriptText, typeName) {
        if (window.COMPILED_GAME.hasClass(typeName, 'functions')) {
            return window.COMPILED_GAME.getClass(typeName, 'functions');
        }
        return originalCompileFunction.call(this, scriptText, typeName);
    };

    // Patch core.getCollections() to return compiled collections
    if (engine.core && typeof engine.core.getCollections === 'function') {
        const originalGetCollections = engine.core.getCollections.bind(engine.core);
        engine.core.getCollections = function() {
            if (window.COMPILED_GAME?.collections) {
                return window.COMPILED_GAME.collections;
            }
            return originalGetCollections();
        };
    }

    // Make library classes available
    if (engine.moduleManager) {
        engine.moduleManager.libraryClasses = {
            ...engine.moduleManager.libraryClasses,
            ...window.COMPILED_GAME.libraryClasses
        };
        window.GUTS = engine.moduleManager.libraryClasses;
    }

    window.COMPILED_GAME.initialized = true;
    console.log('Compiled game bundle initialized successfully');
};

// Wait for external libraries to load before allowing engine init
window.COMPILED_GAME.ready = new Promise((resolve) => {
    if (window.COMPILED_GAME.externalLibraries && window.COMPILED_GAME.externalLibraries.length > 0) {
        window.addEventListener('compiled-libraries-ready', () => {
            console.log('🎮 Compiled game ready');
            resolve();
        });
    } else {
        // No external libraries, ready immediately
        resolve();
    }
});`;
        result.sections.push(initSection);
    }

    /**
     * Compile the engine core files into a single bundle
     */
    async compileEngine(engineFilePaths) {
        console.log('Compiling engine core files...');
        
        const engineSections = [];
        
        engineSections.push(`/**
 * Compiled Engine Bundle
 * Generated: ${new Date().toISOString()}
 * 
 * Contains: ModuleManager.js, BaseEngine.js, Engine.js
 */
`);

        const defaultPaths = {
            moduleManager: './../../engine/ModuleManager.js',
            baseEngine: './../../engine/BaseEngine.js',
            engine: './../../engine/Engine.js'
        };
        
        const paths = engineFilePaths || defaultPaths;
        
        try {
            engineSections.push('\n// ========== MODULE MANAGER ==========');
            const moduleManagerResponse = await fetch(paths.moduleManager);
            const moduleManagerCode = await moduleManagerResponse.text();
            engineSections.push(moduleManagerCode);
            
            engineSections.push('\n// ========== BASE ENGINE ==========');
            const baseEngineResponse = await fetch(paths.baseEngine);
            const baseEngineCode = await baseEngineResponse.text();
            engineSections.push(baseEngineCode);
            
            engineSections.push('\n// ========== ENGINE ==========');
            const engineResponse = await fetch(paths.engine);
            const engineCode = await engineResponse.text();
            engineSections.push(engineCode);
            
            console.log('✅ Engine files compiled successfully');
        } catch (error) {
            console.error('Error compiling engine files:', error);
            throw error;
        }
        
        return engineSections.join('\n\n');
    }

    /**
     * Save the compiled bundle to a file
     */
    async saveBundle(outputPath) {
        if (!this.compiledBundle) {
            throw new Error("No compiled bundle available. Run compile() first.");
        }

        const fs = require('fs').promises;
        await fs.writeFile(outputPath, this.compiledBundle.code, 'utf8');
        console.log(`Compiled bundle saved to: ${outputPath}`);
        
        const metadataPath = outputPath.replace('.js', '.meta.json');
        const metadata = {
            projectName: this.compiledBundle.projectName,
            timestamp: this.compiledBundle.timestamp,
            classRegistry: this.compiledBundle.classRegistry,
            dependencies: this.compiledBundle.dependencies
        };
        await fs.writeFile(metadataPath, JSON.stringify(metadata, null, 2), 'utf8');
        console.log(`Metadata saved to: ${metadataPath}`);
        
        return {
            bundlePath: outputPath,
            metadataPath: metadataPath
        };
    }

}

if (typeof Compiler != 'undefined') {
    if (typeof window !== 'undefined') {
        window.Compiler = Compiler;
    }
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = Compiler;
    }
}