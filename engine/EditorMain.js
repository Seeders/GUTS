import { EditorCore } from './EditorCore.js';
import { EditorUI } from './EditorUI.js';
import { ModuleManager } from './ModuleManager.js';
import { DEFAULT_PROJECT_CONFIG } from '../config/default_app_config.js';

export class EditorMain {
  constructor() {
    // Initialize core systems
    this.core = new EditorCore();
    
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
    this.ui = new EditorUI(this);
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
    Object.keys(this.core.defaultProjects).forEach((key) => {
      if (!localStorage.getItem(key)) {
        localStorage.setItem(key, JSON.stringify(this.core.defaultProjects[key]));
      }
    });
  }

  getCollections() {
    return this.core.getCollections();
  }

  getCollectionDefs() {
    return this.core.getCollectionDefs();
  }
  getInitialProject() {
    const savedProject = localStorage.getItem("currentProject");
    return savedProject && this.core.listProjects().includes(savedProject) 
      ? savedProject 
      : "default_project";
  }

  async loadProject(name) {
    // Load project data
    const project = await this.core.loadProject(name);

    
    this.moduleManager = new ModuleManager(this.core, project.objectTypes, this.elements.mainContentContainer, this.elements.modalContainer);
    
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
        this.ui.setupModuleEventListeners(project.objectTypes.propertyModules);
      }
      
      // Apply theme if specified
      if (editorConfig?.theme) {
        this.applyTheme(project.objectTypes.themes[editorConfig.theme]);
      }
    } catch (e) {
      console.error('Error loading modules:', e);
    }

    // Update UI
    this.ui.renderObjectList();
    this.ui.updateSidebarButtons();
    this.ui.updateProjectSelectors();
    
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
    const collections = this.core.getCollections();
    const currentType = this.core.state.selectedType;
    
    if (collections[currentType] && Object.keys(collections[currentType]).length > 0) {
      this.core.selectObject(Object.keys(collections[currentType])[0]);
    } else {
      this.core.state.selectedObject = null;
      this.ui.renderEditor();
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
      if (this.core.isDefaultProject(this.core.state.currentProject)) return;
      
      if (confirm(`Delete "${this.core.state.currentProject}" permanently?`)) {
        const result = this.core.deleteProject(this.core.state.currentProject);
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

  // Proxy methods to core systems
  saveProject() {
    const success = this.core.saveProject();
    if (success) {
      this.ui.showSuccessMessage('Project saved successfully!');
    }
    return success;
  }

  // Additional coordination methods as needed...
}

// Initialize the application when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
  const editor = new EditorMain();
  editor.init();
});