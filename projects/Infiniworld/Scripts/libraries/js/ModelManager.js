class ModelManager {
    constructor(app, { ShapeFactory, palette, textures, Three_SkeletonUtils }) {
        this.app = app;
        this.models = {};
        this.shapeFactory = new ShapeFactory(palette, textures, null, Three_SkeletonUtils);
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
                const modelGroupName = Object.keys(cfg.render.model)[0];    
                const modelGroup = cfg.render.model[modelGroupName];         
                const isGLTF = modelGroup.shapes.length > 0 && modelGroup.shapes[0].type == "gltf";
                if( isGLTF ){
                    const animations = cfg.render.animations;
                    Object.keys(animations).forEach(async (animationName) => {
                        const anim = animations[animationName][0];
                        const animMainGroup = anim[Object.keys(anim)[0]];

                        let mergedModel = {...cfg.render.model};
                        if(animMainGroup){
                            mergedModel[modelGroupName].shapes[0].url = animMainGroup.shapes[0].url;
                        }
                        this.models[`${prefix}_${type}_${animationName}`] = await this.createModel(mergedModel);                        
                    });
                    this.models[`${prefix}_${type}`] = await this.createModel(cfg.render.model);
                } else {
                    this.models[`${prefix}_${type}`] = await this.createModel(cfg.render.model);
                }
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


    getAnimation(prefix, type, anim) {
        return this.models[`${prefix}_${type}_${anim}`];
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