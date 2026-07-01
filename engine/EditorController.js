/**
 * Main controller class for the editor application.
 * Coordinates between the data model and the user interface.
 * Follows MVC architecture pattern.
 */
class EditorController {
    /**
     * Initializes the editor controller, sets up model, and caches DOM elements
     */
    constructor() {
        // Initialize the data model for managing application state
        this.model = new EditorModel();
        
        // Cache all DOM element references for performance
        // Reduces DOM queries during runtime
        this.elements = {
            app: document.getElementById("container"),
            objectList: document.getElementById('object-list'),
            editor: document.getElementById('editor'),
            newObjectModal: document.getElementById('new-object-modal'),
            newObjectIdInput: document.getElementById('new-object-id'),
            newObjectNameInput: document.getElementById('new-object-name'),
            duplicateObjectModal: document.getElementById('duplicate-object-modal'),
            duplicateObjectIdInput: document.getElementById('duplicate-object-id'),
            duplicateObjectNameInput: document.getElementById('duplicate-object-name'),
            tabs: document.querySelectorAll('.tab'),
            launchGameBtn: document.getElementById('launch-game-btn'),
            modalContainer: document.getElementById('modals'),
            mainContentContainer: document.getElementById('main-content-container'),
            sidebar: document.querySelector('#container .sidebar'),
            projectSelector: document.getElementById('project-selector'),
            deleteProjectBtn: document.getElementById('delete-project-btn')
        };

        // Initialize the view after the model is ready
        // View handles all UI rendering and updates
        this.view = new EditorView(this);
        this.fs = new FileSystemSyncService(this); 
        this.componentClasses = {};
        window.APP = this;
    }

    /**
     * Main initialization method - sets up projects and loads initial content
     * Called when application starts
     */
    async init() {

        // Sync projects from filesystem (discovers new project folders)
        await this.model.syncProjectsFromFilesystem();

        // Determine which project to load (saved or first available)
        const initialProject = this.model.getInitialProject();

        if (!initialProject) {
            console.warn('No projects found. Create a project folder in projects/ directory.');
            document.body.classList.remove('loading');
            return;
        }

        await this.loadProject(initialProject);

        // Complete setup after project is loaded
        requestAnimationFrame(() => {
            document.body.classList.remove('loading');
        });

    }

    getCurrentVersion() {
      return this.model.getCurrentVersion();
    }
  
    /**
     * Gets the currently selected object from the model
     * @returns {Object} The currently selected object or null
     */
    getCurrentObject() {
        return this.model.getCurrentObject();
    }

    /**
     * Gets the singular form of an object type name
     * Used for UI labels and messages
     * @param {string} typeId - Type identifier
     * @returns {string} Singular form of type name
     */
    getSingularType(typeId) {
        return this.model.getSingularType(typeId);
    }

    /**
     * Gets the plural form of an object type name
     * Used for UI labels and section headers
     * @param {string} typeId - Type identifier
     * @returns {string} Plural form of type name
     */
    getPluralType(typeId) {
        return this.model.getPluralType(typeId);
    }

    /**
     * Retrieves all object collections from the model
     * Used to populate lists and selection dropdowns
     * @returns {Object} Collections of objects by type
     */
    getCollections() {
        return this.model.getCollections();
    }

    /**
     * Returns collection definitions metadata
     * Contains type information and schema
     * @returns {Object} Object type definitions
     */
    getCollectionDefs() {
        return this.model.getCollectionDefs();
    }

