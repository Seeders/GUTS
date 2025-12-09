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
        Object.keys(this.components).forEach((modelId) => {
            const model = this.components[modelId];
            // Extract schema if model has title/schema structure, otherwise use model directly
            const data = model.schema || model;
            components[modelId] = (params = {}) => {
                return this.deepMerge(data, params);
            };
        });
        return components;
    }

   
}