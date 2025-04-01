import { DEFAULT_PROJECT_CONFIG } from "../config/default_app_config.js";
import { TOWER_DEFENSE_CONFIG } from "../config/game_td_config.js";

export class EditorCore {
  constructor() {
    // Configuration constants
    this.CONFIG = {
      GRID_SIZE: 40,
      DEFAULT_TOWER_SIZE: 30,
      DEFAULT_TOWER_COLOR: '#ffffff',
      DEFAULT_RENDER: { animations: { idle: [{ shapes: [] }] } },
      DEFAULT_TILEMAP: {},
      DEFAULT_SCRIPT: 'init(){\n\n}'
    };

    // Application state
    this.state = {
      project: {
        objectTypes: {},
        objectTypeDefinitions: []
      },
      currentProject: null,
      selectedType: 'configs',
      selectedObject: null,
      expandedCategories: {}
    };

    // Define default projects
    this.defaultProjects = {
      "default_project": DEFAULT_PROJECT_CONFIG,
      "td_game": TOWER_DEFENSE_CONFIG
    };
  }

  // Project management methods
  async loadProject(name) {
    const config = localStorage.getItem(name);
    
    if (!config) {
      // Fallback to default project if selected doesn't exist
      this.state.currentProject = "default_project";
      this.state.project = DEFAULT_PROJECT_CONFIG;
    } else {
      this.state.currentProject = name;
      this.state.project = JSON.parse(config);
    }

    try {
      localStorage.setItem("currentProject", this.state.currentProject);
    } catch (e) {
      console.warn('Error saving to localStorage:', e);
    }

    return this.state.project;
  }

  saveProject() {
    if (!this.state.currentProject) return;

    const configText = JSON.stringify(this.state.project);
    try {
      localStorage.setItem(this.state.currentProject, configText);
      if(localStorage.getItem("saveToFile") == 1) {
        fetch('/save-config', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: configText
            })
            .then(response => {
                if (!response.ok) throw new Error('Failed to save config');
                return response.text();
            })
            .then(message => {
            })
            .catch(error => {
                console.error('Error:', error);
            });
        }
    } catch (e) {
      console.error('Failed to save project:', e);
      return false;
    }
    return true;
  }

  isDefaultProject(name) {
    return Object.keys(this.defaultProjects).includes(name);
  }

/**
 * Creates a new project with validation and default metadata
 * @param {string} name - Project name/ID
 * @param {object} config - Project configuration (optional)
 * @returns {object} { success: boolean, message: string }
 */
