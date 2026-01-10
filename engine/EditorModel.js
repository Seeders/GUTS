
/**
 * Model class for the editor application.
 * Manages data storage, retrieval, and manipulation.
 * Handles project configurations and object collections.
 */
class EditorModel {
    /**
     * Initializes the editor model with default configurations
     * and application state
     */
    constructor() {
        // Configuration constants for game objects and editor
        this.CONFIG = {
            GRID_SIZE: 40,
            DEFAULT_RENDER: { model: [], animations: { idle: [{ main: { shapes: [], position: {x: 0, y: 0, z: 0}, rotation: {x:0,y:0,z:0}, scale: {x:1, y:1, z:1}} }] } },
            DEFAULT_TILEMAP: {},
            DEFAULT_SCRIPT: 'init(){\n\n}'
        };

        // Application state tracks selections and project data
        this.state = {
            currentVersion: VERSION,
            project: {
                objectTypes: {},
                objectTypeDefinitions: []
            },
            currentProject: null,
            selectedType: 'configs',
            selectedObject: null,
            expandedCategories: {}
        };

        // Projects list - populated from server
        this.projects = [];
    }

    getCurrentVersion() {
      return this.state.currentVersion;
    }

    setSelectedType(type){
        this.state.selectedType = type;
    }
    getSelectedType(){
        return this.state.selectedType;
    }

    /**
     * Determines which project to load initially
     * Checks URL parameter first, then returns first available project
     * @returns {string} Project ID to load
     */
    getInitialProject() {
        // Check URL parameter first
        const urlParams = new URLSearchParams(window.location.search);
        const urlProject = urlParams.get('project');
        if (urlProject && this.projects.includes(urlProject)) {
            return urlProject;
        }

        // Return first available project, or null if none
        return this.projects.length > 0 ? this.projects[0] : null;
    }

    /**
     * Loads a project by name
     * Sets it as the current project in application state
     * FileSystemSyncService will populate the actual data
     * @param {string} name - Project identifier to load
     * @returns {Object} The loaded project data
     */
    async loadProject(name) {
        this.state.currentProject = name;

        // Initialize empty project structure - FileSystemSyncService will populate it
        this.state.project = {
            objectTypes: {},
            objectTypeDefinitions: []
        };
    }

    /**
     * Persists the current project state
     * Individual files are saved to filesystem via FileSystemSyncService
     * @returns {boolean} Success status
     */
    saveProject() {
        if (!this.state.currentProject) return;

        // Ensure all collection types have definitions
        for (const key in this.state.project.objectTypes) {
            if (!this.state.project.objectTypeDefinitions.find((e) => e.id == key)) {
                console.log(`did not find ${key}`);
                this.state.project.objectTypeDefinitions.push({
                    "id": key,
                    "name": key.charAt(0).toUpperCase() + key.slice(1, key.length),
                    "singular": key.slice(0, key.length - 1),
                    "objectTypeCategory": "uncategorized"
                });
            }
        }

        // Project data is saved to filesystem via FileSystemSyncService
        return true;
    }

    /**
     * Strip script text from collections to reduce config file size
     * Scripts are stored in compiled game.js, not needed in config
     * @param {Object} project - Project object with objectTypes and objectTypeDefinitions
     * @returns {Object} - Project with scripts stripped from collections
     */
    stripScriptsFromProject(project) {
        // Deep clone the project to avoid modifying the in-memory state
        const stripped = JSON.parse(JSON.stringify(project));

        // Find all collection types in the "scripts" category
        const scriptCollectionTypes = project.objectTypeDefinitions
            .filter(def => def.objectTypeCategory === 'scripts')
            .map(def => def.id);

        // Strip script property from all items in Scripts category collections
        scriptCollectionTypes.forEach(type => {
            if (stripped.objectTypes[type]) {
                Object.keys(stripped.objectTypes[type]).forEach(itemName => {
                    if (stripped.objectTypes[type][itemName].script) {
                        delete stripped.objectTypes[type][itemName].script;
                    }
                });
            }
        });

        return stripped;
    }

