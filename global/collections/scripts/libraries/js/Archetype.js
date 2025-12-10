/**
 * Archetype - Groups entities with the same component signature
 *
 * Entities with identical component types are stored together for efficient querying.
 * When a query matches an archetype's signature, all entities in that archetype match.
 */
class Archetype {
    /**
     * @param {string[]} componentTypes - Sorted array of component type names
     */
    constructor(componentTypes) {
        // Signature is a sorted array of component types (immutable identity)
        this.signature = Object.freeze([...componentTypes].sort());
        this.signatureSet = new Set(this.signature);
        this.signatureKey = this.signature.join(',');

        // Entity storage: entityId -> index in dense array
        this.entityToIndex = new Map();
        // Dense array of entity IDs for fast iteration
        this.entities = [];

        // Component storage: componentType -> array of data (parallel to entities)
        this.components = new Map();
        for (const type of this.signature) {
            this.components.set(type, []);
        }

        this._size = 0;
    }

    /**
     * Number of entities in this archetype
     */
    get size() {
        return this._size;
    }

    /**
     * Check if this archetype contains a component type
     * @param {string} componentType
     * @returns {boolean}
     */
    hasComponentType(componentType) {
        return this.signatureSet.has(componentType);
    }

    /**
     * Check if this archetype matches a query (has all required components)
     * @param {string[]} requiredComponents
     * @returns {boolean}
     */
    matchesQuery(requiredComponents) {
        for (const type of requiredComponents) {
            if (!this.signatureSet.has(type)) {
                return false;
            }
        }
        return true;
    }

    /**
     * Check if an entity exists in this archetype
     * @param {number} entityId
     * @returns {boolean}
     */
    hasEntity(entityId) {
        return this.entityToIndex.has(entityId);
    }

    /**
     * Add an entity with its component data
     * @param {number} entityId
     * @param {Object} componentData - Map of componentType -> data
     */
    addEntity(entityId, componentData) {
        if (this.entityToIndex.has(entityId)) {
            throw new Error(`Entity ${entityId} already exists in archetype ${this.signatureKey}`);
        }

        const index = this._size;
        this.entityToIndex.set(entityId, index);
        this.entities[index] = entityId;

        // Add component data for each type in signature
        for (const type of this.signature) {
            const dataArray = this.components.get(type);
            dataArray[index] = componentData[type];
        }

        this._size++;
    }

    /**
     * Remove an entity from this archetype
     * @param {number} entityId
     * @returns {Object|null} The removed component data, or null if not found
     */
    removeEntity(entityId) {
        const index = this.entityToIndex.get(entityId);
        if (index === undefined) return null;

        // Collect removed data
        const removedData = {};
        for (const type of this.signature) {
            removedData[type] = this.components.get(type)[index];
        }

        // Swap with last element to maintain dense packing
        const lastIndex = this._size - 1;
        if (index !== lastIndex) {
            const lastEntityId = this.entities[lastIndex];

            // Move last entity to removed position
            this.entities[index] = lastEntityId;
            this.entityToIndex.set(lastEntityId, index);

            // Move component data
            for (const type of this.signature) {
                const dataArray = this.components.get(type);
                dataArray[index] = dataArray[lastIndex];
            }
        }

        // Remove last element
        this.entities.pop();
        for (const type of this.signature) {
            this.components.get(type).pop();
        }
        this.entityToIndex.delete(entityId);
        this._size--;

        return removedData;
    }

    /**
     * Get component data for an entity
     * @param {number} entityId
     * @param {string} componentType
     * @returns {*} Component data or undefined
     */
    getComponent(entityId, componentType) {
        const index = this.entityToIndex.get(entityId);
        if (index === undefined) return undefined;

        const dataArray = this.components.get(componentType);
        if (!dataArray) return undefined;

        return dataArray[index];
    }

    /**
     * Set component data for an entity
     * @param {number} entityId
     * @param {string} componentType
     * @param {*} data
     */
    setComponent(entityId, componentType, data) {
        const index = this.entityToIndex.get(entityId);
        if (index === undefined) {
            throw new Error(`Entity ${entityId} not found in archetype`);
        }

        const dataArray = this.components.get(componentType);
        if (!dataArray) {
            throw new Error(`Component type ${componentType} not in archetype signature`);
        }

        dataArray[index] = data;
    }

