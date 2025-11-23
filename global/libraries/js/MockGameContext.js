/**
 * Mock Game Context for Behavior Tree Editor
 * Simulates the game's component system for testing behavior trees
 * Extends BaseECSGame to match the actual game's ECS structure
 */
class MockGameContext extends GUTS.BaseECSGame {
    constructor(mockEntitiesData = []) {
        // Create minimal mock app object for BaseECSGame
        const mockApp = {
            moduleManager: null,
            getCollections: () => ({
                configs: {},
                textures: {}
            })
        };

        super(mockApp);

        // Track entity labels separately (not part of core ECS)
        this.entityLabels = new Map();
        this.currentEntityId = null;

        // Initialize componentTypes (matching game's componentTypes)
        this.componentTypes = {
            POSITION: 'POSITION',
            TEAM: 'TEAM',
            UNIT_CONTROLLER: 'UNIT_CONTROLLER',
            BUILDER: 'BUILDER',
            VELOCITY: 'VELOCITY',
            COMBAT: 'COMBAT',
            HEALTH: 'HEALTH',
            RESOURCE: 'RESOURCE'
        };

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
                this.addMockEntity(entityData.id, entityData.components, entityData.label);
            });
        } else if (Object.keys(mockEntitiesData).length > 0) {
            // Legacy support: single entity passed as object
            this.addMockEntity('entity-1', mockEntitiesData, 'Entity 1');
        }

        // If no entities were added, create a default one
        if (this.entities.size === 0) {
            this.addMockEntity('entity-1', {}, 'Entity 1');
        }

        // Set current entity to first one
        this.currentEntityId = Array.from(this.entities.keys())[0];
    }



    /**
     * Add a new mock entity with components
     * Uses BaseECSGame's ECS structure
     * @param {string} entityId - Unique entity ID
     * @param {Object} componentsData - Component data for this entity
     * @param {string} label - Human-readable label
     */
    addMockEntity(entityId, componentsData = {}, label = null) {
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
     * Alias for addMockEntity (for backward compatibility)
     * @param {string} entityId - Unique entity ID
     * @param {Object} componentsData - Component data for this entity
     * @param {string} label - Human-readable label
     */
    addEntity(entityId, componentsData = {}, label = null) {
        return this.addMockEntity(entityId, componentsData, label);
    }

    /**
     * Remove an entity
     * @param {string} entityId - Entity to remove
     */
    removeEntity(entityId) {
        // Use BaseECSGame's destroyEntity method
        this.destroyEntity(entityId);
        this.entityLabels.delete(entityId);

        // Update current entity if we deleted it
        if (this.currentEntityId === entityId) {
            this.currentEntityId = this.entities.size > 0 ? Array.from(this.entities.keys())[0] : null;
        }
    }

    /**
     * Get entity by ID
     * Returns an object with entity data (for compatibility with editor)
     * @param {string} entityId - Entity ID
     * @returns {Object|null} - Entity data or null
     */
    getEntity(entityId) {
        if (!this.entities.has(entityId)) {
            return null;
        }

        // Build entity object from BaseECSGame's structure
        const componentTypes = this.entities.get(entityId);
        const components = {};

        for (const componentType of componentTypes) {
            const componentData = this.getComponent(entityId, componentType);
            if (componentData) {
                components[componentType] = componentData;
            }
        }

        return {
            id: entityId,
            label: this.entityLabels.get(entityId) || entityId,
            components: components
        };
    }

    /**
     * Get all entity IDs
     * @returns {Array} - Array of entity IDs
     */
    getAllEntityIds() {
        return Array.from(this.entities.keys());
    }

    /**
     * Get all entities
     * @returns {Array} - Array of entity objects
     */
    getAllEntities() {
        const entities = [];
        for (const entityId of this.entities.keys()) {
            entities.push(this.getEntity(entityId));
        }
        return entities;
    }

    /**
     * Get entities that have a specific component
     * @param {string} componentType - Component type to filter by
     * @returns {Array} - Array of entity IDs
     */
    getEntitiesByComponent(componentType) {
        // Use BaseECSGame's getEntitiesWith method
        return this.getEntitiesWith(componentType);
    }

    /**
     * Set a component on an entity
     * Wrapper around BaseECSGame's addComponent for convenience
     * @param {string} entityId - Entity ID
     * @param {string} componentType - Component type to set
     * @param {Object} data - Component data
     */
    setComponent(entityId, componentType, data) {
        if (!this.entities.has(entityId)) {
            return;
        }

        // Remove existing component if present, then add new one
        if (this.hasComponent(entityId, componentType)) {
            this.removeComponent(entityId, componentType);
        }
        this.addComponent(entityId, componentType, { ...data });
    }

    /**
     * Update a component property on an entity
     * @param {string} entityId - Entity ID
     * @param {string} componentType - Component type
     * @param {string} property - Property name
     * @param {any} value - New value
     */
    updateComponent(entityId, componentType, property, value) {
        const component = this.getComponent(entityId, componentType);
        if (component) {
            component[property] = value;
        }
    }

    /**
     * Update entity label
     * @param {string} entityId - Entity ID
     * @param {string} label - New label
     */
    updateEntityLabel(entityId, label) {
        if (this.entities.has(entityId)) {
            this.entityLabels.set(entityId, label);
        }
    }

    /**
     * Create a mock game context from behavior tree data
     * @param {Object} behaviorTreeData - The behavior tree JSON data
     * @returns {MockGameContext} - Mock game context instance
     */
    static fromBehaviorTreeData(behaviorTreeData) {
        // Support both new mockEntities (array) and legacy mockEntity (object)
        const mockData = behaviorTreeData.mockEntities.entities;
        console.log('reset with', behaviorTreeData.mockEntities, mockData);
        return new MockGameContext(mockData);
    }

    /**
     * Export all entities state
     * @returns {Array} - Array of entity data
     */
    export() {
        const exported = [];
        for (const entityId of this.entities.keys()) {
            const entity = this.getEntity(entityId);
            if (entity) {
                exported.push({
                    id: entity.id,
                    label: entity.label,
                    components: entity.components
                });
            }
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
