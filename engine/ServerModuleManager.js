export class ServerModuleManager {
  constructor( {engine, collections, path, vm}) {
    this.vm = vm;
    this.path = path;
    this.core = engine;
    this.collections = collections;
    this.atLeastOneModuleAdded = false;
    this.registeredLibraries = {};
    this.scriptCache = new Map();
    this.libraryClasses = {};
    this.moduleInstances = {};
    this.core.scriptContext = null;
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
      app,
      getFunction: (typeName) => this.getCompiledScript(typeName, 'functions'),
      getComponent: (typeName) => this.getCompiledScript(typeName, 'components'),
      getRenderer: (typeName) => this.getCompiledScript(typeName, 'renderers'),
      Math,
      console: {
        log: (...args) => console.log('[Script]', ...args),
        error: (...args) => console.error('[Script]', ...args),
      },
      ...this.registeredLibraries,
    };
    return this.scriptContext;
  }

  getCompiledScript(typeName, collectionType) {
    const formattedName = typeName.toLowerCase();
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
    try {
      const compiledFunction = new Function('return ' + scriptText)();
      this.scriptCache.set(typeName.toLowerCase(), compiledFunction);
    } catch (error) {
      console.error(`Error compiling function ${typeName}:`, error);
    }
  }

  compileScript(scriptText, typeName) {
    if (!scriptText) {
      console.error(`No script text provided for ${typeName}`);
      return null;
    }

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

  async loadModules(modules) {
    if (!modules) return {};

    const collections = this.core.getCollections();
    const pendingLibraries = new Set();

    // Function to load a single library
    const importLibrary = async (library, moduleConfig) => {
      try {
        const libraryDef = collections.libraries[library];
        if (!libraryDef) {
          console.warn(`Library definition for ${library} not found`);
          return;
        }

        this.atLeastOneModuleAdded = true;
        let moduleClass;

        if (libraryDef.script) {
          // Execute inline script (mimics client-side blob)
          const moduleExports = { exports: {} };
          const scriptCode = `((module, exports) => { ${libraryDef.script} })(module, exports);`;
          const script = new this.vm.Script(scriptCode);
          const context = {
            module: moduleExports,
            exports: moduleExports.exports,
            console,
          };
          script.runInNewContext(context);
          moduleClass = moduleExports.exports;
          if (libraryDef.className && typeof moduleClass === 'object') {
            moduleClass = moduleClass[libraryDef.className] || moduleClass;
          }
        } else if (libraryDef.href) {
          // Load from filesystem
          const modulePath = this.path.resolve(__dirname, libraryDef.href);
          if (libraryDef.isModule) {
            // ES Module
            moduleClass = await import(modulePath).then((module) => module.default || module[libraryDef.className]);
          } else {
            // CommonJS or global script
            moduleClass = require(modulePath);
            if (libraryDef.className && typeof moduleClass === 'object') {
              moduleClass = moduleClass[libraryDef.className] || moduleClass;
            }
          }
        } else {
          console.warn(`No valid loading method for library ${library}`);
          return;
        }

        // Register the module
        const className = libraryDef.className || library;
        this.registeredLibraries[className] = moduleClass;
        this.libraryClasses[className] = moduleClass;
        pendingLibraries.delete(library);
      } catch (error) {
        console.error(`Error loading library ${library}:`, error);
        pendingLibraries.delete(library);
      }
    };

    // Build import map for ES Modules (optional)
    Object.entries(modules).forEach(([moduleId, moduleConfig]) => {
      const libraries = moduleConfig?.library
        ? [moduleConfig.library]
        : moduleConfig?.libraries || [moduleId];
      libraries.forEach((library) => {
        const libraryDef = collections.libraries[library];
        if (libraryDef && libraryDef.importName && libraryDef.href && libraryDef.isModule) {
          this.importMap[libraryDef.importName] = this.path.resolve(__dirname, libraryDef.href);
        }
      });
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

    await loadLibrariesInOrder();
    return this.registeredLibraries;
  }

  instantiateCollection(app, collection, classLibrary) {
    const instances = {};
    if (!collection || typeof collection !== 'object') {
      console.error('Invalid collection parameter');
      return instances;
    }

    if (!classLibrary || typeof classLibrary !== 'object') {
      console.error('Invalid classLibrary parameter');
      return instances;
    }

    Object.keys(collection).forEach((moduleId) => {
      const module = collection[moduleId];
      if (!module) return;

      if (module.library) {
        const libName = module.library;
        if (classLibrary[libName]) {
          try {
            this.moduleInstances[libName] = new classLibrary[libName](app, module, { ...classLibrary });
          } catch (e) {
            console.error(`Failed to instantiate ${libName}:`, e);
          }
        }
      } else if (Array.isArray(module.libraries)) {
        module.libraries.forEach((library) => {
          if (classLibrary[library]) {
            try {
              this.moduleInstances[library] = new classLibrary[library](app, module, { ...classLibrary });
            } catch (e) {
              console.error(`Failed to instantiate ${library}:`, e);
            }
          }
        });
      } else {
        try {
          if (classLibrary[moduleId]) {
            this.moduleInstances[moduleId] = new classLibrary[moduleId](app, {}, { ...classLibrary });
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
      const modulePath = this.path.resolve(__dirname, moduleDef.href);
      const module = await import(modulePath);
      const moduleClass = module.default || module[moduleDef.className];

      if (!moduleClass) {
        throw new Error(`Module class ${moduleDef.className} not found`);
      }

      if (moduleDef.className) {
        this.libraryClasses[moduleDef.className] = moduleClass;
      }

      return moduleClass;
    } catch (error) {
      console.error(`Error loading library module ${moduleDef.href}:`, error);
      return null;
    }
  }
}
