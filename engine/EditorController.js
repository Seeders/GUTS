import { EditorModel } from './EditorModel.js';
import { EditorView } from './EditorView.js';
import { ModuleManager } from './ModuleManager.js';

/**
 * Main controller class for the editor application.
 * Coordinates between the data model and the user interface.
 * Follows MVC architecture pattern.
 */
export class EditorController {
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
            handle: document.getElementById('toggleEditorButton'),
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
    }

    /**
     * Main initialization method - sets up projects and loads initial content
     * Called when application starts
     */
    async init() {
        // Make sure default projects exist in localStorage
        this.model.initializeDefaultProjects();

        // Determine which project to load (saved or default)
        const initialProject = this.model.getInitialProject();
        await this.loadProject(initialProject);

        // Complete setup after project is loaded
        this.finalizeSetup();
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


    /**
     * Loads a project by name, including all associated modules and configurations
     * Central method that coordinates project initialization
     * @param {string} name - Project identifier to load
     */
    async loadProject(name) {
        // Load project data from storage via the model
        const project = await this.model.loadProject(name);
            
            // Initialize module manager for handling dynamic modules
            this.moduleManager = new ModuleManager(
                this.model, 
                project.objectTypes, 
                this.elements.mainContentContainer, 
                this.elements.modalContainer
            );
            
            try {
                // First load all required library modules
                // Libraries provide common functionality needed by other modules
                this.moduleManager.libraryClasses = await this.moduleManager.loadModules(
                    project.objectTypes.libraries
                );
                
                // Then load property editor modules based on editor configuration
                const editorConfig = project.objectTypes.configs?.editor;
        if (editorConfig) {
            // Filter property modules to only those specified in editor config
            const editorModules = {};
            editorConfig.propertyModules.forEach((pm) => {
                if (project.objectTypes.propertyModules[pm]) {
                    editorModules[pm] = project.objectTypes.propertyModules[pm];
                }
            });
            
            // Load property module classes dynamically
            this.propertyModuleClasses = await this.moduleManager.loadModules(editorModules);
            
            // Setup script execution environment for modules
            this.scriptContext = await this.moduleManager.setupScriptEnvironment(this);
            
            // Instantiate property modules with controller context
            this.propertyModuleInstances = this.moduleManager.instantiateCollection(
                this, 
                project.objectTypes.propertyModules, 
                this.propertyModuleClasses
            );
                    
            // Set up event listeners for module UI interactions
            this.view.setupModuleEventListeners(project.objectTypes.propertyModules);
            }
            
            // Apply theme if specified in editor config
            if (editorConfig?.theme) {
                this.applyTheme(project.objectTypes.themes[editorConfig.theme]);
            }
        } catch (e) {
            console.error('Error loading modules:', e);
        }
        if(!this.model.defaultProjects[name]) {
            this.elements.deleteProjectBtn.classList.remove("hidden");
        } else {
            this.elements.deleteProjectBtn.classList.add("hidden");
        }
        // Update UI components to reflect loaded project
        this.view.renderObjectList();
        this.view.updateSidebarButtons();
        this.view.updateProjectSelectors();
        
        // Select first available object to show in editor
        this.selectInitialObject();
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

    selectObject(obj){
        this.model.selectObject(obj);
        this.view.selectObject(obj);
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
     * Completes the setup process after project loading
     * Removes loading state and sets up event listeners
     */
    finalizeSetup() {
        // Remove loading indicator on next frame for smooth transition
        requestAnimationFrame(() => {
            document.body.classList.remove('loading');
        });

    }

    /**
     * Saves changes to the current object
     * @param {Object} data - Object data to save
     */
    saveObject(data) {
        this.model.saveObject(data);
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
        }
        return success;
    }
}

// Initialize the application when DOM is fully loaded
document.addEventListener('DOMContentLoaded', () => {
    const editor = new EditorController();
    editor.init();
});