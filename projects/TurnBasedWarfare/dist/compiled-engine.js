/**
 * Compiled Engine Bundle
 * Generated: 2025-11-04T23:36:02.474Z
 * 
 * Contains: ModuleManager.js, BaseEngine.js, Engine.js
 */



// ========== MODULE MANAGER ==========

class ModuleManager {
  constructor(editorCore, collections, mainContentContainer, modalContainer){
    this.core = editorCore;
    this.collections = collections;
    this.mainContentContainer = mainContentContainer;
    this.modalContainer = modalContainer;
    this.atLeastOneModuleAdded = false;
    this.registeredLibraries = {};
    this.scriptCache = new Map();
    this.libraryClasses = {};
    this.moduleInstances = {};
    this.core.scriptContext = null;
    this.isServer = this.core.isServer;    
    this.importMap = {};
  }

  // Module registration and management
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

  // Script compilation and execution
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
      ...this.registeredLibraries,
      ...this.libraryClasses
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

    try {
      // Inject scriptContext into the Function scope
      const scriptFunction = new Function(
          'engine',
          `return ${scriptText}`
      );

      const ScriptClass = scriptFunction(this.scriptContext);
      this.scriptCache.set(typeName.toLowerCase(), ScriptClass);
      return ScriptClass;
    } catch (error) {
      console.error(`Error compiling script for ${typeName}:`, error);
      return this.libraryClasses.Component || class DummyComponent {};
    }
  }
  async loadModules(modules) {
    
    if (!modules) return;
    let compiledLibraries = await this.checkCompiledScripts(modules);
    if(compiledLibraries != false){
        return compiledLibraries;
    }
    // if(this.isServer){
    //     return this.loadServerModules(modules);
    // }

    window.loadingLibraries = {};
    window.require = (f) => { 
        window.module = {};
        window.exports = {};
        return window[f] || window[this.registeredLibraries[f]];
    };
    const collections = this.core.getCollections();
    const pendingLibraries = new Set();
    this.importMap = this.importMap || {}; // Ensure importMap is initialized
    window.engine = this.registeredLibraries;
    // Function to instantiate a library once its script is loaded
    const instantiateModuleFromLibrary = (library, moduleConfig) => {
        let libraryKey = library.replace(/-/g, "__");
        try {
            let libraryClass = eval(libraryKey);
            
            if (!libraryClass) {
                throw new Error(`Library class ${libraryKey} not found in global scope`);
            }
            this.registeredLibraries[libraryKey] = libraryClass;
            delete window.loadingLibraries[libraryKey];
            pendingLibraries.delete(library);
        } catch (error) {
            console.error(`Error initializing library ${library}:`, error);
            pendingLibraries.delete(library);
        }
    };

    // Function to load a single library and return a promise
    const importLibrary = (library, moduleConfig) => {
        return new Promise((resolve, reject) => {
            let libraryDef = this.collections.libraries[library];
            this.atLeastOneModuleAdded = true;

            if (!document.getElementById(`${library}-script`)) {
                if (libraryDef.isModule && (libraryDef.filePath || libraryDef.href)) {
                    let path = libraryDef.filePath || libraryDef.href;
                    import(path).then((module) => {
                        let libName = libraryDef.requireName || library;
                        if (libraryDef.windowContext) {
                            if (!window[libraryDef.windowContext]) {
                                window[libraryDef.windowContext] = {};
                            }
                            window[libraryDef.windowContext][libName] = module[libName] || module;
                            this.registeredLibraries[libName] =  module[libName];
                            resolve();
                        } else {
                            window[libName] = module[libName] || module;
                            this.registeredLibraries[libName] =  module[libName];
                            resolve();
                        }
                    });
                } else {
                    let scriptTag = document.createElement("script");
                    scriptTag.setAttribute('id', `${library}-script`);
                    let scriptUrl = "";
                    if (libraryDef.script) {      
                        if (libraryDef.filePath) {
                            scriptTag.src = libraryDef.filePath;
                            scriptTag.onload = () => {
                                console.log('loaded', library);
                                instantiateModuleFromLibrary(library, moduleConfig);
                                resolve();
                            };
                        } else {
                            const scriptContent = `window.loadingLibraries.${library.replace(/-/g, "__")} = ${libraryDef.script};`;
                            const blob = new Blob([scriptContent], { type: 'application/javascript' });
                            scriptUrl = URL.createObjectURL(blob);
                            scriptTag.src = scriptUrl;
                            scriptTag.onload = () => {
                                URL.revokeObjectURL(scriptUrl);
                                instantiateModuleFromLibrary(library, moduleConfig);
                                resolve();
                            };
                        }
                        
                    } else if (libraryDef.href) {          
                        scriptTag.src = libraryDef.href;
                        scriptTag.onload = () => {
                            resolve();
                        };
                    } else {
                        resolve();
                    }
                    document.head.appendChild(scriptTag);

                    scriptTag.onerror = (error) => {
                        scriptUrl ? URL.revokeObjectURL(scriptUrl) : 0;
                        console.error(`Error loading script for module ${library}:`, error);
                        pendingLibraries.delete(library);
                        reject(error);
                    };
                }

            } else {
                resolve();
            }
        });
    };

    // Build the import map from module libraries
    Object.entries(modules).forEach(([moduleId, moduleConfig]) => {
        const libraries = (moduleConfig?.library ? [moduleConfig?.library] : moduleConfig?.libraries) || [moduleId];
        libraries.forEach((library) => {
            let libraryDef = this.collections.libraries[library];

            if (libraryDef && libraryDef.importName && (libraryDef.href || libraryDef.filePath) && libraryDef.isModule) {
                this.importMap[libraryDef.importName] = libraryDef.href || libraryDef.filePath;
            }
        });
    });

    // Prepend the import map to the document head
    if (Object.keys(this.importMap).length > 0 && !this.createdImportMap) {
        this.createdImportMap = true;
        let importMapScript = document.createElement('script');
        importMapScript.setAttribute('type', 'importmap');
        importMapScript.innerHTML = JSON.stringify({ imports: this.importMap }, null, 2);
        document.head.prepend(importMapScript);
    }

    // Set up UI elements
    Object.entries(modules).forEach(([moduleId, module]) => {
        let ui = collections.interfaces[module.interface];
        if (ui) {
            let html = ui.html;
            let css = ui.css;
            let modals = ui.modals;
            if (html) {
                this.mainContentContainer.innerHTML += html;
            }
            if (css) {
                let styleTag = document.createElement('style');
                styleTag.innerHTML = css;
                document.head.append(styleTag);
            }

            if (modals) {
                modals.forEach((modalId) => {
                    let modal = document.createElement('div');
                    modal.setAttribute('id', `modal-${modalId}`);
                    let modalContent = document.createElement('div');
                    modal.classList.add('modal');
                    modalContent.classList.add('modal-content');
                    modal.append(modalContent);
                    modalContent.innerHTML = collections.modals[modalId].html;
                    this.modalContainer.append(modal);
                });
            }
        }
    });

    // Load libraries sequentially
    const loadLibrariesInOrder = async () => {
        const moduleEntries = Object.entries(modules);

        for (const [moduleId, moduleConfig] of moduleEntries) {
            pendingLibraries.add(moduleId);

            if (moduleConfig.library) {
                await importLibrary(moduleConfig.library, moduleConfig);
            } else if (moduleConfig.libraries) {
                for (const library of moduleConfig.libraries) {
                    await importLibrary(library, moduleConfig);
                }
            } else {
                await importLibrary(moduleId, moduleConfig);
            }
        }
    };

    // Return a promise that resolves when all libraries are loaded
    return await loadLibrariesInOrder().then(() => {
        window.loadingLibraries = {};
        return this.registeredLibraries;
    }).catch((error) => {
        console.error("Error during sequential library loading:", error);
    });
  }

  async checkCompiledScripts(modules) {
     if (window.COMPILED_GAME_LOADED) {
        console.log('📦 Compiled bundle detected - skipping library loading');
        
        // Still set up UI elements (needed for editor modules)
        const collections = this.core.getCollections();
        Object.entries(modules).forEach(([moduleId, module]) => {
            let ui = collections.interfaces[module.interface];
            if (ui) {
                if (ui.html) {
                    this.mainContentContainer.innerHTML += ui.html;
                }
                if (ui.css) {
                    let styleTag = document.createElement('style');
                    styleTag.innerHTML = ui.css;
                    document.head.append(styleTag);
                }
                if (ui.modals) {
                    ui.modals.forEach((modalId) => {
                        let modal = document.createElement('div');
                        modal.setAttribute('id', `modal-${modalId}`);
                        let modalContent = document.createElement('div');
                        modal.classList.add('modal');
                        modalContent.classList.add('modal-content');
                        modal.append(modalContent);
                        modalContent.innerHTML = collections.modals[modalId].html;
                        this.modalContainer.append(modal);
                    });
                }
            }
        });
        
        // Return compiled library classes immediately
        return Promise.resolve(window.COMPILED_GAME.libraryClasses);
    }
    return false;
  }


  async loadServerModules(modules){

    const collections = this.core.getCollections();
    // Server: Load modules using Node.js require/import
    const loadedLibraries = {};
    for (const [moduleId, moduleConfig] of Object.entries(modules)) {
        const libraries = moduleConfig?.library ? [moduleConfig.library] : moduleConfig?.libraries || [moduleId];
        for (const library of libraries) {
            const libraryDef = collections.libraries[library];
            if (libraryDef) {
                if (libraryDef.href && libraryDef.isModule) {
                    try {
                        const module = await import(libraryDef.href);
                        const libraryKey = library.replace(/-/g, '__');
                        this.registeredLibraries[libraryKey] = module[libraryDef.requireName] || module.default;
                        loadedLibraries[libraryKey] = this.registeredLibraries[libraryKey];
                    } catch (error) {
                        console.error(`Error loading module ${library}:`, error);
                    }
                } else if (libraryDef.script) {
                    const libraryKey = library.replace(/-/g, '__');
                    const scriptFunction = new Function('return ' + libraryDef.script)();
                    this.registeredLibraries[libraryKey] = scriptFunction;
                    loadedLibraries[libraryKey] = scriptFunction;
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
          return;
      }

      if (!classLibrary || typeof classLibrary !== 'object') {
          console.error('Invalid classLibrary parameter');
          return;
      }

      Object.keys(collection).forEach((moduleId) => {
          let module = collection[moduleId];
          if (!module) {
            // console.warn(`Module ${moduleId} is undefined`);
              return;
          }

          // Handle single library case
          if (module.library) {
              const libName = module.library;
              if (classLibrary[libName]) {
                  try {
                      this.moduleInstances[libName] = new classLibrary[libName](
                          app, 
                          module,
                          {...classLibrary}
                      );
                  } catch (e) {
                      console.error(`Failed to instantiate ${libName}:`, e);
                  }
              } else {
                //  console.warn(`Library ${libName} not found in classLibrary`, classLibrary);
              }
          }
          // Handle multiple libraries case
          else if (Array.isArray(module.libraries)) {
              module.libraries.forEach((library) => {
                  if (classLibrary[library]) {
                      try {
                          this.moduleInstances[library] = new classLibrary[library](
                              app,
                              module,
                              {...classLibrary}
                          );
                      } catch (e) {
                          console.error(`Failed to instantiate ${library}:`, e);
                      }
                  } else {
                    // console.warn(`Library ${library} not found in classLibrary`, classLibrary, classLibrary[library]);
                  }
              });
          } else {
              //this means we are just a library not a module.
            // console.warn(`Module ${moduleId} has no valid library configuration`);
              try {
                  if (classLibrary[moduleId]) {
                      this.moduleInstances[moduleId] = new classLibrary[moduleId](
                          app,
                          {},
                          {...classLibrary}
                      );
                  } else {
                    //  console.warn(`Module ${moduleId} not found in classLibrary`, classLibrary, classLibrary[moduleId]);
                  }
              } catch (e) {
                  console.error(`Failed to instantiate ${moduleId}:`, e);
              }
          }
      });
      return this.moduleInstances;
  }

  async loadESModule(moduleDef) {
    if (!moduleDef.href) {
      console.error('Library module missing source');
      return null;
    }

    try {
      // Dynamic import for ES modules
      const module = await import(moduleDef.source);
      const moduleClass = module.default || module[moduleDef.className];
      
      if (!moduleClass) {
        throw new Error(`Module class ${moduleDef.className} not found`);
      }

      // Store library classes for script context
      if (moduleDef.className) {
        this.libraryClasses[moduleDef.className] = moduleClass;
      }

      return moduleClass;
    } catch (error) {
      console.error(`Error loading library module ${moduleDef.source}:`, error);
      return null;
    }
  }

}




// ========== BASE ENGINE ==========

class BaseEngine {
    constructor() {
        this.plugins = {};
        this.currentTime = Date.now();
        this.lastTime = Date.now();
        this.deltaTime = 0;
        this.engineClasses = [];
        this.appClasses = {};
        this.libraries = {};
        this.running = false;
        this.collections = null;
        this.moduleManager = null;
        this.gameInstance = null;
    }

    async loadCollections(projectName) {
        // This method will be overridden by client and server implementations
        throw new Error('loadCollections must be implemented by subclass');
    }

    getCollections() {
        return this.collections;
    }

    setupScriptEnvironment() {
        this.scriptContext = this.moduleManager.setupScriptEnvironment(this);
    }

    preCompileScripts() {
        for (let funcType in this.collections.functions) {
            const funcDef = this.collections.functions[funcType];
            this.moduleManager.compileFunction(funcDef.script, funcType);
        }
    }

    start() {
        this.running = true;
        this.lastTime = this.getCurrentTime();
    }

    stop() {
        this.running = false;
    }

    getCurrentTime() {
        return Date.now();
    }
}
if(typeof BaseEngine != 'undefined'){
    if (typeof window !== 'undefined') {
        window.BaseEngine = BaseEngine;
    }

    // Make available as ES module export (new for server)  
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = BaseEngine;
    }

    // Make available as ES6 export (also new for server)
    if (typeof exports !== 'undefined') {
        exports.default = BaseEngine;
        exports.BaseEngine = BaseEngine;
    }
}


// ========== ENGINE ==========

class Engine extends BaseEngine {
    constructor(target) {
        super();
        this.applicationTarget = document.getElementById(target);
        this.isServer = false;
        this.tickRate = 1 / 20; // 20 TPS
        this.lastTick = 0;
        this.accumulator = 0;
        const urlParams = new URLSearchParams(window.location.search);
        this.serverMode = urlParams.get('isServer');
        this.services = new Map();
        window.APP = this;
    }

    async init(projectName) {
        this.collections = await this.loadCollections(projectName);
        if (!this.collections) {
            console.error("Failed to load game configuration");
            return;
        }

        // Initialize ModuleManager
        this.moduleManager = new ModuleManager(this, this.collections, this.applicationTarget, this.applicationTarget);
        
        let projectConfig = this.collections.configs.game;
        if (projectConfig.libraries) {
            this.moduleManager.libraryClasses = await this.moduleManager.loadModules({ "game": projectConfig });
            window.GUTS = this.moduleManager.libraryClasses;
        }

        this.setupScriptEnvironment();
        this.preCompileScripts();

        this.gameInstance = new GUTS[projectConfig.appLibrary](this);
        this.loader = new GUTS[projectConfig.appLoaderLibrary](this.gameInstance);
        await this.loader.load();
        
        this.start();
    }

    async loadCollections(projectName) {
        let currentProject = projectName;
        let project = {};

        project = JSON.parse(localStorage.getItem(currentProject));
        
        if (!project) {
            const response = await window.fetch(`config/${currentProject.toUpperCase().replace(/ /g, '_')}.json`);
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            } else {
                const data = await response.json();
                project = data;
            }
        }
        return project.objectTypes;
    }

    hideLoadingScreen() {
        document.body.style = "";
        requestAnimationFrame(() => {
            this.applicationTarget.style = '';
        });
    }

    gameLoop() {
        if (!this.running) return;
        
        const now = this.getCurrentTime();
        const deltaTime = (now - this.lastTick) / 1000;
        this.lastTick = now;
        
        this.accumulator += deltaTime;
        while (this.accumulator >= this.tickRate) {
            this.tick();
            this.accumulator -= this.tickRate;
        }
        
        // Use setImmediate for next tick (Node.js specific)
        requestAnimationFrame(() => this.gameLoop());
    }

    tick() {
        // Update all active game rooms
        if (this.gameInstance && this.gameInstance.update) {
            this.gameInstance.update(this.tickRate);        
        }
        
    }
    start() {
        super.start();
        this.animationFrameId = requestAnimationFrame(() => this.gameLoop());
        requestAnimationFrame(() => {
            this.hideLoadingScreen();
        });
    }

    stop() {
        super.stop();
        if (this.animationFrameId) {
            cancelAnimationFrame(this.animationFrameId);
            this.animationFrameId = null;
        }
    }
    getCurrentTime() {
        return performance.now();
    }

    addService(key, serviceInstance) {
        if(!this.services.get(key)){
            this.services.set(key, serviceInstance);
        } else {
            console.warn('duplicate service key', key);
        }
    }
}