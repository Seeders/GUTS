class Compiler {
    constructor(engine) {
        this.engine = engine;
        this.collections = null;
        this.compiledBundle = null;
        this.compiledEngine = null;
        this.classRegistry = {
            systems: new Map(),
            managers: new Map(),
            components: new Map(),
            functions: new Map(),
            renderers: new Map(),
            classes: new Map()
        };
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
     * @returns {Object} - Compilation result with bundle code and metadata
     */
    async compile(projectName, collections, objectTypeDefinitions, engineFilePaths) {
        console.log(`Starting compilation for project: ${projectName}`);

        this.collections = collections;
        this.objectTypeDefinitions = objectTypeDefinitions;
        if (!this.collections) {
            throw new Error("Failed to load game configuration");
        }

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

window.engine = {};

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

    for (const libraryName of projectConfig.libraries) {
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
     */
    async buildGameClasses(result) {
        const classesSection = ['// ========== GAME CLASSES =========='];
        
        // Collect all unique classes from all scenes
        const collectedClasses = {
            systems: new Set(),
            managers: new Set(),
            components: new Set(),
            functions: new Set(),
            renderers: new Set(),
            classes: new Set()
        };

        // Scan all scenes to find which classes are used
        if (this.collections.scenes) {
            for (const sceneName in this.collections.scenes) {
                const scene = this.collections.scenes[sceneName];
                this.collectClassesFromScene(scene, collectedClasses);
            }
        }

        // Compile functions first (they might be used by other classes)
        if (this.collections.functions) {
            classesSection.push('\n// ========== FUNCTIONS ==========');
            for (const funcName in this.collections.functions) {
                const funcDef = this.collections.functions[funcName];
                if (funcDef.script) {
                    classesSection.push(`\n// Function: ${funcName}`);
                    classesSection.push(`window.COMPILED_GAME.classRegistry.functions = window.COMPILED_GAME.classRegistry.functions || {};`);
                    classesSection.push(`window.COMPILED_GAME.classRegistry.functions['${funcName}'] = ${funcDef.script};`);
                    this.classRegistry.functions.set(funcName, true);
                    collectedClasses.functions.add(funcName);
                }
            }
        }

        // Compile systems
        if (this.collections.systems && collectedClasses.systems.size > 0) {
            classesSection.push('\n// ========== SYSTEMS ==========');
            for (const systemName of collectedClasses.systems) {
                const systemDef = this.collections.systems[systemName];
                if (systemDef && systemDef.script) {
                    classesSection.push(`\n// System: ${systemName}`);
                    classesSection.push(`window.COMPILED_GAME.classRegistry.systems = window.COMPILED_GAME.classRegistry.systems || {};`);
                    classesSection.push(`window.COMPILED_GAME.classRegistry.systems['${systemName}'] = ${systemDef.script};`);
                    this.classRegistry.systems.set(systemName, true);
                }
            }
        }

        // Compile managers
        if (this.collections.managers && collectedClasses.managers.size > 0) {
            classesSection.push('\n// ========== MANAGERS ==========');
            for (const managerName of collectedClasses.managers) {
                const managerDef = this.collections.managers[managerName];
                if (managerDef && managerDef.script) {
                    classesSection.push(`\n// Manager: ${managerName}`);
                    classesSection.push(`window.COMPILED_GAME.classRegistry.managers = window.COMPILED_GAME.classRegistry.managers || {};`);
                    classesSection.push(`window.COMPILED_GAME.classRegistry.managers['${managerName}'] = ${managerDef.script};`);
                    this.classRegistry.managers.set(managerName, true);
                }
            }
        }

        // Compile components
        if (this.collections.components && collectedClasses.components.size > 0) {
            classesSection.push('\n// ========== COMPONENTS ==========');
            for (const componentName of collectedClasses.components) {
                const componentDef = this.collections.components[componentName];
                if (componentDef && componentDef.script) {
                    classesSection.push(`\n// Component: ${componentName}`);
                    classesSection.push(`window.COMPILED_GAME.classRegistry.components = window.COMPILED_GAME.classRegistry.components || {};`);
                    classesSection.push(`window.COMPILED_GAME.classRegistry.components['${componentName}'] = ${componentDef.script};`);
                    this.classRegistry.components.set(componentName, true);
                }
            }
        }

        // Compile renderers
        if (this.collections.renderers && collectedClasses.renderers.size > 0) {
            classesSection.push('\n// ========== RENDERERS ==========');
            for (const rendererName of collectedClasses.renderers) {
                const rendererDef = this.collections.renderers[rendererName];
                if (rendererDef && rendererDef.script) {
                    classesSection.push(`\n// Renderer: ${rendererName}`);
                    classesSection.push(`window.COMPILED_GAME.classRegistry.renderers = window.COMPILED_GAME.classRegistry.renderers || {};`);
                    classesSection.push(`window.COMPILED_GAME.classRegistry.renderers['${rendererName}'] = ${rendererDef.script};`);
                    this.classRegistry.renderers.set(rendererName, true);
                }
            }
        }

        // Compile other classes
        if (this.collections.classes && collectedClasses.classes.size > 0) {
            classesSection.push('\n// ========== OTHER CLASSES ==========');
            for (const className of collectedClasses.classes) {
                const classDef = this.collections.classes[className];
                if (classDef && classDef.script) {
                    classesSection.push(`\n// Class: ${className}`);
                    classesSection.push(`window.COMPILED_GAME.classRegistry.classes = window.COMPILED_GAME.classRegistry.classes || {};`);
                    classesSection.push(`window.COMPILED_GAME.classRegistry.classes['${className}'] = ${classDef.script};`);
                    this.classRegistry.classes.set(className, true);
                }
            }
        }

        result.sections.push(classesSection.join('\n'));
        result.classRegistry = {
            systems: Array.from(collectedClasses.systems),
            managers: Array.from(collectedClasses.managers),
            components: Array.from(collectedClasses.components),
            functions: Array.from(collectedClasses.functions),
            renderers: Array.from(collectedClasses.renderers),
            classes: Array.from(collectedClasses.classes)
        };
    }

    /**
     * Collect all classes referenced in a scene
     */
    collectClassesFromScene(scene, collectedClasses) {
        if (!scene.sceneData || !Array.isArray(scene.sceneData)) return;

        scene.sceneData.forEach(sceneEntity => {
            // Collect systems
            if (sceneEntity.systems) {
                sceneEntity.systems.forEach(systemDef => {
                    if (systemDef.type) {
                        collectedClasses.systems.add(systemDef.type);
                    }
                });
            }

            // Collect managers
            if (sceneEntity.managers) {
                sceneEntity.managers.forEach(managerDef => {
                    if (managerDef.type) {
                        collectedClasses.managers.add(managerDef.type);
                    }
                });
            }

            // Collect classes from ECS scenes
            if (sceneEntity.classes) {
                sceneEntity.classes.forEach(classDef => {
                    const collectionName = classDef.collection;
                    const baseClassId = classDef.baseClass;
                    
                    if (baseClassId && this.collections[collectionName]) {
                        if (collectionName === 'components') {
                            collectedClasses.components.add(baseClassId);
                        } else if (collectionName === 'systems') {
                            collectedClasses.systems.add(baseClassId);
                        } else if (collectionName === 'managers') {
                            collectedClasses.managers.add(baseClassId);
                        } else if (collectionName === 'renderers') {
                            collectedClasses.renderers.add(baseClassId);
                        } else {
                            collectedClasses.classes.add(baseClassId);
                        }
                    }

                    // Also collect all classes from the collection
                    if (this.collections[collectionName]) {
                        for (const classId in this.collections[collectionName]) {
                            if (collectionName === 'components') {
                                collectedClasses.components.add(classId);
                            } else if (collectionName === 'systems') {
                                collectedClasses.systems.add(classId);
                            } else if (collectionName === 'managers') {
                                collectedClasses.managers.add(classId);
                            } else if (collectionName === 'renderers') {
                                collectedClasses.renderers.add(classId);
                            } else {
                                collectedClasses.classes.add(classId);
                            }
                        }
                    }
                });
            }

            // Collect components from non-ECS scenes
            if (sceneEntity.components) {
                sceneEntity.components.forEach(componentDef => {
                    if (componentDef.type) {
                        collectedClasses.components.add(componentDef.type);
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
    const collection = window.COMPILED_GAME.classRegistry[collectionType];
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
    const collection = window.COMPILED_GAME.classRegistry[collectionType];
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
        for (const collectionType in window.COMPILED_GAME.classRegistry) {
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