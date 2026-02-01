/**
 * TreeInputSystem - Handles UI controls and step-by-step animation playback
 *
 * Executes animation steps in order, waiting for each to complete before
 * executing the next. Actions happen when their animation step plays.
 */

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

class TreeInputSystem extends GUTS.BaseSystem {
    static services = [];

    static serviceDependencies = [
        'queueInsert',
        'queueDelete',
        'queueSearch',
        'hasMoreSteps',
        'getNextStep',
        'executeStep',
        'clearTree',
        'loadSampleData',
        'highlightNode',
        'clearHighlights',
        'setComparing',
        'recalculatePositions'
    ];

    constructor(game) {
        super(game);
        this.game.treeInputSystem = this;

        // Animation state
        this.isAnimating = false;
        this.animationSpeed = 800;
        this.isPaused = false;
    }

    async init() {
        if (typeof window === 'undefined' || typeof document === 'undefined') {
            console.log('TreeInputSystem: Skipping init (not in browser)');
            return;
        }

        console.log('TreeInputSystem initializing...');

        await this.waitForElement('addBtn');
        this.setupControls();

        // Load sample data on start
        setTimeout(() => {
            console.log('TreeInputSystem: Attempting to load sample data...');
            console.log('TreeInputSystem: loadSampleData service available:', !!this.call.loadSampleData);
            if (this.call.loadSampleData) {
                const data = this.call.loadSampleData();
                this.updateStatus('Sample data loaded: ' + data.join(', '));
                console.log('TreeInputSystem: Sample data loaded successfully');
            } else {
                console.error('TreeInputSystem: loadSampleData service not available!');
            }
        }, 500);

        console.log('TreeInputSystem initialized');
    }

    waitForElement(id) {
        return new Promise((resolve) => {
            const check = () => {
                if (document.getElementById(id)) {
                    resolve();
                } else {
                    requestAnimationFrame(check);
                }
            };
            check();
        });
    }

    setupControls() {
        const elements = {
            addBtn: document.getElementById('addBtn'),
            removeBtn: document.getElementById('removeBtn'),
            searchBtn: document.getElementById('searchBtn'),
            randomBtn: document.getElementById('randomBtn'),
            clearBtn: document.getElementById('clearBtn'),
            sampleBtn: document.getElementById('sampleBtn'),
            speedSlider: document.getElementById('speedSlider'),
            valueInput: document.getElementById('valueInput')
        };

        if (elements.addBtn) {
            elements.addBtn.addEventListener('click', () => this.handleAdd());
        }

        if (elements.removeBtn) {
            elements.removeBtn.addEventListener('click', () => this.handleRemove());
        }

        if (elements.searchBtn) {
            elements.searchBtn.addEventListener('click', () => this.handleSearch());
        }

        if (elements.randomBtn) {
            elements.randomBtn.addEventListener('click', () => this.handleRandom());
        }

        if (elements.clearBtn) {
            elements.clearBtn.addEventListener('click', () => this.handleClear());
        }

        if (elements.sampleBtn) {
            elements.sampleBtn.addEventListener('click', () => this.handleSample());
        }

        if (elements.speedSlider) {
            elements.speedSlider.addEventListener('input', (e) => {
                this.animationSpeed = 1500 - (e.target.value * 14);
                const speedValue = document.getElementById('speedValue');
                if (speedValue) speedValue.textContent = e.target.value;
            });
        }

        if (elements.valueInput) {
            elements.valueInput.addEventListener('keypress', (e) => {
                if (e.key === 'Enter') {
                    this.handleAdd();
                }
            });
        }
    }

    async handleAdd() {
        if (this.isAnimating) return;

        const input = document.getElementById('valueInput');
        const value = parseInt(input.value);
        if (isNaN(value)) return;

        input.value = '';
        this.updateStatus(`Inserting ${value}...`);

        // Queue the insert operation
        this.call.queueInsert(value);

        // Play all queued steps
        await this.playQueuedSteps();
    }

    async handleRemove() {
        if (this.isAnimating) return;

        const input = document.getElementById('valueInput');
        const value = parseInt(input.value);
        if (isNaN(value)) return;

        input.value = '';
        this.updateStatus(`Removing ${value}...`);

        this.call.queueDelete(value);
        await this.playQueuedSteps();
    }

    async handleSearch() {
        if (this.isAnimating) return;

        const input = document.getElementById('valueInput');
        const value = parseInt(input.value);
        if (isNaN(value)) return;

        this.updateStatus(`Searching for ${value}...`);

        this.call.queueSearch(value);
        await this.playQueuedSteps();
    }

