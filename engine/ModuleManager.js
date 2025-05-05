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
      getFunction: (typeName) => this.getCompiledScript(typeName, 'functions'),
      getComponent: (typeName) => this.getCompiledScript(typeName, 'components'),
      getRenderer: (typeName) => this.getCompiledScript(typeName, 'renderers'),
      Math: Math,
      console: {
        log: (...args) => console.log('[Script]', ...args),
        error: (...args) => console.error('[Script]', ...args)
      },
      ...this.registeredLibraries
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

  // Module loading system
  async loadModules(modules) {
    if (!modules) return;
    window.loadingLibraries = {};
    window.require = (f) => { 
        window.module = {};
        window.exports = {};
        return window[f] || window[this.registeredLibraries[f]]
    };
    const collections = this.core.getCollections();
    const pendingLibraries = new Set();

    // Function to instantiate a library once its script is loaded
    const instantiateModuleFromLibrary = (library, moduleConfig) => {

        let libraryClass = window.loadingLibraries[library];
        try {
            if (!libraryClass) {
                throw new Error(`Library class ${library} not found in global scope`);
            }
            this.registeredLibraries[library] = libraryClass;
            delete window.loadingLibraries[library];
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
                let scriptTag = document.createElement("script");
                scriptTag.setAttribute('id', `${library}-script`);
                let scriptUrl = "";
                if(libraryDef.isModule) {
                    scriptTag.setAttribute("type", "module");
                }
                if (libraryDef.script) {
                    const scriptContent = `window.loadingLibraries.${library} = ${libraryDef.script};`;
                    const blob = new Blob([scriptContent], { type: 'application/javascript' });
                    scriptUrl = URL.createObjectURL(blob);
                    scriptTag.src = scriptUrl;

                    scriptTag.onload = () => {
                        URL.revokeObjectURL(scriptUrl);
                        instantiateModuleFromLibrary(library, moduleConfig);
                        resolve();
                    };
                } else if (libraryDef.href) {
                    if(libraryDef.requireName && libraryDef.isModule){
                      import(libraryDef.href).then((module) => {
                        if(libraryDef.windowContext){
                          if(!window[libraryDef.windowContext]){
                            window[libraryDef.windowContext] = {};
                          }
                          window[libraryDef.windowContext][libraryDef.requireName] = module[libraryDef.requireName];
                          resolve();
                        } else {
                          window[libraryDef.requireName] = module;
                          resolve();
                        }
                      });
                    } 
                    scriptTag.src = libraryDef.href;
                    scriptTag.onload = () => {
                   
                        resolve();
                    };
                    
                } else {
                    resolve();
                }

                scriptTag.onerror = (error) => {
                    scriptUrl ? URL.revokeObjectURL(scriptUrl) : 0;
                    console.error(`Error loading script for module ${library}:`, error);
                    pendingLibraries.delete(library);
                    reject(error);
                };

                document.head.appendChild(scriptTag);
            } else {
                resolve();
            }
        });
    };

    // Set up UI elements
    Object.entries(modules).forEach(([moduleId, module]) => {
        let ui = collections.interfaces[module.interface];
        if (ui) {
            let html = ui.html;
            let css = ui.css;
            let modals = ui.modals;
            if( html ) {
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
                // Load multiple libraries in order if specified
                for (const library of moduleConfig.libraries) {
                    await importLibrary(library, moduleConfig);
                }
            } else {
                // No library needed, instantiate directly
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
