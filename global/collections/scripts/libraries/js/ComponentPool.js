/**
 * ComponentPool - TypedArray-based storage for numeric components
 *
 * Provides cache-friendly contiguous storage for frequently accessed numeric data.
 * Falls back to object storage for non-poolable components.
 */

/**
 * Schema definitions for poolable components
 * Each schema defines the fields, their offsets, and total stride
 */
const POOL_SCHEMAS = {
    // Transform: position(3) + rotation(3) + scale(3) = 9 floats
    transform: {
        stride: 9,
        fields: {
            'position.x': 0, 'position.y': 1, 'position.z': 2,
            'rotation.x': 3, 'rotation.y': 4, 'rotation.z': 5,
            'scale.x': 6, 'scale.y': 7, 'scale.z': 8
        },
        defaults: [0, 0, 0, 0, 0, 0, 1, 1, 1],
        nested: {
            position: { x: 0, y: 1, z: 2 },
            rotation: { x: 3, y: 4, z: 5 },
            scale: { x: 6, y: 7, z: 8 }
        }
    },

    // Velocity: vx, vy, vz, maxSpeed = 4 floats + flags
    velocity: {
        stride: 5, // vx, vy, vz, maxSpeed, flags (affectedByGravity|anchored packed)
        fields: {
            'vx': 0, 'vy': 1, 'vz': 2, 'maxSpeed': 3, '_flags': 4
        },
        defaults: [0, 0, 0, 100, 1], // affectedByGravity=true, anchored=false
        flags: {
            affectedByGravity: 1,
            anchored: 2
        }
    },

    // Collision: radius = 1 float
    collision: {
        stride: 1,
        fields: { 'radius': 0 },
        defaults: [25]
    }
};


/**
 * TypedArrayPool - Manages TypedArray storage for a specific component type
 */
class TypedArrayPool {
    /**
     * @param {Object} schema - Schema definition from POOL_SCHEMAS
     * @param {number} initialCapacity - Initial entity capacity
     */
    constructor(schema, initialCapacity = 256) {
        this.schema = schema;
        this.stride = schema.stride;
        this.capacity = initialCapacity;

        // Main data storage
        this.data = new Float32Array(this.capacity * this.stride);

        // Entity mapping
        this.entityToIndex = new Map();  // entityId -> pool index
        this.indexToEntity = [];          // pool index -> entityId
        this.freeIndices = [];            // Recycled indices
        this._size = 0;

        // Initialize with defaults
        this._initializeDefaults();
    }

    /**
     * Pre-fill data with default values
     * @private
     */
    _initializeDefaults() {
        const defaults = this.schema.defaults;
        for (let i = 0; i < this.capacity; i++) {
            const offset = i * this.stride;
            for (let j = 0; j < this.stride; j++) {
                this.data[offset + j] = defaults[j];
            }
        }
    }

    /**
     * Grow the pool when capacity is exceeded
     * @private
     */
    _grow() {
        const newCapacity = this.capacity * 2;
        const newData = new Float32Array(newCapacity * this.stride);

        // Copy existing data
        newData.set(this.data);

        // Initialize new slots with defaults
        const defaults = this.schema.defaults;
        for (let i = this.capacity; i < newCapacity; i++) {
            const offset = i * this.stride;
            for (let j = 0; j < this.stride; j++) {
                newData[offset + j] = defaults[j];
            }
        }

        this.data = newData;
        this.capacity = newCapacity;
    }

    /**
     * Get the number of components stored
     */
    get size() {
        return this._size;
    }

    /**
     * Check if entity has component
     * @param {number} entityId
     * @returns {boolean}
     */
    has(entityId) {
        return this.entityToIndex.has(entityId);
    }

    /**
     * Allocate storage for an entity
     * @param {number} entityId
     * @returns {number} Pool index
     */
    _allocate(entityId) {
        if (this.entityToIndex.has(entityId)) {
            return this.entityToIndex.get(entityId);
        }

        let index;
        if (this.freeIndices.length > 0) {
            index = this.freeIndices.pop();
        } else {
            index = this._size;
            if (index >= this.capacity) {
                this._grow();
            }
        }

        this.entityToIndex.set(entityId, index);
        this.indexToEntity[index] = entityId;
        this._size++;

        return index;
    }

