/**
 * Mock Game Context for Behavior Tree Editor
 * Simulates the game's component system for testing behavior trees
 */
class MockGameContext {
    constructor(mockEntityData = {}) {
        this.mockEntityId = 'mock-entity-1';
        this.components = new Map();

        // Set up component types (matching game's componentTypes)
        this.componentTypes = {
            POSITION: 'POSITION',
            TEAM: 'TEAM',
            UNIT_CONTROLLER: 'UNIT_CONTROLLER',
            BUILDER: 'BUILDER',
            VELOCITY: 'VELOCITY',
            COMBAT: 'COMBAT'
        };

        // Initialize components from mock data
        for (const [componentType, data] of Object.entries(mockEntityData)) {
            this.components.set(componentType, { ...data });
        }

        // Mock systems
        this.goldMineSystem = {
            getTeamMines: (team) => {
                // Return mock mine IDs
                return this.mockMines || [];
            }
        };

        this.mockMines = [];
        this.mockEnemies = [];
    }

    /**
     * Get a component from the mock entity
     * @param {string} entityId - Entity ID (always the mock entity)
     * @param {string} componentType - Component type to get
     * @returns {Object|null} - The component data or null
     */
    getComponent(entityId, componentType) {
        // For simplicity, always return the mock entity's components
        return this.components.get(componentType) || null;
    }

    /**
     * Set a component on the mock entity
     * @param {string} componentType - Component type to set
     * @param {Object} data - Component data
     */
    setComponent(componentType, data) {
        this.components.set(componentType, { ...data });
    }

    /**
     * Update a component property
     * @param {string} componentType - Component type
     * @param {string} property - Property name
     * @param {any} value - New value
     */
    updateComponent(componentType, property, value) {
        const component = this.components.get(componentType);
        if (component) {
            component[property] = value;
        }
    }

    /**
     * Get all components (for UI display)
     * @returns {Map} - All components
     */
    getAllComponents() {
        return this.components;
    }

    /**
     * Set mock mines for testing
     * @param {Array} mineIds - Array of mine entity IDs
     */
    setMockMines(mineIds) {
        this.mockMines = mineIds;
    }

    /**
     * Set mock enemies for testing
     * @param {Array} enemyIds - Array of enemy entity IDs
     */
    setMockEnemies(enemyIds) {
        this.mockEnemies = enemyIds;
    }

    /**
     * Create a mock game context from behavior tree data
     * @param {Object} behaviorTreeData - The behavior tree JSON data
     * @returns {MockGameContext} - Mock game context instance
     */
    static fromBehaviorTreeData(behaviorTreeData) {
        const mockEntityData = behaviorTreeData.mockEntity || {};
        return new MockGameContext(mockEntityData);
    }

    /**
     * Export the current mock entity state
     * @returns {Object} - Component data
     */
    export() {
        const exported = {};
        for (const [type, data] of this.components.entries()) {
            exported[type] = { ...data };
        }
        return exported;
    }
}

// Export for use in both browser and Node.js environments
if (typeof module !== 'undefined' && module.exports) {
    module.exports = MockGameContext;
}

// Also make available on GUTS global if it exists
if (typeof GUTS !== 'undefined') {
    GUTS.MockGameContext = MockGameContext;
}
