class EditorView {
    constructor(controller) {
      this.controller = controller;
      this.elements = controller.elements;
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
      const categoryTitles = this.controller.getCollections().objectTypeCategories || {};
      this.controller.getCollectionDefs().forEach(type => {
        const category = type.objectTypeCategory || 'uncategorized';
        if (!categories[category]) {
          categories[category] = [];
        }
        categories[category].push(type);
      });

      // Helper to get category display title
      const getCategoryTitle = (categoryKey) => {
        const categoryData = categoryTitles[categoryKey];
        return categoryData?.title || categoryKey;
      };

      // Initialize expanded categories if needed
      if (!this.controller.getExpandedCategories()) {
        this.controller.setExpandedCategories({});
        for (const category in categories) {
          this.controller.getExpandedCategories()[category] = category === currentTypeDef.objectTypeCategory;
        }
      }

      // Generate HTML
      let html = `<div class="type-selector">`;
      // Sort categories alphabetically by display title
      const sortedCategories = Object.entries(categories).sort((a, b) =>
        getCategoryTitle(a[0]).localeCompare(getCategoryTitle(b[0]))
      );
      for (const [category, types] of sortedCategories) {
        const isExpanded = this.controller.getExpandedCategories()[category];
        const isCurrentCategory = category === currentTypeDef.objectTypeCategory;
        const categoryTitle = getCategoryTitle(category);

        html += `
          <div class="category ${isExpanded || isCurrentCategory ? 'highlight' : ''}" data-category-key="${category}">
            <div class="category-header">${categoryTitle}</div>
            <div class="category-types" style="display: ${isExpanded ? 'block' : 'none'};">`;

        // Sort types alphabetically by name
        const sortedTypes = types.sort((a, b) => a.name.localeCompare(b.name));
        sortedTypes.forEach(type => {
          const isSelected = this.controller.getSelectedType() === type.id;
          const collection = this.controller.getCollections()[type.id] || {};
          const itemCount = Object.keys(collection).length;

          html += `
            <div class="object-type-item ${isSelected ? 'selected' : ''}" data-type="${type.id}">
              ${type.name} <span class="item-count">(${itemCount})</span>
            </div>`;

          if (isSelected) {
            // Sort objects alphabetically by title for dropdown
            const sortedObjectIds = Object.keys(collection).sort((a, b) => {
              const titleA = (collection[a].title || a).toLowerCase();
              const titleB = (collection[b].title || b).toLowerCase();
              return titleA.localeCompare(titleB);
            });

            html += `<div class="object-selector">
              <select id="object-dropdown" class="object-dropdown">
                <option value="">-- Select ${this.controller.getSingularType(type.id)} --</option>
                ${sortedObjectIds.map(objId => {
                  const obj = collection[objId];
                  const title = obj.title || objId;
                  const selected = this.controller.getSelectedObject() === objId ? 'selected' : '';
                  return `<option value="${objId}" ${selected}>${title}</option>`;
                }).join('')}
              </select>
            </div>`;
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
        <a href="javascript:void(0)" id="togglePropertyVisibility">[ - ]</a>   
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
      if (key.toLowerCase().endsWith('color')) {
          this.appendColorInput(propertyItem, value);
      } else if(key.toLowerCase().endsWith('file')){
          this.appendFileInput(propertyItem, value);
      } else if (typeof value === 'boolean') {
          this.appendBooleanSelect(propertyItem, value);
      } else if (matchingModuleType) {
          this.appendModuleTypeInput(propertyItem, key, value, matchingModuleType, matchingTypeSingular, matchingTypePlural);
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
      
        const hexInput = this.createColorInputGroup(value, "", "", valueContainer, (val) => {}); 

        hexInput.className = 'property-value color-text';
        hexInput.pattern = '^#[0-9A-Fa-f]{6}$';
  
        propertyItem.appendChild(valueContainer);
    }

    appendFileInput(propertyItem, value) {
        const valueContainer = this.createValueContainer();
        
        // Create a container for the file input and display
        const fileContainer = document.createElement('div');
        fileContainer.className = 'file-input-container';
        
        // Create hidden text input to store the file path - make sure it has the right class
        const valueInput = document.createElement('input');
        valueInput.type = 'hidden'; // Use type='hidden' instead of hiding with CSS
        valueInput.value = value || '';
        valueInput.className = 'property-value'; // This is crucial for readObject() to find it
        
        // Create file input for uploading
        const fileInput = document.createElement('input');
        fileInput.type = 'file';
        fileInput.className = 'file-upload-input';
        
        // Create display element to show current file
        const fileDisplay = document.createElement('div');
        fileDisplay.className = 'file-display';
        fileDisplay.textContent = value ? `Current: ${value.split('/').pop()}` : 'No file selected';
        
        // Handle file upload
        fileInput.addEventListener('change', async (e) => {
            e.preventDefault();
            
            const file = e.target.files[0];
            if (!file) {
                console.error('No file selected');
                return;
            }
            
            try {
                // Create FormData and append the file
                const formData = new FormData();
                formData.append('file', file);
                formData.append('projectName', this.controller.getCurrentProject());
                formData.append('objectType', this.controller.getSelectedType());
                
                // Upload the file
                const response = await fetch('/upload-file', {
                    method: 'POST',
                    body: formData
                });
                
                if (!response.ok) {
                    throw new Error(`Upload failed: ${response.statusText}`);
                }
                
                const result = await response.json();
                
                // Update the hidden input with the file path
                valueInput.value = result.filePath;
                
                // Update the display
                fileDisplay.textContent = `Current: ${result.fileName}`;
                
                console.log('File uploaded successfully, path stored:', result.filePath);
                
            } catch (error) {
                console.error('Error uploading file:', error);
                alert(`Upload failed: ${error.message}`);
            }
        });
        
        // Assemble the file input components
        // Put the hidden input first so it's easier to find in readObject()
        valueContainer.appendChild(valueInput);
        fileContainer.appendChild(fileDisplay);
        fileContainer.appendChild(fileInput);
        valueContainer.appendChild(fileContainer);
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
    
    appendModuleTypeInput(propertyItem, key, value, matchingModuleType, matchingTypeSingular, matchingTypePlural) {
        const valueContainer = this.createValueContainer();
        const moduleInputElementType = matchingModuleType.inputElement || 'input';
        const moduleDataType = matchingModuleType.inputDataType;

        let valueInput;

        // If there's a matching type, use a dropdown select instead of text input
        if (matchingTypeSingular || matchingTypePlural) {
            valueInput = document.createElement('select');
            valueInput.className = 'ref-select property-value';

            const typeId = matchingTypePlural ? matchingTypePlural.id : matchingTypeSingular.id;
            const typeSingular = matchingTypePlural ? matchingTypePlural.singular : matchingTypeSingular.singular;

            valueInput.innerHTML = `<option value="">-- Select ${typeSingular} --</option>`;
            this.populateSelectOptions(valueInput, typeId);
            valueInput.value = value || '';
        } else {
            valueInput = document.createElement(moduleInputElementType);
            valueInput.className = 'property-value';

            let processedValue = value;
            if (moduleDataType === 'json') {
              processedValue = JSON.stringify(value);
            } else if (moduleDataType === 'array') {
              processedValue = JSON.stringify(value);
            }

            if (moduleInputElementType === 'textarea') {
                valueInput.textContent = processedValue;
            } else {
                valueInput.value = processedValue;
            }
        }

        valueInput.setAttribute('id', `${key}-value`);
        valueContainer.appendChild(valueInput);
        const editButton = document.createElement('button');
        editButton.innerText = "edit";
        editButton.addEventListener('click', () => {
            // Hide all module containers first
            Object.values(this.controller.getCollections().editorModules).forEach(module => {
                const container = document.getElementById(module.container);
                if (container) {
                    container.classList.remove('show');
                }
            });

            // Show this module's container
            const moduleContainer = document.getElementById(matchingModuleType.container);
            if (moduleContainer) {
                moduleContainer.classList.add('show');
            }

            // Get current value from the input/select element
            const currentValue = valueInput.value;

            const customEvent = new CustomEvent(matchingModuleType.loadHook, {
              detail: { data: currentValue, propertyName: key, config: this.controller.getCollections().configs.game },
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

        // Sort objects alphabetically by title
        const sortedObjectIds = Object.keys(collection).sort((a, b) => {
            const titleA = (collection[a].title || a).toLowerCase();
            const titleB = (collection[b].title || b).toLowerCase();
            return titleA.localeCompare(titleB);
        });

        sortedObjectIds.forEach(objId => {
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
                } else if (value.startsWith('[') && value.endsWith(']')) {
                  value = JSON.parse(value || []);
                }
                let parsed = false;
                const editorModules = this.controller.model.getCollections().editorModules;
                
                for (const [moduleKey, module] of Object.entries(editorModules)) {
                  if (module.propertyName === keyInput.value && module.inputDataType.toLowerCase() === 'json') {                    
                    value = JSON.parse(value || {});
                    parsed = true;
                    break;
                  }
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
            if (module.propertyName) {
                // Find any property that ends with the module's propertyName
                const matchingKey = Object.keys(object).find(key => 
                    key.toLowerCase().endsWith(module.propertyName.toLowerCase())
                );
                if (matchingKey) {
                    matchingModule = module;
                    matchingProperty = matchingKey;
                    break;
                }
            }
            
            // Check for match in propertyNames array
            if (module.propertyNames) {
                // Safely parse propertyNames if it's a string
                const propertyNames = Array.isArray(module.propertyNames) ? 
                    module.propertyNames : JSON.parse(module.propertyNames);
                
                // Find the first property that ends with any of the propertyNames
                const foundProperty = Object.keys(object).find(key => 
                    propertyNames.some(propName => 
                        key.toLowerCase().endsWith(propName.toLowerCase())
                    )
                );
                
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
                    objectData: object,
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

    }
    hideContent() {
        this.controller.dispatchHook('hideContent', arguments);
        this.elements.mainContentContainer.classList.add('hidden');        
    }
  
    hideEditor() {
        this.controller.dispatchHook('hideEditor', arguments);
        this.elements.editor.classList.add('hidden');        
    }
    
    updateSidebarButtons() {
        this.controller.dispatchHook('updateSidebarButtons', arguments);
      const singularType = this.controller.getSingularType(this.controller.getSelectedType());
      document.getElementById('add-object-btn').textContent = `Add New ${singularType}`;
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
            // Sort objects alphabetically and select first
            const sortedIds = Object.keys(objects).sort((a, b) => {
              const titleA = (objects[a].title || a).toLowerCase();
              const titleB = (objects[b].title || b).toLowerCase();
              return titleA.localeCompare(titleB);
            });
            this.controller.selectObject(sortedIds[0]);
          }
        });
      });
  
      // Object selection via dropdown
      document.getElementById('object-dropdown')?.addEventListener('change', (e) => {
        const selectedId = e.target.value;
        if (selectedId) {
          this.controller.selectObject(selectedId);
        } else {
          this.controller.selectObject(null);
          this.renderEditor();
        }
      });
  
      // Category expand/collapse
      document.querySelectorAll('.category-header').forEach(header => {
        header.addEventListener('click', () => {
          // Use the category key from data attribute, not the display title
          const categoryElement = header.closest('.category');
          const category = categoryElement?.dataset.categoryKey || header.textContent.trim();
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
  
      document.getElementById('add-object-btn')?.addEventListener('click', () => this.showAddObjectModal());
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
      document.getElementById('togglePropertyVisibility')?.addEventListener('click', (e) => {
        const btn = e.target;
        const propsContainer = document.getElementById('editor-properties-container');
        const actionsBar = this.elements.editor.querySelector('.actions');
        if(!propsContainer.classList.contains('hide')) {
          propsContainer.classList.add('hide');
          actionsBar.classList.add('hide');
          btn.innerHTML = '[ + ]';
        } else {
          propsContainer.classList.remove('hide');
          actionsBar.classList.remove('hide');
          btn.innerHTML = '[ - ]';
        }
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
            localStorage.setItem("currentProject", e.target.value);
            window.location.reload();
          }
        });
      
        // Delete project button
        this.elements.deleteProjectBtn?.addEventListener('click', () => {
          if (confirm(`Delete project "${this.controller.getCurrentProject()}"?`)) {
            this.controller.deleteProject(this.controller.getCurrentProject());
            this.elements.app.style.display = 'none';
            localStorage.setItem("currentProject", "Hello World");
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
          
          const result = this.controller.createProject(name);
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
            let projectName = this.controller.getCurrentProject();
            window.open(`projects/${projectName}/index.html`, "_blank");
        });
    }
  
    // Modal handling
    showAddObjectModal() {
        this.controller.dispatchHook('showAddObjectModal', arguments);
        const singularType = this.controller.getSingularType(this.controller.getSelectedType());
        const title = singularType.charAt(0).toUpperCase() + singularType.slice(1);
        this.elements.newObjectModal.querySelector('h2').textContent = `Create New ${title}`;
        this.elements.newObjectModal.querySelector('label[for="new-object-id"]').textContent = `${title} ID:`;
        this.elements.newObjectModal.querySelector('#create-object-btn').textContent = `Create ${title}`;
        this.elements.newObjectModal.classList.add('show');
    }
    showAddTypeModal() {
        this.controller.dispatchHook('showAddTypeModal', arguments);
        const modal = document.getElementById('add-type-modal') || this.createAddTypeModal();
        modal.classList.add('show');
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
        
        this.controller.removeSelectedType();
        // Close the modal and update UI
        document.getElementById('remove-type-modal').classList.remove('show');
        this.renderObjectList();
        this.renderEditor();
        this.renderObject();
        this.updateSidebarButtons();
        this.controller.saveProject();
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
                <input type="text" id="new-type-category" placeholder="e.g. prefabs">
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

    createColorInputGroup(value, attributeName, attributeValue, container, callback){
      let valueToUse = value;
      const palette = this.controller.getPalette();
      if(value && value.paletteColor) {
          valueToUse = palette[value.paletteColor];
      }
      const input = document.createElement('input');
      input.type = "text";
      input.value = valueToUse;
      if(attributeName) {
        input.setAttribute(attributeName, attributeValue);
      }

      const colorInput = document.createElement('input');            
      colorInput.type = "color";
      colorInput.value = valueToUse;
      if(attributeName) {
        colorInput.setAttribute(attributeName, attributeValue + '-color');
      }
      
      input.addEventListener('change', (e) => {
          colorInput.value = e.target.value;        
          callback(e.target.value);   
      });
      colorInput.addEventListener('change', (e) => {      
          input.value = e.target.value;       
          callback(e.target.value);          
      });            
      container.appendChild(input);
      container.appendChild(colorInput);

      if(this.controller.getCollections().palettes) {
          const colorSelect = document.createElement('select');
          let colors = [{ name: "From Palette", value: "" }];

          for(let colorName in palette) {
              if(!colorName.toLowerCase().endsWith('color')) continue;
              colors.push({ name: colorName, value: palette[colorName]});
          }
          colors.forEach(color => {
              const option = document.createElement('option');
              option.value = color.value;
              option.textContent = color.name;
              if (valueToUse === color.value) {
                  option.selected = true;
              }
              colorSelect.appendChild(option);
          });
          input.addEventListener('change', (e) => {
              colorSelect.value = e.target.value; 
          });
          colorInput.addEventListener('change', (e) => {      
              colorSelect.value = e.target.value;         
          });   
          colorSelect.addEventListener('change', (e) => {
              input.value = e.target.value;
              colorInput.value = e.target.value;     
              let colorName = e.target.querySelector(`option[value="${e.target.value}"]`).textContent;    
              callback(e.target.value, colorName);   
          });
          container.appendChild(colorSelect);
      }
      return input;
    }

    createTextureInputGroup(value, attributeName, attributeValue, container, callback){

      let input = document.createElement('select');
      if(attributeName) {
        input.setAttribute(attributeName, attributeValue);
      }
      input.addEventListener('change', (e) => {   
        callback(e.target.value);   
      });
      let empty = document.createElement('option');
      empty.value = "";
      empty.textContent = "Select...";
      input.appendChild(empty);
      for(let textureName in this.controller.getCollections().textures){
          const texture = this.controller.getCollections().textures[textureName];
          const option = document.createElement('option');
          option.value = textureName;
          option.textContent = texture.title;

          if( textureName === value) {
              option.selected = true; // Set the current terrain texture as selected
          }
          input.appendChild(option);
      }
      return input;
    }
  }