    dispatchHook(hookName, params) {
        requestAnimationFrame(() => {
            const customEvent = new CustomEvent(hookName, {
                detail: this.getHookDetail({params}),  
            });
            document.body.dispatchEvent(customEvent);
        });
    }
    getHookDetail(params, result) {
        return { selectedType: this.model.state.selectedType, selectedObject: this.model.state.selectedObject, params: params.arguments, result: result };
    }
    /**
     * Loads a project by name, including all associated modules and configurations
     * Central method that coordinates project initialization
     * @param {string} name - Project identifier to load
     */
    async loadProject(name) {
        await this.model.loadProject(name);
        await this.fs.importProject(name);
        const project = this.model.state.project;

        try {
            const editorConfig = project.objectTypes.configs?.editor;

            // Load property editor modules based on editor configuration
            if (editorConfig) {
                const { editorModules, moduleLibraries } = this.collectEditorModules(project, editorConfig);

                // Inject declared interfaces (html/css/modals) for modules and their libraries
                this.injectModuleInterfaces(project, editorModules);
                this.injectModuleInterfaces(project, moduleLibraries);

                this.instantiateEditorModules(editorModules);

                // Set up event listeners for module UI interactions
                this.view.setupModuleEventListeners(editorModules);
            }

            // Apply theme if specified in editor config
            if (editorConfig?.theme) {
                this.applyTheme(project.objectTypes.themes[editorConfig.theme]);
            }
        } catch (e) {
            console.error('Error loading modules:', e);
        }

        // Update UI components to reflect loaded project
        this.view.renderObjectList();
        this.view.updateSidebarButtons();
        this.view.updateProjectSelectors();

        // Select first available object to show in editor
        this.selectInitialObject();
        this.dispatchHook('loadProject', arguments);

        // New Unity-like shell (opt-in via ?ui=new). Mounts once, refreshes on
        // subsequent project loads. Legacy chrome stays in the DOM but hidden.
        this._mountNewShellIfRequested();
    }

    /**
     * Mount the new EditorShell if the URL requests it (?ui=new). Editor-only;
     * no-op otherwise, so the legacy UI is completely unaffected.
     */
    _mountNewShellIfRequested() {
        try {
            const params = new URLSearchParams(window.location.search);
            if (params.get('ui') !== 'new') return;
            const ShellClass = window.EditorShell || (window.GUTS && window.GUTS.EditorShell);
            if (!ShellClass) { console.warn('EditorShell not found in bundle'); return; }
            if (!this.shell) this.shell = new ShellClass(this);
            if (!this.shell.root) this.shell.mount();
            else if (this.shell.renderAssets) this.shell.renderAssets();
        } catch (e) { console.error('Failed to mount new editor shell:', e); }
    }

    /**
     * Collects the editor modules named in the editor config, along with the
     * library definitions each module depends on.
     * @param {Object} project - Loaded project (objectTypes bag)
     * @param {Object} editorConfig - configs.editor with an editorModules list
     * @returns {{editorModules: Object, moduleLibraries: Object}}
     */
    collectEditorModules(project, editorConfig) {
        const editorModules = {};
        const moduleLibraries = {};

        (editorConfig.editorModules || []).forEach((moduleId) => {
            const module = project.objectTypes.editorModules[moduleId];
            if (!module) return;

            editorModules[moduleId] = module;
            (module.libraries || []).forEach((libraryName) => {
                moduleLibraries[libraryName] = project.objectTypes.libraries[libraryName];
            });
        });

        return { editorModules, moduleLibraries };
    }

    /**
     * Injects the HTML/CSS/modals declared by each module's `interface` into the page.
     * @param {Object} project - Loaded project (holds interfaces/modals)
     * @param {Object} modules - Map of moduleId/libraryName -> definition
     */
    injectModuleInterfaces(project, modules) {
        Object.values(modules).forEach((module) => {
            if (!module || !module.interface) return;

            const ui = project.objectTypes.interfaces[module.interface];
            if (!ui) return;

            if (ui.html) {
                this.elements.mainContentContainer.innerHTML += ui.html;
            }
            if (ui.css) {
                const styleTag = document.createElement('style');
                styleTag.innerHTML = ui.css;
                document.head.append(styleTag);
            }
            if (ui.modals) {
                this.injectModals(project, ui.modals);
            }
        });
    }

