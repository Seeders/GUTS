export class EditorUI {
    constructor(editorCore, moduleManager, elements) {
      this.core = editorCore;
      this.moduleManager = moduleManager;
      this.elements = elements;
      this.isDragging = false;
      this.dragState = {};
      
      // Initialize UI
      this.setupEventListeners();
      this.renderObjectList();
      this.updateSidebarButtons();
      this.dispatchHook('EditorUI', this.getHookDetail({arguments}));
    }
  
    // Main rendering methods
    renderObjectList() {
        this.dispatchHook('renderObjectList', this.getHookDetail({arguments}));
      const currentTypeDef = this.core.getCollectionDefs().find(
        type => type.id === this.core.state.selectedType && this.core.state.selectedObject
      ) || {};
      
      // Group object types by category
      const categories = {};
      this.core.getCollectionDefs().forEach(type => {
        const category = type.category || 'Uncategorized';
        if (!categories[category]) {
          categories[category] = [];
        }
        categories[category].push(type);
      });
  
      // Initialize expanded categories if needed
      if (!this.core.state.expandedCategories) {
        this.core.state.expandedCategories = {};
        for (const category in categories) {
          this.core.state.expandedCategories[category] = category === currentTypeDef.category;
        }
      }
  
      // Generate HTML
      let html = `<div class="type-selector">`;
      for (const [category, types] of Object.entries(categories)) {
        const isExpanded = this.core.state.expandedCategories[category];
        const isCurrentCategory = category === currentTypeDef.category;
        
        html += `
          <div class="category ${isExpanded || isCurrentCategory ? 'highlight' : ''}">
            <div class="category-header">${category}</div>
            <div class="category-types" style="display: ${isExpanded ? 'block' : 'none'};">`;
        
        types.forEach(type => {
          const isSelected = this.core.state.selectedType === type.id;
          html += `
            <div class="object-type-item ${isSelected ? 'selected' : ''}" data-type="${type.id}">
              ${type.name}
            </div>`;
  
          if (isSelected) {
            html += `<div class="object-list">`;
            Object.keys(this.core.getCollections()[type.id] || {}).forEach(objId => {
              const obj = this.core.getCollections()[type.id][objId];
              html += `
                <div class="object-item ${this.core.state.selectedObject === objId ? 'selected' : ''}" 
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
          ${this.core.getCollectionDefs().length > 1 && !currentTypeDef.isCore ? 
            `<button id="remove-type-btn" class="small-btn danger">Remove Type</button>` : ''}
        </div>`;
  
      this.elements.objectList.innerHTML = html;
      this.setupListEventListeners();
      this.renderEditor();
    }
  
    renderEditor() {
        this.dispatchHook('renderEditor', this.getHookDetail({arguments}));
      if (!this.core.state.selectedObject) {
        const singularType = this.core.getSingularType(this.core.state.selectedType);
        this.elements.editor.innerHTML = `
          <div class="instructions">
            Select a ${singularType} from the sidebar or create a new one to start editing.
          </div>
        `;
        return;
      }
  
      const singularType = this.core.getSingularType(this.core.state.selectedType);
      const currentObject = this.core.getCurrentObject();
  
      this.elements.editor.innerHTML = `
        <h2>Editing: ${currentObject.title || this.core.state.selectedObject} (${singularType})</h2>
        
        <div class="tab-content active" id="advanced-tab">  
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
        this.dispatchHook('renderCustomProperties', this.getHookDetail({arguments}));
      container.innerHTML = '';
  
      Object.entries(object).forEach(([key, value]) => {
        this.addCustomProperty(container, key, value);
      });
    }
  
    addCustomProperty(container, key, value) {
        this.dispatchHook('addCustomProperty', this.getHookDetail({arguments}));
        const propertyItem = document.createElement('div');
        propertyItem.className = 'property-item';
        
        // Key input
        const keyInput = document.createElement('input');
        keyInput.type = 'text';
        keyInput.placeholder = 'Property Name';
        keyInput.value = key;
        keyInput.className = 'property-key';
        propertyItem.appendChild(keyInput);
    
        // Value input (default to text input)
        let valueInput = document.createElement('input');
        valueInput.type = 'text';
        valueInput.value = typeof value === 'object' ? JSON.stringify(value) : value;
        valueInput.className = 'property-value';
        const matchingTypePlural = this.core.getCollectionDefs().find(t => t.id.toLowerCase() === key.toLowerCase());
        const matchingTypeSingular = this.core.getCollectionDefs().find(t => t.singular.replace(/ /g,'').toLowerCase() === key.toLowerCase());
          
        // Special handling for certain property types
        const matchingModuleType = Object.values(this.core.getCollections().propertyModules).find((t) => {
          return t.propertyName && t.propertyName.toLowerCase() === key.toLowerCase()
      });
        if (key === 'color') {
          valueInput.type = 'color';
          valueInput.value = value;
        } else if (typeof value === 'boolean') {
          valueInput = document.createElement('select');
          valueInput.innerHTML = `
            <option value="true" ${value ? 'selected' : ''}>true</option>
            <option value="false" ${!value ? 'selected' : ''}>false</option>
          `;
          valueInput.className = 'property-value';
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
        } 
    
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

            Object.keys(this.core.getCollections()[typeId] || {}).forEach(objId => {
                const option = document.createElement('option');
                option.value = objId;
                option.textContent = this.core.getCollections()[typeId][objId].title || objId;
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
            
            Object.keys(this.core.getCollections()[typeId] || {}).forEach(objId => {
                const option = document.createElement('option');
                option.value = objId;
                option.textContent = this.core.getCollections()[typeId][objId].title || objId;
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
    
        // Remove button
        const removeBtn = document.createElement('button');
        removeBtn.textContent = 'Remove';
        removeBtn.className = 'danger';
        removeBtn.addEventListener('click', () => container.removeChild(propertyItem));
        propertyItem.appendChild(removeBtn);
    
        container.appendChild(propertyItem);
    }
  


    selectObject(obj) {
        this.dispatchHook('selectObject', this.getHookDetail({arguments}));
        this.core.selectObject(obj);
        this.renderObjectList();
        this.renderEditor();
        this.renderObject();
    }

    saveObject() {
        this.dispatchHook('saveObject', this.getHookDetail({arguments}));
  
        if (!this.core.state.selectedObject) return;
        
        const updates = {};
        
        // Process all property inputs
        document.querySelectorAll('.property-item').forEach(item => {
            const keyInput = item.querySelector('.property-key');
            const valueInput = item.querySelector('.property-value');
            
            if (keyInput.value && valueInput) {
                updates[keyInput.value] = this.parsePropertyValue(
                keyInput.value, 
                valueInput.value
                );
            }
        });
        
        // Delegate to core
        const result = this.core.updateObject(updates);
        
        if (result.success) {
            this.showSuccessMessage('Changes saved!');
            this.renderObjectList();
            this.renderObject();
        }
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
        const isPluralType = this.core.getCollectionDefs().some(
            t => t.id.toLowerCase() === key.toLowerCase()
        );
        if (isPluralType) {
            try { return JSON.parse(value || '[]'); }
            catch (e) { return [value].filter(Boolean); }
        }
        
        return value; // Default case
    }

    renderObject() {
        this.dispatchHook('renderObject', this.getHookDetail({arguments}));
        Object.values(this.core.getCollections().propertyModules).forEach(module => {
            const container = document.getElementById(module.container);
            if (container) {
                container.classList.remove('show');
            }
        });
        let object = this.core.getCurrentObject();
        if (!object) {
            this.hideContent();
            return;
        }

        
        // Find the first matching property with a module handler
        const matchingProperty = Object.keys(this.core.getCollections().propertyModules).find(
            (moduleId) => {
                let module = this.core.getCollections().propertyModules[moduleId];
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
        
        const moduleInfo = this.core.getCollections().propertyModules[matchingProperty];
        document.getElementById(moduleInfo.container).classList.add('show');
        
        requestAnimationFrame(() => {
            // Create and dispatch the event
            const customEvent = new CustomEvent(moduleInfo.eventName, {
                detail: { data: object[moduleInfo.propertyName], config: this.core.getCollections().configs.game },
                bubbles: true,
                cancelable: true
            });
            
            document.body.dispatchEvent(customEvent);
        });
    }
  
    // UI state management
    showContent() {
        this.dispatchHook('showContent', this.getHookDetail({arguments}));
        this.elements.mainContentContainer.classList.remove('hidden');
        this.elements.handle.classList.remove('hidden');
        this.elements.editor.classList.remove('full-height');
        this.elements.mainContentContainer.removeAttribute('style');
    }
    hideContent() {
        this.dispatchHook('hideContent', this.getHookDetail({arguments}));
        this.elements.mainContentContainer.classList.add('hidden');
        this.elements.handle.classList.add('hidden');
        this.elements.editor.classList.add('full-height');
        this.elements.editor.style.height = '100%';
    }
  
    hideEditor() {
        this.dispatchHook('hideEditor', this.getHookDetail({arguments}));
        this.elements.editor.classList.add('hidden');
        this.elements.handle.classList.add('hidden');
        this.elements.mainContentContainer.classList.add('full-height');
        this.elements.mainContentContainer.style.height = '100%';
    }
    
    updateSidebarButtons() {
        this.dispatchHook('updateSidebarButtons', this.getHookDetail({arguments}));
      const singularType = this.core.getSingularType(this.core.state.selectedType);
      document.getElementById('add-object-btn').textContent = `Add New ${singularType}`;
    }
  
    updateNewObjectModal() {
      const singularType = this.core.getSingularType(this.core.state.selectedType);
      const title = singularType.charAt(0).toUpperCase() + singularType.slice(1);
      this.elements.newObjectModal.querySelector('h2').textContent = `Create New ${title}`;
      this.elements.newObjectModal.querySelector('label[for="new-object-id"]').textContent = `${title} ID:`;
      this.elements.newObjectModal.querySelector('#create-object-btn').textContent = `Create ${title}`;
    }
  
    updateDuplicateObjectModal() {
      const singularType = this.core.getSingularType(this.core.state.selectedType);
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
          this.core.state.selectedType = item.dataset.type;
          this.core.state.selectedObject = null;
          this.renderObjectList();
          this.updateSidebarButtons();
  
          // Auto-select first object if available
          const objects = this.core.getCollections()[this.core.state.selectedType];
          if (objects && Object.keys(objects).length > 0) {
            this.selectObject(Object.keys(objects)[0]);
          }
        });
      });
  
      // Object selection
      document.querySelectorAll('.object-item').forEach(item => {
        item.addEventListener('click', () => {
          this.selectObject(item.dataset.object);
        });
      });
  
      // Category expand/collapse
      document.querySelectorAll('.category-header').forEach(header => {
        header.addEventListener('click', () => {
          const category = header.textContent.trim();
          const isOpened = this.core.state.expandedCategories[category];
          
          // Collapse all except clicked
          for (const cat in this.core.state.expandedCategories) {
            this.core.state.expandedCategories[cat] = false;
          }
          
          if (!isOpened) {
            this.selectObject(null);
          }
          
          this.core.state.expandedCategories[category] = !isOpened;
          this.renderObjectList();
        });
      });
  
      // Type actions
      document.getElementById('add-type-btn')?.addEventListener('click', () => this.showAddTypeModal());
      document.getElementById('remove-type-btn')?.addEventListener('click', () => this.showRemoveTypeModal());
    }
  
    setupEditorEventListeners() {
      document.getElementById('save-object-btn')?.addEventListener('click', () => this.saveObject());
      document.getElementById('revert-changes-btn')?.addEventListener('click', () => {
        this.selectObject(this.core.state.selectedObject);
      });
      document.getElementById('delete-object-btn')?.addEventListener('click', () => this.deleteObject());
      document.getElementById('duplicate-object-btn')?.addEventListener('click', () => this.showDuplicateModal());
      
      // Property buttons
      const propsContainer = document.getElementById('custom-properties');
      document.getElementById('add-property-btn')?.addEventListener('click', () => {
        this.addCustomProperty(propsContainer, '', '');
      });
      document.getElementById('add-renderer-btn')?.addEventListener('click', () => {
        this.addCustomProperty(propsContainer, 'render', JSON.stringify(this.core.CONFIG.DEFAULT_RENDER));
      });
      document.getElementById('add-tileMap-btn')?.addEventListener('click', () => {
        this.addCustomProperty(propsContainer, 'tileMap', this.core.CONFIG.DEFAULT_TILEMAP);
      });
      document.getElementById('add-script-btn')?.addEventListener('click', () => {
        this.addCustomProperty(propsContainer, 'script', this.core.CONFIG.DEFAULT_SCRIPT);
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
          
          const result = this.core.createObject(
            this.core.state.selectedType,
            id,
            { title: name || id }
          );
          
          if (result.success) {
            this.elements.newObjectModal.classList.remove('show');
            this.selectObject(id);
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
          
          const result = this.core.duplicateObject(newId, newName);
          if (result.success) {
            this.elements.duplicateObjectModal.classList.remove('show');
            this.selectObject(newId);
          } else {
            alert(result.message);
          }
        });
    }

    setupProjectEventListeners() {
        // Project selector
        this.elements.projectSelector?.addEventListener('change', (e) => {
          if (e.target.value === "__create_new__") {
            this.showNewProjectModal();
          } else {
            this.core.loadProject(e.target.value);
          }
        });
      
        // Delete project button
        this.elements.deleteProjectBtn?.addEventListener('click', () => {
          if (confirm(`Delete project "${this.core.state.currentProject}"?`)) {
            this.core.deleteProject(this.core.state.currentProject);
            this.core.loadProject("default_project");
          }
        });
    }

    setupActionEventListeners() {
        // Launch game button
        this.elements.launchGameBtn?.addEventListener('click', () => {
            window.open("game.html", "_blank");
        });

        // Save object button
        document.getElementById('save-object-btn')?.addEventListener('click', () => {
            const properties = {};
            
            document.querySelectorAll('.property-item').forEach(item => {
            const key = item.querySelector('.property-key').value;
            let value = item.querySelector('.property-value').value;
            
            // Parse value types
            if (!isNaN(value)) value = Number(value);
            else if (value === 'true') value = true;
            else if (value === 'false') value = false;
            else if (key === 'render' || key === 'tileMap') {
                try { value = JSON.parse(value); } 
                catch (e) { console.error("Invalid JSON", e); }
            }
            
            if (key) properties[key] = value;
            });
            
            this.core.updateObject(properties);
            this.showSuccessMessage("Changes saved!");
        });
    }

    setupDragResize() {
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
      }
  
    // Modal handling
    showAddTypeModal() {
        this.dispatchHook('showAddTypeModal', this.getHookDetail({arguments}));
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
    
            const result = this.core.createType(typeId, typeName, typeSingular, typeCategory);
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
        this.dispatchHook('showNewProjectModal', this.getHookDetail({arguments}));
        const modal = document.getElementById('new-project-modal') || this.createNewProjectModal();
        modal.classList.add('show');
    }
    updateProjectSelectors() {
        this.dispatchHook('updateProjectSelectors', this.getHookDetail({arguments}));
        const projects = this.core.listProjects();
        const projectSelector = document.getElementById("project-selector");
        
        // Clear existing options
        projectSelector.innerHTML = '';
        
        projects.forEach(project => {
            const option = document.createElement('option');
            option.value = project;
            option.textContent = project;
            projectSelector.appendChild(option);            
        });
    }
    createNewProjectModal() {
        
        this.dispatchHook('createNewProjectModal', this.getHookDetail({arguments}));
        const modal = document.createElement('div');
        modal.className = 'modal';
        modal.id = 'new-project-modal';
        modal.innerHTML = `
            <div class="modal-content">
            <h2>Create New Project</h2>
            <div class="form-group">
                <label for="new-project-name">Project Name:</label>
                <input type="text" id="new-project-name" placeholder="My Awesome Game">
            </div>
            <div class="form-group">
                <label for="project-template">Template:</label>
                <select id="project-template">
                ${Object.keys(this.core.defaultProjects).map(name => `
                    <option value="${name}">${name.replace(/_/g, ' ')}</option>
                `).join('')}
                </select>
            </div>
            <div class="actions">
                <button class="primary" id="confirm-new-project">Create</button>
                <button id="cancel-new-project">Cancel</button>
            </div>
            </div>
        `;
        
        document.body.appendChild(modal);
        
        // Event listeners
        document.getElementById('confirm-new-project').addEventListener('click', () => {
            const name = document.getElementById('new-project-name').value.trim();
            const template = document.getElementById('project-template').value;
            
            if (!name) {
            alert("Please enter a project name");
            return;
            }
            
            this.core.createProject(name, this.core.defaultProjects[template]);
            modal.classList.remove('show');
        });
        
        document.getElementById('cancel-new-project').addEventListener('click', () => {
            modal.classList.remove('show');
        });
        
        return modal;
    }
    deleteObject() {
        
        this.dispatchHook('deleteObject', this.getHookDetail({arguments}));
        if (!this.core.state.selectedObject) return;
        
        const singularType = this.core.getSingularType(this.core.state.selectedType);
        const objName = this.core.getCurrentObject().title || this.core.state.selectedObject;
        
        if (confirm(`Delete ${singularType} "${objName}"?`)) {
          this.core.deleteObject();
          this.renderObjectList();
        }
    }
    showDuplicateModal() {
        if (!this.core.state.selectedObject) return;
        
        this.elements.duplicateObjectIdInput.value = `${this.core.state.selectedObject}_copy`;
        this.elements.duplicateObjectNameInput.value = `Copy of ${this.core.getCurrentObject().title || this.core.state.selectedObject}`;
        this.updateDuplicateObjectModal();
        this.elements.duplicateObjectModal.classList.add('show');
    }
    // Utility methods
    showSuccessMessage(message) {
      const actions = document.querySelector('.actions');
      const successMsg = document.createElement('span');
      successMsg.textContent = message;
      successMsg.className = 'success-message';
      actions.appendChild(successMsg);
      
      setTimeout(() => {
        if (actions.contains(successMsg)) {
          actions.removeChild(successMsg);
        }
      }, 2000);
    }

    
    getHookDetail(params, result) {
        return { selectedType: this.core.state.selectedType, selectedObject: this.core.state.selectedObject, params: params.arguments, result: result };
    }
    dispatchHook(hookName, detail = {}) {
        requestAnimationFrame(() => {
            const customEvent = new CustomEvent(hookName, {
                detail: { ...detail, timestamp: Date.now() }
            });
            document.body.dispatchEvent(customEvent);
        });
    }
  }