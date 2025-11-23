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

        // Get full object data - either from event detail or from controller
        this.objectData = detail.objectData || this.controller.getCurrentObject();

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

        // Setup simulation variables
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

        const actions = this.controller.getCollections().actions || {};

        Object.entries(actions).forEach(([actionId, actionData]) => {
            const actionEl = document.createElement('div');
            actionEl.className = 'bt-action-item';
            actionEl.draggable = true;
            actionEl.dataset.actionId = actionId;

            actionEl.innerHTML = `
                <div class="bt-action-item__title">${actionData.title}</div>
                <div class="bt-action-item__priority">Priority: ${actionData.priority}</div>
            `;

            actionEl.addEventListener('dragstart', (e) => {
                e.dataTransfer.setData('actionId', actionId);
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
        if (!varsContainer || !this.currentData) return;

        // Extract all conditions from the tree
        const conditions = this.extractConditions(this.currentData);

        // Initialize simulation state if not exists
        if (!this.simState) {
            this.simState = {};
        }

        varsContainer.innerHTML = '';

        // Create UI controls for each condition
        conditions.forEach(condition => {
            const varDiv = document.createElement('div');
            varDiv.className = 'bt-sim-var';

            const label = document.createElement('label');
            label.className = 'bt-sim-var__label';
            label.textContent = condition;

            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.checked = this.simState[condition] || false;
            checkbox.addEventListener('change', (e) => {
                this.simState[condition] = e.target.checked;
                this.runSimulation();
            });

            varDiv.appendChild(label);
            varDiv.appendChild(checkbox);
            varsContainer.appendChild(varDiv);

            // Initialize state
            if (this.simState[condition] === undefined) {
                this.simState[condition] = false;
            }
        });
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
        if (!this.currentData || !this.currentData.root) return;

        // Use shared BehaviorTreeProcessor if available
        if (typeof GUTS !== 'undefined' && GUTS.BehaviorTreeProcessor) {
            const result = GUTS.BehaviorTreeProcessor.evaluate(this.currentData, this.simState);
            this.displaySimResult(result);
            this.highlightActivePath(result.activePath);
        } else {
            // Fallback to simple evaluation
            const result = this.evaluateNode('root', this.currentData, this.simState);
            this.displaySimResult(result);
            this.highlightActivePath(result.activePath);
        }
    }

    evaluateNode(nodeName, nodes, state, activePath = []) {
        const node = nodes[nodeName];
        if (!node) return { success: false, action: null, activePath };

        activePath = [...activePath, nodeName];

        switch (node.type) {
            case 'selector':
                // Try children until one succeeds
                for (const child of node.children || []) {
                    const result = this.evaluateNode(child, nodes, state, activePath);
                    if (result.success) {
                        return result;
                    }
                }
                return { success: false, action: null, activePath };

            case 'sequence':
                // Execute children in order, all must succeed
                for (const child of node.children || []) {
                    const result = this.evaluateNode(child, nodes, state, activePath);
                    if (!result.success) {
                        return { success: false, action: null, activePath };
                    }
                }
                return { success: true, action: null, activePath };

            case 'condition':
                const conditionMet = this.evaluateCondition(node.condition, state);
                if (conditionMet && node.onSuccess) {
                    return this.evaluateNode(node.onSuccess, nodes, state, activePath);
                }
                return { success: conditionMet, action: null, activePath };

            case 'action':
                return {
                    success: true,
                    action: node.action,
                    target: node.target,
                    priority: node.priority || 0,
                    activePath
                };

            default:
                return { success: false, action: null, activePath };
        }
    }

    evaluateCondition(condition, state) {
        // Simple condition evaluation
        // For complex conditions, try to evaluate them
        try {
            // Replace condition names with state values
            let evalStr = condition;
            for (const [key, value] of Object.entries(state)) {
                evalStr = evalStr.replace(new RegExp(key, 'g'), value ? 'true' : 'false');
            }
            // Basic evaluation (this is simplified)
            return eval(evalStr) || false;
        } catch (e) {
            // If it's a simple condition name, just return the state value
            return state[condition] || false;
        }
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
        // Reset all simulation variables to false
        if (this.simState) {
            Object.keys(this.simState).forEach(key => {
                this.simState[key] = false;
            });
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
