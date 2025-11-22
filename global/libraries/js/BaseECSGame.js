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
        this.tickCount = 0;

        // Fixed timestep for deterministic simulation (20 TPS = 0.05s per tick)
        this.FIXED_DELTA_TIME = 1/20;

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

            // Use tick count based timing to avoid floating-point accumulation errors
            this.tickCount++;
            // Use FIXED_DELTA_TIME for deterministic simulation (ignore variable deltaTime)
            // Round to 2 decimal places to avoid floating-point precision issues
            // (e.g., 3 * 0.05 = 0.15000000000000002 in JavaScript)
            this.currentTime = Math.round(this.tickCount * this.FIXED_DELTA_TIME * 100) / 100;

            // Only update if a reasonable amount of time has passed
            // const timeSinceLastUpdate = this.currentTime - this.lastTime;

            // // Skip update if more than 1 second has passed (tab was inactive)
            // if (timeSinceLastUpdate > 1000) {
            //     this.lastTime = this.currentTime; // Reset timer without updating
            //     return;
            // }
            this.state.now = this.currentTime;
            // Use fixed deltaTime for deterministic simulation
            this.state.deltaTime = this.FIXED_DELTA_TIME;
            this.deltaTime = this.FIXED_DELTA_TIME;

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
        // Classes are now available directly at GUTS[classId]
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
        this.tickCount = 0;
    }
}


// Assign to global.GUTS for server
if (typeof global !== 'undefined' && global.GUTS) {
    global.GUTS.BaseECSGame = BaseECSGame;
}

// ES6 exports for webpack bundling
export default BaseECSGame;
export { BaseECSGame };
