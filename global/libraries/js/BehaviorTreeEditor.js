/**
 * Behavior Tree Visual Editor
 * Provides a graphical interface for editing behavior tree nodes
 */
class BehaviorTreeEditor {
    constructor(controller, moduleConfig, GUTS) {
        this.controller = controller;
        this.moduleConfig = moduleConfig;
        this.GUTS = GUTS;

        this.currentData = null;
        this.selectedNode = null;
        this.zoom = 1;

        this.setupEventListeners();
    }

    setupEventListeners() {
        // Listen for load hook to render the tree
        document.body.addEventListener(this.moduleConfig.loadHook, (event) => {
            this.loadBehaviorTree(event.detail);
        });

        // Setup UI event listeners
        const container = document.getElementById(this.moduleConfig.container);
        if (!container) return;

        // Zoom controls
        document.getElementById('bt-zoom-in')?.addEventListener('click', () => this.zoom += 0.1);
        document.getElementById('bt-zoom-out')?.addEventListener('click', () => this.zoom -= 0.1);
        document.getElementById('bt-fit')?.addEventListener('click', () => this.fitToView());

        // Validation
        document.getElementById('bt-validate-btn')?.addEventListener('click', () => this.validateTree());

        // Export
        document.getElementById('bt-export-btn')?.addEventListener('click', () => this.exportJSON());

        // Save JSON changes
        document.getElementById('bt-save-json-btn')?.addEventListener('click', () => this.saveJSONChanges());

        // Import from file
        document.getElementById('bt-import-json-btn')?.addEventListener('click', () => this.importJSONFile());

        // Simulation controls
        document.getElementById('bt-simulate-btn')?.addEventListener('click', () => this.runSimulation());
        document.getElementById('bt-reset-sim-btn')?.addEventListener('click', () => this.resetSimulation());
    }

    loadBehaviorTree(detail) {
        this.currentData = detail.data;
        this.propertyName = detail.propertyName;
        Object.values(document.getElementsByClassName('editor-module')).forEach((editor) => {
            editor.classList.remove('show');
        });
        document.getElementById('behavior-tree-editor-container').classList.add('show');
        // Get full object data - either from event detail or from controller
        this.objectData = detail.objectData || this.controller.getCurrentObject();

        // Detect if this is a script-based tree (check for script property or isBehaviorTree flag)
        this.isScriptBased = !!(this.objectData && (this.objectData.script || this.objectData.isBehaviorTree));

        // Update info panel with defensive checks
        const unitTypeEl = document.getElementById('bt-unit-type');
        const descriptionEl = document.getElementById('bt-description');
        const titleEl = document.getElementById('bt-tree-title');

        if (unitTypeEl) {
            unitTypeEl.textContent = (this.objectData && this.objectData.unitType) || 'N/A';
        }
        if (descriptionEl) {
            descriptionEl.textContent = (this.objectData && this.objectData.description) || '';
        }
        if (titleEl) {
            titleEl.textContent = (this.objectData && this.objectData.title) || 'Behavior Tree';
        }

        // Load available actions from collection
        this.loadAvailableActions();

        // Setup simulation (script-based uses mock entities, legacy uses blackboard)
        this.setupSimulationVars();

        // Render the tree
        this.renderTree();

        // Update JSON view
        this.updateJSONView();
    }

    loadAvailableActions() {
        const actionsList = document.getElementById('available-actions');
        if (!actionsList) return;

        actionsList.innerHTML = '';

        const behaviorActions = this.controller.getCollections().behaviorActions || {};

        Object.entries(behaviorActions).forEach(([behaviorActionId, actionData]) => {
            const actionEl = document.createElement('div');
            actionEl.className = 'bt-action-item';
            actionEl.draggable = true;
            actionEl.dataset.behaviorActionId = behaviorActionId;

            actionEl.innerHTML = `
                <div class="bt-action-item__title">${actionData.title}</div>
                <div class="bt-action-item__priority">Priority: ${actionData.priority}</div>
            `;

            actionEl.addEventListener('dragstart', (e) => {
                e.dataTransfer.setData('behaviorActionId', behaviorActionId);
            });

            actionsList.appendChild(actionEl);
        });
    }

    renderTree() {
        const canvas = document.getElementById('bt-tree-canvas');
        if (!canvas) return;

        canvas.innerHTML = '';

        // For script-based trees, show the script source
        if (this.isScriptBased || (this.objectData && this.objectData.isBehaviorTree)) {
            this.renderScriptBasedTree(canvas);
            return;
        }

        // Legacy data-driven tree visualization
        if (!this.currentData || !this.currentData.root) {
            canvas.innerHTML = '<div style=\"padding: 20px; text-align: center; color: #888;\">No behavior tree defined</div>';
            return;
        }

        // Create simple text representation for now
        // TODO: Implement visual node graph
        const treeHTML = this.createTreeHTML(this.currentData);
        canvas.innerHTML = `<div class=\"bt-tree-text\" style=\"padding: 20px; color: #fff; font-family: monospace;\">${treeHTML}</div>`;
    }

