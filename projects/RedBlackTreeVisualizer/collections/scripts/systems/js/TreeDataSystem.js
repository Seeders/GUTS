/**
 * TreeDataSystem - Manages Red-Black Tree data structure using ECS entities
 *
 * Animation-driven: Tree modifications happen when animation steps execute,
 * not before. This ensures visual sync with actual data changes.
 */

const NODE_COLOR = {
    RED: 'RED',
    BLACK: 'BLACK'
};

const AnimationType = {
    COMPARE: 'COMPARE',
    INSERT_NODE: 'INSERT_NODE',
    DELETE_NODE: 'DELETE_NODE',
    ROTATE_LEFT: 'ROTATE_LEFT',
    ROTATE_RIGHT: 'ROTATE_RIGHT',
    RECOLOR: 'RECOLOR',
    FOUND: 'FOUND',
    NOT_FOUND: 'NOT_FOUND',
    COMPLETE: 'COMPLETE',
    START_INSERT: 'START_INSERT',
    START_DELETE: 'START_DELETE',
    START_SEARCH: 'START_SEARCH'
};

class TreeDataSystem extends GUTS.BaseSystem {
    static services = [
        'getTreeRoot',
        'queueInsert',
        'queueDelete',
        'queueSearch',
        'getNextStep',
        'hasMoreSteps',
        'executeStep',
        'clearTree',
        'loadSampleData',
        'getAllNodeEntities',
        'getNodeEntity',
        'recalculatePositions'
    ];

    static serviceDependencies = [];

    constructor(game) {
        super(game);
        this.game.treeDataSystem = this;

        this.rootEntityId = null;
        this.animationQueue = [];
        this.valueToEntity = new Map();

        // Layout configuration
        this.horizontalSpacing = 3;
        this.verticalSpacing = 2.5;
        this.startY = 8;
    }

    async init() {
        console.log('TreeDataSystem initialized');
    }

    // ============= Services =============

    getTreeRoot() {
        return this.rootEntityId;
    }

    getAllNodeEntities() {
        return this.game.getEntitiesWith('treeNode');
    }

    getNodeEntity(value) {
        return this.valueToEntity.get(value) || null;
    }

    hasMoreSteps() {
        return this.animationQueue.length > 0;
    }

    getNextStep() {
        return this.animationQueue.length > 0 ? this.animationQueue[0] : null;
    }

    executeStep() {
        if (this.animationQueue.length === 0) return null;

        const step = this.animationQueue.shift();

        // Execute the action if present
        if (step.action) {
            step.action();
        }

        return step;
    }

    clearTree() {
        const entities = this.game.getEntitiesWith('treeNode');
        for (const entityId of entities) {
            this.game.destroyEntity(entityId);
        }
        this.rootEntityId = null;
        this.valueToEntity.clear();
        this.animationQueue = [];
    }

    loadSampleData() {
        console.log('TreeDataSystem: loadSampleData called');
        this.clearTree();
        const sampleData = [50, 25, 75, 10, 30, 60, 90, 5, 15, 27, 55, 80, 95];

        // Insert without animation for bulk load
        for (const value of sampleData) {
            this._insertImmediate(value);
        }

        this.recalculatePositions();
        console.log('TreeDataSystem: Sample data loaded, entities:', this.game.getEntitiesWith('treeNode').length);
        console.log('TreeDataSystem: Root entity:', this.rootEntityId);
        return sampleData;
    }

    // ============= Queue Operations =============

