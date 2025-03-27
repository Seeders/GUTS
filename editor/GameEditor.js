import { TerrainMapEditor } from "./TerrainMapEditor.js";
import { GraphicsEditor } from "./GraphicsEditor.js";
import {AIPromptPanel} from "./AIPromptPanel.js";
import { ScriptEditor } from "./ScriptEditor.js";

class GameEditor {
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

        // Application state
        this.state = {
            objectTypes: {
                configs: {
                    state: {
                        gridSize: 48,
                        imageSize: 128,
                        canvasWidth: 1536,
                        canvasHeight: 768            
                    }
                },
                towers: {},
                enemies: {},
                projectiles: {}
            },
            objectTypeDefinitions: [
                { id: 'configs', name: 'Configs', singular: 'Config' },
                { id: 'towers', name: 'Towers', singular: 'Tower' },
                { id: 'enemies', name: 'Enemies', singular: 'Enemy' },
                { id: 'projectiles', name: 'Projectiles', singular: 'Projectile' },
                { id: 'environment', name: 'Environment', singular: 'Environment' }
            ],
            selectedType: 'towers',
            selectedObject: null,
            isDragging: false,
            objectPosition: { x: 300, y: 120 }
        };

        // Cache DOM elements
        this.elements = {
            objectList: document.getElementById('object-list'),
            editor: document.getElementById('editor'),
            previewCanvas: document.getElementById('preview-canvas'),
            gridDisplay: document.getElementById('grid-display'),
            importExportModal: document.getElementById('import-export-modal'),
            importTextarea: document.getElementById('import-textarea'),
            exportTextarea: document.getElementById('export-textarea'),
            newObjectModal: document.getElementById('new-object-modal'),
            newObjectIdInput: document.getElementById('new-object-id'),
            newObjectNameInput: document.getElementById('new-object-name'),
            duplicateObjectModal: document.getElementById('duplicate-object-modal'),
            duplicateObjectIdInput: document.getElementById('duplicate-object-id'),
            duplicateObjectNameInput: document.getElementById('duplicate-object-name'),
            tabs: document.querySelectorAll('.tab'),
            rotateLeftBtn: document.getElementById('rotateLeftBtn'),
            rotateRightBtn: document.getElementById('rotateRightBtn'),
            clearDrawingBtn: document.getElementById('clearDrawingBtn'),
            colorPicker: document.getElementById('colorPicker'),
            sizeSlider: document.getElementById('sizeSlider'),
            terrainEditorContainer: document.getElementById('level-editor-container'),
            graphicsEditorContainer: document.getElementById('graphics-editor-container')
        };

