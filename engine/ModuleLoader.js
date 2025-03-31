class ModuleLoader {
    constructor(app, collections, mainContentContainer, modalContainer, engineClasses){
        this.app = app;
        this.collections = collections;
        this.mainContentContainer = mainContentContainer;
        this.modalContainer = modalContainer;
        this.atLeastOneModuleAdded = false;
        this.engineClasses = engineClasses;
        this.libraries = {};
    }
//modules depend on libraries, they are not the same thing.
    async loadModules(modules) {
        if (!modules) return;
        window.loadingLibraries = {};
        const pendingLibraries = new Set();

        // Function to instantiate a library once its script is loaded
        const instantiateModuleFromLibrary = (library, moduleConfig) => {
            const libraryDef = this.collections.libraries[library];
            const libraryClassName = libraryDef.className;

            let libraryClass = window.loadingLibraries[libraryClassName];
            try {
                if (!libraryClass) {
                    throw new Error(`Library class ${libraryClassName} not found in global scope`);
                }
                this.libraries[library] = libraryClass;
                delete window.loadingLibraries[libraryClassName];
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

                    if (libraryDef.script) {
                        const scriptContent = `window.loadingLibraries.${libraryDef.className} = ${libraryDef.script};`;
                        const blob = new Blob([scriptContent], { type: 'application/javascript' });
                        scriptUrl = URL.createObjectURL(blob);
                        scriptTag.src = scriptUrl;

                        scriptTag.onload = () => {
                            console.log('loaded', library, moduleConfig);
                            URL.revokeObjectURL(scriptUrl);
                            instantiateModuleFromLibrary(library, moduleConfig);
                            resolve();
                        };
                    } else if (libraryDef.href) {
                        scriptTag.src = libraryDef.href;
                        scriptTag.onload = () => {
                            console.log('loaded', library);   
                            resolve();
                        };
                    }

                    scriptTag.onerror = (error) => {
                        scriptUrl ? URL.revokeObjectURL(scriptUrl) : 0;
                        console.error(`Error loading script for module ${library}:`, error);
                        pendingLibraries.delete(library);
                        reject(error);
                    };

                    document.head.appendChild(scriptTag);
                } else {
                    console.log('already loaded', library);
                    resolve();
                }
            });
        };

        // Set up UI elements (this part remains unchanged)
        Object.entries(modules).forEach(([moduleId, module]) => {
            let ui = this.collections.interfaces[module.interface];
            if (ui) {
                let html = ui.html;
                let css = ui.css;
                let modals = ui.modals;
                this.mainContentContainer.innerHTML += html;

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
                        modalContent.innerHTML = this.collections.modals[modalId].html;
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
                    // No library needed, instantiate directly (if applicable)
                    await importLibrary(moduleId, moduleConfig);
                }
            }
        };

        // Return a promise that resolves when all libraries are loaded
        return await loadLibrariesInOrder().then(() => {
            window.loadingLibraries = {};
            console.log('loaded all modules', this.libraries);
            return this.libraries;
        }).catch((error) => {
            console.error("Error during sequential library loading:", error);
        });
    }
}

export { ModuleLoader }