    queueInsert(value) {
        if (this.valueToEntity.has(value)) {
            this.animationQueue.push({
                type: AnimationType.COMPLETE,
                data: { message: `Value ${value} already exists` }
            });
            return;
        }

        // Start insert animation
        this.animationQueue.push({
            type: AnimationType.START_INSERT,
            data: { value }
        });

        // Find insertion point with comparison animations
        const insertionPath = this._findInsertionPath(value);

        // Add comparison steps
        for (const step of insertionPath.comparisons) {
            this.animationQueue.push(step);
        }

        // Insert the node
        this.animationQueue.push({
            type: AnimationType.INSERT_NODE,
            data: { value, parentValue: insertionPath.parentValue, isLeft: insertionPath.isLeft },
            action: () => {
                this._createNodeEntity(value, insertionPath.parentValue, insertionPath.isLeft);
                this.recalculatePositions();
            }
        });

        // Queue fix-up operations
        this._queueInsertFixup(value);

        this.animationQueue.push({
            type: AnimationType.COMPLETE,
            data: { message: 'Insert complete' },
            action: () => this.recalculatePositions()
        });
    }

    queueDelete(value) {
        if (!this.valueToEntity.has(value)) {
            this.animationQueue.push({
                type: AnimationType.NOT_FOUND,
                data: { value }
            });
            return;
        }

        this.animationQueue.push({
            type: AnimationType.START_DELETE,
            data: { value }
        });

        // Find the node with comparison animations
        const searchPath = this._findNodePath(value);
        for (const step of searchPath) {
            this.animationQueue.push(step);
        }

        // Queue the deletion with fix-up
        this._queueDeleteNode(value);

        this.animationQueue.push({
            type: AnimationType.COMPLETE,
            data: { message: 'Delete complete' },
            action: () => this.recalculatePositions()
        });
    }

    queueSearch(value) {
        this.animationQueue.push({
            type: AnimationType.START_SEARCH,
            data: { value }
        });

        let currentId = this.rootEntityId;
        let found = false;

        while (currentId !== null) {
            const node = this.game.getComponent(currentId, 'treeNode');

            const result = value === node.value ? 'equal' :
                           (value < node.value ? 'less' : 'greater');

            this.animationQueue.push({
                type: AnimationType.COMPARE,
                data: { searchValue: value, nodeValue: node.value, result }
            });

            if (value === node.value) {
                found = true;
                this.animationQueue.push({
                    type: AnimationType.FOUND,
                    data: { value }
                });
                break;
            } else if (value < node.value) {
                currentId = node.leftId;
            } else {
                currentId = node.rightId;
            }
        }

        if (!found) {
            this.animationQueue.push({
                type: AnimationType.NOT_FOUND,
                data: { value }
            });
        }

        return found;
    }

    // ============= Internal Methods =============

    _findInsertionPath(value) {
        const comparisons = [];
        let currentId = this.rootEntityId;
        let parentValue = null;
        let isLeft = false;

        while (currentId !== null) {
            const node = this.game.getComponent(currentId, 'treeNode');
            parentValue = node.value;

            const result = value < node.value ? 'less' : 'greater';
            comparisons.push({
                type: AnimationType.COMPARE,
                data: { newValue: value, nodeValue: node.value, result }
            });

            if (value < node.value) {
                if (node.leftId === null) {
                    isLeft = true;
                    break;
                }
                currentId = node.leftId;
            } else {
                if (node.rightId === null) {
                    isLeft = false;
                    break;
                }
                currentId = node.rightId;
            }
        }

        return { comparisons, parentValue, isLeft };
    }

    _findNodePath(value) {
        const steps = [];
        let currentId = this.rootEntityId;

        while (currentId !== null) {
            const node = this.game.getComponent(currentId, 'treeNode');
            const result = value === node.value ? 'equal' :
                           (value < node.value ? 'less' : 'greater');

            steps.push({
                type: AnimationType.COMPARE,
                data: { searchValue: value, nodeValue: node.value, result }
            });

            if (value === node.value) break;
            currentId = value < node.value ? node.leftId : node.rightId;
        }

        return steps;
    }

