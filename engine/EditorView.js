import { DEFAULT_PROJECT_CONFIG } from "../config/default_app_config.js";

export class EditorView {
    constructor(controller) {
      this.controller = controller;
      this.moduleManager = controller.moduleManager;
      this.elements = controller.elements;
      this.isDragging = false;
      this.dragState = {};
      
      // Initialize UI
      this.setupEventListeners();
      this.renderObjectList();
      this.updateSidebarButtons();
      this.controller.dispatchHook('EditorUI', arguments);
    }
  
    // Main rendering methods
    renderObjectList() {
        this.controller.dispatchHook('renderObjectList', arguments);
      const currentTypeDef = this.controller.getCollectionDefs().find(
        type => type.id === this.controller.getSelectedType() && this.controller.getSelectedObject()
      ) || {};
      
      // Group object types by category
      const categories = {};
      this.controller.getCollectionDefs().forEach(type => {
        const category = type.category || 'Uncategorized';
        if (!categories[category]) {
          categories[category] = [];
        }
        categories[category].push(type);
      });
  
      // Initialize expanded categories if needed
      if (!this.controller.getExpandedCategories()) {
        this.controller.setExpandedCategories({});
        for (const category in categories) {
          this.controller.getExpandedCategories()[category] = category === currentTypeDef.category;
        }
      }
  
      // Generate HTML
      let html = `<div class="type-selector">`;
      for (const [category, types] of Object.entries(categories)) {
        const isExpanded = this.controller.getExpandedCategories()[category];
        const isCurrentCategory = category === currentTypeDef.category;
        
        html += `
          <div class="category ${isExpanded || isCurrentCategory ? 'highlight' : ''}">
            <div class="category-header">${category}</div>
            <div class="category-types" style="display: ${isExpanded ? 'block' : 'none'};">`;
        
        types.forEach(type => {
          const isSelected = this.controller.getSelectedType() === type.id;
          html += `
            <div class="object-type-item ${isSelected ? 'selected' : ''}" data-type="${type.id}">
              ${type.name}
            </div>`;
  
          if (isSelected) {
            html += `<div class="object-list">`;
            Object.keys(this.controller.getCollections()[type.id] || {}).forEach(objId => {
              const obj = this.controller.getCollections()[type.id][objId];
              html += `
                <div class="object-item ${this.controller.getSelectedObject() === objId ? 'selected' : ''}" 
                     data-object="${objId}">
                  ${obj.title || objId}
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
          ${this.controller.getCollectionDefs().length > 1 && !currentTypeDef.isCore ? 
            `<button id="remove-type-btn" class="small-btn danger">Remove Type</button>` : ''}
        </div>`;
  
      this.elements.objectList.innerHTML = html;
      this.setupListEventListeners();
      this.renderEditor();
    }
  
    renderEditor() {
        this.controller.dispatchHook('renderEditor', arguments);
      if (!this.controller.getSelectedObject()) {
        const singularType = this.controller.getSingularType(this.controller.getSelectedType());
        this.elements.editor.innerHTML = `
          <div class="instructions">
            Select a ${singularType} from the sidebar or create a new one to start editing.
          </div>
        `;
        return;
      }
  
      const singularType = this.controller.getSingularType(this.controller.getSelectedType());
      const currentObject = this.controller.getCurrentObject();
  
      this.elements.editor.innerHTML = `
        <h2>Editing: ${currentObject.title || this.controller.getSelectedObject()} (${singularType})</h2>
        
        <div id="editor-properties-container">  
          <h3>Properties</h3>
          <div class="property-list" id="custom-properties"></div>
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
  
      this.renderCustomProperties(
        document.getElementById('custom-properties'),
        currentObject
      );
      this.setupEditorEventListeners();
    }
  
    renderCustomProperties(container, object) {
        this.controller.dispatchHook('renderCustomProperties', arguments);
      container.innerHTML = '';
  
      Object.entries(object).forEach(([key, value]) => {
        this.addCustomProperty(container, key, value);
      });
    }
  
    addCustomProperty(container, key, value) {
      this.controller.dispatchHook('addCustomProperty', arguments);
      
      const propertyItem = this.createPropertyItemElement();
      const keyInput = this.createKeyInputElement(key);
      propertyItem.appendChild(keyInput);
      
      // Get matching types for special handling
      const { matchingTypePlural, matchingTypeSingular, matchingModuleType } = this.controller.findMatchingTypes(key);
      
      // Create value input based on property type
      if (key === 'color') {
          this.appendColorInput(propertyItem, value);
      } else if (typeof value === 'boolean') {
          this.appendBooleanSelect(propertyItem, value);
      } else if (matchingModuleType) {
          this.appendModuleTypeInput(propertyItem, key, value, matchingModuleType);
      } else if (matchingTypeSingular) {
          this.appendSingularTypeSelect(propertyItem, value, matchingTypeSingular, matchingTypePlural);
      } else if (matchingTypePlural) {
          this.appendPluralTypeSelect(propertyItem, value, matchingTypePlural);
      } else {
          this.appendDefaultTextInput(propertyItem, value);
      }
      
      // Add remove button
      this.appendRemoveButton(propertyItem, container);
      
      container.appendChild(propertyItem);
    }
    
    createPropertyItemElement() {
        const propertyItem = document.createElement('div');
        propertyItem.className = 'property-item';
        return propertyItem;
    }
    
    createKeyInputElement(key) {
        const keyInput = document.createElement('input');
        keyInput.type = 'text';
        keyInput.placeholder = 'Property Name';
        keyInput.value = key;
        keyInput.className = 'property-key';
        return keyInput;
    }
    
    createValueContainer() {
        const valueContainer = document.createElement('div');
        valueContainer.className = 'property-value-container';
        return valueContainer;
    }
    
    
    appendColorInput(propertyItem, value) {
        const valueContainer = this.createValueContainer();
        const valueInput = document.createElement('input');
        valueInput.type = 'color';
        valueInput.value = value;
        valueInput.className = 'property-value';
        valueContainer.appendChild(valueInput);
        propertyItem.appendChild(valueContainer);
    }
    
    appendBooleanSelect(propertyItem, value) {
        const valueContainer = this.createValueContainer();
        const valueInput = document.createElement('select');
        valueInput.innerHTML = `
            <option value="true" ${value ? 'selected' : ''}>true</option>
            <option value="false" ${!value ? 'selected' : ''}>false</option>
        `;
        valueInput.className = 'property-value';
        valueContainer.appendChild(valueInput);
        propertyItem.appendChild(valueContainer);
    }
    
    appendModuleTypeInput(propertyItem, key, value, matchingModuleType) {
        const valueContainer = this.createValueContainer();
        const moduleInputElementType = matchingModuleType.inputElement || 'input';
        const moduleDataType = matchingModuleType.inputDataType;
        
        const valueInput = document.createElement(moduleInputElementType);
        valueInput.className = 'property-value';
        
        let processedValue = value;
        if (moduleDataType === 'json') {
            processedValue = JSON.stringify(value);
        }
        
        if (moduleInputElementType === 'textarea') {
            valueInput.textContent = processedValue;
        } else {
            valueInput.value = processedValue;
        }
        
        valueInput.setAttribute('id', `${key}-value`);
        valueContainer.appendChild(valueInput);
        
        const editButton = document.createElement('button');
        editButton.innerText = "edit";
        editButton.addEventListener('click', () => {
            const customEvent = new CustomEvent(matchingModuleType.loadHook, {
              detail: { data: this.controller.getCurrentObject()[key], propertyName: key, config: this.controller.getCollections().configs.game },
              bubbles: true,
              cancelable: true
            });
            document.body.dispatchEvent(customEvent);
        });
      
        valueContainer.appendChild(editButton);
        
        propertyItem.appendChild(valueContainer);
    }
    
    appendSingularTypeSelect(propertyItem, value, matchingTypeSingular, matchingTypePlural) {
        const refContainer = this.createValueContainer();
        const selectElement = document.createElement('select');
        selectElement.className = 'ref-select property-value';
        
        // Determine which type we're referencing
        const typeId = matchingTypePlural ? matchingTypePlural.id : matchingTypeSingular.id;
        const typeSingular = matchingTypePlural ? matchingTypePlural.singular : matchingTypeSingular.singular;
        
        // Add default option
        selectElement.innerHTML = `<option value="">-- Select ${typeSingular} --</option>`;
        
        // Add options for each object of this type
        this.populateSelectOptions(selectElement, typeId);
        
        selectElement.value = value;
        refContainer.appendChild(selectElement);
        propertyItem.appendChild(refContainer);
    }
    
    appendPluralTypeSelect(propertyItem, value, matchingTypePlural) {
        const valueContainer = this.createValueContainer();
        const refContainer = document.createElement('div');
        refContainer.className = 'ref-container';
        
        const selectElement = document.createElement('select');
        selectElement.className = 'ref-select';
        
        // Determine type and add default option
        const typeId = matchingTypePlural.id;
        selectElement.innerHTML = `<option value="">-- Select ${matchingTypePlural.singular} --</option>`;
        
        // Add options for each object of this type
        this.populateSelectOptions(selectElement, typeId);
        
        // Create hidden input for storing the value
        const valueInput = document.createElement('input');
        valueInput.type = 'text';
        valueInput.className = 'property-value';
        
        // Convert value to array if it's a plural reference
        const valueArray = Array.isArray(value) ? value : (value ? [value] : []);
        valueInput.value = JSON.stringify(valueArray);
        
        // Add insert button
        const insertBtn = this.createInsertButton(selectElement, valueInput, matchingTypePlural);
        
        // Assemble the components
        refContainer.appendChild(selectElement);
        refContainer.appendChild(insertBtn);
        valueContainer.appendChild(valueInput);
        valueContainer.appendChild(refContainer);
        propertyItem.appendChild(valueContainer);
    }
    
    populateSelectOptions(selectElement, typeId) {
        const collection = this.controller.getCollections()[typeId] || {};
        
        Object.keys(collection).forEach(objId => {
            const option = document.createElement('option');
            option.value = objId;
            option.textContent = collection[objId].title || objId;
            selectElement.appendChild(option);
        });
    }
    
    createInsertButton(selectElement, valueInput, matchingTypePlural) {
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
        
        return insertBtn;
    }
    
    appendDefaultTextInput(propertyItem, value) {
        const valueContainer = this.createValueContainer();
        const valueInput = document.createElement('input');
        valueInput.type = 'text';
        valueInput.value = typeof value === 'object' ? JSON.stringify(value) : value;
        valueInput.className = 'property-value';
        valueContainer.appendChild(valueInput);
        propertyItem.appendChild(valueContainer);
    }
    
    appendRemoveButton(propertyItem, container) {
        const removeBtn = document.createElement('button');
        removeBtn.textContent = 'Remove';
        removeBtn.className = 'danger';
        removeBtn.addEventListener('click', () => container.removeChild(propertyItem));
        propertyItem.appendChild(removeBtn);
    }
  


    selectObject() {
        
        this.elements.handle.style = "";
         
        this.renderObjectList();
        this.renderEditor();
        this.renderObject();
    }

    readObject() {
  
        const completeObj = {}; 
        
        // Collect custom properties
        this.elements.editor.querySelectorAll('.property-item').forEach(item => {
            const keyInput = item.querySelector('.property-key');
            const valueInput = item.querySelector('.property-value');
            
            if (keyInput.value && valueInput) {
                let value = valueInput.value;
                const matchingTypePlural = this.controller.getCollectionDefs().find(
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

                completeObj[keyInput.value] = value;
            }
        });
        
        return completeObj;
      }
    saveObject() {  
        this.showSuccessMessage('Changes saved!');
        this.renderObjectList();
        this.renderObject();    
    }
      // Event handling setup for modules
    setupModuleEventListeners(modules) {
      Object.entries(modules).forEach(([moduleId, moduleDef]) => {
        if (!moduleDef.saveHook) return;

        document.body.addEventListener(`${moduleDef.saveHook}`, (event) => {
            const result = this.controller.updateObject({[event.detail.propertyName]: event.detail.data});
            this.renderEditor();
            if (result.success && event.detail.refresh != false) {
                this.showSuccessMessage('Changes saved!');
                this.renderObjectList();
                this.renderObject();
            }        
        });

        document.body.addEventListener(`updateCurrentObject`, () => {
          this.controller.selectObject(this.controller.getSelectedObject());
        });
      });
    }
    // Helper method
    parsePropertyValue(key, value) {
        // Handle numeric values
        if (!isNaN(parseFloat(value))) return parseFloat(value);
        
        // Handle booleans
        if (value.toLowerCase() === 'true') return true;
        if (value.toLowerCase() === 'false') return false;
        
        // Handle special object types
        if (key === "render" || key === "tileMap") {
            try { return JSON.parse(value); } 
            catch (e) { console.error("Parse error", e); return value; }
        }
        
        // Handle reference arrays
        const isPluralType = this.controller.getCollectionDefs().some(
            t => t.id.toLowerCase() === key.toLowerCase()
        );
        if (isPluralType) {
            try { return JSON.parse(value || '[]'); }
            catch (e) { return [value].filter(Boolean); }
        }
        
        return value; // Default case
    }

    renderObject() {
        this.controller.dispatchHook('renderObject', arguments);
        
        // Hide all module containers first
        Object.values(this.controller.getCollections().editorModules).forEach(module => {
            const container = document.getElementById(module.container);
            if (container) {
                container.classList.remove('show');
            }
        });
        
        let object = this.controller.getCurrentObject();
        if (!object) {
            this.hideContent();
            return;
        }
        
        // Find the first matching property with a module handler
        let matchingModule = null;
        let matchingProperty = null;
        
        // Check all property modules to find the first matching one
        for (const moduleId in this.controller.getCollections().editorModules) {
            const module = this.controller.getCollections().editorModules[moduleId];
            
            // Check for single propertyName match
            if (module.propertyName && object.hasOwnProperty(module.propertyName)) {
                matchingModule = module;
                matchingProperty = module.propertyName;
                break;
            }
            
            // Check for match in propertyNames array
            if (module.propertyNames) {
                // Safely parse propertyNames if it's a string
                const propertyNames = Array.isArray(module.propertyNames) ? 
                    module.propertyNames : JSON.parse(module.propertyNames);
                
                // Find the first property in the array that exists in the object
                const foundProperty = propertyNames.find(propName => object.hasOwnProperty(propName));
                
                if (foundProperty) {
                    matchingModule = module;
                    matchingProperty = foundProperty;
                    break;
                }
            }
        }
        
        if (!matchingModule) {
            this.hideContent();
            return;
        }
        
        this.showContent();
        
        // Show the matching module's container
        document.getElementById(matchingModule.container).classList.add('show');
        
        requestAnimationFrame(() => {
            // Create and dispatch the event with the matching property
            const customEvent = new CustomEvent(matchingModule.loadHook, {
                detail: { 
                    data: object[matchingProperty], 
                    propertyName: matchingProperty, 
                    config: this.controller.getCollections().configs.game 
                },
                bubbles: true,
                cancelable: true
            });
            
            document.body.dispatchEvent(customEvent);
        });
    }
  
    // UI state management
    showContent() {
        this.controller.dispatchHook('showContent', arguments);
        this.elements.mainContentContainer.classList.remove('hidden');

        if( this.elements.editor.classList.contains('full-height') ) {
          console.log('show', this.lastHeights);
          if(this.lastHeights) {
            this.elements.editor.style.height = this.lastHeights.editor;
            this.elements.mainContentContainer.style.height = this.lastHeights.content;        
          } else {
            this.elements.editor.style.height = '45vh';
            this.elements.mainContentContainer.style.height = '65vh';          
          }
        }
        this.elements.handle.classList.remove('hidden');
        this.elements.editor.classList.remove('full-height');

    }
    hideContent() {
        this.controller.dispatchHook('hideContent', arguments);
        this.elements.mainContentContainer.classList.add('hidden');
        this.elements.handle.classList.add('hidden');
        this.elements.editor.classList.add('full-height');
        this.elements.editor.style.height = '100%';
    }
  
    hideEditor() {
        this.controller.dispatchHook('hideEditor', arguments);
        this.elements.editor.classList.add('hidden');
        this.elements.handle.classList.add('hidden');
        this.elements.mainContentContainer.classList.add('full-height');
        this.elements.mainContentContainer.style.height = '100%';
    }
    
    updateSidebarButtons() {
        this.controller.dispatchHook('updateSidebarButtons', arguments);
      const singularType = this.controller.getSingularType(this.controller.getSelectedType());
      document.getElementById('add-object-btn').textContent = `Add New ${singularType}`;
    }
  
    updateNewObjectModal() {
      const singularType = this.controller.getSingularType(this.controller.getSelectedType());
      const title = singularType.charAt(0).toUpperCase() + singularType.slice(1);
      this.elements.newObjectModal.querySelector('h2').textContent = `Create New ${title}`;
      this.elements.newObjectModal.querySelector('label[for="new-object-id"]').textContent = `${title} ID:`;
      this.elements.newObjectModal.querySelector('#create-object-btn').textContent = `Create ${title}`;
    }
  
    updateDuplicateObjectModal() {
      const singularType = this.controller.getSingularType(this.controller.getSelectedType());
      const title = singularType.charAt(0).toUpperCase() + singularType.slice(1);
      this.elements.duplicateObjectModal.querySelector('h2').textContent = `Duplicate ${title}`;
      this.elements.duplicateObjectModal.querySelector('label[for="duplicate-object-id"]').textContent = `New ${title} ID:`;
      this.elements.duplicateObjectModal.querySelector('#create-duplicate-object-btn').textContent = `Create ${title}`;
    }
  
    // Event listeners setup
    setupEventListeners() {
      this.setupDragResize();
      this.setupProjectEventListeners();
      this.setupModalEventListeners();
      this.setupActionEventListeners();
    }
  
    setupListEventListeners() {
      // Type selection
      document.querySelectorAll('.object-type-item').forEach(item => {
        item.addEventListener('click', () => {
          this.controller.setSelectedType(item.dataset.type);
          this.controller.selectObject(null);
          this.renderObjectList();
          this.updateSidebarButtons();
  
          // Auto-select first object if available
          const objects = this.controller.getCollections()[this.controller.getSelectedType()];
          if (objects && Object.keys(objects).length > 0) {
            this.controller.selectObject(Object.keys(objects)[0]);
          }
        });
      });
  
      // Object selection
      document.querySelectorAll('.object-item').forEach(item => {
        item.addEventListener('click', () => {
          this.controller.selectObject(item.dataset.object);
        });
      });
  
      // Category expand/collapse
      document.querySelectorAll('.category-header').forEach(header => {
        header.addEventListener('click', () => {
          const category = header.textContent.trim();
          const isOpened = this.controller.getExpandedCategories()[category];
          
          // Collapse all except clicked
          for (const cat in this.controller.getExpandedCategories()) {
            this.controller.getExpandedCategories()[cat] = false;
          }
          
          if (!isOpened) {
            this.controller.selectObject(null);
          }
          
          this.controller.getExpandedCategories()[category] = !isOpened;
          this.renderObjectList();
        });
      });
  
      // Type actions
      document.getElementById('add-type-btn')?.addEventListener('click', () => this.showAddTypeModal());
      document.getElementById('remove-type-btn')?.addEventListener('click', () => this.showRemoveTypeModal());
    }
  
    setupEditorEventListeners() {
      document.getElementById('save-object-btn')?.addEventListener('click', () => this.controller.saveObject(this.readObject()));
      document.getElementById('revert-changes-btn')?.addEventListener('click', () => {
        this.selectObject(this.controller.getSelectedObject());
      });
      document.getElementById('delete-object-btn')?.addEventListener('click', () => this.deleteObject());
      document.getElementById('duplicate-object-btn')?.addEventListener('click', () => this.showDuplicateModal());
      
      // Property buttons
      const propsContainer = document.getElementById('custom-properties');
      document.getElementById('add-property-btn')?.addEventListener('click', () => {
        this.addCustomProperty(propsContainer, '', '');
      });
      document.getElementById('add-renderer-btn')?.addEventListener('click', () => {
        this.addCustomProperty(propsContainer, 'render', JSON.stringify(this.controller.model.CONFIG.DEFAULT_RENDER));
      });
      document.getElementById('add-tileMap-btn')?.addEventListener('click', () => {
        this.addCustomProperty(propsContainer, 'tileMap', this.controller.model.CONFIG.DEFAULT_TILEMAP);
      });
      document.getElementById('add-script-btn')?.addEventListener('click', () => {
        this.addCustomProperty(propsContainer, 'script', this.controller.model.CONFIG.DEFAULT_SCRIPT);
      });
    }
    setupModalEventListeners() {
        // New object modal
        document.getElementById('create-object-btn')?.addEventListener('click', () => {
          const id = this.elements.newObjectIdInput.value.trim();
          const name = this.elements.newObjectNameInput.value.trim();
          
          if (!id) {
            alert("Please enter an ID");
            return;
          }
          
          const result = this.controller.createObject(
            this.controller.getSelectedType(),
            id,
            { title: name || id }
          );
          
          if (result.success) {
            this.elements.newObjectModal.classList.remove('show');
            this.controller.selectObject(id);
          } else {
            alert(result.message);
          }
        });
        
        // Duplicate modal
        document.getElementById('create-duplicate-object-btn')?.addEventListener('click', () => {
          const newId = this.elements.duplicateObjectIdInput.value.trim();
          const newName = this.elements.duplicateObjectNameInput.value.trim();
          
          if (!newId) {
            alert("Please enter an ID");
            return;
          }
          
          const result = this.controller.duplicateObject(newId, newName);
          if (result.success) {
            this.elements.duplicateObjectModal.classList.remove('show');
            this.controller.selectObject(newId);
          } else {
            alert(result.message);
          }
        }); 
        document.getElementById('close-duplicate-object-modal')?.addEventListener('click', () => {
            this.elements.duplicateObjectModal.classList.remove('show');
        });
    }

    setupProjectEventListeners() {
  
        // Project selector
        this.elements.projectSelector?.addEventListener('change', (e) => {
          if (e.target.value === "__create_new__") {
            this.showNewProjectModal();
          } else {
            this.elements.app.style.display = 'none';
            this.controller.loadProject(e.target.value);
            window.location.reload();
          }
        });
      
        // Delete project button
        this.elements.deleteProjectBtn?.addEventListener('click', () => {
          if (confirm(`Delete project "${this.controller.getCurrentProject()}"?`)) {
            this.controller.deleteProject(this.controller.getCurrentProject());
            this.elements.app.style.display = 'none';
            this.controller.loadProject("default_project");
            window.location.reload();
          }
        });
            
        const newProjectModal = document.getElementById("new-project-modal");
        const createBtn = document.getElementById("create-project-btn");
        const cancelBtn = document.getElementById("cancel-project-btn");
        
        // Create project handler
        createBtn.addEventListener('click', () => {
          const name = document.getElementById("new-project-name").value.trim();
          if (!name) {
            alert("Please enter a project name");
            return;
          }
          
          const result = this.controller.createProject(name, DEFAULT_PROJECT_CONFIG);
          if (result.success) {
            newProjectModal.classList.remove('show');
            this.controller.loadProject(name);
          } else {
            alert(result.message);
          }
        });
        
        // Cancel button handler
        cancelBtn.addEventListener('click', () => {
          newProjectModal.classList.remove('show');
        });
    }

    setupActionEventListeners() {
        // Launch game button
        this.elements.launchGameBtn?.addEventListener('click', () => {
            window.open("game.html", "_blank");
        });
    }

    setupDragResize() {
        this.isDragging = false;
        this.startY;
        this.startHeightContent;
        this.startHeightEditor;
        this.elements.handle.addEventListener('mousedown', (e) => {
            if( this.elements.editor.classList.contains('full-height') )  {
              return;
            }
            this.isDragging = true;
            this.startY = e.clientY;
            this.startHeightContent = this.elements.mainContentContainer.offsetHeight;
            this.startHeightEditor = this.elements.editor.offsetHeight;
           
            e.preventDefault();
        });
        
        document.addEventListener('mousemove', (e) => {
            if (!this.isDragging) return;  
            if( this.elements.editor.classList.contains('full-height') )  {
              return;
            }      

            const delta = e.clientY + this.elements.handle.offsetHeight / 2 - this.startY;
            const containerHeight = this.elements.handle.parentElement.offsetHeight;
            
            // Calculate new heights with minimum constraints
            let newContentHeight = this.startHeightContent + delta;
            let newEditorHeight = this.startHeightEditor - delta;
            
            // Enforce minimum heights
            if (newContentHeight < 100) {
              newContentHeight = 100;
              newEditorHeight = containerHeight - newContentHeight;
            }
            if (newEditorHeight < 100) {
              newEditorHeight = 100;
              newContentHeight = containerHeight - newEditorHeight;
            }
            this.elements.mainContentContainer.style.height = `${newContentHeight}px`;
            this.elements.editor.style.height = `${newEditorHeight}px`;
        });
        
        document.addEventListener('mouseup', () => {
            if(this.isDragging){
              this.lastHeights = {
                editor: this.elements.editor.style.height,
                content: this.elements.mainContentContainer.style.height,
              }
              console.log(this.lastHeights);
            }
            this.isDragging = false;
        });
      }
  
    // Modal handling
    showAddTypeModal() {
        this.controller.dispatchHook('showAddTypeModal', arguments);
        const modal = document.getElementById('add-type-modal') || this.createAddTypeModal();
        modal.classList.add('show');
    }
  
    createAddTypeModal() {
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
    
        document.getElementById('create-type-btn').addEventListener('click', () => {
            const typeId = document.getElementById('new-type-id').value.trim();
            const typeName = document.getElementById('new-type-name').value.trim();
            const typeSingular = document.getElementById('new-type-singular').value.trim();
            const typeCategory = document.getElementById('new-type-category').value.trim();
    
            if (!typeId) {
            alert('Please enter a Type ID');
            return;
            }
    
            const result = this.controller.createType(typeId, typeName, typeSingular, typeCategory);
            if (result.success) {
            modal.classList.remove('show');
            this.renderObjectList();
            this.updateSidebarButtons();
            } else {
            alert(result.message);
            }
        });
    
        document.getElementById('close-add-type-modal').addEventListener('click', () => {
            modal.classList.remove('show');
        });
    
        return modal;
    }
  
    showNewProjectModal() {
        this.controller.dispatchHook('showNewProjectModal', arguments);
        const modal = document.getElementById('new-project-modal');
        modal.classList.add('show');
    }
    updateProjectSelectors() {
        this.controller.dispatchHook('updateProjectSelectors', arguments);
        const projects = this.controller.listProjects();
        const projectSelector = document.getElementById("project-selector");
        
               // Clear existing options except the "create new" option
          while (this.elements.projectSelector.options.length > 1) {
            projectSelector.remove(1);
          }
        
        projects.forEach(project => {
            const option = document.createElement('option');
            if(project == this.controller.getCurrentProject()){
              option.selected = true;
            }
            option.value = project;
            option.textContent = project;
            projectSelector.appendChild(option);            
        });
    }

    deleteObject() {
        
        this.controller.dispatchHook('deleteObject', arguments);
        if (!this.controller.getSelectedObject()) return;
        
        const singularType = this.controller.getSingularType(this.controller.getSelectedType());
        const objName = this.controller.getCurrentObject().title || this.controller.getSelectedObject();
        
        if (confirm(`Delete ${singularType} "${objName}"?`)) {
          this.controller.deleteObject();
          this.renderObjectList();
        }
    }
    showDuplicateModal() {
        if (!this.controller.getSelectedObject()) return;
        
        this.elements.duplicateObjectIdInput.value = `${this.controller.getSelectedObject()}_copy`;
        this.elements.duplicateObjectNameInput.value = `Copy of ${this.controller.getCurrentObject().title || this.controller.getSelectedObject()}`;
        this.updateDuplicateObjectModal();
        this.elements.duplicateObjectModal.classList.add('show');
    }
    // Utility methods
    showSuccessMessage(message) {
      
      setTimeout(() => {
        const container = this.elements.editor;
        const successMsg = document.createElement('div');
        successMsg.textContent = message;
        successMsg.className = 'success-message';
        container.append(successMsg);

        setTimeout(() => {
          successMsg.remove();
        }, 20000);
      }, 100);
    }

    
    getHookDetail(params, result) {
        return this.controller.getHookDetail(params, result);
    }
    dispatchHook(hookName, detail = {}) {
        this.controller.dispatchHook(hookName, detail);
    }
  }