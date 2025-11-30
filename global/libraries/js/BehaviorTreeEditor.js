class BehaviorTreeEditor {
    constructor(controller, moduleConfig, GUTS) {
        this.controller = controller;
        this.moduleConfig = moduleConfig;
        this.GUTS = GUTS;

        this.currentData = null;
        this.selectedNode = null;
        this.zoom = 1;

        // Simulation state
        this.isPlaying = false;
        this.playInterval = null;

        this.tickRate = 1/20;
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

     
        // Save JSON changes
        document.getElementById('bt-save-json-btn')?.addEventListener('click', () => this.saveJSONChanges());

        // Import from file
        document.getElementById('bt-import-json-btn')?.addEventListener('click', () => this.importJSONFile());

        // Simulation controls
        document.getElementById('bt-step-btn')?.addEventListener('click', () => this.stepSimulation());
        document.getElementById('bt-play-btn')?.addEventListener('click', () => this.togglePlaySimulation());
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

        // Setup simulation with mock entities
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

            const title = actionData.title || this.formatActionName(behaviorActionId);
            const description = actionData.description || '';

            actionEl.innerHTML = `
                <div class="bt-action-item__title">${title}</div>
                <div class="bt-action-item__id" style="font-size: 10px; color: #666;">${behaviorActionId}</div>
                ${description ? `<div class="bt-action-item__desc" style="font-size: 10px; color: #888; margin-top: 4px;">${description}</div>` : ''}
            `;

            actionEl.addEventListener('dragstart', (e) => {
                e.dataTransfer.setData('behaviorActionId', behaviorActionId);
            });

            // Double-click to add to current tree
            actionEl.addEventListener('dblclick', () => {
                this.addActionToTree(behaviorActionId);
            });

            actionsList.appendChild(actionEl);
        });
    }

    addActionToTree(behaviorActionId) {
        if (!this.objectData) {
            alert('Cannot add actions - no tree data loaded');
            return;
        }

        // Get the child nodes array (either behaviorActions or behaviorNodes)
        const childNodes = this.getChildNodes(this.objectData);
        const arrayKey = this.getChildNodesKey(this.objectData);

        // If no array exists, create one
        if (!this.objectData[arrayKey]) {
            this.objectData[arrayKey] = [];
        }

        if (this.objectData[arrayKey].includes(behaviorActionId)) {
            alert('Action already in tree');
            return;
        }

        this.objectData[arrayKey].push(behaviorActionId);
        this.renderTree();
        this.updateJSONView();
    }

    removeActionFromTree(behaviorActionId) {
        if (!this.objectData) return;

        const arrayKey = this.getChildNodesKey(this.objectData);
        const childNodes = this.objectData[arrayKey];
        if (!childNodes) return;

        const index = childNodes.indexOf(behaviorActionId);
        if (index > -1) {
            childNodes.splice(index, 1);
            this.renderTree();
            this.updateJSONView();
        }
    }

    renderTree() {
        const canvas = document.getElementById('bt-tree-canvas');
        if (!canvas) return;

        canvas.innerHTML = '';
        this.renderScriptBasedTree(canvas);
    }

    async renderScriptBasedTree(canvas) {
        if (!this.objectData) {
            canvas.innerHTML = '<div style="padding: 20px; text-align: center; color: #888;">No behavior tree data loaded</div>';
            return;
        }

        // Get child nodes - support both behaviorActions and behaviorNodes array names
        const childNodes = this.getChildNodes(this.objectData);

        // Render behaviorActions/behaviorNodes array
        if (childNodes && Array.isArray(childNodes) && childNodes.length > 0) {
            this.renderBehaviorActionsTree(canvas, childNodes);
            return;
        }

        // Check for decorator with single child
        if (this.objectData.childAction !== undefined) {
            this.renderDecoratorTree(canvas);
            return;
        }

        // No child nodes found
        canvas.innerHTML = '<div style="padding: 20px; text-align: center; color: #888;">No behaviorActions/behaviorNodes array or childAction defined in this node</div>';
    }

    /**
     * Get child nodes from object data - supports both behaviorActions and behaviorNodes
     */
    getChildNodes(data) {
        return data.behaviorActions || data.behaviorNodes || [];
    }

    /**
     * Get the child nodes array key name used by this object
     */
    getChildNodesKey(data) {
        if (data.behaviorActions) return 'behaviorActions';
        if (data.behaviorNodes) return 'behaviorNodes';
        return 'behaviorActions'; // default
    }

    /**
     * Determine node type from node data
     */
    getNodeType(nodeData) {
        if (!nodeData) return 'action';
        return nodeData.behaviorNodeType || 'action';
    }

    /**
     * Render a decorator with its single child
     */
    renderDecoratorTree(canvas) {
        const childAction = this.objectData.childAction;

        canvas.innerHTML = `
            <div id="bt-graph-container" style="padding: 20px; overflow: auto;">
                <svg id="bt-graph-svg" width="100%" height="250" style="background: #0a0a0a; border-radius: 4px;"></svg>
                <div id="bt-action-controls" style="margin-top: 15px;">
                    <div style="color: #888; font-size: 12px;">
                        💡 This decorator wraps a single child action. Set the childAction property in JSON to change.
                    </div>
                </div>
            </div>
        `;

        const svg = document.getElementById('bt-graph-svg');
        if (!svg) return;

        const nodeWidth = 180;
        const nodeHeight = 50;
        const verticalSpacing = 80;
        const svgWidth = Math.max(400, svg.clientWidth);
        svg.setAttribute('width', svgWidth);

        const centerX = svgWidth / 2 - nodeWidth / 2;
        const rootY = 30;

        // Root node (Decorator)
        const rootLabel = this.objectData.title || this.formatActionName(this.objectData.fileName || 'Decorator');
        this.createNode(svg, centerX, rootY, nodeWidth, nodeHeight, rootLabel, 'decorator', 'root');

        // Child node
        if (childAction) {
            const childY = rootY + verticalSpacing;
            const actionData = this.controller.getCollections().behaviorNodes?.[childAction];
            const childLabel = actionData?.title || this.formatActionName(childAction);
            const childType = this.getNodeType(actionData);

            this.createLine(svg, centerX + nodeWidth / 2, rootY + nodeHeight, centerX + nodeWidth / 2, childY);
            this.createNode(svg, centerX, childY, nodeWidth, nodeHeight, childLabel, childType, childAction);
        } else {
            // No child set
            const childY = rootY + verticalSpacing;
            this.createLine(svg, centerX + nodeWidth / 2, rootY + nodeHeight, centerX + nodeWidth / 2, childY);
            this.createNode(svg, centerX, childY, nodeWidth, nodeHeight, '(no child set)', 'empty', 'empty');
        }

        svg.setAttribute('height', rootY + verticalSpacing + nodeHeight + 50);
    }

    renderBehaviorActionsTree(canvas, childNodes) {
        const behaviorActions = childNodes || this.getChildNodes(this.objectData);

        // Create visual tree representation
        canvas.innerHTML = `
            <div id="bt-graph-container" style="padding: 20px; overflow: auto;">
                <svg id="bt-graph-svg" width="100%" height="400" style="background: #0a0a0a; border-radius: 4px;">
                    <!-- Tree will be rendered here -->
                </svg>
                <div id="bt-action-controls" style="margin-top: 15px; display: flex; flex-wrap: wrap; gap: 8px;">
                    <!-- Action controls will be added here -->
                </div>
                <div style="margin-top: 10px; color: #888; font-size: 12px;">
                    💡 Use arrows to reorder, × to remove. Double-click actions in sidebar to add.
                </div>
                <div style="margin-top: 8px; display: flex; flex-wrap: wrap; gap: 12px; font-size: 11px;">
                    <span style="color: #10b981;">■ Selector</span>
                    <span style="color: #3b82f6;">■ Sequence</span>
                    <span style="color: #f59e0b;">■ Parallel</span>
                    <span style="color: #8b5cf6;">■ Decorator</span>
                    <span style="color: #ef4444;">■ Action</span>
                </div>
            </div>
        `;

        const svg = document.getElementById('bt-graph-svg');
        if (!svg) return;

        svg.innerHTML = '';

        const nodeWidth = 180;
        const nodeHeight = 50;
        const verticalSpacing = 80;
        const horizontalSpacing = 30;

        // Root node - determine type from objectData
        const rootY = 30;
        const totalWidth = (nodeWidth + horizontalSpacing) * behaviorActions.length - horizontalSpacing;
        const svgWidth = Math.max(totalWidth + 100, svg.clientWidth);
        svg.setAttribute('width', svgWidth);

        const rootX = svgWidth / 2 - nodeWidth / 2;

        // Determine root node type and label
        const rootType = this.getNodeType(this.objectData);
        let rootLabel = 'SELECTOR (Priority)';
        if (rootType === 'sequence') {
            rootLabel = 'SEQUENCE (All must succeed)';
        } else if (rootType === 'parallel') {
            rootLabel = 'PARALLEL (Run all)';
        } else if (this.objectData.title) {
            rootLabel = this.objectData.title;
        }
        this.createNode(svg, rootX, rootY, nodeWidth, nodeHeight, rootLabel, rootType, 'root');

        // Child nodes (behavior actions)
        const startX = (svgWidth - totalWidth) / 2;

        behaviorActions.forEach((actionName, index) => {
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

            // Get action info from collections
            const actionData = this.controller.getCollections().behaviorNodes?.[actionName];
            const label = actionData?.title || this.formatActionName(actionName);

            // Determine node type from action data structure
            const nodeType = this.getNodeType(actionData);

            this.createNode(svg, x, y, nodeWidth, nodeHeight, label, nodeType, actionName);

            // Add priority number
            const priorityText = document.createElementNS('http://www.w3.org/2000/svg', 'text');
            priorityText.setAttribute('x', x + nodeWidth / 2);
            priorityText.setAttribute('y', y - 8);
            priorityText.setAttribute('text-anchor', 'middle');
            priorityText.setAttribute('fill', '#666');
            priorityText.setAttribute('font-size', '10');
            priorityText.textContent = `#${index + 1}`;
            svg.appendChild(priorityText);
        });

        // Adjust SVG height
        svg.setAttribute('height', rootY + verticalSpacing + nodeHeight + 50);

        // Add action controls
        this.renderActionControls(behaviorActions);
    }

    renderActionControls(behaviorActions) {
        const controlsContainer = document.getElementById('bt-action-controls');
        if (!controlsContainer) return;

        controlsContainer.innerHTML = '';

        behaviorActions.forEach((actionName, index) => {
            const actionData = this.controller.getCollections().behaviorNodes?.[actionName];
            const label = actionData?.title || this.formatActionName(actionName);

            const controlDiv = document.createElement('div');
            controlDiv.style.cssText = 'display: flex; align-items: center; gap: 4px; padding: 4px 8px; background: #1a1a1a; border: 1px solid #333; border-radius: 4px; font-size: 11px;';

            // Priority number
            const prioritySpan = document.createElement('span');
            prioritySpan.style.cssText = 'color: #666; font-weight: bold; min-width: 20px;';
            prioritySpan.textContent = `#${index + 1}`;
            controlDiv.appendChild(prioritySpan);

            // Action name
            const nameSpan = document.createElement('span');
            nameSpan.style.cssText = 'color: #fff; flex: 1;';
            nameSpan.textContent = label;
            controlDiv.appendChild(nameSpan);

            // Move up button
            if (index > 0) {
                const upBtn = document.createElement('button');
                upBtn.textContent = '↑';
                upBtn.title = 'Move up (higher priority)';
                upBtn.style.cssText = 'padding: 2px 6px; font-size: 10px; background: #333; border: none; color: #fff; border-radius: 2px; cursor: pointer;';
                upBtn.addEventListener('click', () => this.moveAction(index, index - 1));
                controlDiv.appendChild(upBtn);
            }

            // Move down button
            if (index < behaviorActions.length - 1) {
                const downBtn = document.createElement('button');
                downBtn.textContent = '↓';
                downBtn.title = 'Move down (lower priority)';
                downBtn.style.cssText = 'padding: 2px 6px; font-size: 10px; background: #333; border: none; color: #fff; border-radius: 2px; cursor: pointer;';
                downBtn.addEventListener('click', () => this.moveAction(index, index + 1));
                controlDiv.appendChild(downBtn);
            }

            // Remove button
            const removeBtn = document.createElement('button');
            removeBtn.textContent = '×';
            removeBtn.title = 'Remove action';
            removeBtn.style.cssText = 'padding: 2px 6px; font-size: 12px; background: #ef4444; border: none; color: #fff; border-radius: 2px; cursor: pointer; margin-left: 4px;';
            removeBtn.addEventListener('click', () => this.removeActionFromTree(actionName));
            controlDiv.appendChild(removeBtn);

            controlsContainer.appendChild(controlDiv);
        });
    }

    moveAction(fromIndex, toIndex) {
        if (!this.objectData) return;

        const arrayKey = this.getChildNodesKey(this.objectData);
        const actions = this.objectData[arrayKey];
        if (!actions) return;

        const [moved] = actions.splice(fromIndex, 1);
        actions.splice(toIndex, 0, moved);

        this.renderTree();
        this.updateJSONView();
    }

    formatActionName(actionName) {
        // Convert CombatBehaviorAction -> Combat
        return actionName
            .replace('BehaviorAction', '')
            .replace('Action', '')
            .replace(/([A-Z])/g, ' $1')
            .trim();
    }

    createNode(svg, x, y, width, height, label, type, id) {
        const colors = {
            'selector': { fill: '#1e3a2f', stroke: '#10b981', text: '#10b981' },      // Green
            'sequence': { fill: '#1e2a3a', stroke: '#3b82f6', text: '#3b82f6' },      // Blue
            'parallel': { fill: '#3a2a1e', stroke: '#f59e0b', text: '#f59e0b' },      // Orange
            'decorator': { fill: '#2a1e3a', stroke: '#8b5cf6', text: '#8b5cf6' },     // Purple
            'condition': { fill: '#1e2a3a', stroke: '#3b82f6', text: '#3b82f6' },     // Blue (same as sequence)
            'action': { fill: '#3a1e1e', stroke: '#ef4444', text: '#ef4444' },        // Red
            'empty': { fill: '#2a2a2a', stroke: '#666', text: '#666' }                // Gray
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

    highlightActiveNode(currentAction) {
        // Remove previous highlights
        const nodes = document.querySelectorAll('.bt-graph-node');
        const availableActions = this.controller.getCollections().behaviorNodes || {};

        nodes.forEach(node => {
            const rect = node.querySelector('rect');
            if (rect) {
                rect.setAttribute('stroke-width', '2');
                // Reset to original color based on node type
                const nodeId = node.getAttribute('data-node-id');
                let strokeColor = '#ef4444'; // Default action color

                if (nodeId === 'root') {
                    const rootType = this.getNodeType(this.objectData);
                    const colors = {
                        'selector': '#10b981',
                        'sequence': '#3b82f6',
                        'parallel': '#f59e0b',
                        'decorator': '#8b5cf6'
                    };
                    strokeColor = colors[rootType] || '#10b981';
                } else if (nodeId) {
                    const actionData = availableActions[nodeId];
                    const nodeType = this.getNodeType(actionData);
                    const colors = {
                        'selector': '#10b981',
                        'sequence': '#3b82f6',
                        'parallel': '#f59e0b',
                        'decorator': '#8b5cf6',
                        'action': '#ef4444'
                    };
                    strokeColor = colors[nodeType] || '#ef4444';
                }
                rect.setAttribute('stroke', strokeColor);
            }
        });

        // Highlight active nodes based on result
        if (!currentAction) return;

        // Highlight root
        this.highlightNode('root');

        // Highlight the action directly
        this.highlightNode(currentAction);
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
        this.mockGame.init(true, this.controller.getCollections().editorModules.behaviorTreeModule);


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

    createComponentEditor(container, entityId, componentType, componentData) {
        const detailsEl = document.createElement('details');
        detailsEl.open = false;
        detailsEl.style.marginBottom = '12px';
        detailsEl.style.border = '1px solid #333';
        detailsEl.style.borderRadius = '4px';
        detailsEl.style.padding = '8px';

        // Summary with component name and remove button
        const summary = document.createElement('summary');
        summary.style.cursor = 'pointer';
        summary.style.fontWeight = '600';
        summary.style.fontSize = '11px';
        summary.style.color = '#6366f1';
        summary.style.display = 'flex';
        summary.style.alignItems = 'center';
        summary.style.justifyContent = 'space-between';
        summary.style.marginBottom = '8px';
        summary.innerHTML = `<span>${componentType}</span>`;

        // Remove button inside summary
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
        summary.appendChild(removeBtn);

        detailsEl.appendChild(summary);

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

        // Re-evaluate to update results
        this.displaySimulationResults();
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
                this.displaySimulationResults();
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
                this.displaySimulationResults();
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
                    this.displaySimulationResults();
                } catch (err) {
                    alert('Invalid JSON: ' + err.message);
                }
            });
            propDiv.appendChild(textarea);
        }

        container.appendChild(propDiv);
    }

    /**
     * Run one tree evaluation step
     */
    stepSimulation() {
        if (!this.mockGame) return;

        // Run one game update tick - this will call BehaviorSystem.update()
        // BehaviorSystem reads aiState.rootBehaviorTree and evaluates that tree
        this.mockGame.update(this.tickRate);

        // Display results after evaluation
        this.displaySimulationResults();
    }

    /**
     * Toggle play/pause for continuous simulation
     */
    togglePlaySimulation() {
        if (this.isPlaying) {
            this.pauseSimulation();
        } else {
            this.playSimulation();
        }
    }

    /**
     * Start continuous tree evaluation
     */
    playSimulation() {
        if (!this.mockGame) return;

        this.isPlaying = true;
        const playBtn = document.getElementById('bt-play-btn');
        if (playBtn) {
            playBtn.textContent = '⏸ Pause';
            playBtn.classList.add('editor-module__btn--warning');
        }

        // Run game updates repeatedly - 500ms interval (2 evaluations per second)
        const evaluationInterval = 500;

        this.playInterval = setInterval(() => {
            // Run one game update tick - this will call BehaviorSystem.update()
            this.mockGame.update(this.tickRate);
            this.displaySimulationResults();
        }, evaluationInterval);
    }

    /**
     * Stop continuous simulation
     */
    pauseSimulation() {
        this.isPlaying = false;
        const playBtn = document.getElementById('bt-play-btn');
        if (playBtn) {
            playBtn.textContent = '▶ Play';
            playBtn.classList.remove('editor-module__btn--warning');
        }

        if (this.playInterval) {
            clearInterval(this.playInterval);
            this.playInterval = null;
        }
    }

    /**
     * Display simulation results after a tick
     */
    displaySimulationResults() {
        if (!this.mockGame) return;

        // Evaluate behavior tree only for the main entity (first entity)
        const results = [];
        const entityIds = Array.from(this.mockGame.entities.keys());

        if (entityIds.length > 0) {
            const mainEntityId = entityIds[0];
            // Get debug trace from BehaviorSystem's processor via gameManager
            const debugger_ = this.mockGame.gameManager.call('getDebugger');
            const trace = debugger_?.getLastTrace(mainEntityId);

            results.push({
                entityId: mainEntityId,
                entityLabel: this.mockGame.getEntityLabel(mainEntityId),
                aiState: this.mockGame.getComponent(mainEntityId, 'aiState'),
                result: trace?.result,
                trace
            });
        }

        this.displaySimResult(results);
    }

    /**
     * @deprecated Use stepSimulation() instead
     */
    runSimulation() {
        this.stepSimulation();
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
        let highlightedAction = null;
        for (const { aiState } of results) {
            if (aiState && aiState.currentAction) {
                highlightedAction = aiState.currentAction;
                break;
            }
        }
        if (this.isScriptBased && highlightedAction) {
            this.highlightActiveNode(highlightedAction);
        }

        results.forEach(({ entityId, entityLabel, aiState, result, trace }) => {
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

            // Display tree evaluation result
            if (result) {
                const resultType = typeof result;
                if (resultType === 'string') {
                    // Result is an action name
                    resultContent.innerHTML = `
                        <div style="color: #22c55e;"><strong>\u2713 Action Selected</strong></div>
                        <div style="margin-top: 4px;"><strong>Action:</strong> ${result}</div>
                    `;
                } else if (resultType === 'object' && result !== null) {
                    // Result is an object - display its properties
                    resultContent.innerHTML = `
                        <div style="color: #22c55e;"><strong>\u2713 Evaluation Result</strong></div>
                        <div style="margin-top: 4px;"><pre style="margin: 0; font-size: 10px;">${JSON.stringify(result, null, 2)}</pre></div>
                    `;
                } else {
                    // Other result types
                    resultContent.innerHTML = `
                        <div style="color: #22c55e;"><strong>\u2713 Result:</strong> ${result}</div>
                    `;
                }
            } else {
                resultContent.innerHTML = `<div style="color: #888;">\u2717 No result</div>`;
            }

            // Also show current action from aiState if available
            if (aiState && aiState.currentAction) {
                const actionDiv = document.createElement('div');
                actionDiv.style.marginTop = '8px';
                actionDiv.style.paddingTop = '8px';
                actionDiv.style.borderTop = '1px solid #333';
                actionDiv.innerHTML = `<div style="color: #aaa;"><strong>Current Action:</strong> ${aiState.currentAction}</div>`;
                resultContent.appendChild(actionDiv);
            }

            entityCard.appendChild(resultContent);

            // Add debug trace section if available
            if (trace) {
                const traceSection = this.createTraceDisplay(trace);
                entityCard.appendChild(traceSection);
            }

            resultDiv.appendChild(entityCard);
        });
    }

    /**
     * Create a visual display of the debug trace
     * @param {Object} trace - Debug trace from BehaviorTreeDebugger
     * @returns {HTMLElement} trace display element
     */
    createTraceDisplay(trace) {
        const traceDiv = document.createElement('details');
        traceDiv.open = true; // Open by default so trace is visible
        traceDiv.style.marginTop = '10px';
        traceDiv.style.borderTop = '1px solid #333';
        traceDiv.style.paddingTop = '8px';

        const summary = document.createElement('summary');
        summary.style.cursor = 'pointer';
        summary.style.fontSize = '11px';
        summary.style.fontWeight = '600';
        summary.style.color = '#6366f1';
        summary.innerHTML = `Execution Trace <span style="color: #666; font-weight: normal;">(${trace.duration?.toFixed(2) || '?'}ms)</span>`;
        traceDiv.appendChild(summary);

        const traceContent = document.createElement('div');
        traceContent.style.marginTop = '8px';
        traceContent.style.fontSize = '10px';
        traceContent.style.fontFamily = 'monospace';
        traceContent.style.backgroundColor = '#0a0a0a';
        traceContent.style.padding = '8px';
        traceContent.style.borderRadius = '4px';
        traceContent.style.maxHeight = '200px';
        traceContent.style.overflow = 'auto';

        // Header info
        const headerDiv = document.createElement('div');
        headerDiv.style.color = '#888';
        headerDiv.style.marginBottom = '8px';
        headerDiv.innerHTML = `Tick: ${trace.tick} | Tree: ${trace.treeId}`;
        traceContent.appendChild(headerDiv);

        // Node evaluations
        if (trace.nodes && trace.nodes.length > 0) {
            const nodesDiv = document.createElement('div');
            nodesDiv.innerHTML = '<div style="color: #aaa; margin-bottom: 4px;">Evaluation Path:</div>';

            trace.nodes.forEach((node, index) => {
                const nodeDiv = document.createElement('div');
                nodeDiv.style.marginLeft = '8px';
                nodeDiv.style.marginBottom = '2px';

                const statusIcon = this.getStatusIcon(node.status);
                const statusColor = this.getStatusColor(node.status);

                let nodeHtml = `<span style="color: #666;">#${node.index + 1}</span> `;
                nodeHtml += `<span style="color: ${statusColor};">${statusIcon}</span> `;
                nodeHtml += `<span style="color: #fff;">${node.name}</span> `;
                nodeHtml += `<span style="color: ${statusColor};">[${node.status}]</span>`;

                if (node.type && node.type !== 'action') {
                    nodeHtml += ` <span style="color: #666;">(${node.type})</span>`;
                }

                if (node.duration !== null && node.duration !== undefined) {
                    nodeHtml += ` <span style="color: #666;">${node.duration.toFixed(2)}ms</span>`;
                }

                if (node.reason) {
                    nodeHtml += ` <span style="color: #888;">- ${node.reason}</span>`;
                }

                nodeDiv.innerHTML = nodeHtml;
                nodesDiv.appendChild(nodeDiv);

                // Show memory if present
                if (node.memory && Object.keys(node.memory).length > 0) {
                    const memoryDiv = document.createElement('div');
                    memoryDiv.style.marginLeft = '24px';
                    memoryDiv.style.color = '#666';
                    memoryDiv.innerHTML = `Memory: ${JSON.stringify(node.memory)}`;
                    nodesDiv.appendChild(memoryDiv);
                }

                // Show meta if present
                if (node.meta && Object.keys(node.meta).length > 0) {
                    const metaDiv = document.createElement('div');
                    metaDiv.style.marginLeft = '24px';
                    metaDiv.style.color = '#666';
                    metaDiv.innerHTML = `Meta: ${JSON.stringify(node.meta)}`;
                    nodesDiv.appendChild(metaDiv);
                }
            });

            traceContent.appendChild(nodesDiv);
        }

        // State snapshot
        if (trace.stateSnapshot) {
            const stateDiv = document.createElement('div');
            stateDiv.style.marginTop = '8px';
            stateDiv.style.borderTop = '1px solid #333';
            stateDiv.style.paddingTop = '8px';
            stateDiv.innerHTML = `<div style="color: #aaa; margin-bottom: 4px;">State Snapshot:</div>`;
            stateDiv.innerHTML += `<div style="margin-left: 8px; color: #888;">${JSON.stringify(trace.stateSnapshot, null, 2)}</div>`;
            traceContent.appendChild(stateDiv);
        }

        traceDiv.appendChild(traceContent);
        return traceDiv;
    }

    /**
     * Get status icon for display
     * @param {string} status
     * @returns {string} icon character
     */
    getStatusIcon(status) {
        switch (status) {
            case 'success': return '\u2713';
            case 'failure': return '\u2717';
            case 'running': return '\u27F3';
            case 'skipped': return '\u2192';
            default: return '\u25CB';
        }
    }

    /**
     * Get status color for display
     * @param {string} status
     * @returns {string} CSS color
     */
    getStatusColor(status) {
        switch (status) {
            case 'success': return '#22c55e';
            case 'failure': return '#ef4444';
            case 'running': return '#f59e0b';
            case 'skipped': return '#6b7280';
            default: return '#888';
        }
    }

    resetSimulation() {
        // Stop any running simulation
        this.pauseSimulation();

        // Clear debug data from BehaviorSystem's processor before resetting
        if (this.mockGame?.gameManager) {
            const processor = this.mockGame.behaviorSystem?.processor;
            if (processor) {
                processor.clearAllDebugData();
            }
        }

        // Reset mock game context to original state
        if (GUTS && GUTS.MockGameContext) {
            this.mockGame = GUTS.MockGameContext.fromBehaviorTreeData(this.objectData, this.controller);
            this.mockGame.init(true, this.controller.getCollections().editorModules.behaviorTreeModule);
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