    _createNodeEntity(value, parentValue, isLeft) {
        const nodeId = this.game.createEntity();

        this.game.addComponent(nodeId, 'transform', {
            position: { x: 0, y: this.startY, z: 0 },
            rotation: { x: 0, y: 0, z: 0 },
            scale: { x: 1, y: 1, z: 1 }
        });

        this.game.addComponent(nodeId, 'treeNode', {
            value: value,
            color: NODE_COLOR.RED,
            parentId: null,
            leftId: null,
            rightId: null,
            isRoot: false,
            depth: 0,
            highlighted: false
        });

        this.valueToEntity.set(value, nodeId);

        if (parentValue === null) {
            // First node - becomes root
            this.rootEntityId = nodeId;
            const node = this.game.getComponent(nodeId, 'treeNode');
            node.color = NODE_COLOR.BLACK;
            node.isRoot = true;
        } else {
            const parentId = this.valueToEntity.get(parentValue);
            const parent = this.game.getComponent(parentId, 'treeNode');
            const node = this.game.getComponent(nodeId, 'treeNode');

            node.parentId = parentId;
            if (isLeft) {
                parent.leftId = nodeId;
            } else {
                parent.rightId = nodeId;
            }
        }

        return nodeId;
    }

    _queueInsertFixup(value) {
        // We need to simulate the fix-up to queue the right steps
        // This is done by walking through what the fix-up WOULD do

        const nodeId = this.valueToEntity.get(value);
        if (!nodeId) return;

        // Clone the current state to simulate
        const simulatedState = this._cloneTreeState();
        this._simulateAndQueueFixup(value, simulatedState);
    }

    _cloneTreeState() {
        const state = new Map();
        const entities = this.game.getEntitiesWith('treeNode');
        for (const entityId of entities) {
            const node = this.game.getComponent(entityId, 'treeNode');
            state.set(node.value, { ...node, entityId });
        }
        return state;
    }

    _simulateAndQueueFixup(value, state) {
        let current = state.get(value);
        if (!current) return;

        const getNode = (val) => state.get(val);
        const getParent = (node) => node.parentId ?
            Array.from(state.values()).find(n => n.entityId === node.parentId) : null;

        while (current && !current.isRoot) {
            const parent = getParent(current);
            if (!parent || parent.color !== NODE_COLOR.RED) break;

            const grandparent = getParent(parent);
            if (!grandparent) break;

            const grandparentNode = this.game.getComponent(grandparent.entityId, 'treeNode');
            const isParentLeft = grandparentNode.leftId === parent.entityId;

            const uncleId = isParentLeft ? grandparentNode.rightId : grandparentNode.leftId;
            const uncle = uncleId ? this.game.getComponent(uncleId, 'treeNode') : null;

            if (uncle && uncle.color === NODE_COLOR.RED) {
                // Case 1: Uncle is red - recolor
                this.animationQueue.push({
                    type: AnimationType.RECOLOR,
                    data: {
                        nodes: [parent.value, uncle.value, grandparent.value],
                        reason: 'Uncle is red - recolor parent, uncle, grandparent'
                    },
                    action: () => {
                        const p = this.game.getComponent(this.valueToEntity.get(parent.value), 'treeNode');
                        const u = this.game.getComponent(this.valueToEntity.get(uncle.value), 'treeNode');
                        const g = this.game.getComponent(this.valueToEntity.get(grandparent.value), 'treeNode');
                        if (p) p.color = NODE_COLOR.BLACK;
                        if (u) u.color = NODE_COLOR.BLACK;
                        if (g) g.color = NODE_COLOR.RED;
                    }
                });

                // Update simulation state
                parent.color = NODE_COLOR.BLACK;
                state.get(uncle.value).color = NODE_COLOR.BLACK;
                grandparent.color = NODE_COLOR.RED;
                current = grandparent;
            } else {
                // Cases 2 and 3
                const parentNode = this.game.getComponent(parent.entityId, 'treeNode');
                const isCurrentRight = parentNode.rightId === current.entityId;
                const isCurrentLeft = parentNode.leftId === current.entityId;

                if (isParentLeft && isCurrentRight) {
                    // Case 2a: Left-Right - rotate left at parent
                    this._queueRotateLeft(parent.value);
                    current = parent;
                } else if (!isParentLeft && isCurrentLeft) {
                    // Case 2b: Right-Left - rotate right at parent
                    this._queueRotateRight(parent.value);
                    current = parent;
                }

                // Case 3: Straight line
                const newParent = getParent(current);
                if (newParent) {
                    const newGrandparent = getParent(newParent);
                    if (newGrandparent) {
                        this.animationQueue.push({
                            type: AnimationType.RECOLOR,
                            data: {
                                nodes: [newParent.value, newGrandparent.value],
                                reason: 'Recolor before final rotation'
                            },
                            action: () => {
                                const p = this.game.getComponent(this.valueToEntity.get(newParent.value), 'treeNode');
                                const g = this.game.getComponent(this.valueToEntity.get(newGrandparent.value), 'treeNode');
                                if (p) p.color = NODE_COLOR.BLACK;
                                if (g) g.color = NODE_COLOR.RED;
                            }
                        });

                        const newGpNode = this.game.getComponent(newGrandparent.entityId, 'treeNode');
                        if (newGpNode.leftId === newParent.entityId) {
                            this._queueRotateRight(newGrandparent.value);
                        } else {
                            this._queueRotateLeft(newGrandparent.value);
                        }
                    }
                }
                break;
            }
        }

        // Ensure root is black
        this.animationQueue.push({
            type: AnimationType.RECOLOR,
            data: { nodes: [], reason: 'Ensure root is black' },
            action: () => {
                if (this.rootEntityId) {
                    const root = this.game.getComponent(this.rootEntityId, 'treeNode');
                    if (root) root.color = NODE_COLOR.BLACK;
                }
            }
        });
    }

