class ModelManager {
    constructor(app, { ShapeFactory, palette }) {
        this.app = app;
        this.models = {};
        this.shapeFactory = new ShapeFactory(palette);
    }

    clear() {
        this.models = {};
    }

    dispose() {
        // Cleanup when manager is no longer needed
        for (const [key, model] of Object.entries(this.models)) {
            this.disposeModel(model);
        }
        this.models = {};
    }
    
    disposeModel(model) {
        if (!model) return;
        
        // Handle animation objects
        if (model.animations) {
            for (const [animType, frames] of Object.entries(model.animations)) {
                for (const frame of frames) {
                    if (frame.group) {
                        this.shapeFactory.disposeObject(frame.group);
                        frame.group = null;
                    }
                }
            }
        }
    }

    async loadModels(prefix, config) {
        if (!prefix || !config || typeof config !== 'object') {
            throw new Error('Invalid prefix or config provided to loadModels');
        }
    
        for (const [type, cfg] of Object.entries(config)) {
            if (cfg.render && cfg.render.model) {
                this.models[`${prefix}_${type}`] = await this.createModel(cfg.render.model);
            }
        }        
       
    }


    async createModel(modelData) {
        const modelGroup = await this.createObjectsFromJSON(modelData, {});
            
        if (modelGroup) {
            // Apply shadows to all meshes
            modelGroup.traverse((child) => {
                if (child.isMesh) {
                    child.castShadow = true;
                    child.receiveShadow = true;
                }
            });
            
        }
            
        
        
        return modelGroup;
    }

    getModel(prefix, type) {
        return this.models[`${prefix}_${type}`];
    }

    async createObjectsFromJSON(model, frameData) {
        const rootGroup = new THREE.Group();
        
        for (const groupName in model) {
            const group = await this.shapeFactory.createMergedGroupFromJSON(model, frameData, groupName);
            if (group) {
                rootGroup.add(group);
            }
        }
    
        return rootGroup;
    }
}