    /**
     * Sort objectTypes keys alphabetically for deterministic config file output
     * @param {Object} project - Project object with objectTypes
     * @returns {Object} - Project with sorted objectTypes
     */
    sortObjectTypes(project) {
        if (!project.objectTypes) return project;

        // Sort the top-level objectTypes keys
        const sortedObjectTypes = {};
        const sortedKeys = Object.keys(project.objectTypes).sort();

        for (const key of sortedKeys) {
            const collection = project.objectTypes[key];

            // Sort items within each collection
            if (collection && typeof collection === 'object') {
                const sortedCollection = {};
                const sortedItemKeys = Object.keys(collection).sort();

                for (const itemKey of sortedItemKeys) {
                    sortedCollection[itemKey] = collection[itemKey];
                }
                sortedObjectTypes[key] = sortedCollection;
            } else {
                sortedObjectTypes[key] = collection;
            }
        }

        project.objectTypes = sortedObjectTypes;
        return project;
    }

    /**
     * Check if webpack build should be used
     */
    shouldUseWebpack() {
        // Check if webpack is enabled in editor config
        const editorConfig = this.getCollections()?.configs?.editor;
        return editorConfig?.useWebpack !== false; // Default to true
    }

    /**
     * Trigger webpack build via server endpoint
     */
    async triggerWebpackBuild() {
        if (!this.state.currentProject) {
            return;
        }

        console.log('🔨 Triggering webpack build...');

        try {
            const response = await fetch('/webpack-build', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    projectName: this.state.currentProject,
                    production: false
                })
            });

            if (response.ok) {
                const result = await response.json();
                console.log(`✅ Webpack build completed in ${result.duration}s`);
            } else {
                const error = await response.json();
                console.error('❌ Webpack build failed:', error.error);
            }
        } catch (error) {
            console.error('❌ Error triggering webpack build:', error);
        }
    }

    /**
     * Checks if a project is one of the built-in default projects
     * Default projects cannot be deleted or modified in certain ways
     * @param {string} name - Project identifier to check
     * @returns {boolean} True if the project is a default project
     */
    isDefaultProject(name) {
        return Object.keys(this.defaultProjects || {}).includes(name);
    }

    /**
     * Creates a new project with validation
     * @param {string} name - Project name/ID
     * @param {object} config - Project configuration (optional)
     * @returns {object} { success: boolean, message: string }
     */
    createProject(name, config = null) {
        // Validate name
        if (!name || typeof name !== 'string') {
            return { success: false, message: 'Invalid project name' };
        }

        // Check if project exists in list
        if (this.projects.includes(name)) {
            return { success: false, message: 'Project already exists' };
        }

        // Add to projects list (server will create the actual project)
        this.projects.push(name);

        return { success: true, message: 'Project created' };
    }

    /**
     * Deletes a project from storage
     * Prevents deletion of default projects
     * @param {string} name - Project identifier to delete
     * @returns {object} Result with success status and message
     */
    deleteProject(name) {
        if (this.isDefaultProject(name)) {
            return { success: false, message: 'Cannot delete default projects' };
        }

        if (!this.projects.includes(name)) {
            return { success: false, message: 'Project not found' };
        }

        // Remove from projects list
        this.projects = this.projects.filter(p => p !== name);

        return { success: true, message: 'Project deleted successfully' };
    }

    /**
     * Lists all available projects
     * @returns {Array} List of project identifiers
     */
    listProjects() {
        return this.projects;
    }

    /**
     * Fetches available projects from the server
     * @returns {Promise<Array>} List of project identifiers
     */
    async syncProjectsFromFilesystem() {
        try {
            const response = await fetch('/list-projects');
            if (!response.ok) {
                console.warn('Could not fetch projects from filesystem');
                return this.projects;
            }

            const data = await response.json();
            this.projects = data.projects || [];

            console.log('Synced projects from filesystem:', this.projects);
            return this.projects;
        } catch (error) {
            console.warn('Error syncing projects from filesystem:', error);
            return this.projects;
        }
    }

    /**
     * Returns all object collections from the current project
     * Objects are organized by type (e.g., entities, configs)
     * @returns {Object} Collections of objects by type
     */
    getCollections() {
        return this.state.project.objectTypes;
    }

    /**
     * Returns type definitions for all collections
     * Contains metadata about each object type
     * @returns {Array} Array of type definition objects
     */
    getCollectionDefs() {
        return this.state.project.objectTypeDefinitions;
    }

    /**
     * Gets the singular form of an object type name
     * Used for labels and UI text
     * @param {string} typeId - Type identifier
     * @returns {string} Singular form of type name
     */
    getSingularType(typeId) {
        const typeDef = this.getCollectionDefs().find(t => t.id === typeId);
        return typeDef ? typeDef.singular : typeId.slice(0, -1);
    }

    /**
     * Gets the plural form of an object type name
     * Used for collection labels
     * @param {string} typeId - Type identifier
     * @returns {string} Plural form of type name
     */
    getPluralType(typeId) {
        const typeDef = this.getCollectionDefs().find(t => t.id === typeId);
        return typeDef ? typeDef.name : typeId;
    }

    /**
     * Get all collection definitions for a given category
     * @param {string} category - Category name to filter by
     * @returns {Array} Filtered collection definitions
     */
    getCollectionDefsByCategory(category) {
        return this.getCollectionDefs().filter(typeDef => typeDef.objectTypeCategory === category);
    }

    /**
     * Get all collections for a given category
     * @param {string} category - Category name to filter by
     * @returns {Object} Filtered collections organized by type
     */
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

    /**
     * Gets the category for a specific object type
     * @param {string} objectType - Type identifier
     * @returns {string|null} Category name or null if not found
     */
    getCategoryByType(objectType) {
        const typeDef = this.getCollectionDefs().find(t => t.id === objectType);
        return typeDef ? typeDef.objectTypeCategory : null;
    }


    findMatchingTypes(key) {
        const keyLower = key.toLowerCase();
        const collectionDefs = this.getCollectionDefs();
        const editorModules = Object.values(this.getCollections().editorModules);

        // Check for exact matches first, fall back to endsWith if no exact match
        const matchingTypePlural = collectionDefs.find(t =>
            keyLower === t.id.toLowerCase()) ||
            collectionDefs.find(t =>
                keyLower.endsWith(t.id.toLowerCase()));

        const matchingTypeSingular = collectionDefs.find(t =>
            keyLower === t.singular.replace(/ /g,'').toLowerCase()) ||
            collectionDefs.find(t =>
                keyLower.endsWith(t.singular.replace(/ /g,'').toLowerCase()));

        const matchingModuleType = editorModules.find((t) => {
            return (t.propertyName && keyLower === t.propertyName.toLowerCase()) ||
                (t.propertyNames && JSON.parse(t.propertyNames).some(name =>
                    keyLower === name.toLowerCase()));
        }) || editorModules.find((t) => {
            return (t.propertyName && keyLower.endsWith(t.propertyName.toLowerCase())) ||
                (t.propertyNames && JSON.parse(t.propertyNames).some(name =>
                    keyLower.endsWith(name.toLowerCase())));
        });

        return { matchingTypePlural, matchingTypeSingular, matchingModuleType };
    }

    /**
     * Searches for references to a specific object property across all collections
     * @param {string} objectType - Type of the object (e.g. 'configs')
     * @param {string} objectId - ID of the object (e.g. 'game')
     * @param {string} propertyName - Name of the property to search for (e.g. 'canvasWidth')
     * @returns {Array} Array of references found with their locations and context
     */
    findPropertyReferences(objectType, objectId, propertyName) {
      // Get all collections from the current project
      const collections = this.getCollections();
      const collectionDefs = this.getCollectionDefs();
      const references = [];

      // Find the singular and plural forms for the object type
      const typeDef = collectionDefs.find(def => def.id === objectType);
      const pluralType = typeDef ? typeDef.name : objectType;
      const singularType = typeDef ? typeDef.singular : objectType.slice(0, -1);

      // Recursive function to search an object for references
      const searchObject = (obj, path, parentObj) => {
          if (!obj || typeof obj !== 'object') return;

          // Check if this is the source property itself to avoid self-references
          if (path === `${objectType}.${objectId}` ||
              path === `${objectType}.${objectId}.${propertyName}`) {
              return;
          }

          // Check each property of the object
          for (const [key, value] of Object.entries(obj)) {
              const currentPath = path ? `${path}.${key}` : key;

              // Check if this is a string that contains our reference
              if (typeof value === 'string') {

                    if (value.includes(propertyName)) {
                        references.push({
                            path: currentPath,
                            value: value
                        });
                    }

              }
              // Continue searching recursively if it's an object
              else if (typeof value === 'object' && value !== null) {
                  searchObject(value, currentPath, obj);
              }
          }
      };

      // Search through all collections
      for (const [typeId, typeObjects] of Object.entries(collections)) {
          searchObject(typeObjects, typeId, collections);
      }

      return references;
    }

    /**
     * Returns the identifier of the current project
     * @returns {string} Current project identifier
     */
    getCurrentProject() {
        return this.state.currentProject;
    }
    /**
     * Returns current selection context including type and object
     * Used by modules and views to determine what's selected
     * @returns {Object} Selected type and object
     */
    getCurrentObjectContext() {
        const { selectedType, selectedObject } = this.state;
        return { selectedType, selectedObject };
    }

    /**
     * Selects an object by ID and makes it the current selection
     * @param {string} objId - Object identifier to select
     * @returns {Object} The selected object
     */
    selectObject(objId) {
        this.state.selectedObject = objId;
        return this.getCurrentObject();
    }

    /**
     * Returns the currently selected object data
     * @returns {Object|null} Current object or null if none selected
     */
    getCurrentObject() {
        if (!this.state.selectedType || !this.state.selectedObject) return null;
        return this.getCollections()[this.state.selectedType][this.state.selectedObject];
    }

    /**
     * Creates a new object with the given properties
     * @param {string} typeId - Type identifier for the object
     * @param {string} objId - Unique identifier for the object
     * @param {Object} properties - Initial properties for the object
     * @returns {Object} Result with success status and object data
     */
    createObject(typeId, objId, properties = {}) {
        // Create collection if it doesn't exist
        if (!this.getCollections()[typeId]) {
            this.getCollections()[typeId] = {};
        }

        // Check for duplicate object IDs
        if (this.getCollections()[typeId][objId]) {
            return { success: false, message: 'Object already exists' };
        }

        // Create object with title defaulting to ID
        this.getCollections()[typeId][objId] = {
            title: objId,
            ...properties
        };

        return { success: true, object: this.getCollections()[typeId][objId] };
    }

    /**
     * Updates properties of the currently selected object
     * @param {Object} updates - Properties to update
     * @returns {Object} Result with success status and updated object
     */
    updateObject(updates) {
        if (!this.state.selectedType || !this.state.selectedObject) {
            return { success: false, message: 'No object selected' };
        }
        // Merge current object with updates
        const currentObj = this.getCurrentObject();
        this.getCollections()[this.state.selectedType][this.state.selectedObject] = {
            ...currentObj,
            ...updates
        };

        this.saveProject();

        return { success: true, object: this.getCurrentObject() };
    }

    /**
     * Completely replaces the current object with new data
     * @param {Object} complete - Complete object data
     * @returns {Object} Result with success status and saved object
     */
    saveObject(complete) {
        if (!this.state.selectedType || !this.state.selectedObject) {
            return { success: false, message: 'No object selected' };
        }

        // Replace entire object
        this.getCollections()[this.state.selectedType][this.state.selectedObject] = complete;

        this.saveProject();
        return { success: true, object: this.getCurrentObject() };
    }

    /**
     * Deletes the currently selected object
     * @returns {Object} Result with success status
     */
    deleteObject() {
        if (!this.state.selectedType || !this.state.selectedObject) {
            return { success: false, message: 'No object selected' };
        }

        // Remove object from collection
        delete this.getCollections()[this.state.selectedType][this.state.selectedObject];
        this.selectObject(null);
        return { success: true };
    }

    /**
     * Duplicates the current object with a new ID and optional name
     * @param {string} newId - Unique ID for the duplicate
     * @param {string} newName - Display name for the duplicate (optional)
     * @returns {Object} Result with success status and duplicated object
     */
    duplicateObject(newId, newName) {
        if (!this.state.selectedType || !this.state.selectedObject) {
            return { success: false, message: 'No object to duplicate' };
        }

        // Copy original object properties
        const original = this.getCurrentObject();
        return this.createObject(this.state.selectedType, newId, {
            ...original,
            title: newName || newId
        });
    }

    /**
     * Creates a new object type with associated metadata
     * @param {string} typeId - Unique identifier for the type
     * @param {string} typeName - Display name for the type (plural)
     * @param {string} typeSingular - Singular form of the type name
     * @param {string} typeCategory - Category for grouping types
     * @returns {Object} Result with success status
     */
    createType(typeId, typeName, typeSingular, typeCategory) {
        if (this.getCollections()[typeId]) {
            return { success: false, message: 'Type already exists' };
        }

        // Create empty collection for the type
        this.getCollections()[typeId] = {};

        // Create the type definition
        const typeDef = {
            id: typeId,
            name: typeName || typeId.charAt(0).toUpperCase() + typeId.slice(1),
            singular: typeSingular || typeId.slice(0, -1).charAt(0).toUpperCase() + typeId.slice(0, -1).slice(1),
            objectTypeCategory: typeCategory || 'uncategorized',
            fileName: typeId
        };

        // Add type definition to the definitions array (for in-memory use)
        this.getCollectionDefs().push(typeDef);

        // Also add to objectTypeDefinitions collection (triggers file save via FileSystemSyncService)
        if (!this.getCollections().objectTypeDefinitions) {
            this.getCollections().objectTypeDefinitions = {};
        }
        this.getCollections().objectTypeDefinitions[typeId] = typeDef;

        return { success: true };
    }

    /**
     * Deletes an object type and all its objects
     * @param {string} typeId - Type identifier to delete
     * @returns {Object} Result with success status
     */
    deleteType(typeId) {
        if (!this.getCollections()[typeId]) {
            return { success: false, message: 'Type not found' };
        }

        // Prevent removing all types
        if (this.getCollectionDefs().length <= 1) {
            return { success: false, message: 'Cannot remove the last object type' };
        }

        // Remove collection and definition
        delete this.getCollections()[typeId];
        this.state.project.objectTypeDefinitions = this.getCollectionDefs().filter(type => type.id !== typeId);

        // Also remove from objectTypeDefinitions collection (triggers file delete via FileSystemSyncService)
        if (this.getCollections().objectTypeDefinitions) {
            delete this.getCollections().objectTypeDefinitions[typeId];
        }

        // Reset selection if deleting currently selected type
        if (this.state.selectedType === typeId) {
            this.setSelectedType(this.getCollectionDefs()[0].id);
            this.selectObject(null);
        }

        return { success: true };
    }

    /**
     * Gets metadata for a project
     * @param {string} name - Project identifier
     * @returns {Object} Project metadata
     */
    getProjectMetadata(name) {
        // Metadata is now managed by the server/filesystem
        return {
            createdAt: new Date().toISOString(),
            lastModified: new Date().toISOString()
        };
    }

    /**
     * Updates metadata for the current project
     * @param {Object} updates - Metadata properties to update
     */
    updateProjectMetadata(updates) {
        // Metadata is now managed by the server/filesystem
        // This is a no-op but kept for API compatibility
    }

    /**
     * Validates project data structure and format
     * @param {string} data - JSON string of project data
     * @returns {Object} Validation result with success status
     */
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

}
