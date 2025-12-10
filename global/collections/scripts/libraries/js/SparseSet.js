/**
 * SparseSet - Efficient data structure for entity-component storage
 *
 * Provides O(1) add, remove, has, and get operations with cache-friendly iteration.
 * Uses a sparse array for fast lookups and a dense array for fast iteration.
 */
class SparseSet {
    constructor() {
        // Sparse array: entityId -> index in dense array
        // Using Map for sparse storage (handles non-contiguous IDs efficiently)
        this.sparse = new Map();

        // Dense arrays: packed storage for fast iteration
        this.denseEntities = [];  // Entity IDs in dense storage
        this.denseData = [];      // Component data parallel to denseEntities

        // Track size for quick access
        this._size = 0;
    }

    /**
     * Get the number of components stored
     * @returns {number}
     */
    get size() {
        return this._size;
    }

    /**
     * Check if an entity has this component
     * @param {number} entityId
     * @returns {boolean}
     */
    has(entityId) {
        return this.sparse.has(entityId);
    }

    /**
     * Get component data for an entity
     * @param {number} entityId
     * @returns {*} Component data or undefined
     */
    get(entityId) {
        const index = this.sparse.get(entityId);
        if (index === undefined) return undefined;
        return this.denseData[index];
    }

    /**
     * Add or update component data for an entity
     * @param {number} entityId
     * @param {*} data Component data
     */
    set(entityId, data) {
        const existingIndex = this.sparse.get(entityId);

        if (existingIndex !== undefined) {
            // Update existing
            this.denseData[existingIndex] = data;
        } else {
            // Add new
            const index = this._size;
            this.sparse.set(entityId, index);
            this.denseEntities[index] = entityId;
            this.denseData[index] = data;
            this._size++;
        }
    }

    /**
     * Remove component from an entity
     * @param {number} entityId
     * @returns {*} Removed component data or undefined
     */
    delete(entityId) {
        const index = this.sparse.get(entityId);
        if (index === undefined) return undefined;

        const removedData = this.denseData[index];

        // Swap with last element to maintain dense packing
        const lastIndex = this._size - 1;
        if (index !== lastIndex) {
            const lastEntityId = this.denseEntities[lastIndex];
            const lastData = this.denseData[lastIndex];

            // Move last element to the removed position
            this.denseEntities[index] = lastEntityId;
            this.denseData[index] = lastData;
            this.sparse.set(lastEntityId, index);
        }

        // Remove last element
        this.denseEntities.pop();
        this.denseData.pop();
        this.sparse.delete(entityId);
        this._size--;

        return removedData;
    }

    /**
     * Clear all data
     */
    clear() {
        this.sparse.clear();
        this.denseEntities.length = 0;
        this.denseData.length = 0;
        this._size = 0;
    }

    /**
     * Iterate over all entity-data pairs
     * @yields {[number, *]} [entityId, data] pairs
     */
    *[Symbol.iterator]() {
        for (let i = 0; i < this._size; i++) {
            yield [this.denseEntities[i], this.denseData[i]];
        }
    }

    /**
     * Iterate over all entity IDs
     * @yields {number} Entity IDs
     */
    *entities() {
        for (let i = 0; i < this._size; i++) {
            yield this.denseEntities[i];
        }
    }

    /**
     * Iterate over all component data
     * @yields {*} Component data
     */
    *values() {
        for (let i = 0; i < this._size; i++) {
            yield this.denseData[i];
        }
    }

    /**
     * Get all entity IDs as an array (for compatibility)
     * @returns {number[]}
     */
    getEntityArray() {
        return this.denseEntities.slice(0, this._size);
    }

    /**
     * Execute a callback for each entity-data pair
     * @param {Function} callback (data, entityId, set) => void
     */
    forEach(callback) {
        for (let i = 0; i < this._size; i++) {
            callback(this.denseData[i], this.denseEntities[i], this);
        }
    }
}

// Export for different module systems
if (typeof global !== 'undefined' && global.GUTS) {
    global.GUTS.SparseSet = SparseSet;
}

if (typeof window !== 'undefined') {
    window.GUTS = window.GUTS || {};
    window.GUTS.SparseSet = SparseSet;
}

export default SparseSet;
export { SparseSet };