    _queueRotateLeft(nodeValue) {
        this.animationQueue.push({
            type: AnimationType.ROTATE_LEFT,
            data: { node: nodeValue },
            action: () => this._rotateLeft(this.valueToEntity.get(nodeValue))
        });
    }

    _queueRotateRight(nodeValue) {
        this.animationQueue.push({
            type: AnimationType.ROTATE_RIGHT,
            data: { node: nodeValue },
            action: () => this._rotateRight(this.valueToEntity.get(nodeValue))
        });
    }

    _rotateLeft(nodeId) {
        const node = this.game.getComponent(nodeId, 'treeNode');
        const rightId = node.rightId;
        if (!rightId) return;

        const right = this.game.getComponent(rightId, 'treeNode');

        node.rightId = right.leftId;
        if (right.leftId) {
            this.game.getComponent(right.leftId, 'treeNode').parentId = nodeId;
        }

        right.parentId = node.parentId;

        if (!node.parentId) {
            this.rootEntityId = rightId;
            right.isRoot = true;
            node.isRoot = false;
        } else {
            const parent = this.game.getComponent(node.parentId, 'treeNode');
            if (nodeId === parent.leftId) {
                parent.leftId = rightId;
            } else {
                parent.rightId = rightId;
            }
        }

        right.leftId = nodeId;
        node.parentId = rightId;

        this.recalculatePositions();
    }

    _rotateRight(nodeId) {
        const node = this.game.getComponent(nodeId, 'treeNode');
        const leftId = node.leftId;
        if (!leftId) return;

        const left = this.game.getComponent(leftId, 'treeNode');

        node.leftId = left.rightId;
        if (left.rightId) {
            this.game.getComponent(left.rightId, 'treeNode').parentId = nodeId;
        }

        left.parentId = node.parentId;

        if (!node.parentId) {
            this.rootEntityId = leftId;
            left.isRoot = true;
            node.isRoot = false;
        } else {
            const parent = this.game.getComponent(node.parentId, 'treeNode');
            if (nodeId === parent.rightId) {
                parent.rightId = leftId;
            } else {
                parent.leftId = leftId;
            }
        }

        left.rightId = nodeId;
        node.parentId = leftId;

        this.recalculatePositions();
    }