    async renderScriptBasedTree(canvas) {
        if (!this.objectData) {
            canvas.innerHTML = '<div style=\"padding: 20px; text-align: center; color: #888;\">No behavior tree data loaded</div>';
            return;
        }

        const scriptName = this.objectData.script || this.controller.getCurrentObjectKey();
        const scriptPath = this.controller.getCurrentPath().replace(/\/[^\/]+$/, `/js/${scriptName}.js`);

        canvas.innerHTML = `
            <div style=\"padding: 20px;\">
                <h3 style=\"color: #fff; margin-top: 0;\">Script-Based Behavior Tree</h3>
                <div style=\"color: #aaa; margin-bottom: 15px;\">
                    <strong>Script:</strong> ${scriptName}<br>
                    <strong>Path:</strong> ${scriptPath}
                </div>
                <div style=\"background: #1e1e1e; padding: 15px; border-radius: 4px; overflow-x: auto;\">
                    <div id=\"bt-script-source\" style=\"color: #d4d4d4; font-family: 'Consolas', 'Monaco', monospace; font-size: 13px; line-height: 1.5; white-space: pre;\">Loading script source...</div>
                </div>
                <div style=\"margin-top: 15px; color: #888; font-size: 12px;\">
                    💡 This behavior tree is defined by its JavaScript class. Use the simulation panel on the right to test different component states.
                </div>
            </div>
        `;

        // Try to load the script source
        try {
            const response = await fetch(scriptPath);
            if (response.ok) {
                const scriptSource = await response.text();
                const sourceEl = document.getElementById('bt-script-source');
                if (sourceEl) {
                    sourceEl.textContent = scriptSource;
                }
            } else {
                const sourceEl = document.getElementById('bt-script-source');
                if (sourceEl) {
                    sourceEl.textContent = `// Could not load script from ${scriptPath}`;
                    sourceEl.style.color = '#ff6b6b';
                }
            }
        } catch (error) {
            const sourceEl = document.getElementById('bt-script-source');
            if (sourceEl) {
                sourceEl.textContent = `// Error loading script: ${error.message}`;
                sourceEl.style.color = '#ff6b6b';
            }
        }
    }

    createTreeHTML(nodes, nodeName = 'root', depth = 0) {
        if (!nodes[nodeName]) return '';

        const node = nodes[nodeName];
        const indent = '&nbsp;&nbsp;'.repeat(depth);
        const typeColors = {
            'selector': '#10b981',
            'sequence': '#f59e0b',
            'condition': '#3b82f6',
            'action': '#ef4444'
        };
        const color = typeColors[node.type] || '#888';

        let html = `${indent}<span style=\"color: ${color}; font-weight: bold;\">[${node.type.toUpperCase()}]</span> ${nodeName}`;

        if (node.action) {
            html += ` <span style=\"color: #888;\">(action: ${node.action})</span>`;
        }
        if (node.condition) {
            html += ` <span style=\"color: #888;\">(${node.condition})</span>`;
        }

        html += '<br/>';

        if (node.children && Array.isArray(node.children)) {
            node.children.forEach(childName => {
                html += this.createTreeHTML(nodes, childName, depth + 1);
            });
        }

        if (node.onSuccess) {
            html += this.createTreeHTML(nodes, node.onSuccess, depth + 1);
        }

        return html;
    }

    validateTree() {
        const output = document.getElementById('bt-validation-output');
        if (!output) return;

        output.classList.add('bt-validation-output--visible');
        output.innerHTML = '';

        const errors = [];

        // For script-based trees, validate differently
        if (this.isScriptBased || (this.objectData && this.objectData.isBehaviorTree)) {
            this.validateScriptBasedTree(errors);
        } else {
            // Legacy data-driven validation
            if (!this.currentData) {
                errors.push('No tree data loaded');
            } else {
                // Check for root node
                if (!this.currentData.root) {
                    errors.push('Missing root node');
                } else {
                    // Validate tree structure
                    this.validateNode(this.currentData, 'root', errors);
                }
            }
        }

        if (errors.length === 0) {
            output.innerHTML = '<div class=\"bt-validation-success\">✓ Tree structure is valid</div>';
        } else {
            errors.forEach(error => {
                output.innerHTML += `<div class=\"bt-validation-error\">✗ ${error}</div>`;
            });
        }
    }

