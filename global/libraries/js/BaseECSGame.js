class BaseECSGame {
    constructor(app) {
        this.app = app;
        this.state = null; // Will be set by subclasses
        this.sceneManager = null; // Will be set by subclasses
        this.moduleManager = app.moduleManager;

        this.entityId = 0;
        this.entitiesToAdd = [];
        this.entities = new Map();
        this.components = new Map();
        this.classes = [];
        this.systems = [];

        this.nextEntityId = 1;
        this.lastTime = 0;
        this.currentTime = 0;
        this.deltaTime = 0;

        this.isServer = false;

        this.componentTypes = null;

        // Performance monitoring
        if (typeof PerformanceMonitor !== 'undefined') {
            this.performanceMonitor = new PerformanceMonitor();
        }
    }
    init() {
        if(document){
            document.addEventListener('keydown', (e) => {                
                this.triggerEvent('onKeyDown', e.key);
            });
        }
    }
    getEntityId() {
        return this.nextEntityId++;
    }
    getCollections() {
        return this.app.getCollections();
    }

    async update(deltaTime) {

        if (!this.state.isPaused) {
            // Start performance frame tracking
            if (this.performanceMonitor) {
                this.performanceMonitor.startFrame();
            }

            this.currentTime = this.currentTime + deltaTime;

            // Only update if a reasonable amount of time has passed
            // const timeSinceLastUpdate = this.currentTime - this.lastTime;

            // // Skip update if more than 1 second has passed (tab was inactive)
            // if (timeSinceLastUpdate > 1000) {
            //     this.lastTime = this.currentTime; // Reset timer without updating
            //     return;
            // }
            this.state.now = this.currentTime;
            this.state.deltaTime = deltaTime;
            this.deltaTime = deltaTime;

            for (const system of this.systems) {
                const systemName = system.constructor.name;

                // Start tracking this system
                if (this.performanceMonitor) {
                    this.performanceMonitor.startSystem(systemName);
                }

                if (system.update) {
                    await system.update();
                }

                // End update tracking
                if (this.performanceMonitor) {
                    this.performanceMonitor.endSystemUpdate(systemName);
                }

                if(system.render && !this.isServer){
                    // Start render tracking
                    if (this.performanceMonitor) {
                        this.performanceMonitor.startSystemRender(systemName);
                    }

                    await system.render();

                    // End render tracking
                    if (this.performanceMonitor) {
                        this.performanceMonitor.endSystemRender(systemName);
                    }
                } else if (this.performanceMonitor) {
                    // If no render, still need to end the system tracking
                    this.performanceMonitor.startSystemRender(systemName);
                    this.performanceMonitor.endSystemRender(systemName);
                }
            }

            // Update performance overlay
            if (this.performanceMonitor) {
                this.performanceMonitor.updateOverlay();
            }

            this.postUpdate();
        }
    }

    postUpdate() {
       // this.desyncDebugger?.displaySync(false); 
       
        this.lastTime = this.currentTime;
    
        this.entitiesToAdd.forEach((entity) => this.addEntity(entity));        
        this.entitiesToAdd = [];
        
    }

    createEntity(setId) {
        const id = setId || this.getEntityId();
        this.entities.set(id, new Set());
        return id;
    }
    
    destroyEntity(entityId) {
        if (this.entities.has(entityId)) {

            this.systems.forEach(system => {
                if (system.entityDestroyed) {
                    system.entityDestroyed(entityId);                    
                }
            });

            const componentTypes = this.entities.get(entityId);
            componentTypes.forEach(type => {
                this.removeComponent(entityId, type);
            });
            this.entities.delete(entityId);
        }
    }
    
    addComponent(entityId, componentId, componentData) {
        if (!this.entities.has(entityId)) {
            throw new Error(`Entity ${entityId} does not exist`);
        }
        
        if (!this.components.has(componentId)) {
            this.components.set(componentId, new Map());
        }
        
        this.components.get(componentId).set(entityId, componentData);
        this.entities.get(entityId).add(componentId);
    }
    
    removeComponent(entityId, componentType) {
        let component = this.getComponent(entityId, componentType);
        if (this.components.has(componentType)) {
            this.components.get(componentType).delete(entityId);
        }
        if (this.entities.has(entityId)) {
            this.entities.get(entityId).delete(componentType);
        }
        return component;
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
        return result.sort((a, b) => String(a).localeCompare(String(b)));
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


    triggerEvent(eventName, data) {
        this.systems.forEach(system => {
            if (system[eventName]) {
                system[eventName](data);
            }
        });
    }

    gameOver() {
        this.state.gameOver = true;
    }

    gameVictory() {
        this.state.victory = true;
    }
    resetCurrentTime() {
        this.state.now = 0;
        this.lastTime = 0;
        this.currentTime = 0;     
    }
}

if(typeof BaseECSGame != 'undefined'){
    if (typeof window !== 'undefined') {
        window.BaseECSGame = BaseECSGame;
    }

    // Make available as ES module export (new for server)  
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = BaseECSGame;
    }

    // Make available as ES6 export (also new for server)
    if (typeof exports !== 'undefined') {
        exports.default = BaseECSGame;
        exports.BaseECSGame = BaseECSGame;
    }
}