    _queueDeleteNode(value) {
        const nodeId = this.valueToEntity.get(value);
        const node = this.game.getComponent(nodeId, 'treeNode');

        this.animationQueue.push({
            type: AnimationType.DELETE_NODE,
            data: { value },
            action: () => {
                this._performDelete(value);
                this.recalculatePositions();
            }
        });
    }

    _performDelete(value) {
        const nodeId = this.valueToEntity.get(value);
        if (!nodeId) return;

        const node = this.game.getComponent(nodeId, 'treeNode');

        // Simple BST delete - find replacement
        if (!node.leftId && !node.rightId) {
            // Leaf node
            this._transplant(nodeId, null);
        } else if (!node.leftId) {
            this._transplant(nodeId, node.rightId);
        } else if (!node.rightId) {
            this._transplant(nodeId, node.leftId);
        } else {
            // Two children - find in-order successor
            let successorId = node.rightId;
            let successor = this.game.getComponent(successorId, 'treeNode');
            while (successor.leftId) {
                successorId = successor.leftId;
                successor = this.game.getComponent(successorId, 'treeNode');
            }

            if (successor.parentId !== nodeId) {
                this._transplant(successorId, successor.rightId);
                successor.rightId = node.rightId;
                if (successor.rightId) {
                    this.game.getComponent(successor.rightId, 'treeNode').parentId = successorId;
                }
            }

            this._transplant(nodeId, successorId);
            successor.leftId = node.leftId;
            if (successor.leftId) {
                this.game.getComponent(successor.leftId, 'treeNode').parentId = successorId;
            }
            successor.color = node.color;
        }

        this.valueToEntity.delete(value);
        this.game.destroyEntity(nodeId);
    }

    _transplant(u, v) {
        const uNode = this.game.getComponent(u, 'treeNode');

        if (!uNode.parentId) {
            this.rootEntityId = v;
            if (v) {
                const vNode = this.game.getComponent(v, 'treeNode');
                vNode.isRoot = true;
                vNode.parentId = null;
            }
        } else {
            const parent = this.game.getComponent(uNode.parentId, 'treeNode');
            if (u === parent.leftId) {
                parent.leftId = v;
            } else {
                parent.rightId = v;
            }
            if (v) {
                this.game.getComponent(v, 'treeNode').parentId = uNode.parentId;
            }
        }
    }

    _insertImmediate(value) {
        if (this.valueToEntity.has(value)) return false;

        const nodeId = this.game.createEntity();

        this.game.addComponent(nodeId, 'transform', {
            position: { x: 0, y: this.startY, z: 0 },
            rotation: { x: 0, y: 0, z: 0 },
            scale: { x: 1, y: 1, z: 1 }
        });

        this.game.addComponent(nodeId, 'treeNode', {
            value: value,
            color: NODE_COLOR.RED,
            parentId: null,
            leftId: null,
            rightId: null,
            isRoot: false,
            depth: 0,
            highlighted: false
        });

        this.valueToEntity.set(value, nodeId);

        if (this.rootEntityId === null) {
            this.rootEntityId = nodeId;
            const node = this.game.getComponent(nodeId, 'treeNode');
            node.color = NODE_COLOR.BLACK;
            node.isRoot = true;
        } else {
            // Find parent
            let currentId = this.rootEntityId;
            let parentId = null;
            let isLeft = false;

            while (currentId !== null) {
                parentId = currentId;
                const current = this.game.getComponent(currentId, 'treeNode');
                if (value < current.value) {
                    isLeft = true;
                    currentId = current.leftId;
                } else {
                    isLeft = false;
                    currentId = current.rightId;
                }
            }

            const node = this.game.getComponent(nodeId, 'treeNode');
            const parent = this.game.getComponent(parentId, 'treeNode');
            node.parentId = parentId;

            if (isLeft) {
                parent.leftId = nodeId;
            } else {
                parent.rightId = nodeId;
            }

            this._fixInsertImmediate(nodeId);
        }

        return true;
    }