    validateScriptBasedTree(errors) {
        if (!this.objectData) {
            errors.push('No behavior tree data loaded');
            return;
        }

        // Check for required properties
        if (!this.objectData.title) {
            errors.push('Missing title property');
        }

        if (!this.objectData.unitType) {
            errors.push('Missing unitType property');
        }

        // Check if script class exists
        const scriptName = this.objectData.script || this.controller.getCurrentObjectKey();
        if (scriptName) {
            const className = scriptName.charAt(0).toUpperCase() + scriptName.slice(1) + 'BehaviorTree';
            if (typeof window[className] === 'undefined' &&
                (!this.GUTS.behaviorTrees || !this.GUTS.behaviorTrees[scriptName])) {
                errors.push(`Script class ${className} not found. Make sure the script is loaded.`);
            }
        } else {
            errors.push('Missing script reference');
        }

        // Check mockEntity structure
        if (!this.objectData.mockEntity) {
            errors.push('Missing mockEntity property for simulation');
        } else {
            // Validate that mockEntity has at least some component data
            if (Object.keys(this.objectData.mockEntity).length === 0) {
                errors.push('mockEntity has no component data');
            }
        }
    }

    validateNode(nodes, nodeName, errors, visited = new Set()) {
        if (visited.has(nodeName)) {
            errors.push(`Circular reference detected: ${nodeName}`);
            return;
        }

        visited.add(nodeName);

        const node = nodes[nodeName];
        if (!node) {
            errors.push(`Node not found: ${nodeName}`);
            return;
        }

        // Validate node type
        const validTypes = ['selector', 'sequence', 'condition', 'action'];
        if (!validTypes.includes(node.type)) {
            errors.push(`Invalid node type "${node.type}" for node: ${nodeName}`);
        }

        // Validate children
        if (node.children) {
            if (!Array.isArray(node.children)) {
                errors.push(`Children must be an array for node: ${nodeName}`);
            } else {
                node.children.forEach(childName => {
                    this.validateNode(nodes, childName, errors, new Set(visited));
                });
            }
        }

        // Validate onSuccess
        if (node.onSuccess) {
            this.validateNode(nodes, node.onSuccess, errors, new Set(visited));
        }

        // Validate action nodes have action specified
        if (node.type === 'action' && !node.action) {
            errors.push(`Action node missing action property: ${nodeName}`);
        }

        // Validate condition nodes have condition specified
        if (node.type === 'condition' && !node.condition) {
            errors.push(`Condition node missing condition property: ${nodeName}`);
        }
    }

    updateJSONView() {
        const jsonView = document.getElementById('bt-json-view');
        if (!jsonView) return;

        try {
            jsonView.value = JSON.stringify(this.currentData, null, 2);
        } catch (e) {
            jsonView.value = 'Error displaying JSON: ' + e.message;
        }
    }

    exportJSON() {
        const jsonStr = JSON.stringify(this.currentData, null, 2);
        const blob = new Blob([jsonStr], { type: 'application/json' });
        const url = URL.createObjectURL(blob);

        const a = document.createElement('a');
        a.href = url;
        const unitType = (this.objectData && this.objectData.unitType) || 'tree';
        a.download = `${unitType}_behavior_tree.json`;
        a.click();

        URL.revokeObjectURL(url);
    }

    saveJSONChanges() {
        const jsonView = document.getElementById('bt-json-view');
        if (!jsonView) return;

        try {
            const newData = JSON.parse(jsonView.value);
            this.currentData = newData;
            this.renderTree();
            this.save();
            alert('Changes saved successfully!');
        } catch (e) {
            alert('Invalid JSON: ' + e.message);
        }
    }

    importJSONFile() {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = 'application/json';

        input.onchange = (e) => {
            const file = e.target.files[0];
            if (!file) return;

            const reader = new FileReader();
            reader.onload = (event) => {
                try {
                    const newData = JSON.parse(event.target.result);
                    this.currentData = newData;
                    this.updateJSONView();
                    this.renderTree();
                    alert('JSON imported successfully! Click "Save Changes" to apply.');
                } catch (error) {
                    alert('Error importing JSON: ' + error.message);
                }
            };
            reader.readAsText(file);
        };

        input.click();
    }

    fitToView() {
        this.zoom = 1;
        const canvas = document.getElementById('bt-tree-canvas');
        if (canvas) {
            canvas.scrollTop = 0;
            canvas.scrollLeft = 0;
        }
    }

    save() {
        // Dispatch save event to EditorController
        const saveEvent = new CustomEvent(this.moduleConfig.saveHook, {
            detail: {
                propertyName: this.propertyName,
                data: this.currentData
            },
            bubbles: true,
            cancelable: true
        });
        document.body.dispatchEvent(saveEvent);
    }

