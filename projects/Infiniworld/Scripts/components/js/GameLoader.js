class GameLoader extends engine.Component {
    
    constructor(game, parent, params) {
        super(game, parent, params);
    }

    init() {}
    
    async load({config}){
        this.config = config;        
        this.config.configs.game.canvasWidth = window.outerWidth;
        this.config.configs.game.canvasHeight = window.outerHeight;
        this.state = new (this.game.libraryClasses.GameState)(this.config);  
        this.game.state = this.state;
        this.game.palette = this.config.palettes && this.config.configs.game.palette ? this.config.palettes[this.config.configs.game.palette] : null;
        this.isometric = this.config.configs.game.isIsometric;
        if (this.game.state.modifierSet && this.config.modifierSets) {
            this.game.state.stats = this.config.modifierSets[this.game.state.modifierSet];
            this.game.state.defaultStats = { ...this.game.state.stats };
        }   
        this.setupCanvas(this.config.configs.game.canvasWidth, this.config.configs.game.canvasHeight);
        await this.loadAssets();

        const scene = this.config.scenes["main"];
        const sceneEntities = scene.sceneData;
        sceneEntities.forEach((sceneEntity) => {
            
            let position = new THREE.Vector3();
            let scale = new THREE.Vector3(1, 1, 1);
            let rotation = new THREE.Vector3();
            let params = {
                "objectType": sceneEntity.objectType,
                "spawnType": sceneEntity.spawnType,
            };
            sceneEntity.components.forEach((entityComp) => {
                if(entityComp.type == "transform"){
                    position = entityComp.parameters.position;
                    scale = entityComp.parameters.scale;
                    rotation = entityComp.parameters.rotation;
                }
                params = {...params, ...entityComp.parameters };
            });
            if(sceneEntity.type == "game"){  
                this.game.gameEntity = this.game.createEntityFromConfig(sceneEntity.type, params, position);
                this.game.audioManager = this.game.gameEntity.getComponent('AudioManager');  
            } else {
                let spawned = this.game.spawn(sceneEntity.type, params, new THREE.Vector3(position.x, position.y, position.z));                              
                spawned.transform.scale.copy(scale);
                // Alternative quaternion approach
                let euler = new THREE.Euler(
                    rotation.x,
                    rotation.y,
                    rotation.z
                );
                spawned.transform.quaternion.setFromEuler(euler);
                console.log(spawned.transform.quaternion, rotation, euler);
                if(sceneEntity.type.startsWith("player")){
                    this.player = spawned;
                    this.game.player = this.player;
                    this.player.placed = true;
                }
            }
        });
 

    }

    getProject() {
        return this.game.gameEntity;
    }
    setupCanvas(canvasWidth, canvasHeight) {
        this.canvas = document.getElementById("gameCanvas");
        if(this.game.config.configs.game.is3D){
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
        this.game.modelManager = new (this.game.libraryClasses.ModelManager)(this.game, {}, {ShapeFactory: this.game.libraryClasses.ShapeFactory, palette: this.game.palette, textures: this.game.config.textures});    
        for(let objectType in this.config) {
            
            await this.game.modelManager.loadModels(objectType, this.config[objectType]);
        }  
 
        console.log("loaded all Models");
    }
}