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
}