    /**
     * Builds and appends modal elements for the given modal ids.
     * @param {Object} project - Loaded project (holds modal html)
     * @param {Array<string>} modalIds - Modal ids to render
     */
    injectModals(project, modalIds) {
        modalIds.forEach((modalId) => {
            const modal = document.createElement('div');
            modal.setAttribute('id', `modal-${modalId}`);
            modal.classList.add('modal');

            const modalContent = document.createElement('div');
            modalContent.classList.add('modal-content');
            modalContent.innerHTML = project.objectTypes.modals[modalId].html;

            modal.append(modalContent);
            this.elements.modalContainer.append(modal);
        });
    }

    /**
     * Instantiates the editor module classes for the given modules.
     * A module either names a single `library` class, or exposes a `libraries`
     * array from which classes ending in `Editor`/`Module` are instantiated.
     * @param {Object} editorModules - Map of moduleId -> definition
     */
    instantiateEditorModules(editorModules) {
        this.editorModuleInstances = {};

        const instantiate = (className, module) => {
            if (!window.GUTS[className]) {
                console.warn(`Editor module library ${className} not found in window.GUTS`);
                return;
            }
            try {
                this.editorModuleInstances[className] = new window.GUTS[className](this, module, window.GUTS);
            } catch (e) {
                console.error(`Failed to instantiate ${className}:`, e);
            }
        };

        Object.values(editorModules).forEach((module) => {
            if (!module) return;

            if (module.library) {
                instantiate(module.library, module);
            } else if (Array.isArray(module.libraries)) {
                module.libraries
                    .filter((library) => library.endsWith('Editor') || library.endsWith('Module'))
                    .forEach((library) => instantiate(library, module));
            }
        });
    }

    renderObjectList() {
        this.view.renderObjectList();    
    }

    /**
     * Applies CSS theme to the application
     * Injects theme CSS into document head
     * @param {Object} themeConfig - Theme configuration with CSS
     */
    applyTheme(themeConfig) {
        // Find existing theme style tag or create a new one
        const styleTag = document.getElementById("theme_style") || document.createElement('style');
        styleTag.id = "theme_style";
        styleTag.innerHTML = themeConfig.css;
        document.head.appendChild(styleTag);
    }

    /**
     * Selects an object by id and refreshes the editor UI to show it.
     * @param {string|null} objectId - Object identifier to select (null clears)
     */
    selectObject(objectId) {
        this.model.selectObject(objectId);
        this.view.selectObject();
    }

    /**
     * Selects the first object in the current collection
     * Called after project load to ensure something is selected
     */
    selectInitialObject() {
        const collections = this.model.getCollections();
        const currentType = this.model.state.selectedType;
        
        if (collections[currentType] && Object.keys(collections[currentType]).length > 0) {
            // Select first object if collection has objects
            this.selectObject(Object.keys(collections[currentType])[0])
        } else {
            // Clear selection if no objects available
            this.model.state.selectedObject = null;
            this.view.renderEditor();
        }
    }
    /**
     * Saves changes to the current object
     * @param {Object} data - Object data to save
     */
    saveObject(data) {
        let result = this.model.saveObject(data);
        if( result.success ) {
            this.view.saveObject(data);
            this.dispatchHook('saveObject', arguments);
        }
    }

    /**
     * Saves the entire project to storage
     * Shows success message on completion
     * @returns {boolean} Success status
     */
    saveProject() {
        const success = this.model.saveProject();
        if (success) {
            this.view.showSuccessMessage('Project saved successfully!');
            this.dispatchHook('saveProject', arguments);
        }
        return success;
    }

    setSelectedType(type) {
        this.model.setSelectedType(type);
    }
    getSelectedType() {
        return this.model.getSelectedType();
    }

    getSelectedObject() {
        return this.model.state.selectedObject;
    }

    getProjectName() {
        return this.model.getCurrentProject();
    }

    getSelectedCollection() {
        return this.model.getSelectedType();
    }

    getSelectedCategory() {
        const collectionName = this.model.getSelectedType();
        if (!collectionName) return null;

        const collectionDef = this.model.getCollectionDefs().find(def => def.id === collectionName);
        return collectionDef?.objectTypeCategory || null;
    }

    getExpandedCategories() {
        return this.model.state.expandedCategories;
    }

