class ServerECSGame {
    constructor(app) {
        this.app = app;
        this.state = new global.GUTS.GameState(this.getCollections());
        this.sceneManager = new global.GUTS.ServerSceneManager(this);
        this.moduleManager = app.moduleManager;
        this.isServer = true;
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
        // No image manager or canvas setup needed on server
        console.log('Server ECS Game initialized');
    }

    getCollections() {
        return this.app.getCollections();
    }

    update(deltaTime, now) {
        if (!this.state.isPaused) {
            this.currentTime = now;
            const timeSinceLastUpdate = this.currentTime - this.lastTime;

            if (timeSinceLastUpdate > 1000) {
                this.lastTime = this.currentTime;
                return;
            }

            this.systems.forEach(system => {
                if (system.update) {
                    system.update(deltaTime, now);
                }
            });

            this.postUpdate();
            this.lastTime = this.currentTime;
        } 
    }

    postUpdate() {
        this.entitiesToAdd.forEach((entity) => this.addEntity(entity));
        this.entitiesToAdd = [];

        // Server-specific game state checks
        if (this.state.gameOver || this.state.victory) return;
    }

    spawn(type, params) {
        // Server-side entity spawning logic
        const entityId = this.createEntity();
        
        // Add basic components based on type
        switch (type) {
            case 'player':
                this.addComponent(entityId, 'Transform', {
                    x: params.x || 0,
                    y: params.y || 0,
                    rotation: params.rotation || 0
                });
                this.addComponent(entityId, 'Player', {
                    playerId: params.playerId,
                    health: 100,
                    score: 0
                });
                break;
            // Add other entity types as needed
        }
        
        return entityId;
    }

    // ECS methods (same as client)
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
        this.app.appClasses[classId] = classRef;
    }
}


if (typeof window !== 'undefined') {
    window.ServerECSGame = ServerECSGame;
}

// Make available as ES module export (new for server)  
if (typeof module !== 'undefined' && module.exports) {
    module.exports = ServerECSGame;
}

// Make available as ES6 export (also new for server)
if (typeof exports !== 'undefined') {
    exports.default = ServerECSGame;
    exports.ServerECSGame = ServerECSGame;
}