    // Simulation methods
    setupSimulationVars() {
        const varsContainer = document.getElementById('bt-simulation-vars');
        if (!varsContainer) return;

        // Use different approaches for script-based vs data-driven trees
        if (this.isScriptBased) {
            this.setupScriptBasedSimulation(varsContainer);
        } else {
            this.setupDataDrivenSimulation(varsContainer);
        }
    }

    setupScriptBasedSimulation(varsContainer) {
        // Initialize mock game context
        if (!this.mockGame && typeof GUTS !== 'undefined' && GUTS.MockGameContext) {
            this.mockGame = GUTS.MockGameContext.fromBehaviorTreeData(this.objectData);
        }

        if (!this.mockGame) {
            console.warn('MockGameContext not available');
            return;
        }

        varsContainer.innerHTML = '';

        // Add header and entity management controls
        const headerDiv = document.createElement('div');
        headerDiv.style.marginBottom = '12px';
        headerDiv.innerHTML = `
            <h4 style="font-size: 12px; color: #aaa; margin: 0 0 8px 0;">Mock Entities</h4>
            <button id="bt-add-entity-btn" style="padding: 4px 8px; font-size: 11px; background: #22c55e; border: none; color: white; border-radius: 3px; cursor: pointer;">+ Add Entity</button>
        `;
        varsContainer.appendChild(headerDiv);

        // Container for all entities
        const entitiesContainer = document.createElement('div');
        entitiesContainer.id = 'bt-entities-container';
        varsContainer.appendChild(entitiesContainer);

        // Render all entities
        this.renderAllEntities(entitiesContainer);

        // Add entity button handler
        const addBtn = document.getElementById('bt-add-entity-btn');
        if (addBtn) {
            addBtn.addEventListener('click', () => {
                const newId = `entity-${Date.now()}`;
                this.mockGame.addEntity(newId, {
                    POSITION: { x: 0, z: 0 },
                    TEAM: { team: 1 }
                }, `Entity ${this.mockGame.getAllEntityIds().length}`);
                this.renderAllEntities(entitiesContainer);
            });
        }
    }

    renderAllEntities(container) {
        container.innerHTML = '';

        const entities = this.mockGame.getAllEntities();

        entities.forEach(entity => {
            this.createEntityEditor(container, entity);
        });
    }

    createEntityEditor(container, entity) {
        const entityCard = document.createElement('div');
        entityCard.style.marginBottom = '16px';
        entityCard.style.border = '1px solid #444';
        entityCard.style.borderRadius = '6px';
        entityCard.style.padding = '10px';
        entityCard.style.backgroundColor = '#1a1a1a';

        // Entity header with label and remove button
        const headerDiv = document.createElement('div');
        headerDiv.style.display = 'flex';
        headerDiv.style.justifyContent = 'space-between';
        headerDiv.style.alignItems = 'center';
        headerDiv.style.marginBottom = '10px';

        const labelInput = document.createElement('input');
        labelInput.type = 'text';
        labelInput.value = entity.label;
        labelInput.style.flex = '1';
        labelInput.style.padding = '4px 8px';
        labelInput.style.fontSize = '12px';
        labelInput.style.fontWeight = '600';
        labelInput.style.backgroundColor = '#2a2a2a';
        labelInput.style.border = '1px solid #444';
        labelInput.style.color = '#fff';
        labelInput.style.borderRadius = '3px';
        labelInput.addEventListener('change', () => {
            this.mockGame.updateEntityLabel(entity.id, labelInput.value);
        });

        const removeBtn = document.createElement('button');
        removeBtn.textContent = '×';
        removeBtn.style.marginLeft = '8px';
        removeBtn.style.padding = '2px 8px';
        removeBtn.style.fontSize = '16px';
        removeBtn.style.background = '#ef4444';
        removeBtn.style.border = 'none';
        removeBtn.style.color = 'white';
        removeBtn.style.borderRadius = '3px';
        removeBtn.style.cursor = 'pointer';
        removeBtn.addEventListener('click', () => {
            if (this.mockGame.getAllEntityIds().length <= 1) {
                alert('Cannot remove the last entity');
                return;
            }
            this.mockGame.removeEntity(entity.id);
            const entitiesContainer = document.getElementById('bt-entities-container');
            if (entitiesContainer) {
                this.renderAllEntities(entitiesContainer);
            }
        });

        headerDiv.appendChild(labelInput);
        headerDiv.appendChild(removeBtn);
        entityCard.appendChild(headerDiv);

        // Entity ID display
        const idDiv = document.createElement('div');
        idDiv.textContent = `ID: ${entity.id}`;
        idDiv.style.fontSize = '10px';
        idDiv.style.color = '#666';
        idDiv.style.marginBottom = '10px';
        entityCard.appendChild(idDiv);

        // Components section
        const componentsDiv = document.createElement('div');

        for (const [componentType, componentData] of entity.components.entries()) {
            this.createComponentEditor(componentsDiv, entity.id, componentType, componentData);
        }

        // Add component button
        const addComponentBtn = document.createElement('button');
        addComponentBtn.textContent = '+ Add Component';
        addComponentBtn.style.marginTop = '8px';
        addComponentBtn.style.padding = '4px 8px';
        addComponentBtn.style.fontSize = '10px';
        addComponentBtn.style.background = '#3b82f6';
        addComponentBtn.style.border = 'none';
        addComponentBtn.style.color = 'white';
        addComponentBtn.style.borderRadius = '3px';
        addComponentBtn.style.cursor = 'pointer';
        addComponentBtn.addEventListener('click', () => {
            this.showAddComponentDialog(entity.id);
        });

        componentsDiv.appendChild(addComponentBtn);
        entityCard.appendChild(componentsDiv);

        container.appendChild(entityCard);
    }

