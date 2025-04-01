import { ModuleLoader } from "./ModuleLoader.js";
import { DEFAULT_PROJECT_CONFIG } from "../config/default_app_config.js";
import { TOWER_DEFENSE_CONFIG } from "../config/game_td_config.js";

class Editor {
    constructor() {
        
        // Configuration constants
        this.CONFIG = {
            GRID_SIZE: 40,
            DEFAULT_TOWER_SIZE: 30,
            DEFAULT_TOWER_COLOR: '#ffffff',
            DEFAULT_RENDER: {animations:{idle:[{shapes:[]}]}},
            DEFAULT_TILEMAP: {},
            DEFAULT_SCRIPT: 'init(){\n\n}'
        };
        this.engineClasses = {};
        // Application state
        this.state = {
            project: {},
            selectedType: 'configs',
            selectedObject: null,
            isDragging: false,
            objectPosition: { x: 300, y: 120 }
        };

        // Cache DOM elements
        this.elements = {
            objectList: document.getElementById('object-list'),
            editor: document.getElementById('editor'),
            handle: document.getElementById('toggleEditorButton'),
            importTextarea: document.getElementById('import-textarea'),
            exportTextarea: document.getElementById('export-textarea'),
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
            sidebar: document.querySelector('#container .sidebar')
        };
        this.registeredModules = {};
        this.modules = {};
        this.libraries = {};
        this.scriptCache = new Map(); // Cache compiled scripts
        // Initialize the application
        this.dispatchHook('constructor', this.getHookDetail({arguments}));
    }

    getHookDetail(params, result) {
        return { selectedType: this.state.selectedType, selectedObject: this.state.selectedObject, params: params.arguments, result: result };
    }
    dispatchHook(hookName, detail = {}) {
        requestAnimationFrame(() => {
            const customEvent = new CustomEvent(hookName, {
                detail: { ...detail, timestamp: Date.now() }
            });
            document.body.dispatchEvent(customEvent);
        });
    }
    getScript(typeName) {
        this.dispatchHook('getScript', this.getHookDetail({arguments}));
        return this.scriptContext.getComponent(typeName);
    }

    compileScript(scriptText, typeName) {
        this.dispatchHook('compileScript', this.getHookDetail({arguments}));
        if (this.scriptCache.has(typeName)) {
            return this.scriptCache.get(typeName);
        }

        try {
            const defaultConstructor = `
                constructor(game, parent, params) {
                    super(game, parent, params);
                }
            `;

            const constructorMatch = scriptText.match(/constructor\s*\([^)]*\)\s*{[^}]*}/);
            let classBody = constructorMatch ? scriptText : `${defaultConstructor}\n${scriptText}`;

            // Inject scriptContext into the Function scope
            const scriptFunction = new Function(
                'engine',
                `
                    return class ${typeName} extends engine.Component {
                        ${classBody}
                    }
                `
            );