    /**
     * Get all entities as an array
     * @returns {number[]}
     */
    getEntities() {
        return this.entities.slice(0, this._size);
    }

    /**
     * Iterate over entities with their component data
     * @yields {{entityId: number, components: Object}}
     */
    *[Symbol.iterator]() {
        for (let i = 0; i < this._size; i++) {
            const entityId = this.entities[i];
            const components = {};
            for (const type of this.signature) {
                components[type] = this.components.get(type)[i];
            }
            yield { entityId, components };
        }
    }

    /**
     * Iterate over just entity IDs
     * @yields {number}
     */
    *entityIds() {
        for (let i = 0; i < this._size; i++) {
            yield this.entities[i];
        }
    }
}


/**
 * ArchetypeManager - Manages all archetypes and entity-archetype mappings
 */
class ArchetypeManager {
    constructor() {
        // All archetypes by signature key
        this.archetypes = new Map();  // signatureKey -> Archetype

        // Entity to archetype mapping
        this.entityArchetype = new Map();  // entityId -> Archetype

        // Query cache: queryKey -> { archetypes: Archetype[], version: number }
        this.queryCache = new Map();
        this.queryCacheVersion = 0;

        // Empty archetype for entities with no components
        this.emptyArchetype = new Archetype([]);
        this.archetypes.set('', this.emptyArchetype);
    }

    /**
     * Get or create an archetype for a given signature
     * @param {string[]} componentTypes
     * @returns {Archetype}
     */
    getOrCreateArchetype(componentTypes) {
        const sorted = [...componentTypes].sort();
        const key = sorted.join(',');

        let archetype = this.archetypes.get(key);
        if (!archetype) {
            archetype = new Archetype(sorted);
            this.archetypes.set(key, archetype);
            this._invalidateQueryCache();
        }

        return archetype;
    }

    /**
     * Create an entity (starts in empty archetype)
     * @param {number} entityId
     */
    createEntity(entityId) {
        if (this.entityArchetype.has(entityId)) {
            throw new Error(`Entity ${entityId} already exists`);
        }
        this.emptyArchetype.addEntity(entityId, {});
        this.entityArchetype.set(entityId, this.emptyArchetype);
    }

    /**
     * Destroy an entity
     * @param {number} entityId
     * @returns {Object|null} Removed component data
     */
    destroyEntity(entityId) {
        const archetype = this.entityArchetype.get(entityId);
        if (!archetype) return null;

        const removedData = archetype.removeEntity(entityId);
        this.entityArchetype.delete(entityId);
        return removedData;
    }

    /**
     * Check if entity exists
     * @param {number} entityId
     * @returns {boolean}
     */
    hasEntity(entityId) {
        return this.entityArchetype.has(entityId);
    }

    /**
     * Get all component types for an entity
     * @param {number} entityId
     * @returns {string[]}
     */
    getEntityComponentTypes(entityId) {
        const archetype = this.entityArchetype.get(entityId);
        if (!archetype) return [];
        return [...archetype.signature];
    }

    /**
     * Add a component to an entity (moves to new archetype)
     * @param {number} entityId
     * @param {string} componentType
     * @param {*} data
     */
    addComponent(entityId, componentType, data) {
        const currentArchetype = this.entityArchetype.get(entityId);
        if (!currentArchetype) {
            throw new Error(`Entity ${entityId} does not exist`);
        }

        // Check if already has this component
        if (currentArchetype.hasComponentType(componentType)) {
            // Just update the data
            currentArchetype.setComponent(entityId, componentType, data);
            return;
        }

        // Calculate new signature
        const newSignature = [...currentArchetype.signature, componentType];
        const newArchetype = this.getOrCreateArchetype(newSignature);

        // Migrate entity: remove from old, add to new
        const oldData = currentArchetype.removeEntity(entityId);
        const newData = { ...oldData, [componentType]: data };
        newArchetype.addEntity(entityId, newData);

        this.entityArchetype.set(entityId, newArchetype);
        this._invalidateQueryCache();
    }

