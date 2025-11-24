class ComponentGenerator {
    constructor(components) {
        this.components = components;
    }

    deepMerge(target, source) {
        const result = { ...target };
        
        for (const key in source) {
            if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
                result[key] = this.deepMerge(result[key] || {}, source[key]);
            } else {
                result[key] = source[key] == 'null' ? null : source[key];
            }
        }
        
        return result;
    }

    getComponents() {
        let components = {};
        Object.keys(this.components).forEach((componentId) => {
            const model = this.components[componentId];
            // Extract schema if model has title/schema structure, otherwise use model directly
            const data = model.schema || model;
            components[componentId] = (params = {}) => {
                return this.deepMerge(data, params);
            };
        });
        return components;
    }

    getComponentTypes() {
        // Auto-generate component types from models collection
        // Convert camelCase keys to UPPER_SNAKE_CASE
        const types = {};
        Object.keys(this.components).forEach(key => {
            // Convert camelCase to UPPER_SNAKE_CASE
            const upperKey = key
                .replace(/([A-Z])/g, '_$1')  // Add underscore before capitals
                .toUpperCase()                // Convert to uppercase
                .replace(/^_/, '');           // Remove leading underscore if present
            types[upperKey] = key;
        });
        return types;
    }
}