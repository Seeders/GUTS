class ComponentManager {
    constructor(game) {
        this.game = game;
        this.game.componentManager = this;
        this.models = this.game.getCollections().models;
        this.game.componentTypes = this.getComponentTypes();
        this.commandIdCounter = 0; // Deterministic counter for command IDs
        //this.models.position == { x: 0, y: 0, z: 0 };
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

    getModels() {
        let components = {};
        Object.keys(this.models).forEach((modelId) => {
            const model = this.models[modelId];
            // Extract schema if model has title/schema structure, otherwise use model directly
            const data = model.schema || model;
            components[modelId] = (params = {}) => {
                return this.deepMerge(data, params);
            };
        });
        return components;
    }
    getComponents(){
        // Simply return models - factory functions generated from collection
        return this.getModels();
    }

    getComponentTypes() {
        // Auto-generate component types from models collection
        // Convert camelCase keys to UPPER_SNAKE_CASE
        const types = {};
        Object.keys(this.models).forEach(key => {
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