    showAddComponentDialog(entityId) {
        const availableTypes = Object.keys(this.mockGame.componentTypes).filter(type => {
            return !this.mockGame.getComponent(entityId, type);
        });

        if (availableTypes.length === 0) {
            alert('All component types are already added');
            return;
        }

        const componentType = prompt(`Add component:\n\n${availableTypes.join('\n')}\n\nEnter component type:`);
        if (componentType && this.mockGame.componentTypes[componentType.toUpperCase()]) {
            const normalizedType = componentType.toUpperCase();
            this.mockGame.setComponent(entityId, normalizedType, {});
            const entitiesContainer = document.getElementById('bt-entities-container');
            if (entitiesContainer) {
                this.renderAllEntities(entitiesContainer);
            }
        } else if (componentType) {
            alert('Invalid component type');
        }
    }

    setupDataDrivenSimulation(varsContainer) {
        // Legacy blackboard-based simulation
        if (!this.currentData) return;

        // Initialize blackboard if not exists
        if (!this.blackboard && typeof GUTS !== 'undefined' && GUTS.BehaviorTreeBlackboard) {
            this.blackboard = new GUTS.BehaviorTreeBlackboard();
        }

        if (!this.blackboard) {
            console.warn('BehaviorTreeBlackboard not available');
            return;
        }

        // Extract all variables from the tree
        const variables = GUTS.BehaviorTreeBlackboard.extractVariables(this.currentData);

        varsContainer.innerHTML = '';

        // Create preset variable configurations for common patterns
        this.createCommonVariablePresets(variables);

        // Create UI controls for each variable
        const sortedVars = Array.from(variables.entries()).sort((a, b) => {
            // Sort: objects first, then primitives
            if (a[1] === 'object' && b[1] !== 'object') return -1;
            if (a[1] !== 'object' && b[1] === 'object') return 1;
            return a[0].localeCompare(b[0]);
        });

        sortedVars.forEach(([varName, varType]) => {
            // Skip nested paths for objects (we'll edit them as objects)
            if (varName.includes('.')) return;

            this.createVariableInput(varsContainer, varName, varType);
        });
    }

    createComponentEditor(container, entityId, componentType, componentData) {
        const detailsEl = document.createElement('details');
        detailsEl.open = true;
        detailsEl.style.marginBottom = '12px';
        detailsEl.style.border = '1px solid #333';
        detailsEl.style.borderRadius = '4px';
        detailsEl.style.padding = '8px';

        const summary = document.createElement('summary');
        summary.textContent = componentType;
        summary.style.cursor = 'pointer';
        summary.style.fontWeight = '600';
        summary.style.fontSize = '11px';
        summary.style.color = '#6366f1';
        summary.style.marginBottom = '8px';
        detailsEl.appendChild(summary);

        const propsContainer = document.createElement('div');
        propsContainer.style.marginLeft = '8px';

        // Create inputs for each property
        for (const [key, value] of Object.entries(componentData)) {
            this.createComponentPropertyInput(propsContainer, entityId, componentType, key, value);
        }

        // Add property button
        const addPropBtn = document.createElement('button');
        addPropBtn.textContent = '+ Add Property';
        addPropBtn.style.marginTop = '4px';
        addPropBtn.style.padding = '2px 6px';
        addPropBtn.style.fontSize = '9px';
        addPropBtn.style.background = '#8b5cf6';
        addPropBtn.style.border = 'none';
        addPropBtn.style.color = 'white';
        addPropBtn.style.borderRadius = '2px';
        addPropBtn.style.cursor = 'pointer';
        addPropBtn.addEventListener('click', () => {
            const propName = prompt('Enter property name:');
            if (propName) {
                this.mockGame.updateComponent(entityId, componentType, propName, null);
                const entitiesContainer = document.getElementById('bt-entities-container');
                if (entitiesContainer) {
                    this.renderAllEntities(entitiesContainer);
                }
            }
        });
        propsContainer.appendChild(addPropBtn);

        detailsEl.appendChild(propsContainer);
        container.appendChild(detailsEl);
    }