        // Initialize the application
        this.init();
    }

    // Helper methods
    getSingularType(typeId) {
        const typeDef = this.state.objectTypeDefinitions.find(t => t.id === typeId);
        return typeDef ? typeDef.singular : typeId.slice(0, -1);
    }

    getPluralType(typeId) {
        const typeDef = this.state.objectTypeDefinitions.find(t => t.id === typeId);
        return typeDef ? typeDef.name : typeId;
    }

    // Rendering methods
    renderTypeSelector() {
        let html = `<h2>Object Types</h2>`;
    
        // Group object types by category
        const categories = {};
        this.state.objectTypeDefinitions.forEach(type => {
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
                this.state.expandedCategories[category] = false; // All closed by default
            }
        }
    
        // Render categories and their types
        html += `<div class="type-selector">`;
        for (const [category, types] of Object.entries(categories)) {
            const isExpanded = this.state.expandedCategories[category] || false;
            html += `
                <div class="category">
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
                    Object.keys(this.state.objectTypes[type.id] || {}).forEach(objId => {
                        html += `
                            <div class="object-item ${this.state.selectedObject === objId ? 'selected' : ''}" data-object="${objId}">
                                ${objId}
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
                ${this.state.objectTypeDefinitions.length > 1 ? `<button id="remove-type-btn" class="small-btn danger">Remove Type</button>` : ''}
            </div>`;
    
        return html;
    }
    renderObjectList() {
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
                const objects = this.state.objectTypes[this.state.selectedType];
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
                // Collapse all categories except the clicked one
                for (const cat in this.state.expandedCategories) {
                    this.state.expandedCategories[cat] = cat === category;
                }
                this.renderObjectList(); // Re-render to reflect new state
            });
        });
    
        // Add event listeners for type actions
        document.getElementById('add-type-btn')?.addEventListener('click', () => this.showAddTypeModal());
        document.getElementById('remove-type-btn')?.addEventListener('click', () => this.showRemoveTypeModal());
    }
    selectObject(objId) {
        this.state.selectedObject = objId;
        this.renderObjectList();
        this.renderEditor();
        this.renderPreview();
        this.updateMainContent();
    }

    renderEditor() {
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
                    <button id="ai-prompt-btn">AI Generate</button>
                </div>
            </div>
            <div class="actions">
                <div>
                    <button class="primary" id="save-object-btn">Save ${singularType}</button>
                    <button id="duplicate-object-btn">Duplicate Object</button>
                    <button id="revert-changes-btn">Revert Changes</button>                    
                    <button class="danger" id="delete-object-btn">Delete ${singularType}</button>
                </div>
            </div>
        `;
        
        this.scriptEditor.render();
        // Add event listener
        document.getElementById('ai-prompt-btn').addEventListener('click', () => {
            this.aiPromptPanel.showModal();
        });
        document.getElementById('duplicate-object-btn').addEventListener('click', () => {
            this.elements.duplicateObjectIdInput.value = '';
            this.elements.duplicateObjectNameInput.value = '';
            this.updateDuplicateObjectModal();
            this.elements.duplicateObjectModal.classList.add('show');
        });
        // Setup property editor
        const customPropertiesContainer = document.getElementById('custom-properties');
        this.renderCustomProperties(customPropertiesContainer, this.state.objectTypes[this.state.selectedType][this.state.selectedObject]);
        
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
        container.innerHTML = '';

        Object.entries(object).forEach(([key, value]) => {
            this.addCustomProperty(container, key, value);
        });
    }

    addCustomProperty(container, key, value) {
        const propertyItem = document.createElement('div');
        propertyItem.className = 'property-item';
        
        const keyInput = document.createElement('input');
        keyInput.type = 'text';
        keyInput.placeholder = 'Property Name';
        keyInput.value = key;
        keyInput.className = 'property-key';
        
        // Check if the key matches a type name (plural or singular)
        const matchingTypePlural = this.state.objectTypeDefinitions.find(t => t.id.toLowerCase() === key.toLowerCase());
        const matchingTypeSingular = this.state.objectTypeDefinitions.find(t => t.singular.replace(/ /g,'').toLowerCase() === key.toLowerCase());
        
        propertyItem.appendChild(keyInput);
        // Regular property input (not a reference)
        let valueInput = document.createElement('input');
        let type = 'text';
        if (key === 'color') {
            type = 'color';
            valueInput.type = type;
            valueInput.value = value;
        } else if (key === 'render') {
            valueInput = document.createElement('textarea');
            type = 'textarea';
            value = JSON.stringify(value);
            valueInput.textContent = value;
            valueInput.setAttribute('id', 'render-value');
        } else if(key === "script" ){ 
            valueInput = document.createElement('textarea');
            valueInput.textContent = value;
            type = 'textarea';            
        } else if (key === "tileMap" ) {
            valueInput = document.createElement('textarea');
            type = 'textarea';
            value = JSON.stringify(value);
            valueInput.textContent = value;
            valueInput.setAttribute('id', 'tilemap-value');
        } else {
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

            Object.keys(this.state.objectTypes[typeId] || {}).forEach(objId => {
                const option = document.createElement('option');
                option.value = objId;
                option.textContent = this.state.objectTypes[typeId][objId].title || objId;
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
            
            Object.keys(this.state.objectTypes[typeId] || {}).forEach(objId => {
                const option = document.createElement('option');
                option.value = objId;
                option.textContent = this.state.objectTypes[typeId][objId].title || objId;
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
        if (!this.state.selectedObject) return;
        
        const object = {}; 
        
        // Collect custom properties
        document.querySelectorAll('.property-item').forEach(item => {
            const keyInput = item.querySelector('.property-key');
            const valueInput = item.querySelector('.property-value');
            
            if (keyInput.value && valueInput) {
                let value = valueInput.value;
                const matchingTypePlural = this.state.objectTypeDefinitions.find(
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
                    value = JSON.parse(value);
                }

                object[keyInput.value] = value;
            }
        });
        
        // Update the config
        this.state.objectTypes[this.state.selectedType][this.state.selectedObject] = object;
        
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
        if (!this.state.selectedObject) return;
        
        const singularType = this.getSingularType(this.state.selectedType);
        
        if (confirm(`Are you sure you want to delete "${this.state.selectedObject}" ${singularType}?`)) {
            delete this.state.objectTypes[this.state.selectedType][this.state.selectedObject];
            this.state.selectedObject = null;
            this.renderObjectList();
            this.renderEditor();
            this.renderPreview();
        }
    }

    // Preview methods
    renderPreview() {
        if (this.state.selectedObject && this.state.objectTypes[this.state.selectedType][this.state.selectedObject]) {
            const object = this.state.objectTypes[this.state.selectedType][this.state.selectedObject];
            this.drawObject(object);               
        }
    }

    drawObject(object) {
        let data = null;
        let eventName = "";
        if(object.render) {
            eventName = "renderObject";
            data = object.render;
        } else if(object.tileMap) {
            eventName = "editTileMap";
            data = { config: this.state.objectTypes.configs.game, tileMap: object.tileMap, environment: this.state.objectTypes.environment }
        }
        if( data ) {
            // Create a custom event with data
            const myCustomEvent = new CustomEvent(eventName, {
                detail: data,
                bubbles: true,
                cancelable: true
            });

            // Dispatch the event
            document.body.dispatchEvent(myCustomEvent);
        }
    }

    // Import/Export methods
    generateConfigCode() {
        let code = `{\n`;
        
        Object.entries(this.state.objectTypes[this.state.selectedType]).forEach(([objId, config]) => {
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
        const id = this.elements.newObjectIdInput.value.trim();
        const name = this.elements.newObjectNameInput.value.trim();
        
        if (!id) {
            alert(`Please enter an ID`);
            return;
        }
        
        if (this.state.objectTypes[this.state.selectedType][id]) {
            alert(`Object with ID "${id}" already exists`);
            return;
        }
        
        // Create default properties based on type
        let defaultProps = {
            title: name || id,
            render: JSON.parse(JSON.stringify(this.CONFIG.DEFAULT_RENDER))
        };
        
        this.state.objectTypes[this.state.selectedType][id] = defaultProps;
        
        this.elements.newObjectModal.classList.remove('show');
        this.renderObjectList();
        this.selectObject(id);
    }

    duplicateObject() {      
        const currentSelectedObjectType = this.state.objectTypes[this.state.selectedType];
        if( currentSelectedObjectType ) {
            // Create default properties based on type
            let defaultProps = {...currentSelectedObjectType[this.state.selectedObject]};
                
            const id = this.elements.duplicateObjectIdInput.value.trim();
            const title = this.elements.duplicateObjectNameInput.value.trim();
            defaultProps.title = title;
            this.state.objectTypes[this.state.selectedType][id] = defaultProps;
            
            this.elements.duplicateObjectModal.classList.remove('show');
            this.renderObjectList();
            this.selectObject(id);
        }
    }

    // Type management methods
    createNewType() {
        const typeId = document.getElementById('new-type-id').value.trim();
        const typeName = document.getElementById('new-type-name').value.trim();
        const typeSingular = document.getElementById('new-type-singular').value.trim();
        const typeCategory = document.getElementById('new-type-category').value.trim();
    
        if (!typeId) {
            alert('Please enter a Type ID');
            return;
        }
    
        if (this.state.objectTypes[typeId]) {
            alert(`Type "${typeId}" already exists`);
            return;
        }
    
        this.state.objectTypes[typeId] = {};
        this.state.objectTypeDefinitions.push({
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
        const typeId = this.state.selectedType;
        
        if (!typeId) return;
        
        // Prevent removing all types
        if (this.state.objectTypeDefinitions.length <= 1) {
            alert('Cannot remove the last object type');
            return;
        }
        
        // Remove the type
        delete this.state.objectTypes[typeId];
        this.state.objectTypeDefinitions = this.state.objectTypeDefinitions.filter(type => type.id !== typeId);
        
        // Switch to the first available type
        this.state.selectedType = this.state.objectTypeDefinitions[0].id;
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
        const singularType = this.getSingularType(this.state.selectedType);
        document.querySelector('#new-object-modal h2').textContent = `Create New ${singularType.charAt(0).toUpperCase() + singularType.slice(1)}`;
        document.querySelector('#new-object-modal label[for="new-object-id"]').textContent = `${singularType.charAt(0).toUpperCase() + singularType.slice(1)} ID:`;
        document.getElementById('create-object-btn').textContent = `Create ${singularType.charAt(0).toUpperCase() + singularType.slice(1)}`;
    }

    updateDuplicateObjectModal() {
        const singularType = this.getSingularType(this.state.selectedType);
        document.querySelector('#duplicate-object-modal h2').textContent = `Create Duplicate ${singularType.charAt(0).toUpperCase() + singularType.slice(1)}`;
        document.querySelector('#duplicate-object-modal label[for="duplicate-object-id"]').textContent = `${singularType.charAt(0).toUpperCase() + singularType.slice(1)} ID:`;
        document.getElementById('create-duplicate-object-btn').textContent = `Create ${singularType.charAt(0).toUpperCase() + singularType.slice(1)}`;
    }

    updateSidebarButtons() {
        const singularType = this.getSingularType(this.state.selectedType);
        document.getElementById('add-object-btn').textContent = `Add New ${singularType}`;
        document.getElementById('import-export-btn').textContent = `Import/Export ${this.getPluralType(this.state.selectedType)}`;
    }

    updateMainContent() {
        this.elements.terrainEditorContainer.classList.remove('show');
        this.elements.graphicsEditorContainer.classList.remove('show');
        if(typeof this.state.objectTypes[this.state.selectedType][this.state.selectedObject].render != "undefined") {
            this.elements.graphicsEditorContainer.classList.add('show');
        } else if(typeof this.state.objectTypes[this.state.selectedType][this.state.selectedObject].tileMap != "undefined") {
            this.elements.terrainEditorContainer.classList.add('show');
        }
    }

    // Utility methods
    toggleEditor() {
        if(this.elements.editor.offsetParent === null){
            this.elements.editor.setAttribute('style', 'display: block');
            this.elements.terrainEditorContainer.setAttribute('style', 'height: 50vh');
            this.elements.graphicsEditorContainer.setAttribute('style', 'height: 50vh');
        } else {
            this.elements.editor.setAttribute('style', 'display: none');
            this.elements.terrainEditorContainer.setAttribute('style', 'height: 100vh');
            this.elements.graphicsEditorContainer.setAttribute('style', 'height: 100vh');        
        }
    }

    copyExportToClipboard() {
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
        localStorage.setItem("objectTypes", JSON.stringify(this.state.objectTypes));
        localStorage.setItem("objectTypeDefinitions", JSON.stringify(this.state.objectTypeDefinitions));
        this.saveConfigFile();
    }
    
    saveConfigFile() {
        this.state.objectTypes.objectTypeDefinitions = this.state.objectTypeDefinitions;
        const configText = JSON.stringify(this.state.objectTypes, null, 2);
        delete this.state.objectTypes.objectTypeDefinitions;
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

    importConfig() {
        const code = this.elements.importTextarea.value;
        const result = this.parseConfigCode(code);
        
        if (result) {
            this.state.objectTypes[result.type] = result.config;
            this.state.selectedType = result.type;
            this.renderObjectList();
            this.elements.importExportModal.classList.remove('show');
            
            if (Object.keys(this.state.objectTypes[this.state.selectedType]).length > 0) {
                this.selectObject(Object.keys(this.state.objectTypes[this.state.selectedType])[0]);
            } else {
                this.state.selectedObject = null;
                this.renderEditor();
                this.renderPreview();
            }
            this.saveToLocalStorage();
        }
    }

    // Initialization methods
    initModules() {
        this.terrainMapEditor = new TerrainMapEditor();
        this.terrainMapEditor.init();
        this.graphicsEditor = new GraphicsEditor();        
 
        this.aiPromptPanel = new AIPromptPanel(this);
        this.scriptEditor = new ScriptEditor(this); // Initialize ScriptEditor
        

    }

    setupEventListeners() {
        // Import/Export handling
        document.getElementById('import-export-btn').addEventListener('click', () => {
            this.elements.exportTextarea.value = this.generateConfigCode();
            this.elements.importExportModal.classList.add('show');
        });

        document.getElementById('close-import-export-modal').addEventListener('click', () => {
            this.elements.importExportModal.classList.remove('show');
        });
        
        document.getElementById('close-export-modal').addEventListener('click', () => {
            this.elements.importExportModal.classList.remove('show');
        });
        
        document.getElementById('copy-export-btn').addEventListener('click', () => this.copyExportToClipboard());
        
        document.getElementById('import-btn').addEventListener('click', () => this.importConfig());
        
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

        document.getElementById('toggleEditorButton').addEventListener('click', () => this.toggleEditor());

        // Tab navigation
        this.elements.tabs.forEach(tab => {
            tab.addEventListener('click', () => {
                this.elements.tabs.forEach(t => t.classList.remove('active'));
                document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
                
                tab.classList.add('active');
                document.getElementById(`${tab.dataset.tab}-tab`).classList.add('active');
            });
        });
        
        document.body.addEventListener('saveObjectGraphics', (event) => {
            let renderData = event.detail;
            document.getElementById('render-value').value = JSON.stringify(renderData);
        });
        
        document.body.addEventListener('saveTileMap', (event) => {
            document.getElementById('tilemap-value').value = JSON.stringify(event.detail);
        });
    }

    init() {
        fetch('/config/game_config.json')
            .then(response => {
                if (!response.ok) throw new Error('File not found');
                return response.json();
            })
            .then(config => {
                this.state.objectTypes = config;                    
                if(this.state.objectTypes.objectTypeDefinitions) {
                    this.state.objectTypeDefinitions = this.state.objectTypes.objectTypeDefinitions;
                    delete this.state.objectTypes.objectTypeDefinitions;                           
                }
                this.initModules();
                // Set up event listeners
                this.setupEventListeners();
                
                // Render initial UI
                this.renderObjectList();
                this.updateSidebarButtons();            
                
                if( config.configs.editor ) {
                    let styleTag = document.getElementById("theme_style");
                    styleTag.innerHTML = config.themes[config.configs.editor.theme].css;
                }
                
                if (Object.keys(this.state.objectTypes[this.state.selectedType]).length > 0) {
                    this.selectObject(Object.keys(this.state.objectTypes[this.state.selectedType])[0]);
                }    
            })
            .catch(error => {
                console.error('Error loading config:', error);
            });             
    }
}

// Initialize the application when the DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    new GameEditor();
});