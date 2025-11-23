/**
 * Mock Game Context for Behavior Tree Editor
 * Simulates the game's component system for testing behavior trees
 */
class MockGameContext {
    constructor(mockEntitiesData = []) {
        // Store multiple entities, each with their own components
        // entities is a Map: entityId -> Map(componentType -> componentData)
        this.entities = new Map();
        this.currentEntityId = null;
        this.nextEntityId = 1;

        // Set up component types (matching game's componentTypes)
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

        // Initialize entities from mock data
        if (Array.isArray(mockEntitiesData)) {
            mockEntitiesData.forEach(entityData => {
                this.addEntity(entityData.id, entityData.components, entityData.label);
            });
        } else if (Object.keys(mockEntitiesData).length > 0) {
            // Legacy support: single entity passed as object
            this.addEntity('entity-1', mockEntitiesData, 'Entity 1');
        }

        // If no entities were added, create a default one
        if (this.entities.size === 0) {
            this.addEntity('entity-1', {}, 'Entity 1');
        }

        // Set current entity to first one
        this.currentEntityId = Array.from(this.entities.keys())[0];

        // Mock gameManager with register functionality
        this.gameManager = this.createMockGameManager();
    }

    /**
     * Create mock gameManager that simulates runtime functionality
     * Follows the gameManager.register pattern used in-game
     */
    createMockGameManager() {
        const registeredFunctions = new Map();

        return {
            // Register a public function (mimics in-game systems)
            register: (name, fn) => {
                registeredFunctions.set(name, fn);
            },

            // Get a registered function
            get: (name) => {
                return registeredFunctions.get(name);
            },

            // Common entity query functions
            getEntitiesByComponent: (componentType) => {
                return this.getEntitiesByComponent(componentType);
            },

            getComponent: (entityId, componentType) => {
                return this.getComponent(entityId, componentType);
            },

            getAllEntities: () => {
                return this.getAllEntityIds();
            },

            // Distance calculation helper
            getDistance: (entityId1, entityId2) => {
                const pos1 = this.getComponent(entityId1, 'POSITION');
                const pos2 = this.getComponent(entityId2, 'POSITION');
                if (!pos1 || !pos2) return Infinity;

                const dx = pos2.x - pos1.x;
                const dz = pos2.z - pos1.z;
                return Math.sqrt(dx * dx + dz * dz);
            },

            // Team filtering helper
            getEntitiesByTeam: (team) => {
                const result = [];
                for (const entityId of this.getAllEntityIds()) {
                    const teamComp = this.getComponent(entityId, 'TEAM');
                    if (teamComp && teamComp.team === team) {
                        result.push(entityId);
                    }
                }
                return result;
            },

            // Enemy finding helper
            getEnemies: (entityId) => {
                const teamComp = this.getComponent(entityId, 'TEAM');
                if (!teamComp) return [];

                const result = [];
                for (const otherId of this.getAllEntityIds()) {
                    if (otherId === entityId) continue;
                    const otherTeam = this.getComponent(otherId, 'TEAM');
                    if (otherTeam && otherTeam.team !== teamComp.team) {
                        result.push(otherId);
                    }
                }
                return result;
            }
        };
    }

    /**
     * Add a new mock entity
     * @param {string} entityId - Unique entity ID
     * @param {Object} componentsData - Component data for this entity
     * @param {string} label - Human-readable label
     */
    addEntity(entityId, componentsData = {}, label = null) {
        console.log('added entity', entityId);
        const components = new Map();
        for (const [componentType, data] of Object.entries(componentsData)) {
            components.set(componentType, { ...data });
        }

        this.entities.set(entityId, {
            id: entityId,
            label: label || entityId,
            components: components
        });

        return entityId;
    }

    /**
     * Remove an entity
     * @param {string} entityId - Entity to remove
     */
    removeEntity(entityId) {
        this.entities.delete(entityId);

        // Update current entity if we deleted it
        if (this.currentEntityId === entityId) {
            this.currentEntityId = this.entities.size > 0 ? Array.from(this.entities.keys())[0] : null;
        }
    }

    /**
     * Get entity by ID
     * @param {string} entityId - Entity ID
     * @returns {Object|null} - Entity data or null
     */
    getEntity(entityId) {
        return this.entities.get(entityId) || null;
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
        return Array.from(this.entities.values());
    }

    /**
     * Get entities that have a specific component
     * @param {string} componentType - Component type to filter by
     * @returns {Array} - Array of entity IDs
     */
    getEntitiesByComponent(componentType) {
        const result = [];
        for (const [entityId, entity] of this.entities.entries()) {
            if (entity.components.has(componentType)) {
                result.push(entityId);
            }
        }
        return result;
    }

    /**
     * Get a component from an entity
     * @param {string} entityId - Entity ID
     * @param {string} componentType - Component type to get
     * @returns {Object|null} - The component data or null
     */
    getComponent(entityId, componentType) {
        const entity = this.entities.get(entityId);
        if (!entity) return null;
        return entity.components.get(componentType) || null;
    }

    /**
     * Set a component on an entity
     * @param {string} entityId - Entity ID
     * @param {string} componentType - Component type to set
     * @param {Object} data - Component data
     */
    setComponent(entityId, componentType, data) {
        const entity = this.entities.get(entityId);
        if (entity) {
            entity.components.set(componentType, { ...data });
        }
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
        const entity = this.entities.get(entityId);
        if (entity) {
            entity.label = label;
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
        for (const entity of this.entities.values()) {
            const components = {};
            for (const [type, data] of entity.components.entries()) {
                components[type] = { ...data };
            }
            exported.push({
                id: entity.id,
                label: entity.label,
                components: components
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