    createComponentPropertyInput(container, entityId, componentType, propertyName, value) {
        const propDiv = document.createElement('div');
        propDiv.style.marginBottom = '8px';

        const label = document.createElement('label');
        label.className = 'bt-sim-var__label';
        label.textContent = propertyName;
        propDiv.appendChild(label);

        // Create appropriate input based on value type
        if (value === null || value === undefined) {
            // Null/undefined - use text input with "null" placeholder
            const input = document.createElement('input');
            input.type = 'text';
            input.placeholder = 'null';
            input.style.width = '100%';
            input.addEventListener('change', (e) => {
                let newValue = e.target.value;
                if (newValue === '' || newValue === 'null') {
                    newValue = null;
                } else {
                    try {
                        newValue = JSON.parse(newValue);
                    } catch (err) {
                        // Keep as string
                    }
                }
                this.mockGame.updateComponent(entityId, componentType, propertyName, newValue);
                this.runSimulation();
            });
            propDiv.appendChild(input);
        } else if (typeof value === 'boolean') {
            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.checked = value;
            checkbox.addEventListener('change', (e) => {
                this.mockGame.updateComponent(entityId, componentType, propertyName, e.target.checked);
                this.runSimulation();
            });
            propDiv.appendChild(checkbox);
        } else if (typeof value === 'number') {
            const input = document.createElement('input');
            input.type = 'number';
            input.value = value;
            input.style.width = '100%';
            input.addEventListener('change', (e) => {
                this.mockGame.updateComponent(entityId, componentType, propertyName, parseFloat(e.target.value));
                this.runSimulation();
            });
            propDiv.appendChild(input);
        } else if (typeof value === 'string') {
            const input = document.createElement('input');
            input.type = 'text';
            input.value = value;
            input.style.width = '100%';
            input.addEventListener('change', (e) => {
                this.mockGame.updateComponent(entityId, componentType, propertyName, e.target.value);
                this.runSimulation();
            });
            propDiv.appendChild(input);
        } else if (typeof value === 'object') {
            // Object - use JSON textarea
            const textarea = document.createElement('textarea');
            textarea.value = JSON.stringify(value, null, 2);
            textarea.style.width = '100%';
            textarea.style.minHeight = '60px';
            textarea.style.fontFamily = 'monospace';
            textarea.style.fontSize = '11px';
            textarea.style.background = '#0a0a0a';
            textarea.style.border = '1px solid #333';
            textarea.style.borderRadius = '4px';
            textarea.style.padding = '4px';
            textarea.style.color = '#fff';
            textarea.addEventListener('change', (e) => {
                try {
                    const newValue = JSON.parse(e.target.value);
                    this.mockGame.updateComponent(entityId, componentType, propertyName, newValue);
                    this.runSimulation();
                } catch (err) {
                    alert('Invalid JSON: ' + err.message);
                }
            });
            propDiv.appendChild(textarea);
        }

        container.appendChild(propDiv);
    }

    createCommonVariablePresets(variables) {
        // Set up common default values for known patterns
        const defaults = {
            'hasPlayerOrder': { type: 'boolean', value: false },
            'hasEnemiesInRange': { type: 'boolean', value: false },
            'hasAssignedBuilding': { type: 'boolean', value: false },
            'hasNearbyMine': { type: 'boolean', value: false },
            'playerOrder': {
                type: 'object',
                value: {
                    action: 'MOVE_TO',
                    target: { x: 100, z: 100 }
                }
            },
            'nearestEnemy': {
                type: 'object',
                value: { x: 200, z: 200 }
            }
        };

        for (const [varName, config] of Object.entries(defaults)) {
            if (variables.has(varName) && !this.blackboard.has(varName)) {
                this.blackboard.set(varName, config.value, config.type);

                // For objects, also set nested properties
                if (config.type === 'object') {
                    for (const [key, value] of Object.entries(config.value)) {
                        const nestedPath = `${varName}.${key}`;
                        const nestedType = typeof value === 'object' ? 'object' : typeof value;
                        this.blackboard.set(nestedPath, value, nestedType);
                    }
                }
            }
        }
    }

