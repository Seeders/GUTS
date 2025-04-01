import { EditorModel } from './EditorModel.js';
import { EditorView } from './EditorView.js';
import { ModuleManager } from './ModuleManager.js';
import { DEFAULT_PROJECT_CONFIG } from '../config/default_app_config.js';

export class EditorController {
  constructor() {
    // Initialize core systems
    this.model = new EditorModel();
    
    // Cache DOM elements
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

    // Initialize UI after core systems
    this.view = new EditorView(this);
  }

  async init() {
    // Initialize default projects if they don't exist
    this.initializeDefaultProjects();

    // Load saved project or default
    const initialProject = this.getInitialProject();
    await this.loadProject(initialProject);

    // Finalize initialization
    this.finalizeSetup();
  }

  initializeDefaultProjects() {
    Object.keys(this.model.defaultProjects).forEach((key) => {
      if (!localStorage.getItem(key)) {
        localStorage.setItem(key, JSON.stringify(this.model.defaultProjects[key]));
      }
    });
  }

  getCurrentObjectContext() {
    const { selectedType, selectedObject } = this.model.state;
    return { selectedType, selectedObject };
  }
  getCurrentObject() {
    return this.model.getCurrentObject();
  }
  getSingularType(typeId) {
    return this.model.getSingularType(typeId);
  }

  getPluralType(typeId) {
    return this.model.getPluralType(typeId);
  }


  getCollections() {
    return this.model.getCollections();
  }

  getCollectionDefs() {
    return this.model.getCollectionDefs();
  }


  getInitialProject() {
    const savedProject = localStorage.getItem("currentProject");
    return savedProject && this.model.listProjects().includes(savedProject) 
      ? savedProject 
      : "default_project";
  }



  async loadProject(name) {
    // Load project data
    const project = await this.model.loadProject(name);

    
    this.moduleManager = new ModuleManager(this.model, project.objectTypes, this.elements.mainContentContainer, this.elements.modalContainer);
    
    try {
      // Load libraries first
      this.moduleManager.libraryClasses = await this.moduleManager.loadModules(
        project.objectTypes.libraries
      );
      
      // Then load property modules
      const editorConfig = project.objectTypes.configs?.editor;
      if (editorConfig) {
        const editorModules = {};
        editorConfig.propertyModules.forEach((pm) => {
          if (project.objectTypes.propertyModules[pm]) {
            editorModules[pm] = project.objectTypes.propertyModules[pm];
          }
        });
        
        this.propertyModuleClasses = await this.moduleManager.loadModules(editorModules);
   
        this.scriptContext = await this.moduleManager.setupScriptEnvironment(this);
    
        this.propertyModuleInstances = this.moduleManager.instantiateCollection(this, project.objectTypes.propertyModules, this.propertyModuleClasses);      
        this.view.setupModuleEventListeners(project.objectTypes.propertyModules);
      }
      
      // Apply theme if specified
      if (editorConfig?.theme) {
        this.applyTheme(project.objectTypes.themes[editorConfig.theme]);
      }
    } catch (e) {
      console.error('Error loading modules:', e);
    }

    // Update UI
    this.view.renderObjectList();
    this.view.updateSidebarButtons();
    this.view.updateProjectSelectors();
    
    // Select first available object
    this.selectInitialObject();
  }

  applyTheme(themeConfig) {
    const styleTag = document.getElementById("theme_style") || document.createElement('style');
    styleTag.id = "theme_style";
    styleTag.innerHTML = themeConfig.css;
    document.head.appendChild(styleTag);
  }

  selectInitialObject() {
    const collections = this.model.getCollections();
    const currentType = this.model.state.selectedType;
    
    if (collections[currentType] && Object.keys(collections[currentType]).length > 0) {
      this.model.selectObject(Object.keys(collections[currentType])[0]);
    } else {
      this.model.state.selectedObject = null;
      this.view.renderEditor();
    }
  }

  finalizeSetup() {
    // Remove loading state
    requestAnimationFrame(() => {
      document.body.classList.remove('loading');
    });

    // Set up project event listeners
    this.setupProjectEventListeners();
  }

  setupProjectEventListeners() {
    // Project selector change
    this.elements.projectSelector.addEventListener('change', (e) => {
      if (e.target.value === "__create_new__") {
        this.showNewProjectModal();
      } else {
        this.loadProject(e.target.value);
      }
    });

    // Delete project button
    this.elements.deleteProjectBtn.addEventListener('click', () => {
      if (this.model.isDefaultProject(this.model.state.currentProject)) return;
      
      if (confirm(`Delete "${this.model.state.currentProject}" permanently?`)) {
        const result = this.model.deleteProject(this.model.state.currentProject);
        if (result.success) {
          this.loadProject("default_project");
        } else {
          alert(result.message);
        }
      }
    });
  }

  showNewProjectModal() {
      document.getElementById('new-project-modal').classList.add('show');
  }

  saveObject(data) {
    this.model.saveObject(data);
  }
  // Proxy methods to core systems
  saveProject() {
    const success = this.model.saveProject();
    if (success) {
      this.view.showSuccessMessage('Project saved successfully!');
    }
    return success;
  }

  // Additional coordination methods as needed...
}

// Initialize the application when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
  const editor = new EditorController();
  editor.init();
});