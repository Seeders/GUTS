export default class ServerModuleManager {
    constructor(engine, collections) {
        this.core = engine;
        this.collections = collections;
        this.registeredLibraries = {};
        this.scriptCache = new Map();
        this.libraryClasses = {};
        this.moduleInstances = {};
        this.isServer = true;
    }

    registerModule(name, moduleInstance) {
        if (this.registeredLibraries[name]) {
            console.warn(`Module ${name} is already registered`);
            return this.registeredLibraries[name];
        }
        this.registeredLibraries[name] = moduleInstance;
        return moduleInstance;
    }

    getModule(name) {
        if (!this.registeredLibraries[name]) {
            console.error(`Module ${name} not found`);
            return null;
        }
        return this.registeredLibraries[name];
    }

    setupScriptEnvironment(app) {
        this.scriptContext = {
            app: app,
            appClasses: {},
            getFunction: (typeName) => this.getCompiledScript(typeName, 'functions'),
            getComponent: (typeName) => this.getCompiledScript(typeName, 'components'),
            getRenderer: (typeName) => this.getCompiledScript(typeName, 'renderers'),
            Math: Math,
            console: {
                log: (...args) => console.log('[Script]', ...args),
                error: (...args) => console.error('[Script]', ...args)
            },
            // Server-specific global objects
            process: process,
            global: global,
            Buffer: Buffer,
            ...this.registeredLibraries,
            ...global.GUTS
        };
        return this.scriptContext;
    }

    getCompiledScript(typeName, collectionType) {
        let formattedName = typeName.toLowerCase();
        if (this.scriptCache.has(formattedName)) {
            return this.scriptCache.get(formattedName);
        }

        const collections = this.core.getCollections();
        if (!collections[collectionType] || !collections[collectionType][typeName]) {
            console.error(`Script ${formattedName} not found in ${collectionType}`);
            return null;
        }

        const scriptText = collections[collectionType][typeName].script;
        return this.compileScript(scriptText, formattedName);
    }

    compileFunction(scriptText, typeName) {
        const compiledFunction = new Function('return ' + scriptText)();
        this.scriptCache.set(typeName.toLowerCase(), compiledFunction);
    }

    compileScript(scriptText, typeName) {
        if (!scriptText) {
            console.error(`No script text provided for ${typeName}`);
            return null;
        }
        console.log('compile script', typeName);
        try {
            const scriptFunction = new Function('engine', `return ${scriptText}`);
            const ScriptClass = scriptFunction(this.scriptContext);
            this.scriptCache.set(typeName.toLowerCase(), ScriptClass);
            return ScriptClass;
        } catch (error) {
            console.error(`Error compiling script for ${typeName}:`, error);
            return this.libraryClasses.Component || class DummyComponent {};
        }
    }

    async loadServerModules(modules) {
      console.log('loadServerModules', modules);
        if (!modules) return {};

        const loadedLibraries = {};
        
        for (const [moduleId, moduleConfig] of Object.entries(modules)) {
            const libraries = moduleConfig?.library ? [moduleConfig.library] : moduleConfig?.libraries || [moduleId];

            for (const library of libraries) {
                  console.log('searching for ', library);
                const libraryDef = this.collections.libraries[library];
                if (libraryDef) {
                  console.log('found', library);
                    try {
                        let libraryClass;
                        if (libraryDef.href && libraryDef.isModule) {                          
                            // Dynamic import for ES modules
                            const module = await import(libraryDef.href);
                            libraryClass = module[libraryDef.requireName] || module.default;
                        } else {
                            // Node.js require (for built-in modules)
                            const module = await import(`..${libraryDef.filePath}`);
                            libraryClass = module.default || module;
                        }

                        if (libraryClass) {
                            const libraryKey = library.replace(/-/g, '__');
                            this.registeredLibraries[libraryKey] = libraryClass;
                            loadedLibraries[libraryKey] = libraryClass;
                            console.log('loaded library server module', libraryKey);
                        }


                    } catch (error) {
                        console.error(`Error loading server module ${library}:`, error);
                    }
                }
            }
        }
        
        return loadedLibraries;
    }

    instantiateCollection(app, collection, classLibrary) {
        let instances = {};
        if (!collection || typeof collection !== 'object') {
            console.error('Invalid collection parameter');
            return instances;
        }

        if (!classLibrary || typeof classLibrary !== 'object') {
            console.error('Invalid classLibrary parameter');
            return instances;
        }

        Object.keys(collection).forEach((moduleId) => {
            let module = collection[moduleId];
            if (!module) {
                return;
            }

            try {
                if (module.library && classLibrary[module.library]) {
                    this.moduleInstances[module.library] = new classLibrary[module.library](
                        app, module, {...classLibrary}
                    );
                } else if (Array.isArray(module.libraries)) {
                    module.libraries.forEach((library) => {
                        if (classLibrary[library]) {
                            this.moduleInstances[library] = new classLibrary[library](
                                app, module, {...classLibrary}
                            );
                        }
                    });
                } else if (classLibrary[moduleId]) {
                    this.moduleInstances[moduleId] = new classLibrary[moduleId](
                        app, {}, {...classLibrary}
                    );
                }
            } catch (e) {
                console.error(`Failed to instantiate ${moduleId}:`, e);
            }
        });
        
        return this.moduleInstances;
    }
}