    createVariableInput(container, varName, varType) {
        const varDiv = document.createElement('div');
        varDiv.className = 'bt-sim-var';

        const label = document.createElement('label');
        label.className = 'bt-sim-var__label';
        label.textContent = varName;

        varDiv.appendChild(label);

        // Get current value or create default
        let currentValue = this.blackboard.get(varName);
        if (currentValue === undefined) {
            currentValue = GUTS.BehaviorTreeBlackboard.getDefaultValue(varType);
            this.blackboard.set(varName, currentValue, varType);
        }

        // Create appropriate input based on type
        if (varType === 'boolean') {
            this.createBooleanInput(varDiv, varName, currentValue);
        } else if (varType === 'object') {
            this.createObjectInput(varDiv, varName, currentValue);
        } else if (varType === 'string') {
            this.createStringInput(varDiv, varName, currentValue);
        } else if (varType === 'number') {
            this.createNumberInput(varDiv, varName, currentValue);
        } else {
            this.createTextInput(varDiv, varName, currentValue);
        }

        container.appendChild(varDiv);
    }

    createBooleanInput(container, varName, currentValue) {
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.checked = currentValue || false;
        checkbox.addEventListener('change', (e) => {
            this.blackboard.set(varName, e.target.checked, 'boolean');
            this.runSimulation();
        });
        container.appendChild(checkbox);
    }

    createStringInput(container, varName, currentValue) {
        const input = document.createElement('input');
        input.type = 'text';
        input.value = currentValue || '';
        input.addEventListener('change', (e) => {
            this.blackboard.set(varName, e.target.value, 'string');
            this.runSimulation();
        });
        container.appendChild(input);
    }

    createNumberInput(container, varName, currentValue) {
        const input = document.createElement('input');
        input.type = 'number';
        input.value = currentValue || 0;
        input.addEventListener('change', (e) => {
            this.blackboard.set(varName, parseFloat(e.target.value), 'number');
            this.runSimulation();
        });
        container.appendChild(input);
    }

    createTextInput(container, varName, currentValue) {
        const input = document.createElement('input');
        input.type = 'text';
        input.value = typeof currentValue === 'object' ? JSON.stringify(currentValue) : (currentValue || '');
        input.addEventListener('change', (e) => {
            try {
                const value = JSON.parse(e.target.value);
                this.blackboard.set(varName, value);
            } catch (err) {
                this.blackboard.set(varName, e.target.value);
            }
            this.runSimulation();
        });
        container.appendChild(input);
    }

    createObjectInput(container, varName, currentValue) {
        const detailsEl = document.createElement('details');
        detailsEl.style.marginTop = '4px';

        const summary = document.createElement('summary');
        summary.textContent = 'Edit properties';
        summary.style.cursor = 'pointer';
        summary.style.fontSize = '11px';
        summary.style.color = '#6366f1';
        detailsEl.appendChild(summary);

        const objContainer = document.createElement('div');
        objContainer.style.marginLeft = '8px';
        objContainer.style.marginTop = '4px';

        // Create inputs for object properties
        const value = currentValue || {};
        for (const [key, val] of Object.entries(value)) {
            const propDiv = document.createElement('div');
            propDiv.style.marginBottom = '4px';

            const propLabel = document.createElement('label');
            propLabel.className = 'bt-sim-var__label';
            propLabel.textContent = key;
            propLabel.style.fontSize = '10px';
            propDiv.appendChild(propLabel);

            const propInput = document.createElement('input');
            propInput.type = typeof val === 'number' ? 'number' : 'text';
            propInput.value = typeof val === 'object' ? JSON.stringify(val) : val;
            propInput.style.width = '100%';
            propInput.addEventListener('change', (e) => {
                const newValue = { ...this.blackboard.get(varName) };
                try {
                    newValue[key] = propInput.type === 'number' ? parseFloat(e.target.value) :
                                    (e.target.value.startsWith('{') ? JSON.parse(e.target.value) : e.target.value);
                } catch (err) {
                    newValue[key] = e.target.value;
                }
                this.blackboard.set(varName, newValue, 'object');

                // Also update nested path
                const nestedPath = `${varName}.${key}`;
                this.blackboard.set(nestedPath, newValue[key]);

                this.runSimulation();
            });
            propDiv.appendChild(propInput);
            objContainer.appendChild(propDiv);
        }

        detailsEl.appendChild(objContainer);
        container.appendChild(detailsEl);
    }

    extractConditions(nodes) {
        const conditions = new Set();

        const traverse = (nodeName) => {
            const node = nodes[nodeName];
            if (!node) return;

            if (node.type === 'condition' && node.condition) {
                // Extract simple condition names
                const cond = node.condition.replace(/[^\w]/g, '');
                conditions.add(node.condition);
            }

            if (node.children && Array.isArray(node.children)) {
                node.children.forEach(child => traverse(child));
            }
            if (node.onSuccess) {
                traverse(node.onSuccess);
            }
        };

        if (nodes.root) {
            traverse('root');
        }

        return Array.from(conditions);
    }

