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

        // Detect if this is a script-based tree
        this.isScriptBased = !!(this.objectData && this.objectData.script);

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

        if (!this.currentData || !this.currentData.root) {
            canvas.innerHTML = '<div style=\"padding: 20px; text-align: center; color: #888;\">No behavior tree defined</div>';
            return;
        }

        // Create simple text representation for now
        // TODO: Implement visual node graph
        const treeHTML = this.createTreeHTML(this.currentData);
        canvas.innerHTML = `<div class=\"bt-tree-text\" style=\"padding: 20px; color: #fff; font-family: monospace;\">${treeHTML}</div>`;
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

        if (errors.length === 0) {
            output.innerHTML = '<div class=\"bt-validation-success\">✓ Tree structure is valid</div>';
        } else {
            errors.forEach(error => {
                output.innerHTML += `<div class=\"bt-validation-error\">✗ ${error}</div>`;
            });
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

        varsContainer.innerHTML = '<h4 style="font-size: 12px; color: #aaa; margin-bottom: 8px;">Mock Entity Components</h4>';

        // Build UI for each component
        const components = this.mockGame.getAllComponents();

        for (const [componentType, componentData] of components.entries()) {
            this.createComponentEditor(varsContainer, componentType, componentData);
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

    createComponentEditor(container, componentType, componentData) {
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
            this.createComponentPropertyInput(propsContainer, componentType, key, value);
        }

        detailsEl.appendChild(propsContainer);
        container.appendChild(detailsEl);
    }

    createComponentPropertyInput(container, componentType, propertyName, value) {
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
                this.mockGame.updateComponent(componentType, propertyName, newValue);
                this.runSimulation();
            });
            propDiv.appendChild(input);
        } else if (typeof value === 'boolean') {
            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.checked = value;
            checkbox.addEventListener('change', (e) => {
                this.mockGame.updateComponent(componentType, propertyName, e.target.checked);
                this.runSimulation();
            });
            propDiv.appendChild(checkbox);
        } else if (typeof value === 'number') {
            const input = document.createElement('input');
            input.type = 'number';
            input.value = value;
            input.style.width = '100%';
            input.addEventListener('change', (e) => {
                this.mockGame.updateComponent(componentType, propertyName, parseFloat(e.target.value));
                this.runSimulation();
            });
            propDiv.appendChild(input);
        } else if (typeof value === 'string') {
            const input = document.createElement('input');
            input.type = 'text';
            input.value = value;
            input.style.width = '100%';
            input.addEventListener('change', (e) => {
                this.mockGame.updateComponent(componentType, propertyName, e.target.value);
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
                    this.mockGame.updateComponent(componentType, propertyName, newValue);
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

        let result;

        if (this.isScriptBased) {
            // Use mock game context with actual script class
            if (!this.mockGame) return;
            result = GUTS.BehaviorTreeProcessor.evaluate(this.objectData, this.mockGame);
        } else {
            // Use blackboard with data-driven evaluation
            if (!this.currentData || !this.currentData.root || !this.blackboard) return;
            result = GUTS.BehaviorTreeProcessor.evaluate(this.currentData, this.blackboard);
        }

        this.displaySimResult(result);
        this.highlightActivePath(result.activePath);
    }

    displaySimResult(result) {
        const resultDiv = document.getElementById('bt-sim-result');
        if (!resultDiv) return;

        resultDiv.style.display = 'block';

        if (result.action) {
            resultDiv.innerHTML = `
                <div><strong>Result:</strong> Action Selected</div>
                <div class="bt-sim-result__action">Action: ${result.action}</div>
                ${result.target ? `<div>Target: ${result.target}</div>` : ''}
                ${result.priority !== undefined ? `<div>Priority: ${result.priority}</div>` : ''}
            `;
        } else {
            resultDiv.innerHTML = `<div style="color: #888;">No action selected (all conditions failed)</div>`;
        }
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