    _fixInsertImmediate(nodeId) {
        let current = nodeId;

        while (current !== this.rootEntityId) {
            const node = this.game.getComponent(current, 'treeNode');
            if (!node.parentId) break;

            const parent = this.game.getComponent(node.parentId, 'treeNode');
            if (parent.color !== NODE_COLOR.RED) break;

            if (!parent.parentId) break;
            const grandparent = this.game.getComponent(parent.parentId, 'treeNode');

            if (node.parentId === grandparent.leftId) {
                const uncleId = grandparent.rightId;
                const uncle = uncleId ? this.game.getComponent(uncleId, 'treeNode') : null;

                if (uncle && uncle.color === NODE_COLOR.RED) {
                    parent.color = NODE_COLOR.BLACK;
                    uncle.color = NODE_COLOR.BLACK;
                    grandparent.color = NODE_COLOR.RED;
                    current = parent.parentId;
                } else {
                    if (current === parent.rightId) {
                        current = node.parentId;
                        this._rotateLeft(current);
                    }
                    const p = this.game.getComponent(this.game.getComponent(current, 'treeNode').parentId, 'treeNode');
                    const g = this.game.getComponent(p.parentId, 'treeNode');
                    p.color = NODE_COLOR.BLACK;
                    g.color = NODE_COLOR.RED;
                    this._rotateRight(p.parentId);
                }
            } else {
                const uncleId = grandparent.leftId;
                const uncle = uncleId ? this.game.getComponent(uncleId, 'treeNode') : null;

                if (uncle && uncle.color === NODE_COLOR.RED) {
                    parent.color = NODE_COLOR.BLACK;
                    uncle.color = NODE_COLOR.BLACK;
                    grandparent.color = NODE_COLOR.RED;
                    current = parent.parentId;
                } else {
                    if (current === parent.leftId) {
                        current = node.parentId;
                        this._rotateRight(current);
                    }
                    const p = this.game.getComponent(this.game.getComponent(current, 'treeNode').parentId, 'treeNode');
                    const g = this.game.getComponent(p.parentId, 'treeNode');
                    p.color = NODE_COLOR.BLACK;
                    g.color = NODE_COLOR.RED;
                    this._rotateLeft(p.parentId);
                }
            }
        }

        const root = this.game.getComponent(this.rootEntityId, 'treeNode');
        root.color = NODE_COLOR.BLACK;
    }

    recalculatePositions() {
        if (!this.rootEntityId) return;

        const calculateDepth = (nodeId) => {
            if (!nodeId) return 0;
            const node = this.game.getComponent(nodeId, 'treeNode');
            return 1 + Math.max(calculateDepth(node.leftId), calculateDepth(node.rightId));
        };

        const treeDepth = calculateDepth(this.rootEntityId);
        const initialSpread = Math.min(12, 4 * Math.pow(1.5, Math.min(treeDepth, 5)));

        const assignPosition = (nodeId, x, y, spread, depth) => {
            if (!nodeId) return;

            const node = this.game.getComponent(nodeId, 'treeNode');
            const transform = this.game.getComponent(nodeId, 'transform');

            node.depth = depth;
            transform.position.x = x;
            transform.position.y = y;
            transform.position.z = 0;

            const childSpread = spread * 0.55;
            assignPosition(node.leftId, x - spread, y - this.verticalSpacing, childSpread, depth + 1);
            assignPosition(node.rightId, x + spread, y - this.verticalSpacing, childSpread, depth + 1);
        };

        assignPosition(this.rootEntityId, 0, this.startY, initialSpread, 0);
    }

    render() {
        // Data system doesn't render
    }
}

// Export
if (typeof window !== 'undefined') {
    window.TreeDataSystem = TreeDataSystem;
}
