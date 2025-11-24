/**
 * Mock Game Context for Behavior Tree Editor
 * Simulates the game's component system for testing behavior trees
 * Extends BaseECSGame to match the actual game's ECS structure
 */
class MockGameContext extends GUTS.BaseECSGame {
    constructor(mockEntitiesData = [], app = null) {
        // Use provided app (e.g., editor controller) or create minimal mock
        const mockApp = app || {
            moduleManager: null,
            getCollections: () => ({
                configs: {},
                textures: {},
                models: {}
            })
        };

        super(mockApp);

        // Track entity labels separately (not part of core ECS)
        this.entityLabels = new Map();
        this.currentEntityId = null;

        // Initialize componentManager to get componentTypes
        // Note: componentManager sets this.componentTypes via BaseECSGame
        this.componentManager = new GUTS.ComponentManager(this);

        // Initialize gameManager with GameServices
        this.gameManager = new GUTS.GameServices();

        // Initialize state (needed by BaseECSGame update loop)
        this.state = {
            isPaused: false,
            now: 0,
            deltaTime: 0,
            gameOver: false,
            victory: false
        };

        // Initialize entities from mock data
        if (Array.isArray(mockEntitiesData)) {
            mockEntitiesData.forEach(entityData => {
                this.initializeEntity(entityData.id, entityData.components, entityData.label);
            });
        }

        // If no entities were added, create a default one
        if (this.entities.size === 0) {
            this.initializeEntity('entity-1', {}, 'Entity 1');
        }

        // Set current entity to first one
        this.currentEntityId = Array.from(this.entities.keys())[0];
    }

    /**
     * Initialize an entity with components and label
     * @param {string} entityId - Unique entity ID
     * @param {Object} componentsData - Component data for this entity
     * @param {string} label - Human-readable label
     */
    initializeEntity(entityId, componentsData = {}, label = null) {
        console.log('added entity', entityId);

        // Create entity using BaseECSGame's method
        this.createEntity(entityId);

        // Store label separately
        this.entityLabels.set(entityId, label || entityId);

        // Add components using BaseECSGame's method
        for (const [componentType, data] of Object.entries(componentsData)) {
            this.addComponent(entityId, componentType, { ...data });
        }

        return entityId;
    }

    /**
     * Update entity label
     * @param {string} entityId - Entity ID
     * @param {string} label - New label
     */
    setEntityLabel(entityId, label) {
        if (this.entities.has(entityId)) {
            this.entityLabels.set(entityId, label);
        }
    }

    /**
     * Get entity label
     * @param {string} entityId - Entity ID
     * @returns {string} - Entity label
     */
    getEntityLabel(entityId) {
        return this.entityLabels.get(entityId) || entityId;
    }

    /**
     * Create a mock game context from behavior tree data
     * @param {Object} behaviorTreeData - The behavior tree JSON data
     * @param {Object} app - Optional app object (e.g., editor controller) with getCollections()
     * @returns {MockGameContext} - Mock game context instance
     */
    static fromBehaviorTreeData(behaviorTreeData, app = null) {
        // Support both new mockEntities (array) and legacy mockEntity (object)
        const mockData = behaviorTreeData.mockEntities.entities;
        console.log('reset with', behaviorTreeData.mockEntities, mockData);
        return new MockGameContext(mockData, app);
    }

    /**
     * Export all entities state for JSON serialization
     * @returns {Array} - Array of entity data
     */
    export() {
        const exported = [];
        for (const entityId of this.entities.keys()) {
            const componentTypes = this.entities.get(entityId);
            const componentsObj = {};

            // Extract all components for this entity
            for (const componentType of componentTypes) {
                const componentData = this.getComponent(entityId, componentType);
                if (componentData) {
                    componentsObj[componentType] = componentData;
                }
            }

            exported.push({
                id: entityId,
                label: this.getEntityLabel(entityId),
                components: componentsObj
            });
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