    runSimulation() {
        if (!GUTS || !GUTS.BehaviorTreeProcessor) return;

        if (this.isScriptBased) {
            // Use mock game context with actual script class
            if (!this.mockGame) return;

            // Evaluate behavior tree for each entity
            const results = [];
            const entityIds = this.mockGame.getAllEntityIds();

            entityIds.forEach(entityId => {
                const entity = this.mockGame.getEntity(entityId);
                const result = GUTS.BehaviorTreeProcessor.evaluate(
                    this.objectData,
                    this.mockGame,
                    'root',
                    entityId
                );
                results.push({
                    entityId,
                    entity,
                    result
                });
            });

            this.displaySimResult(results);
        } else {
            // Use blackboard with data-driven evaluation (single result)
            if (!this.currentData || !this.currentData.root || !this.blackboard) return;
            const result = GUTS.BehaviorTreeProcessor.evaluate(this.currentData, this.blackboard);
            this.displaySimResult([{ result }]);
            this.highlightActivePath(result.activePath);
        }
    }

    displaySimResult(results) {
        const resultDiv = document.getElementById('bt-sim-result');
        if (!resultDiv) return;

        resultDiv.style.display = 'block';
        resultDiv.innerHTML = '<h4 style="font-size: 12px; color: #aaa; margin: 0 0 8px 0;">Simulation Results</h4>';

        if (!results || results.length === 0) {
            resultDiv.innerHTML += `<div style="color: #888;">No results</div>`;
            return;
        }

        results.forEach(({ entityId, entity, result }) => {
            const entityCard = document.createElement('div');
            entityCard.style.marginBottom = '12px';
            entityCard.style.padding = '8px';
            entityCard.style.border = '1px solid #333';
            entityCard.style.borderRadius = '4px';
            entityCard.style.backgroundColor = '#1a1a1a';

            if (entity) {
                const entityHeader = document.createElement('div');
                entityHeader.style.fontSize = '11px';
                entityHeader.style.fontWeight = '600';
                entityHeader.style.color = '#fff';
                entityHeader.style.marginBottom = '6px';
                entityHeader.textContent = entity.label || entityId;
                entityCard.appendChild(entityHeader);

                const entityIdDiv = document.createElement('div');
                entityIdDiv.style.fontSize = '9px';
                entityIdDiv.style.color = '#666';
                entityIdDiv.style.marginBottom = '6px';
                entityIdDiv.textContent = `ID: ${entityId}`;
                entityCard.appendChild(entityIdDiv);
            }

            const resultContent = document.createElement('div');
            resultContent.style.fontSize = '11px';

            if (result && result.action) {
                resultContent.innerHTML = `
                    <div style="color: #22c55e;"><strong>✓ Action Selected</strong></div>
                    <div style="margin-top: 4px;"><strong>Action:</strong> ${result.action}</div>
                    ${result.target ? `<div><strong>Target:</strong> ${JSON.stringify(result.target)}</div>` : ''}
                    ${result.priority !== undefined ? `<div><strong>Priority:</strong> ${result.priority}</div>` : ''}
                    ${result.data ? `<div><strong>Data:</strong> ${JSON.stringify(result.data)}</div>` : ''}
                `;
            } else {
                resultContent.innerHTML = `<div style="color: #888;">✗ No action (all conditions failed)</div>`;
            }

            entityCard.appendChild(resultContent);
            resultDiv.appendChild(entityCard);
        });
    }

    highlightActivePath(activePath = []) {
        // Clear previous highlights
        this.renderTree();

        if (!activePath || activePath.length === 0) return;

        // In the text visualization, we'll wrap active nodes with highlighting
        const canvas = document.getElementById('bt-tree-canvas');
        if (!canvas) return;

        let html = canvas.innerHTML;

        // Highlight each node in the active path
        activePath.forEach(nodeName => {
            // Find and highlight the node name in the HTML
            const regex = new RegExp(`(<span[^>]*>\\[[^\\]]+\\]</span>\\s+)(${nodeName})(\\s|<)`, 'g');
            html = html.replace(regex, (match, prefix, name, suffix) => {
                return `${prefix}<span class="bt-node-active">${name}</span>${suffix}`;
            });
        });

        canvas.innerHTML = html;
    }

    resetSimulation() {
        if (this.isScriptBased) {
            // Reset mock game context to original state
            if (GUTS && GUTS.MockGameContext) {
                this.mockGame = GUTS.MockGameContext.fromBehaviorTreeData(this.objectData);
            }
        } else {
            // Clear the blackboard
            if (this.blackboard) {
                this.blackboard.clear();
            }
        }

        // Reset UI
        this.setupSimulationVars();

        // Clear result
        const resultDiv = document.getElementById('bt-sim-result');
        if (resultDiv) {
            resultDiv.style.display = 'none';
        }

        // Clear highlighting
        this.renderTree();
    }
}
