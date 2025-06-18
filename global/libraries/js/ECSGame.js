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
    }
    init() {       
        this.imageManager.dispose();
    }

    getCollections() {
        return this.app.getCollections();
    }

    update() {
  
        if (!this.state.isPaused) {
            this.currentTime = Date.now();

            // Only update if a reasonable amount of time has passed
            const timeSinceLastUpdate = this.currentTime - this.lastTime;

            // Skip update if more than 1 second has passed (tab was inactive)
            if (timeSinceLastUpdate > 1000) {
                this.lastTime = this.currentTime; // Reset timer without updating
                return;
            }

            this.deltaTime = Math.min(1/30, timeSinceLastUpdate / 1000); // Cap at 1/30th of a second        
            this.lastTime = this.currentTime;

            let entitiesToRemove = [];
            for (const e of this.entities.values()) {
                e.update();
                if(!e.destroyed){
                    if(!this.isServer){
                        e.draw();
                    }
                    e.postUpdate();  
                } else {
                    entitiesToRemove.push(e);
                }     
            }

            for(let i = 0; i < entitiesToRemove.length; i++){
                this.removeEntity(entitiesToRemove[i]);
            }

            this.postUpdate();
        }     
    }

    postUpdate() {
    
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

    spawn(type, params) {
        let entity = this.createEntityFromCollections(type, params);
        if(!entity.excluded){
            this.entitiesToAdd.push(entity);        
        }
        return entity;
    }
    
    createEntityFromCollections(type, params) {

        const entity = this.createEntity(type);
        const def = this.getCollections().entities[type];

        entity.transform = entity.addComponent("transform");
        if(def.id){
            entity.id = def.id;
        }
        if (def.components) {
            def.components.forEach((componentType) => {
                const componentDef = this.getCollections().components[componentType];
                if (componentDef.script) {
                    const ScriptComponent = this.moduleManager.getCompiledScript(componentType, 'components');
                    if (ScriptComponent) {
                        entity.addComponent(componentType);                  
                    }
                }
            });
        }
        if (def.renderers) {
            def.renderers.forEach((rendererType) => {
                const componentDef = this.getCollections().renderers[rendererType];
                if (componentDef.script) {
                    const ScriptComponent = this.moduleManager.getCompiledScript(rendererType, 'renderers');
                    if (ScriptComponent) {
                        entity.addRenderer(rendererType);                  
                    }
                }
            });
        }
        //this allows components to reference other components on the entity at init, since they will now all exist before init.
        entity.init(params);
        return entity;
    }

    createEntity(type) {
        const entity = new GUTS.Entity(this, type);
        entity.id = ++this.entityId;
        return entity;
    }

    getEntityById(id){
        return this.entities.get(id);
    }

    addEntity(entity) {
        this.entities.set(entity.id, entity);
    }
    removeEntity(entity) {        
        this.entities.delete(entity.id);        
    }
}