    /**
     * Set component data for an entity
     * @param {number} entityId
     * @param {Object} componentData - Component data object
     */
    set(entityId, componentData) {
        const index = this._allocate(entityId);
        const offset = index * this.stride;

        // Handle nested objects (like transform.position.x)
        if (this.schema.nested) {
            for (const [nestedKey, fieldMap] of Object.entries(this.schema.nested)) {
                const nestedData = componentData[nestedKey];
                if (nestedData) {
                    for (const [fieldKey, fieldOffset] of Object.entries(fieldMap)) {
                        if (nestedData[fieldKey] !== undefined) {
                            this.data[offset + fieldOffset] = nestedData[fieldKey];
                        }
                    }
                }
            }
        }

        // Handle flat fields
        for (const [fieldPath, fieldOffset] of Object.entries(this.schema.fields)) {
            if (fieldPath.startsWith('_')) continue; // Skip internal fields

            if (fieldPath.includes('.')) continue; // Already handled by nested

            if (componentData[fieldPath] !== undefined) {
                this.data[offset + fieldOffset] = componentData[fieldPath];
            }
        }

        // Handle flags for velocity component
        if (this.schema.flags) {
            let flags = 0;
            for (const [flagName, flagBit] of Object.entries(this.schema.flags)) {
                if (componentData[flagName]) {
                    flags |= flagBit;
                }
            }
            this.data[offset + this.schema.fields['_flags']] = flags;
        }
    }

    /**
     * Get component data for an entity (creates proxy object)
     * @param {number} entityId
     * @returns {Object|undefined}
     */
    get(entityId) {
        const index = this.entityToIndex.get(entityId);
        if (index === undefined) return undefined;

        return this._createProxy(index);
    }

    /**
     * Create a proxy object for component access
     * Allows direct mutation like: transform.position.x = 5
     * @param {number} index - Pool index
     * @returns {Object}
     * @private
     */
    _createProxy(index) {
        const offset = index * this.stride;
        const data = this.data;
        const schema = this.schema;

        // For components with nested structure (like transform)
        if (schema.nested) {
            const proxy = {};
            for (const [nestedKey, fieldMap] of Object.entries(schema.nested)) {
                proxy[nestedKey] = {};
                for (const [fieldKey, fieldOffset] of Object.entries(fieldMap)) {
                    Object.defineProperty(proxy[nestedKey], fieldKey, {
                        get() { return data[offset + fieldOffset]; },
                        set(value) { data[offset + fieldOffset] = value; },
                        enumerable: true
                    });
                }
            }
            return proxy;
        }

        // For flat components (like velocity)
        const proxy = {};
        for (const [fieldPath, fieldOffset] of Object.entries(schema.fields)) {
            if (fieldPath.startsWith('_')) {
                // Handle flags
                if (schema.flags && fieldPath === '_flags') {
                    for (const [flagName, flagBit] of Object.entries(schema.flags)) {
                        Object.defineProperty(proxy, flagName, {
                            get() { return (data[offset + fieldOffset] & flagBit) !== 0; },
                            set(value) {
                                if (value) {
                                    data[offset + fieldOffset] |= flagBit;
                                } else {
                                    data[offset + fieldOffset] &= ~flagBit;
                                }
                            },
                            enumerable: true
                        });
                    }
                }
            } else {
                Object.defineProperty(proxy, fieldPath, {
                    get() { return data[offset + fieldOffset]; },
                    set(value) { data[offset + fieldOffset] = value; },
                    enumerable: true
                });
            }
        }

        return proxy;
    }

    /**
     * Remove component from an entity
     * @param {number} entityId
     * @returns {Object|undefined} The removed data
     */
    delete(entityId) {
        const index = this.entityToIndex.get(entityId);
        if (index === undefined) return undefined;

        // Copy data before clearing
        const offset = index * this.stride;
        const removedData = this._extractData(offset);

        // Reset to defaults
        const defaults = this.schema.defaults;
        for (let j = 0; j < this.stride; j++) {
            this.data[offset + j] = defaults[j];
        }

        // Mark as free
        this.entityToIndex.delete(entityId);
        this.indexToEntity[index] = undefined;
        this.freeIndices.push(index);
        this._size--;

        return removedData;
    }

    /**
     * Extract data at offset as plain object
     * @param {number} offset
     * @returns {Object}
     * @private
     */
    _extractData(offset) {
        const schema = this.schema;
        const data = this.data;

        if (schema.nested) {
            const result = {};
            for (const [nestedKey, fieldMap] of Object.entries(schema.nested)) {
                result[nestedKey] = {};
                for (const [fieldKey, fieldOffset] of Object.entries(fieldMap)) {
                    result[nestedKey][fieldKey] = data[offset + fieldOffset];
                }
            }
            return result;
        }

        const result = {};
        for (const [fieldPath, fieldOffset] of Object.entries(schema.fields)) {
            if (fieldPath === '_flags' && schema.flags) {
                const flags = data[offset + fieldOffset];
                for (const [flagName, flagBit] of Object.entries(schema.flags)) {
                    result[flagName] = (flags & flagBit) !== 0;
                }
            } else if (!fieldPath.startsWith('_')) {
                result[fieldPath] = data[offset + fieldOffset];
            }
        }
        return result;
    }

