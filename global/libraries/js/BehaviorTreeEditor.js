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

        console.log(this.currentData, "loadBehaviorTree");
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
            canvas.innerHTML = '<div style="padding: 20px; text-align: center; color: #888;">No behavior tree data loaded</div>';
            return;
        }

        // Get the script class name from the key
        const scriptName = this.controller.getSelectedObject();

        // Try multiple ways to find the class
        let TreeClass = null;

        // Try direct window access with exact class name
        if (window[scriptName]) {
            TreeClass = window[scriptName];
            console.log('Found class via window[' + scriptName + ']');
        }
        // Try GUTS.behaviorTrees
        else if (GUTS && GUTS.behaviorTrees && GUTS.behaviorTrees[scriptName]) {
            TreeClass = GUTS.behaviorTrees[scriptName];
            console.log('Found class via GUTS.behaviorTrees[' + scriptName + ']');
        }
        // Try with BehaviorTree suffix removed if present
        else {
            const baseName = scriptName.replace('BehaviorTree', '');
            const withSuffix = baseName + 'BehaviorTree';
            if (window[withSuffix]) {
                TreeClass = window[withSuffix];
                console.log('Found class via window[' + withSuffix + ']');
            }
        }

        // Extract method names from the class to visualize
        let methods = [];

        // Method 1: Try to extract from class instance
        if (TreeClass) {
            try {
                const instance = new TreeClass();
                const proto = Object.getPrototypeOf(instance);
                methods = Object.getOwnPropertyNames(proto)
                    .filter(name => name.startsWith('check') || name === 'evaluate');

                console.log('Behavior tree class:', scriptName);
                console.log('Extracted methods via class:', methods);
            } catch (e) {
                console.warn('Error instantiating behavior tree:', e);
            }
        }

        // Method 2: If class not found or methods empty, parse from script source
        if (methods.length === 0 && this.objectData.script) {
            const scriptSource = this.objectData.script;
            // Match method definitions like "checkPlayerOrder(", "checkMining(", etc.
            const methodRegex = /\s+(check\w+)\s*\(/g;
            let match;
            const foundMethods = new Set();
            while ((match = methodRegex.exec(scriptSource)) !== null) {
                foundMethods.add(match[1]);
            }
            methods = Array.from(foundMethods);
            methods.unshift('evaluate'); // Add evaluate at the beginning
            console.log('Extracted methods via script parsing:', methods);
        }

        if (methods.length === 0) {
            console.warn('Could not find behavior tree class:', scriptName);
            console.warn('Available on window:', Object.keys(window).filter(k => k.includes('Behavior')));
        }

        // Create visual tree representation
        canvas.innerHTML = `
            <div id="bt-graph-container" style="padding: 20px; overflow: auto;">
                <svg id="bt-graph-svg" width="100%" height="500" style="background: #0a0a0a; border-radius: 4px;">
                    <!-- Tree will be rendered here -->
                </svg>
                <div style="margin-top: 15px; color: #888; font-size: 12px;">
                    💡 Use the simulation panel to test the behavior tree. Active paths will be highlighted in green.
                </div>
            </div>
        `;

        this.renderTreeGraph(methods);
    }

    renderTreeGraph(methods) {
        const svg = document.getElementById('bt-graph-svg');
        if (!svg) return;

        // Clear existing content
        svg.innerHTML = '';

        const nodeWidth = 160;
        const nodeHeight = 50;
        const verticalSpacing = 80;
        const horizontalSpacing = 20;

        // Root node (Selector)
        const rootY = 40;
        const rootX = svg.clientWidth / 2 - nodeWidth / 2;

        this.createNode(svg, rootX, rootY, nodeWidth, nodeHeight, 'ROOT SELECTOR', 'selector', 'root');

        // Child nodes (check methods)
        const childMethods = methods.filter(m => m.startsWith('check'));
        const totalWidth = (nodeWidth + horizontalSpacing) * childMethods.length - horizontalSpacing;
        const startX = (svg.clientWidth - totalWidth) / 2;

        childMethods.forEach((method, index) => {
            const x = startX + index * (nodeWidth + horizontalSpacing);
            const y = rootY + verticalSpacing;

            // Draw connecting line
            this.createLine(
                svg,
                rootX + nodeWidth / 2,
                rootY + nodeHeight,
                x + nodeWidth / 2,
                y
            );

            // Create node
            const label = this.formatMethodName(method);
            this.createNode(svg, x, y, nodeWidth, nodeHeight, label, 'condition', method);

            // Add potential action below each condition
            const actionY = y + verticalSpacing;
            this.createLine(
                svg,
                x + nodeWidth / 2,
                y + nodeHeight,
                x + nodeWidth / 2,
                actionY
            );

            const actionLabel = this.extractActionFromMethod(method);
            this.createNode(svg, x, actionY, nodeWidth, nodeHeight, actionLabel, 'action', `${method}-action`);
        });

        // Add IDLE fallback
        const idleX = startX + childMethods.length * (nodeWidth + horizontalSpacing);
        const idleY = rootY + verticalSpacing;

        this.createLine(
            svg,
            rootX + nodeWidth / 2,
            rootY + nodeHeight,
            idleX + nodeWidth / 2,
            idleY
        );

        this.createNode(svg, idleX, idleY, nodeWidth, nodeHeight, 'IDLE', 'action', 'idle');
    }

    createNode(svg, x, y, width, height, label, type, id) {
        const colors = {
            'selector': { fill: '#1e3a2f', stroke: '#10b981', text: '#10b981' },
            'condition': { fill: '#1e2a3a', stroke: '#3b82f6', text: '#3b82f6' },
            'action': { fill: '#3a1e1e', stroke: '#ef4444', text: '#ef4444' }
        };
        const color = colors[type] || colors.action;

        // Create group
        const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        g.setAttribute('data-node-id', id);
        g.setAttribute('class', 'bt-graph-node');

        // Rectangle
        const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        rect.setAttribute('x', x);
        rect.setAttribute('y', y);
        rect.setAttribute('width', width);
        rect.setAttribute('height', height);
        rect.setAttribute('fill', color.fill);
        rect.setAttribute('stroke', color.stroke);
        rect.setAttribute('stroke-width', '2');
        rect.setAttribute('rx', '6');

        // Text
        const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        text.setAttribute('x', x + width / 2);
        text.setAttribute('y', y + height / 2);
        text.setAttribute('text-anchor', 'middle');
        text.setAttribute('dominant-baseline', 'middle');
        text.setAttribute('fill', color.text);
        text.setAttribute('font-size', '12');
        text.setAttribute('font-weight', '600');
        text.textContent = label;

        g.appendChild(rect);
        g.appendChild(text);
        svg.appendChild(g);
    }

    createLine(svg, x1, y1, x2, y2) {
        const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        line.setAttribute('x1', x1);
        line.setAttribute('y1', y1);
        line.setAttribute('x2', x2);
        line.setAttribute('y2', y2);
        line.setAttribute('stroke', '#444');
        line.setAttribute('stroke-width', '2');
        svg.appendChild(line);
    }

    formatMethodName(method) {
        // Convert checkPlayerOrder -> Player Order
        return method.replace('check', '').replace(/([A-Z])/g, ' $1').trim().toUpperCase();
    }

    extractActionFromMethod(method) {
        // Extract likely action from method name
        const mapping = {
            'checkPlayerOrder': 'PLAYER ORDER',
            'checkBuildOrder': 'BUILD',
            'checkBuild': 'BUILD',
            'checkMining': 'MINE',
            'checkMine': 'MINE',
            'checkCombat': 'ATTACK',
            'checkAttack': 'ATTACK',
            'checkMoveOrder': 'MOVE TO'
        };
        return mapping[method] || 'ACTION';
    }

    highlightActiveNode(result) {
        // Remove previous highlights
        const nodes = document.querySelectorAll('.bt-graph-node');
        nodes.forEach(node => {
            const rect = node.querySelector('rect');
            if (rect) {
                rect.setAttribute('stroke-width', '2');
            }
        });

        // Highlight active nodes based on result
        if (!result || !result.action) return;

        // Highlight root
        this.highlightNode('root');

        // If this is a player-ordered action, highlight the player order method
        if (result.playerOrdered) {
            this.highlightNode('checkPlayerOrder');
            this.highlightNode('checkPlayerOrder-action');
            return;
        }

        // Otherwise, highlight specific action node based on action mapping
        const actionMapping = {
            'BUILD': 'checkBuildOrder',
            'MINE': 'checkMining',
            'ATTACK': 'checkCombat',
            'MOVE': 'checkMoveOrder',
            'MOVE_TO': 'checkMoveOrder',
            'IDLE': 'idle'
        };

        const methodName = actionMapping[result.action];
        if (methodName) {
            this.highlightNode(methodName);
            this.highlightNode(`${methodName}-action`);
        }
    }

    highlightNode(nodeId) {
        const node = document.querySelector(`[data-node-id="${nodeId}"]`);
        if (node) {
            const rect = node.querySelector('rect');
            if (rect) {
                rect.setAttribute('stroke', '#22c55e');
                rect.setAttribute('stroke-width', '4');
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

        // Check mockEntities structure
        if (!this.currentData) {
            errors.push('Missing mockEntities property for simulation');
        } else {
            // Validate that mockEntities has at least some component data
            if (Object.keys(this.currentData).length === 0) {
                errors.push('mockEntities has no component data');
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
                data: { "entities": this.currentData }
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
     
        this.setupScriptBasedSimulation(varsContainer);

    }

    setupScriptBasedSimulation(varsContainer) {
        // Initialize mock game context with editor controller for getCollections()
        this.mockGame = GUTS.MockGameContext.fromBehaviorTreeData(this.objectData, this.controller);


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
                this.mockGame.initializeEntity(newId, {
                    position: { x: 0, y: 0, z: 0 },                    
                }, `Entity ${this.mockGame.entities.size}`);
                this.renderAllEntities(entitiesContainer);
            });
        }
    }

    renderAllEntities(container) {
        container.innerHTML = '';

        // Iterate over all entity IDs from BaseECSGame
        for (const entityId of this.mockGame.entities.keys()) {
            this.createEntityEditor(container, entityId);
        }
    }

    createEntityEditor(container, entityId) {
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
        labelInput.value = this.mockGame.getEntityLabel(entityId);
        labelInput.style.flex = '1';
        labelInput.style.padding = '4px 8px';
        labelInput.style.fontSize = '12px';
        labelInput.style.fontWeight = '600';
        labelInput.style.backgroundColor = '#2a2a2a';
        labelInput.style.border = '1px solid #444';
        labelInput.style.color = '#fff';
        labelInput.style.borderRadius = '3px';
        labelInput.addEventListener('change', () => {
            this.mockGame.setEntityLabel(entityId, labelInput.value);
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
            if (this.mockGame.entities.size <= 1) {
                alert('Cannot remove the last entity');
                return;
            }
            this.mockGame.destroyEntity(entityId);
            this.mockGame.entityLabels.delete(entityId);
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
        idDiv.textContent = `ID: ${entityId}`;
        idDiv.style.fontSize = '10px';
        idDiv.style.color = '#666';
        idDiv.style.marginBottom = '10px';
        entityCard.appendChild(idDiv);

        // Components section
        const componentsDiv = document.createElement('div');

        // Get component types for this entity from BaseECSGame
        const componentTypes = this.mockGame.entities.get(entityId);
        if (componentTypes) {
            for (const componentType of componentTypes) {
                const componentData = this.mockGame.getComponent(entityId, componentType);
                if (componentData) {
                    this.createComponentEditor(componentsDiv, entityId, componentType, componentData);
                }
            }
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
            this.showAddComponentDialog(entityId);
        });

        componentsDiv.appendChild(addComponentBtn);
        entityCard.appendChild(componentsDiv);

        container.appendChild(entityCard);
    }

    showAddComponentDialog(entityId) {
        // Get available component types directly from componentGenerator (lowercase names)
        const allComponentTypes = Object.keys(this.mockGame.componentGenerator.components);
        const availableTypes = allComponentTypes.filter(type => {
            return !this.mockGame.getComponent(entityId, type);
        });

        if (availableTypes.length === 0) {
            alert('All component types are already added');
            return;
        }

        // Create modal overlay
        const overlay = document.createElement('div');
        overlay.style.position = 'fixed';
        overlay.style.top = '0';
        overlay.style.left = '0';
        overlay.style.right = '0';
        overlay.style.bottom = '0';
        overlay.style.backgroundColor = 'rgba(0, 0, 0, 0.7)';
        overlay.style.display = 'flex';
        overlay.style.alignItems = 'center';
        overlay.style.justifyContent = 'center';
        overlay.style.zIndex = '10000';

        // Create modal content
        const modal = document.createElement('div');
        modal.style.backgroundColor = '#1a1a1a';
        modal.style.border = '1px solid #444';
        modal.style.borderRadius = '8px';
        modal.style.padding = '20px';
        modal.style.minWidth = '300px';
        modal.style.maxWidth = '400px';

        // Header
        const header = document.createElement('h3');
        header.textContent = 'Add Component';
        header.style.margin = '0 0 16px 0';
        header.style.fontSize = '14px';
        header.style.color = '#fff';
        modal.appendChild(header);

        // Dropdown
        const select = document.createElement('select');
        select.style.width = '100%';
        select.style.padding = '8px';
        select.style.fontSize = '12px';
        select.style.backgroundColor = '#2a2a2a';
        select.style.border = '1px solid #444';
        select.style.color = '#fff';
        select.style.borderRadius = '4px';
        select.style.marginBottom = '16px';

        // Add placeholder option
        const placeholderOption = document.createElement('option');
        placeholderOption.value = '';
        placeholderOption.textContent = 'Select a component...';
        placeholderOption.disabled = true;
        placeholderOption.selected = true;
        select.appendChild(placeholderOption);

        // Add available component types (sorted alphabetically)
        availableTypes.sort().forEach(type => {
            const option = document.createElement('option');
            option.value = type;  // Use lowercase name (e.g., "health")
            option.textContent = type;  // Display lowercase name
            select.appendChild(option);
        });

        modal.appendChild(select);

        // Buttons container
        const buttonsDiv = document.createElement('div');
        buttonsDiv.style.display = 'flex';
        buttonsDiv.style.gap = '8px';
        buttonsDiv.style.justifyContent = 'flex-end';

        // Cancel button
        const cancelBtn = document.createElement('button');
        cancelBtn.textContent = 'Cancel';
        cancelBtn.style.padding = '6px 12px';
        cancelBtn.style.fontSize = '12px';
        cancelBtn.style.backgroundColor = '#444';
        cancelBtn.style.border = 'none';
        cancelBtn.style.color = '#fff';
        cancelBtn.style.borderRadius = '4px';
        cancelBtn.style.cursor = 'pointer';
        cancelBtn.addEventListener('click', () => {
            document.body.removeChild(overlay);
        });
        buttonsDiv.appendChild(cancelBtn);

        // Add button
        const addBtn = document.createElement('button');
        addBtn.textContent = 'Add';
        addBtn.style.padding = '6px 12px';
        addBtn.style.fontSize = '12px';
        addBtn.style.backgroundColor = '#3b82f6';
        addBtn.style.border = 'none';
        addBtn.style.color = '#fff';
        addBtn.style.borderRadius = '4px';
        addBtn.style.cursor = 'pointer';
        addBtn.addEventListener('click', () => {
            const selectedType = select.value;
            if (selectedType) {
                // Get component definition and initialize with default values
                const componentDefinition = this.mockGame.componentGenerator.components[selectedType];
                const defaultData = componentDefinition?.schema || componentDefinition || {};

                // Add component with default values (using lowercase name)
                this.mockGame.addComponent(entityId, selectedType, { ...defaultData });

                const entitiesContainer = document.getElementById('bt-entities-container');
                if (entitiesContainer) {
                    this.renderAllEntities(entitiesContainer);
                }
                document.body.removeChild(overlay);
            }
        });
        buttonsDiv.appendChild(addBtn);

        modal.appendChild(buttonsDiv);
        overlay.appendChild(modal);
        document.body.appendChild(overlay);

        // Close on overlay click
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) {
                document.body.removeChild(overlay);
            }
        });
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

        console.log(this.currentData, "Current Data");

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

        // Header container with component name and remove button
        const headerDiv = document.createElement('div');
        headerDiv.style.display = 'flex';
        headerDiv.style.alignItems = 'center';
        headerDiv.style.justifyContent = 'space-between';
        headerDiv.style.marginBottom = '8px';

        const summary = document.createElement('summary');
        summary.textContent = componentType;
        summary.style.cursor = 'pointer';
        summary.style.fontWeight = '600';
        summary.style.fontSize = '11px';
        summary.style.color = '#6366f1';
        summary.style.flex = '1';
        headerDiv.appendChild(summary);

        // Remove button
        const removeBtn = document.createElement('button');
        removeBtn.textContent = '×';
        removeBtn.style.padding = '0 6px';
        removeBtn.style.fontSize = '14px';
        removeBtn.style.background = '#ef4444';
        removeBtn.style.border = 'none';
        removeBtn.style.color = 'white';
        removeBtn.style.borderRadius = '3px';
        removeBtn.style.cursor = 'pointer';
        removeBtn.style.lineHeight = '1';
        removeBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            this.removeComponent(entityId, componentType);
        });
        headerDiv.appendChild(removeBtn);

        detailsEl.appendChild(headerDiv);

        const propsContainer = document.createElement('div');
        propsContainer.style.marginLeft = '8px';

        // Get component definition to ensure all properties are shown
        const componentDefinition = this.mockGame.componentGenerator.components[componentType];
        const defaultSchema = componentDefinition?.schema || componentDefinition || {};

        // Merge default schema with actual component data to show all properties
        const allProperties = { ...defaultSchema, ...componentData };

        // Create inputs for each property
        for (const [key, value] of Object.entries(allProperties)) {
            this.createComponentPropertyInput(propsContainer, entityId, componentType, key, value);
        }

        detailsEl.appendChild(propsContainer);
        container.appendChild(detailsEl);
    }

    removeComponent(entityId, componentType) {
        // Remove the component from the entity
        this.mockGame.removeComponent(entityId, componentType);

        // Re-render all entities
        const entitiesContainer = document.getElementById('bt-entities-container');
        if (entitiesContainer) {
            this.renderAllEntities(entitiesContainer);
        }

        // Re-run simulation to update results
        this.runSimulation();
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
                const component = this.mockGame.getComponent(entityId, componentType);
                if (component) {
                    component[propertyName] = newValue;
                }
                this.runSimulation();
            });
            propDiv.appendChild(input);
        } else if (typeof value === 'boolean') {
            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.checked = value;
            checkbox.addEventListener('change', (e) => {
                const component = this.mockGame.getComponent(entityId, componentType);
                if (component) {
                    component[propertyName] = e.target.checked;
                }
                this.runSimulation();
            });
            propDiv.appendChild(checkbox);
        } else if (typeof value === 'number') {
            const input = document.createElement('input');
            input.type = 'number';
            input.value = value;
            input.style.width = '100%';
            input.addEventListener('change', (e) => {
                const component = this.mockGame.getComponent(entityId, componentType);
                if (component) {
                    component[propertyName] = parseFloat(e.target.value);
                }
                this.runSimulation();
            });
            propDiv.appendChild(input);
        } else if (typeof value === 'string') {
            const input = document.createElement('input');
            input.type = 'text';
            input.value = value;
            input.style.width = '100%';
            input.addEventListener('change', (e) => {
                const component = this.mockGame.getComponent(entityId, componentType);
                if (component) {
                    component[propertyName] = e.target.value;
                }
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
                    const component = this.mockGame.getComponent(entityId, componentType);
                    if (component) {
                        component[propertyName] = newValue;
                    }
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

            // Evaluate behavior tree only for the main entity (first entity)
            // Other entities in mockEntities are just part of the environment
            const results = [];
            const entityIds = Array.from(this.mockGame.entities.keys());

            // Only run for the first entity (the main entity)
            if (entityIds.length > 0) {
                const mainEntityId = entityIds[0];
                const result = GUTS.BehaviorTreeProcessor.evaluate(
                    this.objectData,
                    this.mockGame,
                    'root',
                    mainEntityId
                );
                results.push({
                    entityId: mainEntityId,
                    entityLabel: this.mockGame.getEntityLabel(mainEntityId),
                    result
                });
            }

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

        // Highlight active node in graph based on first result with action
        let highlightedResult = null;
        for (const { result } of results) {
            if (result && result.action) {
                highlightedResult = result;
                break;
            }
        }
        if (this.isScriptBased && highlightedResult) {
            this.highlightActiveNode(highlightedResult);
        }

        results.forEach(({ entityId, entityLabel, result }) => {
            const entityCard = document.createElement('div');
            entityCard.style.marginBottom = '12px';
            entityCard.style.padding = '8px';
            entityCard.style.border = '1px solid #333';
            entityCard.style.borderRadius = '4px';
            entityCard.style.backgroundColor = '#1a1a1a';

            if (entityId) {
                const entityHeader = document.createElement('div');
                entityHeader.style.fontSize = '11px';
                entityHeader.style.fontWeight = '600';
                entityHeader.style.color = '#fff';
                entityHeader.style.marginBottom = '6px';
                entityHeader.textContent = entityLabel || entityId;
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
                this.mockGame = GUTS.MockGameContext.fromBehaviorTreeData(this.objectData, this.controller);
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