    handleRandom() {
        if (this.isAnimating) return;

        const value = Math.floor(Math.random() * 100) + 1;
        const input = document.getElementById('valueInput');
        input.value = value;
        this.handleAdd();
    }

    handleClear() {
        if (this.isAnimating) return;

        this.call.clearTree();
        this.call.clearHighlights();
        this.updateStatus('Tree cleared');
        this.updateStepInfo('');
    }

    handleSample() {
        if (this.isAnimating) return;

        const data = this.call.loadSampleData();
        this.call.clearHighlights();
        this.updateStatus('Sample data loaded: ' + data.join(', '));
        this.updateStepInfo('');
    }

    async playQueuedSteps() {
        this.isAnimating = true;

        while (this.call.hasMoreSteps()) {
            // Get the next step (peek)
            const step = this.call.getNextStep();

            // Update UI to show what's about to happen
            this.updateStepInfo(this.formatStep(step));
            this.updateHighlights(step);

            // Wait for animation duration
            await this.delay(this.animationSpeed);

            // Execute the step (this runs the action and removes from queue)
            this.call.executeStep();

            // Update positions after action
            if (step.action) {
                this.call.recalculatePositions();
            }
        }

        // Clean up
        this.call.clearHighlights();
        this.isAnimating = false;

        // Update final status based on last step
        this.updateStepInfo('Ready');
    }

    updateHighlights(step) {
        this.call.clearHighlights();

        switch (step.type) {
            case AnimationType.COMPARE:
                if (step.data.nodeValue !== null && step.data.nodeValue !== undefined) {
                    this.call.setComparing(step.data.nodeValue);
                }
                break;

            case AnimationType.INSERT_NODE:
                // Highlight where the node will be inserted
                if (step.data.parentValue !== null) {
                    this.call.highlightNode(step.data.parentValue);
                }
                break;

            case AnimationType.DELETE_NODE:
                this.call.highlightNode(step.data.value);
                break;

            case AnimationType.ROTATE_LEFT:
            case AnimationType.ROTATE_RIGHT:
                this.call.highlightNode(step.data.node);
                break;

            case AnimationType.RECOLOR:
                if (step.data.nodes) {
                    step.data.nodes.forEach(v => {
                        if (v !== null && v !== undefined) {
                            this.call.highlightNode(v);
                        }
                    });
                }
                break;

            case AnimationType.FOUND:
                this.call.highlightNode(step.data.value);
                break;
        }
    }

    formatStep(step) {
        switch (step.type) {
            case AnimationType.START_INSERT:
                return `Starting insert of ${step.data.value}...`;

            case AnimationType.START_DELETE:
                return `Starting delete of ${step.data.value}...`;

            case AnimationType.START_SEARCH:
                return `Starting search for ${step.data.value}...`;

            case AnimationType.COMPARE:
                if (step.data.nodeValue === null) return 'Starting traversal...';
                const searchVal = step.data.newValue || step.data.searchValue;
                const dir = step.data.result === 'less' ? 'LEFT' :
                            step.data.result === 'greater' ? 'RIGHT' : 'FOUND';
                return `Compare ${searchVal} with ${step.data.nodeValue} → go ${dir}`;

            case AnimationType.INSERT_NODE:
                const pos = step.data.isLeft ? 'left' : 'right';
                const parent = step.data.parentValue !== null ?
                    `as ${pos} child of ${step.data.parentValue}` : 'as root';
                return `Insert node ${step.data.value} ${parent}`;

            case AnimationType.DELETE_NODE:
                return `Delete node ${step.data.value}`;

            case AnimationType.ROTATE_LEFT:
                return `Rotate LEFT at node ${step.data.node}`;

            case AnimationType.ROTATE_RIGHT:
                return `Rotate RIGHT at node ${step.data.node}`;

            case AnimationType.RECOLOR:
                const nodes = step.data.nodes.filter(n => n !== null && n !== undefined);
                if (nodes.length === 0) return step.data.reason;
                return `Recolor nodes [${nodes.join(', ')}]: ${step.data.reason}`;

            case AnimationType.FOUND:
                return `Found ${step.data.value}!`;

            case AnimationType.NOT_FOUND:
                return `${step.data.value} not found`;

            case AnimationType.COMPLETE:
                this.updateStatus(step.data.message);
                return step.data.message;

            default:
                return '';
        }
    }

    delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    updateStatus(message) {
        const status = document.getElementById('status');
        if (status) status.textContent = message;
    }

    updateStepInfo(message) {
        const stepInfo = document.getElementById('stepInfo');
        if (stepInfo) stepInfo.textContent = message;
    }

    render() {
        // Input system doesn't render
    }
}

// Export
if (typeof window !== 'undefined') {
    window.TreeInputSystem = TreeInputSystem;
}
