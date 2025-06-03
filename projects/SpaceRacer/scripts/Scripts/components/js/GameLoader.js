class GameLoader extends engine.Component {
    
    init() {}
    
    async load(){
        this.collections = this.game.getCollections();        
        this.collections.configs.game.canvasWidth = window.outerWidth;
        this.collections.configs.game.canvasHeight = window.outerHeight;    
        this.game.palette = this.collections.palettes && this.collections.configs.game.palette ? this.collections.palettes[this.collections.configs.game.palette] : null;
        this.isometric = this.collections.configs.game.isIsometric;
        if (this.game.state.modifierSet && this.collections.modifierSets) {
            this.game.state.stats = this.collections.modifierSets[this.game.state.modifierSet];
            this.game.state.defaultStats = { ...this.game.state.stats };
        }   
        this.setupCanvas(this.collections.configs.game.canvasWidth, this.collections.configs.game.canvasHeight);
        await this.loadAssets();
        this.playerId = 0;
        const scene = this.collections.scenes["main"];
        const sceneEntities = scene.sceneData;
        sceneEntities.forEach(async (sceneEntity) => {
              

            let params = {
                "objectType": sceneEntity.objectType,
                "spawnType": sceneEntity.spawnType,
            };
            sceneEntity.components.forEach((entityComp) => {
                params = {...params, ...entityComp.parameters };
            });
            if(sceneEntity.type == "game"){  
                this.game.gameEntity = this.game.createEntityFromCollections(sceneEntity.type, params);
                this.game.audioManager = this.game.gameEntity.getComponent('AudioManager');  
                this.game.multiplayerManager = this.game.gameEntity.getComponent("MultiplayerManager");
                this.game.multiplayerManager.init({scene: this.game.scene, physics: this.game.physics, serverUrl: this.collections.configs.game.multiplayerServerUrl });
            } else {
                let spawned = this.game.spawn(sceneEntity.type, params);                                  
                if(sceneEntity.type.startsWith("player")){
                    this.player = spawned;
                    this.game.player = this.player;
                    this.player.placed = true;
                }
            }
        });

        if(this.player && this.game.multiplayerManager) {
            this.playerId = await this.game.multiplayerManager.initializeMultiplayer(this.serverUrl);   
            if(this.playerId != 0){
                this.game.multiplayerManager.createLocalPlayer(this.playerId, this.player);
                this.game.isSinglePlayer = false;
            } else {
                this.game.isSinglePlayer = true;
                this.game.isServer = false;
                this.player.getComponent("AircraftController")?.setupPhysics(this.game.physics.simulation);
            }  
        }
 

    }

    getProject() {
        return this.game.gameEntity;
    }
    setupCanvas(canvasWidth, canvasHeight) {
        this.canvas = document.getElementById("gameCanvas");
        if(this.game.getCollections().configs.game.is3D){
            this.finalCtx = this.canvas.getContext("webgl2");
        } else {
            this.finalCtx = this.canvas.getContext("2d");
        }
        this.canvasBuffer = document.createElement("canvas");
        this.ctx = this.canvasBuffer.getContext("2d");
        this.canvasBuffer.setAttribute('width', canvasWidth);
        this.canvasBuffer.setAttribute('height', canvasHeight);
        this.canvas.setAttribute('width', canvasWidth);
        this.canvas.setAttribute('height', canvasHeight);  
        
        this.terrainCanvasBuffer = document.createElement('canvas');

        this.game.canvas = this.canvas;
        this.game.finalCtx = this.finalCtx;
        this.game.canvasBuffer = this.canvasBuffer;
        this.game.ctx = this.ctx;
        this.game.terrainCanvasBuffer = this.terrainCanvasBuffer;
    }
    async loadAssets() {     
        this.game.modelManager = new GUTS.ModelManager(this.game, {}, {ShapeFactory: GUTS.ShapeFactory, palette: this.game.palette, textures: this.game.getCollections().textures});    
        for(let objectType in this.collections) {
            
            await this.game.modelManager.loadModels(objectType, this.collections[objectType]);
        }  
 
        console.log("loaded all Models");
    }
}