            const ScriptClass = scriptFunction(this.scriptContext);
            this.scriptCache.set(typeName, ScriptClass);
            return ScriptClass;
        } catch (error) {
            console.error(`Error compiling script for ${typeName}:`, error);
            return this.libraryClasses.Component; // Fallback to base Component
        }
    }

    setupScriptEnvironment() {
        this.dispatchHook('setupScriptEnvironment', this.getHookDetail({arguments}));
        // Safe execution context with all imported modules
        this.scriptContext = {
            game: this,
            getFunction: (typeName) => this.scriptCache.get(typeName) || this.compileScript(this.getCollections().functions[typeName].script, typeName),
            // Add a way to access other compiled scripts
            getComponent: (typeName) => this.scriptCache.get(typeName) || this.compileScript(this.getCollections().components[typeName].script, typeName),
            getRenderer: (typeName) => this.scriptCache.get(typeName) || this.compileScript(this.getCollections().renderers[typeName].script, typeName),
            Math: Math,
            console: {
                log: (...args) => console.log('[Script]', ...args),
                error: (...args) => console.error('[Script]', ...args)
            }
        };
    }


    async init() {
        this.dispatchHook('init', this.getHookDetail({arguments}));
        
        // Define default projects
        this.defaultProjects = {
          "default_project": DEFAULT_PROJECT_CONFIG,
          "td_game": TOWER_DEFENSE_CONFIG,
        };
      
        // Initialize default projects if they don't exist
        Object.keys(this.defaultProjects).forEach((key) => {
          if (!localStorage.getItem(key)) {
            localStorage.setItem(key, JSON.stringify(this.defaultProjects[key]));
          }
        });
      
        // Initialize project selector
        this.initProjectSelector();
        this.setupProjectManagement();
      
        // Load saved project or default
        const savedProject = localStorage.getItem("currentProject");
        const initialProject = savedProject && this.listProjects().includes(savedProject) 
          ? savedProject 
          : "default_project";
        
        await this.loadProject(initialProject);
      
        requestAnimationFrame(() => {
          document.body.classList.remove('loading');
        });
    }
    
    saveConfigFile() {
        this.dispatchHook('saveConfigFile', this.getHookDetail({arguments}));
        const configText = JSON.stringify(this.state.project);
        try {
            localStorage.setItem(this.state.currentProject, configText);
        } catch(e) {

        }
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
    }

    isDefaultProject(name) {
        return Object.keys(this.defaultProjects).includes(name);
    }

    addProject(name, config) {
        if (!name || typeof name !== 'string') {
            return { success: false, message: 'Invalid project name' };
        }
        
        if (this.isDefaultProject(name)) {
            return { success: false, message: 'Cannot override default projects' };
        }
        
        if (localStorage.getItem(name)) {
            return { success: false, message: 'Project already exists' };
        }
        
        try {
            localStorage.setItem(name, JSON.stringify(config));
            
            const projects = JSON.parse(localStorage.getItem("projects") || []);
            if (!projects.includes(name)) {
                projects.push(name);
                localStorage.setItem('projects', JSON.stringify(projects));
            }
            
            return { success: true, message: 'Project added successfully' };
        } catch (error) {
            return { success: false, message: 'Failed to add project' };
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
    initProjectSelector() {
        const projectSelector = document.getElementById("project-selector");
        const deleteBtn = document.getElementById("delete-project-btn");
        
        // Clear existing options except the "create new" option
        while (projectSelector.options.length > 1) {
          projectSelector.remove(1);
        }
        
        // Add all projects to the selector
        this.listProjects().forEach(project => {
          const option = document.createElement('option');
          option.value = project;
          option.textContent = project;
          projectSelector.appendChild(option);
        });
        // Set current project if available
        if (this.state.currentProject) {
          projectSelector.value = this.state.currentProject;
        }
        
        // Update delete button state
        deleteBtn.disabled = this.isDefaultProject(this.state.currentProject);
    }
      
    setupProjectManagement() {
        const projectSelector = document.getElementById("project-selector");
        const deleteBtn = document.getElementById("delete-project-btn");
        const newProjectModal = document.getElementById("new-project-modal");
        const createBtn = document.getElementById("create-project-btn");
        const cancelBtn = document.getElementById("cancel-project-btn");
        
        // Project selector change handler
        projectSelector.addEventListener('change', (e) => {
          if (e.target.value === "__create_new__") {
            // Show create project modal
            document.getElementById("new-project-name").value = "";
            newProjectModal.classList.add('show');
            // Reset selector to current project
            e.target.value = this.state.currentProject || "";
          } else {
            this.loadProject(e.target.value);
          }
        });
        
        // Delete button handler
        deleteBtn.addEventListener('click', () => {
          if (this.isDefaultProject(this.state.currentProject)) return;
          
          if (confirm(`Are you sure you want to delete "${this.state.currentProject}"? This cannot be undone.`)) {
            const result = this.deleteProject(this.state.currentProject);
            if (result.success) {
              // Switch to default project after deletion
              this.loadProject("default_project");
            } else {
              alert(result.message);
            }
          }
        });
        
        // Create project handler
        createBtn.addEventListener('click', () => {
          const name = document.getElementById("new-project-name").value.trim();
          if (!name) {
            alert("Please enter a project name");
            return;
          }
          
          const result = this.addProject(name, DEFAULT_PROJECT_CONFIG);
          if (result.success) {
            newProjectModal.classList.remove('show');
            this.loadProject(name);
          } else {
            alert(result.message);
          }
        });
        
        // Cancel button handler
        cancelBtn.addEventListener('click', () => {
          newProjectModal.classList.remove('show');
        });
    }
      
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
        } catch(e) {
            console.warn('error saving to localStorage, you probably need to export/import instead because your project is too big.', e);
        }
        this.initProjectSelector(); // Update UI
        await this.configLoaded();
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
          
          const projects = this.listProjects().filter(p => p !== name);
          localStorage.setItem('projects', JSON.stringify(projects));
          
          return { success: true, message: 'Project deleted successfully' };
        } catch (error) {
          return { success: false, message: 'Failed to delete project' };
        }
    }

    getCollections() {
        return this.state.project.objectTypes;
    }

    getCollectionDefs() {
        return this.state.project.objectTypeDefinitions;
    }
    getCollectionDefs() {
        return this.state.project.objectTypeDefinitions;
    }
    
    // Helper methods
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
        return typeDef ? typeDef.category : null; // Return null if not found
    }
    // Rendering methods
    renderTypeSelector() {
        this.dispatchHook('renderTypeSelector', this.getHookDetail({arguments}));
        let html = ``;  
        let currentCollectionDef = this.getCollectionDefs().find( type => type.id == this.state.selectedType && this.state.selectedObject != null ) || { };

        // Group object types by category
        const categories = {};
        this.getCollectionDefs().forEach(type => {
            const category = type.category || 'Uncategorized';
            if (!categories[category]) {
                categories[category] = [];
            }
            categories[category].push(type);
        });
    
        // Initialize expandedCategories if not already set
        if (!this.state.expandedCategories) {
            this.state.expandedCategories = {};
            for (const category in categories) {
                this.state.expandedCategories[category] = category == currentCollectionDef.category ? true : false; // All closed by default
            }
        }
    
        // Render categories and their types
        html += `<div class="type-selector">`;
        for (const [category, types] of Object.entries(categories)) {
            const isExpanded = this.state.expandedCategories[category] || false;
            html += `
                <div class="category ${(isExpanded || category == currentCollectionDef.category) ? 'highlight' : ''}">
                    <div class="category-header">${category}</div>
                    <div class="category-types" style="display: ${isExpanded ? 'block' : 'none'};">`;
            types.forEach(type => {
                const isSelected = this.state.selectedType === type.id;
                html += `
                    <div class="object-type-item ${isSelected ? 'selected' : ''}" data-type="${type.id}">
                        ${type.name}
                    </div>`;
    
                // If this is the selected type, render its objects underneath
                if (isSelected) {
                    html += `<div class="object-list">`;
                    Object.keys(this.getCollections()[type.id] || {}).forEach(objId => {
                        html += `
                            <div class="object-item ${this.state.selectedObject === objId ? 'selected' : ''}" data-object="${objId}">
                                ${this.getCollections()[type.id][objId].title || objId}
                            </div>`;
                    });
                    html += `</div>`;
                }
            });
            html += `</div></div>`;
        }
        html += `</div>`;
    
        // Add type action buttons
        html += `
            <div class="type-actions">
                <button id="add-type-btn" class="small-btn">Add Type</button>
                ${this.getCollectionDefs().length > 1 && !currentCollectionDef.isCore ? `<button id="remove-type-btn" class="small-btn danger">Remove Type</button>` : ''}
            </div>`;
    
        return html;
    }
    renderObjectList() {
        this.dispatchHook('renderObjectList', this.getHookDetail({arguments}));
        // Render the type selector with integrated object list
        this.elements.objectList.innerHTML = this.renderTypeSelector();
        // Add event listeners for type selection
        document.querySelectorAll('.type-selector .object-type-item').forEach(item => {
            item.addEventListener('click', () => {
                this.state.selectedType = item.dataset.type;
                this.state.selectedObject = null; // Reset selected object when changing type
                this.renderObjectList();
                this.renderEditor();
                this.renderPreview();
                this.updateSidebarButtons();
    
                // Auto-select the first object of the new type, if any
                const objects = this.getCollections()[this.state.selectedType];
                if (objects && Object.keys(objects).length > 0) {
                    this.selectObject(Object.keys(objects)[0]);
                }
            });
        });
    
        // Add event listeners for object selection
        document.querySelectorAll('.object-list .object-item').forEach(item => {
            item.addEventListener('click', () => {
                this.selectObject(item.dataset.object);
            });
        });
    
        // Add event listeners for category collapse/expand
        document.querySelectorAll('.category-header').forEach(header => {
            header.addEventListener('click', () => {
                const category = header.textContent.trim(); // Use category name as key
                const isOpenedAlready = this.state.expandedCategories[category];
     
                // Collapse all categories except the clicked one
                for (const cat in this.state.expandedCategories) {
                    this.state.expandedCategories[cat] = false;
                }
                if(!isOpenedAlready) {
                    this.selectObject(null);
                }
                this.state.expandedCategories[category] = isOpenedAlready ? false : true;
                this.renderObjectList(); // Re-render to reflect new state
            });
        });
    
        // Add event listeners for type actions
        document.getElementById('add-type-btn')?.addEventListener('click', () => this.showAddTypeModal());
        document.getElementById('remove-type-btn')?.addEventListener('click', () => this.showRemoveTypeModal());
    }
    selectObject(objId) {
        this.dispatchHook('selectObject', this.getHookDetail({arguments}));
        this.state.selectedObject = objId;
        this.renderObjectList();
        this.renderEditor();
        this.updateMainContent();
        this.renderPreview();
    }

    renderEditor() {
        this.dispatchHook('renderEditor', this.getHookDetail({arguments}));
        const singularType = this.getSingularType(this.state.selectedType);
        
        if (!this.state.selectedObject) {
            this.elements.editor.innerHTML = `
                <div class="instructions">
                    Select a ${singularType} from the sidebar or create a new one to start editing.
                </div>
            `;
            return;
        }
        
        this.elements.editor.innerHTML = `
            <h2>Editing: ${this.state.selectedObject} (${singularType})</h2>
            
            <div class="tab-content active" id="advanced-tab">  
                <h3>Properties</h3>
                <div class="property-list" id="custom-properties">
                    <!-- Custom properties will be rendered here -->
                </div>
            </div>            
            <div class="actions">
                <div>                    
                    <button id="add-property-btn">Add Custom Property</button>
                    <button id="add-renderer-btn">Add Render</button>
                    <button id="add-tileMap-btn">Add TileMap</button>
                    <button id="add-script-btn">Add Script</button>
                </div>
            </div>
            <div class="actions">
                <div>
                    <button class="primary" id="save-object-btn">Save ${singularType}</button>
                    <button id="duplicate-object-btn">Duplicate ${singularType}</button>
                    <button id="revert-changes-btn">Revert Changes</button>                    
                    <button class="danger" id="delete-object-btn">Delete ${singularType}</button>
                </div>
            </div>
        `;
        
        // Add event listener
       
        document.getElementById('duplicate-object-btn').addEventListener('click', () => {
            this.elements.duplicateObjectIdInput.value = '';
            this.elements.duplicateObjectNameInput.value = '';
            this.updateDuplicateObjectModal();
            this.elements.duplicateObjectModal.classList.add('show');
        });
        // Setup property editor
        const customPropertiesContainer = document.getElementById('custom-properties');
        this.renderCustomProperties(customPropertiesContainer, this.getCollections()[this.state.selectedType][this.state.selectedObject]);
        
        // Add event listeners for editor controls
        document.getElementById('add-property-btn').addEventListener('click', () => {
            this.addCustomProperty(customPropertiesContainer, '', '');
        });
        document.getElementById('add-renderer-btn').addEventListener('click', () => {
            this.addCustomProperty(customPropertiesContainer, 'renderer', JSON.stringify(this.CONFIG.DEFAULT_RENDER));
        });
        document.getElementById('add-tileMap-btn').addEventListener('click', () => {
            this.addCustomProperty(customPropertiesContainer, 'tileMap', this.CONFIG.DEFAULT_TILEMAP);
        });
        document.getElementById('add-script-btn').addEventListener('click', () => {
            this.addCustomProperty(customPropertiesContainer, 'script', this.CONFIG.DEFAULT_SCRIPT);
        });
        
        document.getElementById('save-object-btn').addEventListener('click', () => this.saveObject());
        document.getElementById('revert-changes-btn').addEventListener('click', () => {
            this.selectObject(this.state.selectedObject);
        });
        document.getElementById('delete-object-btn').addEventListener('click', () => this.deleteObject());

    }

    renderCustomProperties(container, object) {
        this.dispatchHook('renderCustomProperties', this.getHookDetail({arguments}));
        container.innerHTML = '';

        Object.entries(object).forEach(([key, value]) => {
            this.addCustomProperty(container, key, value);
        });
        this.dispatchHook('renderCustomProperties', this.getHookDetail({arguments}));
    }

    addCustomProperty(container, key, value) {
        this.dispatchHook('addCustomProperty', this.getHookDetail({arguments}));
        const propertyItem = document.createElement('div');
        propertyItem.className = 'property-item';
        
        const keyInput = document.createElement('input');
        keyInput.type = 'text';
        keyInput.placeholder = 'Property Name';
        keyInput.value = key;
        keyInput.className = 'property-key';
        
        // Check if the key matches a type name (plural or singular)
        const matchingTypePlural = this.getCollectionDefs().find(t => t.id.toLowerCase() === key.toLowerCase());
        const matchingTypeSingular = this.getCollectionDefs().find(t => t.singular.replace(/ /g,'').toLowerCase() === key.toLowerCase());
        
        const matchingModuleType = Object.values(this.getCollections().propertyModules).find((t) => {
           return t.propertyName && t.propertyName.toLowerCase() === key.toLowerCase()
        });
        propertyItem.appendChild(keyInput);
        // Regular property input (not a reference)
        let valueInput = document.createElement('input');
        let type = 'text';
        if (key === 'color') {
            type = 'color';
            valueInput.type = type;
            valueInput.value = value;
        } else if (matchingModuleType) {
            let moduleInputElementType = matchingModuleType.inputElement || type;
            let moduleDataType = matchingModuleType.inputDataType;
            valueInput = document.createElement(moduleInputElementType);
            if(moduleDataType == 'json') {
                value = JSON.stringify(value);
            } 
            if(moduleInputElementType == 'textarea') {
                valueInput.textContent = value;
            } else {
                valueInput.value = value;
            }
            valueInput.setAttribute('id', `${matchingModuleType.propertyName}-value`);
        }  else {
            valueInput.type = type;
            valueInput.value = value;
        }
        valueInput.placeholder = 'Value';
        valueInput.className = 'property-value';
        
        propertyItem.appendChild(valueInput);
        if( matchingTypeSingular ) {
            // Create a container for the reference selector and value display
            const refContainer = document.createElement('div');
            refContainer.className = 'ref-container';

            // Create a select element for choosing objects
            const selectElement = document.createElement('select');
            selectElement.className = 'ref-select property-value';
            valueInput.remove();

            // Determine which type we're referencing
            const typeId = matchingTypePlural ? matchingTypePlural.id : matchingTypeSingular.id;

            // Add options based on available objects of that type
            selectElement.innerHTML = `<option value="">-- Select ${matchingTypePlural ? matchingTypePlural.singular : matchingTypeSingular.singular} --</option>`;

            Object.keys(this.getCollections()[typeId] || {}).forEach(objId => {
                const option = document.createElement('option');
                option.value = objId;
                option.textContent = this.getCollections()[typeId][objId].title || objId;
                selectElement.appendChild(option);
            });
            selectElement.value = value;
            // Add the select to the container
            refContainer.appendChild(selectElement);            

            propertyItem.appendChild(refContainer);
        } else if (matchingTypePlural) {
            // Create a container for the reference selector and value display
            const refContainer = document.createElement('div');
            refContainer.className = 'ref-container';
            
            // Create a select element for choosing objects
            const selectElement = document.createElement('select');
            selectElement.className = 'ref-select';
            
            // Determine which type we're referencing
            const typeId = matchingTypePlural ? matchingTypePlural.id : matchingTypeSingular.id;
            
            // Add options based on available objects of that type
            selectElement.innerHTML = `<option value="">-- Select ${matchingTypePlural ? matchingTypePlural.singular : matchingTypeSingular.singular} --</option>`;
            
            Object.keys(this.getCollections()[typeId] || {}).forEach(objId => {
                const option = document.createElement('option');
                option.value = objId;
                option.textContent = this.getCollections()[typeId][objId].title || objId;
                selectElement.appendChild(option);
            });
            
            // Add the select to the container
            refContainer.appendChild(selectElement);            
           
            // Convert value to array if it's a plural reference
            const valueArray = matchingTypePlural ? (Array.isArray(value) ? value : (value ? [value] : [])) : value;
            
            valueInput.value = matchingTypePlural ? JSON.stringify(valueArray) : valueArray || '';
            
            // Add button for inserting selected reference
            const insertBtn = document.createElement('button');
            insertBtn.textContent = 'Insert';
            insertBtn.className = 'small-btn';
            insertBtn.addEventListener('click', () => {
                const selectedValue = selectElement.value;
                if (!selectedValue) return;
                
                if (matchingTypePlural) {
                    // For plural (array) references
                    let currentValues = JSON.parse(valueInput.value || '[]');  
                    currentValues.push(selectedValue);
                    valueInput.value = JSON.stringify(currentValues);                
                } else {
                    // For singular references
                    valueInput.value = selectedValue;
                }
            });                  
            
            // Add elements to the container
            refContainer.appendChild(insertBtn);
            propertyItem.appendChild(refContainer);
        } 
        
        const removeBtn = document.createElement('button');
        removeBtn.textContent = 'Remove';
        removeBtn.className = 'danger';
        removeBtn.addEventListener('click', () => {
            container.removeChild(propertyItem);
        });
        
        propertyItem.appendChild(removeBtn);
        container.appendChild(propertyItem);
    }

    // Object management methods
    saveObject() {
        this.dispatchHook('saveObject', this.getHookDetail({arguments}));
        if (!this.state.selectedObject) return;
        
        const object = {}; 
        
        // Collect custom properties
        document.querySelectorAll('.property-item').forEach(item => {
            const keyInput = item.querySelector('.property-key');
            const valueInput = item.querySelector('.property-value');
            
            if (keyInput.value && valueInput) {
                let value = valueInput.value;
                const matchingTypePlural = this.getCollectionDefs().find(
                    t => t.id.toLowerCase() === keyInput.value.toLowerCase()
                );
                // Try to parse value types for non-reference fields
                if (!isNaN(parseFloat(value)) && isFinite(value)) {
                    value = parseFloat(value);
                } else if (value.toLowerCase() === 'true') {
                    value = true;
                } else if (value.toLowerCase() === 'false') {
                    value = false;
                }
                
                if (keyInput.value === "render") {
                    value = JSON.parse(value);
                } else if(keyInput.value === "tileMap") {
                    value = JSON.parse(value);
                } else if(matchingTypePlural) {
                    value = JSON.parse(value || '[]');
                }

                object[keyInput.value] = value;
            }
        });
        
        // Update the config
        this.getCollections()[this.state.selectedType][this.state.selectedObject] = object;
        
        // Update UI
        this.renderObjectList();
        this.renderPreview();
        this.selectObject(this.state.selectedObject);
        this.saveToLocalStorage();
        
        // Show success message
        const actions = document.querySelector('.actions');
        const successMsg = document.createElement('span');
        successMsg.textContent = 'Changes saved!';
        successMsg.className = 'success-message';
        actions.appendChild(successMsg);
        
        setTimeout(() => {
            if (actions.contains(successMsg)) {
                actions.removeChild(successMsg);
            }
        }, 2000);
    }

    deleteObject() {
        this.dispatchHook('deleteObject', this.getHookDetail({arguments}));
        if (!this.state.selectedObject) return;
        
        const singularType = this.getSingularType(this.state.selectedType);
        
        if (confirm(`Are you sure you want to delete "${this.state.selectedObject}" ${singularType}?`)) {
            delete this.getCollections()[this.state.selectedType][this.state.selectedObject];
            this.state.selectedObject = null;
            this.renderObjectList();
            this.renderEditor();
            this.renderPreview();
        }
    }

    // Preview methods
    renderPreview() {
        this.dispatchHook('renderPreview', this.getHookDetail({arguments}));
        if (this.state.selectedObject && this.getCollections()[this.state.selectedType][this.state.selectedObject]) {
            const object = this.getCollections()[this.state.selectedType][this.state.selectedObject];
            this.drawObject(object);               
        }
    }

    // Import/Export methods
    generateConfigCode() {
        this.dispatchHook('generateConfigCode', this.getHookDetail({arguments}));
        let code = `{\n`;
        
        Object.entries(this.getCollections()[this.state.selectedType]).forEach(([objId, config]) => {
            code += `    ${objId}: { `;
            
            const props = Object.entries(config)
                .filter(([_, value]) => value !== undefined && value !== null)
                .map(([key, value]) => {
                    if (typeof value === 'string') {
                        return `${key}: '${value}'`;
                    } if(typeof value === 'object' ) {
                        return `${key}: ${JSON.stringify(value)}`;
                    } else {
                        return `${key}: ${value}`;
                    }
                })
                .join(', ');
            
            code += `${props} },\n`;
        });
        
        code += '}';
        
        return code;
    }

    parseConfigCode(code) {
        this.dispatchHook('parseConfigCode', this.getHookDetail({arguments}));
        try {
            // Extract the config object with variable pattern matching
            const regex = /\{([^;]*(?:\{[^;]*\}[^;]*)*)\}/s;
            const match = code.match(regex);
            
            if (!match) {
                throw new Error('Could not find configuration in the code');
            }
                            
            // Create a valid JavaScript expression
            const objText = `(${match[0]})`;
            
            // Parse the JavaScript object
            const config = eval(objText);
            
            // Determine the actual object type
            let objectType = this.state.selectedType;
            
            return { type: objectType, config };
        } catch (error) {
            console.error('Error parsing configuration:', error);
            alert('Failed to parse configuration. Please check format and try again.');
            return null;
        }
    }

    // Object creation methods
    createNewObject() {
        this.dispatchHook('createNewObject', this.getHookDetail({arguments}));
        const id = this.elements.newObjectIdInput.value.trim();
        const name = this.elements.newObjectNameInput.value.trim();
        
        if (!id) {
            alert(`Please enter an ID`);
            return;
        }
        
        if (this.getCollections()[this.state.selectedType][id]) {
            alert(`Object with ID "${id}" already exists`);
            return;
        }
        
        // Create default properties based on type
        let defaultProps = {
            title: name || id,
            render: JSON.parse(JSON.stringify(this.CONFIG.DEFAULT_RENDER))
        };
        
        this.getCollections()[this.state.selectedType][id] = defaultProps;
        
        this.elements.newObjectModal.classList.remove('show');
        this.renderObjectList();
        this.selectObject(id);
    }

    duplicateObject() {      
        this.dispatchHook('duplicateObject', this.getHookDetail({arguments}));
        const currentSelectedObjectType = this.getCollections()[this.state.selectedType];
        if( currentSelectedObjectType ) {
            // Create default properties based on type
            let defaultProps = {...currentSelectedObjectType[this.state.selectedObject]};
                
            const id = this.elements.duplicateObjectIdInput.value.trim();
            const title = this.elements.duplicateObjectNameInput.value.trim();
            defaultProps.title = title;
            this.getCollections()[this.state.selectedType][id] = defaultProps;
            
            this.elements.duplicateObjectModal.classList.remove('show');
            this.renderObjectList();
            this.selectObject(id);
        }
    }

    // Type management methods
    createNewType() {
        this.dispatchHook('createNewType', this.getHookDetail({arguments}));
        const typeId = document.getElementById('new-type-id').value.trim();
        const typeName = document.getElementById('new-type-name').value.trim();
        const typeSingular = document.getElementById('new-type-singular').value.trim();
        const typeCategory = document.getElementById('new-type-category').value.trim();
    
        if (!typeId) {
            alert('Please enter a Type ID');
            return;
        }
    
        if (this.getCollections()[typeId]) {
            alert(`Type "${typeId}" already exists`);
            return;
        }
    
        this.getCollections()[typeId] = {};
        this.getCollectionDefs().push({
            id: typeId,
            name: typeName || typeId.charAt(0).toUpperCase() + typeId.slice(1),
            singular: typeSingular || typeId.slice(0, -1).charAt(0).toUpperCase() + typeId.slice(0, -1).slice(1),
            category: typeCategory || 'Uncategorized'
        });
    
        this.state.selectedType = typeId;
        this.state.selectedObject = null;
    
        document.getElementById('add-type-modal').classList.remove('show');
        this.renderObjectList();
        this.renderEditor();
        this.renderPreview();
        this.updateSidebarButtons();
        this.saveToLocalStorage();
    }

    showAddTypeModal() {
        this.dispatchHook('showAddTypeModal', this.getHookDetail({arguments}));
        if (!document.getElementById('add-type-modal')) {
            const modal = document.createElement('div');
            modal.className = 'modal';
            modal.id = 'add-type-modal';
            modal.innerHTML = `
                <div class="modal-content">
                    <h2>Add New Object Type</h2>
                    <div class="form-group">
                        <label for="new-type-id">Type ID (plural, e.g. "weapons"):</label>
                        <input type="text" id="new-type-id" placeholder="e.g. weapons">
                    </div>
                    <div class="form-group">
                        <label for="new-type-name">Display Name (plural):</label>
                        <input type="text" id="new-type-name" placeholder="e.g. Weapons">
                    </div>
                    <div class="form-group">
                        <label for="new-type-singular">Singular Name:</label>
                        <input type="text" id="new-type-singular" placeholder="e.g. Weapon">
                    </div>
                    <div class="form-group">
                        <label for="new-type-category">Category:</label>
                        <input type="text" id="new-type-category" placeholder="e.g. Gameplay">
                    </div>
                    <div class="actions">
                        <button class="primary" id="create-type-btn">Create Type</button>
                        <button id="close-add-type-modal">Cancel</button>
                    </div>
                </div>
            `;
            document.body.appendChild(modal);
    
            document.getElementById('create-type-btn').addEventListener('click', () => this.createNewType());
            document.getElementById('close-add-type-modal').addEventListener('click', () => {
                document.getElementById('add-type-modal').classList.remove('show');
            });
        }
        document.getElementById('add-type-modal').classList.add('show');
    }

    showRemoveTypeModal() {
        this.dispatchHook('showRemoveTypeModal', this.getHookDetail({arguments}));
        // Create the modal if it doesn't exist
        if (!document.getElementById('remove-type-modal')) {
            const modal = document.createElement('div');
            modal.className = 'modal';
            modal.id = 'remove-type-modal';
            modal.innerHTML = `
                <div class="modal-content">
                    <h2>Remove Object Type</h2>
                    <div class="warning" style="color: #f44; margin: 10px 0;">
                        Warning: This will permanently delete all objects of this type!
                    </div>
                    <div class="actions">
                        <button class="danger" id="confirm-remove-type-btn">Remove Type</button>
                        <button id="close-remove-type-modal">Cancel</button>
                    </div>
                </div>
            `;
            document.body.appendChild(modal);
            
            // Add event listeners
            document.getElementById('confirm-remove-type-btn').addEventListener('click', () => this.removeSelectedType());
            document.getElementById('close-remove-type-modal').addEventListener('click', () => {
                document.getElementById('remove-type-modal').classList.remove('show');
            });
        }
        
        // Show the modal
        document.getElementById('remove-type-modal').classList.add('show');
    }

    removeSelectedType() {
        this.dispatchHook('removeSelectedType', this.getHookDetail({arguments}));
        const typeId = this.state.selectedType;
        
        if (!typeId) return;
        let typeDef = this.getCollectionDefs().find(type => type.id == typeId);
        if(typeDef.isCore){
            
            alert('Cannot remove a core object type');
             return;
        }

        // Prevent removing all types
        if (this.getCollectionDefs().length <= 1) {
            alert('Cannot remove the last object type');
            return;
        }
        
        // Remove the type
        delete this.getCollections()[typeId];
        this.state.project.objectTypeDefinitions = this.getCollectionDefs().filter(type => type.id !== typeId);
        
        // Switch to the first available type
        this.state.selectedType = this.getCollectionDefs()[0].id;
        this.state.selectedObject = null;
        
        // Close the modal and update UI
        document.getElementById('remove-type-modal').classList.remove('show');
        this.renderObjectList();
        this.renderEditor();
        this.renderPreview();
        this.updateSidebarButtons();
        this.saveToLocalStorage();
    }

    // UI update methods
    updateNewObjectModal() {
        this.dispatchHook('updateNewObjectModal', this.getHookDetail({arguments}));
        const singularType = this.getSingularType(this.state.selectedType);
        document.querySelector('#new-object-modal h2').textContent = `Create New ${singularType.charAt(0).toUpperCase() + singularType.slice(1)}`;
        document.querySelector('#new-object-modal label[for="new-object-id"]').textContent = `${singularType.charAt(0).toUpperCase() + singularType.slice(1)} ID:`;
        document.getElementById('create-object-btn').textContent = `Create ${singularType.charAt(0).toUpperCase() + singularType.slice(1)}`;
    }

    updateDuplicateObjectModal() {
        this.dispatchHook('updateDuplicateObjectModal', this.getHookDetail({arguments}));
        const singularType = this.getSingularType(this.state.selectedType);
        document.querySelector('#duplicate-object-modal h2').textContent = `Create Duplicate ${singularType.charAt(0).toUpperCase() + singularType.slice(1)}`;
        document.querySelector('#duplicate-object-modal label[for="duplicate-object-id"]').textContent = `${singularType.charAt(0).toUpperCase() + singularType.slice(1)} ID:`;
        document.getElementById('create-duplicate-object-btn').textContent = `Create ${singularType.charAt(0).toUpperCase() + singularType.slice(1)}`;
    }

    updateSidebarButtons() {
        this.dispatchHook('updateSidebarButtons', this.getHookDetail({arguments}));
        const singularType = this.getSingularType(this.state.selectedType);
        document.getElementById('add-object-btn').textContent = `Add New ${singularType}`;
    }


    // Utility methods
    toggleEditor() {
        this.dispatchHook('toggleEditor', this.getHookDetail({arguments}));
        if(this.elements.editor.offsetParent === null){
        //    this.elements.editor.setAttribute('style', 'display: block');
        //    this.elements.mainContentContainer.setAttribute('style', 'height: 50vh');
        } else {
          //  this.elements.editor.setAttribute('style', 'display: none');
         //   this.elements.mainContentContainer.setAttribute('style', 'height: 100vh');       
        }
    }

    copyExportToClipboard() {
        this.dispatchHook('copyExportToClipboard', this.getHookDetail({arguments}));
        this.elements.exportTextarea.select();
        document.execCommand('copy');
        const copyBtn = document.getElementById('copy-export-btn');
        copyBtn.textContent = 'Copied!';
        this.saveToLocalStorage();
        setTimeout(() => {
            copyBtn.textContent = 'Copy to Clipboard';
        }, 2000);
    }

    saveToLocalStorage() {
        this.dispatchHook('saveToLocalStorage', this.getHookDetail({arguments}));
        this.saveConfigFile();
    }

    importConfig() {
        this.dispatchHook('importConfig', this.getHookDetail({arguments}));
        const code = this.elements.importTextarea.value;
        const result = this.parseConfigCode(code);
        
        if (result) {
            this.getCollections()[result.type] = result.config;
            this.state.selectedType = result.type;
            this.renderObjectList();
            this.elements.importExportModal.classList.remove('show');
            
            if (Object.keys(this.getCollections()[this.state.selectedType]).length > 0) {
                this.selectObject(Object.keys(this.getCollections()[this.state.selectedType])[0]);
            } else {
                this.state.selectedObject = null;
                this.renderEditor();
                this.renderPreview();
            }
            this.saveToLocalStorage();
        }
    }
    loadCommonJSModule(source) {
        // Simulated module system
        
        // Shim for module.exports
        const module = { exports: {} };
        
        // Wrap the source in a function and evaluate it
        const pluginCode = `
          (function(require, module) {
            ${source}
          })(require, module);
          return module.exports;
        `;
        
        // Use Function constructor to evaluate safely
        const pluginFunction = new Function("require", "module", pluginCode);
        const result = pluginFunction(require, module);
        
        return result;
      }
      
    // Initialization methods
    // Add these new methods to register custom modules and property handlers
    registerModule(name, moduleInstance) {
        this.dispatchHook('registerModule', this.getHookDetail({arguments}));
        this.registeredModules[name] = moduleInstance;
        return moduleInstance;
    }
    // Method to instantiate all registered modules


    selectCurrentObject() {   
        this.dispatchHook('selectCurrentObject', this.getHookDetail({arguments}));             
 
        if (Object.keys(this.getCollections()[this.state.selectedType]).length > 0) {
            this.selectObject(Object.keys(this.getCollections()[this.state.selectedType])[0]);
        }   
    }

    // Method to access a module instance
    getModule(name) {
        this.dispatchHook('getModule', this.getHookDetail({arguments}));
        return this.modules[name];
    }

    // Update the registerPropertyHandler to work with the new module system
    registerPropertyHandler(propertyName, config) {
        this.dispatchHook('registerPropertyHandler', this.getHookDetail({arguments}));
        this.getCollections().propertyModules[propertyName] = {
            ...config,
            container: config.container || `${propertyName}-editor-container`
        };
    }

    // Updated updateMainContent to work with the new module system
    updateMainContent() {
        this.dispatchHook('updateMainContent', this.getHookDetail({arguments}));
        // Hide all editor containers first
        Object.values(this.getCollections().propertyModules).forEach(module => {
            const container = document.getElementById(module.container);
            if (container) {
                container.classList.remove('show');
            }
        });

    }
    hideEditor() {
        this.elements.editor.classList.add('hidden');
        this.elements.handle.classList.add('hidden');
        this.elements.mainContentContainer.classList.add('full-height');
        this.elements.mainContentContainer.style.height = '100%';
    }
    
    showContent() {
        this.elements.mainContentContainer.classList.remove('hidden');
        this.elements.handle.classList.remove('hidden');
        this.elements.editor.classList.remove('full-height');
        this.elements.mainContentContainer.removeAttribute('style');
    }
    hideContent() {
        this.elements.mainContentContainer.classList.add('hidden');
        this.elements.handle.classList.add('hidden');
        this.elements.editor.classList.add('full-height');
        this.elements.editor.style.height = '100%';
    }
    // Updated drawObject to work with the new module system
    drawObject(object) {
        this.dispatchHook('drawObject', this.getHookDetail({arguments}));
        if (!object) return;
        
        // Find the first matching property with a module handler
        const matchingProperty = Object.keys(this.getCollections().propertyModules).find(
            (moduleId) => {
                let module = this.getCollections().propertyModules[moduleId];
                return typeof object[module.propertyName] !== "undefined"
            }
        );
        
        if (!matchingProperty) {            
            this.hideContent();
           // this.elements.editor.setAttribute('style', 'display: flex');
            //this.elements.mainContentContainer.setAttribute('style', 'display: none');
            return;
        } 
        this.showContent();
        
        const moduleInfo = this.getCollections().propertyModules[matchingProperty];
        document.getElementById(moduleInfo.container).classList.add('show');
        
        requestAnimationFrame(() => {
            // Create and dispatch the event
            const customEvent = new CustomEvent(moduleInfo.eventName, {
                detail: { data: object[moduleInfo.propertyName], config: this.getCollections().configs.game },
                bubbles: true,
                cancelable: true
            });
            
            document.body.dispatchEvent(customEvent);
        });
    }
    setupEventListeners() {
        this.dispatchHook('setupEventListeners', this.getHookDetail({arguments}));
      
        // Import/Export handling
        // document.getElementById('import-export-btn').addEventListener('click', () => {
        //     this.elements.exportTextarea.value = this.generateConfigCode();
        //     this.elements.importExportModal.classList.add('show');
        // });

        
        // New object handling
        document.getElementById('add-object-btn').addEventListener('click', () => {
            this.elements.newObjectIdInput.value = '';
            this.elements.newObjectNameInput.value = '';
            this.updateNewObjectModal();
            this.elements.newObjectModal.classList.add('show');
        });
        
        document.getElementById('close-new-object-modal').addEventListener('click', () => {
            this.elements.newObjectModal.classList.remove('show');
        });
        
        document.getElementById('create-object-btn').addEventListener('click', () => this.createNewObject());
        
        // New object handling


        document.getElementById('close-duplicate-object-modal').addEventListener('click', () => {
            this.elements.duplicateObjectModal.classList.remove('show');
        });

        document.getElementById('create-duplicate-object-btn').addEventListener('click', () => this.duplicateObject());

        //document.getElementById('toggleEditorButton').addEventListener('click', () => this.toggleEditor());
        this.isDragging = false;
        let startY;
        let startHeightContent;
        let startHeightEditor;
        document.getElementById('toggleEditorButton').addEventListener('mousedown', (e) => {
            this.isDragging = true;
            startY = e.clientY;
            startHeightContent = this.elements.mainContentContainer.offsetHeight;
            startHeightEditor = this.elements.editor.offsetHeight;
            e.preventDefault();
        });
        
        document.addEventListener('mousemove', (e) => {
            if (!this.isDragging) return;
        
            const delta = e.clientY - startY;
            const containerHeight = document.getElementById('toggleEditorButton').parentElement.offsetHeight;
            const handleHeight = document.getElementById('toggleEditorButton').offsetHeight;
            
            // Calculate new heights with minimum constraints
            let newContentHeight = startHeightContent + delta;
            let newEditorHeight = startHeightEditor - delta;
            
            // Enforce minimum heights
            if (newContentHeight < 100) {
              newContentHeight = 100;
              newEditorHeight = containerHeight - newContentHeight - handleHeight;
            }
            if (newEditorHeight < 100) {
              newEditorHeight = 100;
              newContentHeight = containerHeight - newEditorHeight - handleHeight;
            }
        
            this.elements.mainContentContainer.style.height = `${newContentHeight}px`;
            this.elements.editor.style.height = `${newEditorHeight}px`;
            this.elements.mainContentContainer.style.flex = 'none'; // Override flex property
            this.elements.editor.style.flex = 'none';  // Override flex property
        });
        
        document.addEventListener('mouseup', () => {
            this.isDragging = false;
        });
        // Tab navigation
        this.elements.tabs.forEach(tab => {
            tab.addEventListener('click', () => {
                this.elements.tabs.forEach(t => t.classList.remove('active'));
                document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
                
                tab.classList.add('active');
                document.getElementById(`${tab.dataset.tab}-tab`).classList.add('active');
            });
        });        

        this.elements.launchGameBtn.addEventListener('click',() => {
            window.open("index.html", "mozillaTab");
        });
        
        this.selectCurrentObject(); // Call when all modules are loaded      
    }

    setupModuleEventListeners(modules){
        Object.entries(modules).forEach(([moduleId, module]) => {
            document.body.addEventListener(`save${module.propertyName}`, (event) => {
                let valEl = this.elements.editor.querySelector(`#${module.propertyName}-value`);
                if (module.inputDataType == "json") {
                    valEl.value = JSON.stringify(event.detail);
                } else {
                    valEl.value = event.detail;
                }
                this.saveObject();
            });
            document.body.addEventListener(`updateCurrentObject`, (event) => {                
                this.selectObject(this.state.selectedObject);
            });
        });
    }

    async configLoaded() {
        this.dispatchHook('configLoaded', this.getHookDetail({arguments}));
        const collections = this.getCollections();
        if( collections.configs.editor ) {
            let styleTag = document.getElementById("theme_style");
            styleTag.innerHTML = collections.themes[collections.configs.editor.theme].css;
        }
        this.setupScriptEnvironment();
        this.moduleLoader = new ModuleLoader(this, collections, this.elements.mainContentContainer, this.elements.modalContainer, this.engineClasses);

    
        try {   
            this.libraryClasses = await this.moduleLoader.loadModules(collections.libraries);
        //    this.libraryInstances = this.instantiateCollection(collections.libraries, this.libraryModuleClasses, this.libraryInstances);  
            let editorModules = {};
            collections.configs.editor.propertyModules.forEach((pm) => {
                editorModules[pm] = collections.propertyModules[pm]
            });
            this.propertyModuleClasses = await this.moduleLoader.loadModules(editorModules);             
            this.propertyModuleInstances = this.moduleLoader.instantiateCollection(this, collections.propertyModules, this.propertyModuleClasses, this.engineClasses);      
            
        } catch(e) {
            console.error(e);
        }    

        this.setupModuleEventListeners(collections.propertyModules);
        // Set up event listeners
        this.setupEventListeners();
        
        // Render initial UI
        this.renderObjectList();
        this.updateSidebarButtons();      

    }
}

// Initialize the application when the DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    let editor = new Editor();
    editor.init();
});