    setExpandedCategories(categories) {
        this.model.state.expandedCategories = categories;
    }

    findMatchingTypes(key) {
        return this.model.findMatchingTypes(key);
    }

    updateObject(data) {
        return this.model.updateObject(data);
    }

    createObject(type, id, data) {
        return this.model.createObject(type, id, data);
    }

    duplicateObject(newId, newName) {
        return this.model.duplicateObject(newId, newName);
    }

    deleteObject() {
        this.model.deleteObject();
    }

    createProject(name, config) {
        return this.model.createProject(name, config);
    }

    listProjects() {
        return this.model.listProjects();
    }

    getCurrentProject() {
        return this.model.state.currentProject;
    }

    getResourcesPath(){
        return `/projects/${this.getCurrentProject()}/resources/`;
    }

    getDefaultRender() {
        return this.model.CONFIG.DEFAULT_RENDER;
    }

    getDefaultTileMap() {
        return this.model.CONFIG.DEFAULT_TILEMAP;
    }

    getDefaultScript() {
        return this.model.CONFIG.DEFAULT_SCRIPT;
    }

    createType(typeId, typeName, typeSingular, typeCategory) {
        const result = this.model.createType(typeId, typeName, typeSingular, typeCategory);
        if (result.success) {
            // Dispatch custom event directly (not using dispatchHook) so we control the detail
            const customEvent = new CustomEvent('createType', {
                detail: { typeId, typeName, typeSingular, typeCategory }
            });
            document.body.dispatchEvent(customEvent);
        }
        return result;
    }

    removeSelectedType() {
        const typeId = this.getSelectedType();
        // Get category before deleting (needed to delete the folder)
        const category = this.model.getCategoryByType(typeId);
        const result = this.model.deleteType(typeId);
        if (result.success) {
            // Dispatch custom event directly
            const customEvent = new CustomEvent('deleteType', {
                detail: { typeId, category }
            });
            document.body.dispatchEvent(customEvent);
        }
        return result;
    }

    createColorInputGroup(value, attributeName, attributeValue, container, callback){
        return this.view.createColorInputGroup(value,  attributeName, attributeValue, container, callback);
    }

    createTextureInputGroup(value, attributeName, attributeValue, container, callback){
        return this.view.createTextureInputGroup(value,  attributeName, attributeValue, container, callback);
    }

    getColorValue(value){        
        const palette = this.getPalette();   
        const colorToUse = palette && value.paletteColor ? palette[value.paletteColor] : value;
        return colorToUse;    
    }
    setColorValue(container, rawValue){
        let colorValue = this.getColorValue(rawValue);
        container.querySelector("input[type='text']").value = colorValue;
        container.querySelector("input[type='color']").value = colorValue;    
        container.querySelector("select").value = colorValue;    
        return colorValue;
    }
    getPalette() {
        const paletteName = this.getCollections().configs.game.palette || "main";
        const palettes = this.getCollections().palettes;
        return palettes && palettes[paletteName] ? palettes[paletteName] : null;
    }
    
    /**
     * Gets a compiled component class by type name
     * @param {string} typeName - Component type name
     * @returns {Function|null} - Compiled component class or null if not found
     */
    getComponentClass(typeName) {
        return this.scriptContext.getComponent(typeName) || null;
    }

    /**
     * Instantiates a component by type name with the given entity and params
     * @param {string} typeName - Component type name
     * @param {Object} entity - Entity to attach component to
     * @param {Object} params - Parameters for component initialization
     * @returns {Object|null} - Instantiated component or null if failed
     */
    instantiateComponent(typeName) {
        const ComponentClass = this.getComponentClass(typeName);
        if (!ComponentClass) {
            console.error(`Component class ${typeName} not found`);
            return null;
        }

        try {
            return new ComponentClass(this, null);
        } catch (error) {
            console.error(`Error instantiating component ${typeName}:`, error);
            return null;
        }
    }
}

// Initialize the application when DOM is fully loaded
document.addEventListener('DOMContentLoaded', () => {
    const editor = new EditorController();
    editor.init();
});