class ECSGame {
    constructor(app){
        this.app = app;     
        this.imageManager = new GUTS.ImageManager(this, 
            { 
                imageSize: this.getCollections().configs.game.imageSize, 
                palette: this.getCollections().configs.game.palette, 
                textures: this.getCollections().textures
            }
        );         
        this.state = new GUTS.GameState(this.getCollections());  
        this.sceneManager = new GUTS.SceneManager(this); 
        this.moduleManager = app.moduleManager;
                
        this.entityId = 0;
        this.entitiesToAdd = [];
        this.entities = new Map();
        this.components = new Map();  
        this.classes = [];      
        this.systems = [];
        
        this.nextEntityId = 1;
        this.lastTime = 0;
    }
        

    init() {       
        this.imageManager.dispose();
    }

    getCollections() {
        return this.app.getCollections();
    }

    update(deltaTime, now) {
  
        if (!this.state.isPaused) {
            this.currentTime = now;

            // Only update if a reasonable amount of time has passed
            const timeSinceLastUpdate = this.currentTime - this.lastTime;

            // Skip update if more than 1 second has passed (tab was inactive)
            if (timeSinceLastUpdate > 1000) {
                this.lastTime = this.currentTime; // Reset timer without updating
                return;
            }
            this.state.simTime = now;
            this.deltaTime = deltaTime;        

            this.systems.forEach(system => {
                if (system.update) {
                    system.update(deltaTime, now);
                    system.render(deltaTime, now);
                }
            });

            this.postUpdate();
        }     
    }

    postUpdate() {
        this.lastTime = this.currentTime;
    
        this.entitiesToAdd.forEach((entity) => this.addEntity(entity));        
        this.entitiesToAdd = [];

        if (this.state.gameOver || this.state.victory || this.state.isLevelingUp) return;
                
        // Game over check
        if (this.state.bloodCoreHP <= 0 && !this.state.gameOver) {
            this.gameOver();
        }
        
    }

    gameOver() {
        this.state.gameOver = true;
        this.state.isPaused = true;
        gameOverWave.textContent = this.state.round + 1;
        gameOverMenu.style.display = 'block';
        overlay.style.display = 'block';
    }

    gameVictory() {
        this.state.victory = true;
        this.state.isPaused = true;
        victoryMenu.style.display = 'block';
        overlay.style.display = 'block';
    }

    spawn() {
        console.log('spawn', arguments);
    }

    createEntity(presetID) {
        const id = presetID || this.nextEntityId++;
        this.entities.set(id, new Set());
        return id;
    }
    
    destroyEntity(entityId) {
        if (this.entities.has(entityId)) {
            const componentTypes = this.entities.get(entityId);
            componentTypes.forEach(type => {
                this.removeComponent(entityId, type);
            });
            this.entities.delete(entityId);
        }
    }
    
    addComponent(entityId, componentType, componentData) {
        if (!this.entities.has(entityId)) {
            throw new Error(`Entity ${entityId} does not exist`);
        }
        
        if (!this.components.has(componentType)) {
            this.components.set(componentType, new Map());
        }
        
        this.components.get(componentType).set(entityId, componentData);
        this.entities.get(entityId).add(componentType);
    }
    
    removeComponent(entityId, componentType) {
        if (this.components.has(componentType)) {
            this.components.get(componentType).delete(entityId);
        }
        if (this.entities.has(entityId)) {
            this.entities.get(entityId).delete(componentType);
        }
    }
    
    getComponent(entityId, componentType) {
        if (this.components.has(componentType)) {
            return this.components.get(componentType).get(entityId);
        }
        return null;
    }
    
    hasComponent(entityId, componentType) {
        return this.components.has(componentType) && 
                this.components.get(componentType).has(entityId);
    }
    
    getEntitiesWith(...componentTypes) {
        const result = [];
        for (const [entityId, entityComponents] of this.entities) {
            if (componentTypes.every(type => entityComponents.has(type))) {
                result.push(entityId);
            }
        }
        return result;
    }
    
    addSystem(system, params) {
        system.game = this;
        this.systems.push(system);
        if (system.init) {
            system.init(params);
        }
    }
    
    addClass(classId, classRef, params) {
        this.classes[classId] = { classRef: classRef, defaultParams: params };
        APP.appClasses[classId] = classRef;
    }
        
}