    /**
     * Iterate over all components with their entity IDs
     * @yields {[number, Object]}
     */
    *[Symbol.iterator]() {
        for (const [entityId, index] of this.entityToIndex) {
            yield [entityId, this._createProxy(index)];
        }
    }

    /**
     * Get raw data offset for an entity (for bulk operations)
     * @param {number} entityId
     * @returns {number} Offset into data array, or -1 if not found
     */
    getOffset(entityId) {
        const index = this.entityToIndex.get(entityId);
        if (index === undefined) return -1;
        return index * this.stride;
    }

    /**
     * Direct access to underlying data array
     * @returns {Float32Array}
     */
    getRawData() {
        return this.data;
    }

    /**
     * Get pool statistics
     * @returns {Object}
     */
    getStats() {
        return {
            size: this._size,
            capacity: this.capacity,
            stride: this.stride,
            memoryBytes: this.data.byteLength,
            freeSlots: this.freeIndices.length
        };
    }
}


/**
 * ComponentPoolManager - Manages TypedArray pools for all poolable components
 */
class ComponentPoolManager {
    constructor() {
        this.pools = new Map();  // componentType -> TypedArrayPool
        this.schemas = POOL_SCHEMAS;
    }

    /**
     * Check if a component type is poolable
     * @param {string} componentType
     * @returns {boolean}
     */
    isPoolable(componentType) {
        return this.schemas.hasOwnProperty(componentType);
    }

    /**
     * Get or create a pool for a component type
     * @param {string} componentType
     * @returns {TypedArrayPool|null}
     */
    getPool(componentType) {
        if (!this.isPoolable(componentType)) return null;

        let pool = this.pools.get(componentType);
        if (!pool) {
            pool = new TypedArrayPool(this.schemas[componentType]);
            this.pools.set(componentType, pool);
        }
        return pool;
    }

    /**
     * Set component data
     * @param {string} componentType
     * @param {number} entityId
     * @param {Object} data
     * @returns {boolean} True if handled by pool
     */
    set(componentType, entityId, data) {
        const pool = this.getPool(componentType);
        if (!pool) return false;
        pool.set(entityId, data);
        return true;
    }

    /**
     * Get component data
     * @param {string} componentType
     * @param {number} entityId
     * @returns {Object|undefined|null} null if not poolable, undefined if not found
     */
    get(componentType, entityId) {
        const pool = this.getPool(componentType);
        if (!pool) return null;  // Not poolable
        return pool.get(entityId);  // May return undefined
    }

    /**
     * Check if entity has component
     * @param {string} componentType
     * @param {number} entityId
     * @returns {boolean|null} null if not poolable
     */
    has(componentType, entityId) {
        const pool = this.pools.get(componentType);
        if (!pool) return null;
        return pool.has(entityId);
    }

    /**
     * Delete component
     * @param {string} componentType
     * @param {number} entityId
     * @returns {Object|undefined|null}
     */
    delete(componentType, entityId) {
        const pool = this.pools.get(componentType);
        if (!pool) return null;
        return pool.delete(entityId);
    }

    /**
     * Get statistics for all pools
     * @returns {Object}
     */
    getStats() {
        const stats = {};
        for (const [type, pool] of this.pools) {
            stats[type] = pool.getStats();
        }
        return stats;
    }
}


// Export for different module systems
if (typeof global !== 'undefined' && global.GUTS) {
    global.GUTS.ComponentPool = TypedArrayPool;
    global.GUTS.ComponentPoolManager = ComponentPoolManager;
    global.GUTS.POOL_SCHEMAS = POOL_SCHEMAS;
}

if (typeof window !== 'undefined') {
    window.GUTS = window.GUTS || {};
    window.GUTS.ComponentPool = TypedArrayPool;
    window.GUTS.ComponentPoolManager = ComponentPoolManager;
    window.GUTS.POOL_SCHEMAS = POOL_SCHEMAS;
}

export default ComponentPoolManager;
export { TypedArrayPool, ComponentPoolManager, POOL_SCHEMAS };