    /**
     * Remove a component from an entity (moves to new archetype)
     * @param {number} entityId
     * @param {string} componentType
     * @returns {*} Removed component data
     */
    removeComponent(entityId, componentType) {
        const currentArchetype = this.entityArchetype.get(entityId);
        if (!currentArchetype) {
            throw new Error(`Entity ${entityId} does not exist`);
        }

        if (!currentArchetype.hasComponentType(componentType)) {
            return undefined;
        }

        // Get the data before removing
        const removedData = currentArchetype.getComponent(entityId, componentType);

        // Calculate new signature
        const newSignature = currentArchetype.signature.filter(t => t !== componentType);
        const newArchetype = this.getOrCreateArchetype(newSignature);

        // Migrate entity: remove from old, add to new
        const oldData = currentArchetype.removeEntity(entityId);
        delete oldData[componentType];
        newArchetype.addEntity(entityId, oldData);

        this.entityArchetype.set(entityId, newArchetype);
        this._invalidateQueryCache();

        return removedData;
    }

    /**
     * Get a component from an entity
     * @param {number} entityId
     * @param {string} componentType
     * @returns {*}
     */
    getComponent(entityId, componentType) {
        const archetype = this.entityArchetype.get(entityId);
        if (!archetype) return undefined;
        return archetype.getComponent(entityId, componentType);
    }

    /**
     * Check if entity has a component
     * @param {number} entityId
     * @param {string} componentType
     * @returns {boolean}
     */
    hasComponent(entityId, componentType) {
        const archetype = this.entityArchetype.get(entityId);
        if (!archetype) return false;
        return archetype.hasComponentType(componentType);
    }

    /**
     * Get all entities with specified components
     * Uses cached archetype matching for efficiency
     * @param {...string} componentTypes
     * @returns {number[]}
     */
    getEntitiesWith(...componentTypes) {
        if (componentTypes.length === 0) {
            // Return all entities
            return Array.from(this.entityArchetype.keys());
        }

        const queryKey = componentTypes.slice().sort().join(',');

        // Check cache
        const cached = this.queryCache.get(queryKey);
        if (cached && cached.version === this.queryCacheVersion) {
            return cached.result;
        }

        // Find matching archetypes
        const result = [];
        for (const archetype of this.archetypes.values()) {
            if (archetype.matchesQuery(componentTypes)) {
                // Add all entities from this archetype
                for (let i = 0; i < archetype.size; i++) {
                    result.push(archetype.entities[i]);
                }
            }
        }

        // Sort for deterministic order
        if (result.length > 0 && typeof result[0] === 'number') {
            result.sort((a, b) => a - b);
        } else {
            result.sort();
        }

        // Cache result
        this.queryCache.set(queryKey, {
            result,
            version: this.queryCacheVersion
        });

        return result;
    }

    /**
     * Get matching archetypes for a query (for advanced iteration)
     * @param {...string} componentTypes
     * @returns {Archetype[]}
     */
    getMatchingArchetypes(...componentTypes) {
        const matching = [];
        for (const archetype of this.archetypes.values()) {
            if (archetype.matchesQuery(componentTypes)) {
                matching.push(archetype);
            }
        }
        return matching;
    }

    /**
     * Invalidate query cache
     * @private
     */
    _invalidateQueryCache() {
        this.queryCacheVersion++;
    }

    /**
     * Get all entity IDs
     * @returns {number[]}
     */
    getAllEntityIds() {
        return Array.from(this.entityArchetype.keys());
    }

    /**
     * Get entity signature as a Set (for compatibility)
     * @param {number} entityId
     * @returns {Set<string>|null}
     */
    getEntitySignature(entityId) {
        const archetype = this.entityArchetype.get(entityId);
        if (!archetype) return null;
        return archetype.signatureSet;
    }

    /**
     * Get entity count
     * @returns {number}
     */
    get size() {
        return this.entityArchetype.size;
    }

    /**
     * Get statistics about archetype usage
     * @returns {Object}
     */
    getStats() {
        const stats = {
            archetypeCount: this.archetypes.size,
            entityCount: this.entityArchetype.size,
            archetypes: []
        };

        for (const [key, archetype] of this.archetypes) {
            stats.archetypes.push({
                signature: key,
                entityCount: archetype.size
            });
        }

        return stats;
    }
}


// Export for different module systems
if (typeof global !== 'undefined' && global.GUTS) {
    global.GUTS.Archetype = Archetype;
    global.GUTS.ArchetypeManager = ArchetypeManager;
}

if (typeof window !== 'undefined') {
    window.GUTS = window.GUTS || {};
    window.GUTS.Archetype = Archetype;
    window.GUTS.ArchetypeManager = ArchetypeManager;
}

export default ArchetypeManager;
export { Archetype, ArchetypeManager };