createProject(name, config = null) {
    // Validate name
    if (!name || typeof name !== 'string') {
      return { success: false, message: 'Invalid project name' };
    }
  
    // Check if project exists
    if (localStorage.getItem(name)) {
      return { success: false, message: 'Project already exists' };
    }
  
    // Use provided config or default template
    const projectConfig = config || JSON.parse(JSON.stringify(DEFAULT_PROJECT_CONFIG));
  
    try {
      // Save project
      localStorage.setItem(name, JSON.stringify(projectConfig));
      
      // Update projects list
      const projects = JSON.parse(localStorage.getItem("projects") || []);
      if (!projects.includes(name)) {
        projects.push(name);
        localStorage.setItem('projects', JSON.stringify(projects));
      }
      
      // Set metadata
      localStorage.setItem(
        `${name}_metadata`,
        JSON.stringify({
          createdAt: new Date().toISOString(),
          lastModified: new Date().toISOString(),
          version: 1.0
        })
      );
  
      return { success: true, message: 'Project created' };
    } catch (error) {
      console.error('Project creation failed:', error);
      return { success: false, message: 'Storage error' };
    }
  }

  deleteProject(name) {
    if (this.isDefaultProject(name)) {
      return { success: false, message: 'Cannot delete default projects' };
    }
    
    if (!localStorage.getItem(name)) {
      return { success: false, message: 'Project not found' };
    }
    
    try {
      localStorage.removeItem(name);
      
      const projects = JSON.parse(localStorage.getItem("projects") || []).filter(p => p !== name);
      localStorage.setItem('projects', JSON.stringify(projects));
      
      return { success: true, message: 'Project deleted successfully' };
    } catch (error) {
      return { success: false, message: 'Failed to delete project' };
    }
  }

  listProjects() {
    const projects = JSON.parse(localStorage.getItem('projects') || '["default_project","td_game"]');
    return Array.isArray(projects) ? projects : [];
  }

  // Object type management
  getCollections() {
    return this.state.project.objectTypes;
  }

  getCollectionDefs() {
    return this.state.project.objectTypeDefinitions;
  }

  getSingularType(typeId) {
    const typeDef = this.getCollectionDefs().find(t => t.id === typeId);
    return typeDef ? typeDef.singular : typeId.slice(0, -1);
  }

  getPluralType(typeId) {
    const typeDef = this.getCollectionDefs().find(t => t.id === typeId);
    return typeDef ? typeDef.name : typeId;
  }

    
    // Get all collection definitions for a given category
  getCollectionDefsByCategory(category) {
      return this.getCollectionDefs().filter(typeDef => typeDef.category === category);
  }
  
  // Get all collections for a given category
  getCollectionsByCategory(category) {
      const defs = this.getCollectionDefsByCategory(category);
      return defs.reduce((collections, typeDef) => {
          const collectionKey = typeDef.id; // e.g., "configs", "entities"
          if (this.state.project.objectTypes[collectionKey]) {
              collections[collectionKey] = this.state.project.objectTypes[collectionKey];
          }
          return collections;
      }, {});
  }
  
  getCategoryByType(objectType) {
    const typeDef = this.getCollectionDefs().find(t => t.id === objectType);
    return typeDef ? typeDef.category : null;
  }

  // Object management
  selectObject(objId) {
    this.state.selectedObject = objId;
    return this.getCurrentObject();
  }

  getCurrentObject() {
    if (!this.state.selectedType || !this.state.selectedObject) return null;
    return this.getCollections()[this.state.selectedType][this.state.selectedObject];
  }

  createObject(typeId, objId, properties = {}) {
    if (!this.getCollections()[typeId]) {
      this.getCollections()[typeId] = {};
    }

    if (this.getCollections()[typeId][objId]) {
      return { success: false, message: 'Object already exists' };
    }

    this.getCollections()[typeId][objId] = {
      title: objId,
      ...properties
    };

    return { success: true, object: this.getCollections()[typeId][objId] };
  }

  updateObject(updates) {
    if (!this.state.selectedType || !this.state.selectedObject) {
      return { success: false, message: 'No object selected' };
    }

    const currentObj = this.getCurrentObject();
    this.getCollections()[this.state.selectedType][this.state.selectedObject] = {
      ...currentObj,
      ...updates
    };

    this.saveProject();

    return { success: true, object: this.getCurrentObject() };
  }

  deleteObject() {
    if (!this.state.selectedType || !this.state.selectedObject) {
      return { success: false, message: 'No object selected' };
    }

    delete this.getCollections()[this.state.selectedType][this.state.selectedObject];
    this.state.selectedObject = null;
    return { success: true };
  }

  duplicateObject(newId, newName) {
    if (!this.state.selectedType || !this.state.selectedObject) {
      return { success: false, message: 'No object to duplicate' };
    }

    const original = this.getCurrentObject();
    return this.createObject(this.state.selectedType, newId, {
      ...original,
      title: newName || newId
    });
  }

  // Type management
  createType(typeId, typeName, typeSingular, typeCategory) {
    if (this.getCollections()[typeId]) {
      return { success: false, message: 'Type already exists' };
    }

    this.getCollections()[typeId] = {};
    this.getCollectionDefs().push({
      id: typeId,
      name: typeName || typeId.charAt(0).toUpperCase() + typeId.slice(1),
      singular: typeSingular || typeId.slice(0, -1).charAt(0).toUpperCase() + typeId.slice(0, -1).slice(1),
      category: typeCategory || 'Uncategorized'
    });

    return { success: true };
  }

  deleteType(typeId) {
    if (!this.getCollections()[typeId]) {
      return { success: false, message: 'Type not found' };
    }

    // Prevent removing all types
    if (this.getCollectionDefs().length <= 1) {
      return { success: false, message: 'Cannot remove the last object type' };
    }

    delete this.getCollections()[typeId];
    this.state.project.objectTypeDefinitions = this.getCollectionDefs().filter(type => type.id !== typeId);
    
    // Reset selection if deleting currently selected type
    if (this.state.selectedType === typeId) {
      this.state.selectedType = this.getCollectionDefs()[0].id;
      this.state.selectedObject = null;
    }

    return { success: true };
  }

  getProjectMetadata(name) {
    const meta = localStorage.getItem(`${name}_metadata`);
    return meta ? JSON.parse(meta) : {
      createdAt: new Date().toISOString(),
      lastModified: new Date().toISOString()
    };
  }
  
  updateProjectMetadata(updates) {
    if (!this.state.currentProject) return;
    const currentMeta = this.getProjectMetadata(this.state.currentProject);
    localStorage.setItem(
      `${this.state.currentProject}_metadata`,
      JSON.stringify({
        ...currentMeta,
        ...updates,
        lastModified: new Date().toISOString()
      })
    );
  }
  validateProjectData(data) {
    try {
      const project = JSON.parse(data);
      return project.objectTypes && project.objectTypeDefinitions ?
        { valid: true } :
        { valid: false, error: "Invalid project structure" };
    } catch (e) {
      return { valid: false, error: "Invalid JSON" };
    }
  }

  
  saveToLocalStorage() {
    this.dispatchHook('saveToLocalStorage', this.getHookDetail({arguments}));
    this.saveConfigFile();
  }
}