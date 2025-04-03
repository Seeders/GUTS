import { DEFAULT_PROJECT_CONFIG } from "../config/default_app_config.js";
import { ModuleManager } from "./ModuleManager.js";

class Engine {
    constructor(target) {
        this.entityId = 0;

        this.applicationTarget = document.getElementById(target);
        this.entitiesToAdd = [];
        this.plugins = {};
        this.currentTime = Date.now();
        this.lastTime = Date.now();
        this.deltaTime = 0;
        this.engineClasses = [];
        this.libraries = {};
    }

    async init() {
        this.config = this.loadConfig();
      
        if (!this.config) {
            console.error("Failed to load game configuration");
            return;
        }

        // Initialize ModuleManager
        this.moduleManager = new ModuleManager(this, this.config, this.applicationTarget, this.applicationTarget);
        
        let projectConfig = this.config.configs.game;
        if (projectConfig.libraries) {
            // Use ModuleManager to load modules
            this.libraryClasses = await this.moduleManager.loadModules({ "game": projectConfig });
        }

        await this.loadAssets();

        this.state = new (this.libraryClasses.GameState)(this.config);  
        this.isometric = this.config.configs.game.isIsometric || false;
        this.setupHTML();
        this.state.tileMapData = this.config.levels[this.state.level].tileMap;   
 
        this.translator = new (this.libraryClasses.CoordinateTranslator)(this.config.configs.game, this.config.levels[this.state.level].tileMap.terrainMap.length, this.isometric);
        this.spatialGrid = new (this.libraryClasses.SpatialGrid)(this.config.levels[this.state.level].tileMap.terrainMap.length, this.config.configs.game.gridSize);
        const terrainImages = this.imageManager.getImages("levels", this.state.level);
        this.terrainTileMapper = new (this.libraryClasses.TileMap)(this, {}, {CanvasUtility: this.libraryClasses.CanvasUtility});
        this.terrainTileMapper.init(this.terrainCanvasBuffer, this.config.configs.game.gridSize, terrainImages, this.isometric);
        
        // Use ModuleManager's script environment
        this.setupScriptEnvironment();
        this.preCompileScripts();
        this.gameEntity = this.createEntityFromConfig(0, 0, 'game', { gameConfig: this.config.configs.game, terrainCanvasBuffer: this.terrainCanvasBuffer, canvasBuffer: this.canvasBuffer, environment: this.config.environment, imageManager: this.imageManager, levelName: this.state.level, level: this.config.levels[this.state.level] });
        this.animationFrameId = requestAnimationFrame(() => this.gameLoop());
        this.setupEventListeners();
        this.imageManager.dispose();
    }
    
    getCollections() {
        return this.config;
    }

    async loadAssets() {
        this.imageManager = new (this.libraryClasses.ImageManager)(this, {imageSize: this.config.configs.game.imageSize}, { ShapeFactory: this.libraryClasses.ShapeFactory});    
        // Load all images
        for(let objectType in this.config) {
            await this.imageManager.loadImages(objectType, this.config[objectType]);
        }  
    }

    setupHTML() {      
        document.body.style = "";  
        document.getElementById('loading-screen').style = 'display: none;';    
        this.setupCanvas();
        requestAnimationFrame(() => {
            
            this.applicationTarget.style = '';
        });
    }

    setupCanvas() {
        this.canvas = document.getElementById("gameCanvas");
        this.finalCtx = this.canvas.getContext("2d");
        this.canvasBuffer = document.createElement("canvas");
        this.ctx = this.canvasBuffer.getContext("2d");
        this.canvasBuffer.setAttribute('width', this.config.configs.game.canvasWidth);
        this.canvasBuffer.setAttribute('height', this.config.configs.game.canvasHeight);
        this.canvas.setAttribute('width', this.config.configs.game.canvasWidth);
        this.canvas.setAttribute('height', this.config.configs.game.canvasHeight);
        
        this.terrainCanvasBuffer = document.createElement('canvas');
        this.terrainCanvasBuffer.width = this.canvas.width;
        this.terrainCanvasBuffer.height = this.canvas.height;
    }

    setupEventListeners() {
        this.canvas.addEventListener('mousemove', (e) => {
            const rect = this.canvas.getBoundingClientRect();
            
            // Account for canvas scaling and offset
            const scaleX = this.canvas.width / rect.width;   // Ratio of canvas pixel width to CSS width
            const scaleY = this.canvas.height / rect.height; // Ratio of canvas pixel height to CSS height
            
            // Calculate mouse position relative to canvas with scaling
            const mouseX = (e.clientX - rect.left) * scaleX + (this.isometric ? 0 : -( this.canvas.width - this.state.tileMapData.size * this.config.configs.game.gridSize) / 2);
            const mouseY = (e.clientY - rect.top) * scaleY + (this.isometric ? 0 : -( this.canvas.height - this.state.tileMapData.size * this.config.configs.game.gridSize) / 2);
    
            // Convert to isometric and grid coordinates
            const gridPos = this.translator.isoToGrid(mouseX, mouseY);
            const snappedGrid = this.translator.snapToGrid(gridPos.x, gridPos.y);
            const pixelIsoPos = this.translator.pixelToIso(mouseX, mouseY);
    
            // Update state with corrected coordinates
            this.state.mousePosition = { 
                x: mouseX, 
                y: mouseY, 
                isoX: pixelIsoPos.x, 
                isoY: pixelIsoPos.y, 
                gridX: snappedGrid.x, 
                gridY: snappedGrid.y 
            };
        });
    }

    reset() {
        // Implementation remains the same
    }

    setupScriptEnvironment() {
        // Use ModuleManager's script environment setup
        this.scriptContext = this.moduleManager.setupScriptEnvironment(this);
    }

    // Pre-compile all scripts to ensure availability
    preCompileScripts() {
        for (let componentType in this.config.components) {
            const componentDef = this.config.components[componentType];
            if (componentDef.script) {
                this.moduleManager.compileScript(componentDef.script, componentType);
            }
        }
        for (let componentType in this.config.renderers) {
            const componentDef = this.config.renderers[componentType];
            if (componentDef.script) {
                this.moduleManager.compileScript(componentDef.script, componentType);
            }
        }
        for( let funcType in this.config.functions) {            
            const funcDef = this.config.functions[funcType];
            this.moduleManager.compileFunction(funcDef.script, funcType);
        }
    }
    
    spawn(x, y, type, params) {
        return this.addEntity(this.createEntityFromConfig(x, y, type, params));
    }

    createEntityFromConfig(x, y, type, params) {
        const entity = this.createEntity(x, y, type);
        const def = this.config.entities[type];
        
        if (def.components) {
            def.components.forEach((componentType) => {
                const componentDef = this.config.components[componentType];
                if (componentDef.script) {
                    const ScriptComponent = this.moduleManager.getCompiledScript(componentType, 'components');
                    if (ScriptComponent) {
                        entity.addComponent(ScriptComponent, params);                  
                    }
                }
            });
        }
        if (def.renderers) {
            def.renderers.forEach((rendererType) => {
                const componentDef = this.config.renderers[rendererType];
                if (componentDef.script) {
                    const ScriptComponent = this.moduleManager.getCompiledScript(rendererType, 'renderers');
                    if (ScriptComponent) {
                        entity.addRenderer(ScriptComponent, params);                  
                    }
                }
            });
        }
        return entity;
    }

    update() {
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
       
        // Sort entities by y position for proper drawing order
        this.state.entities.sort((a, b) => {
            return (a.position.y * this.state.tileMap.length + a.position.x) - (b.position.y * this.state.tileMap.length + b.position.x)
        });
    
        this.gameEntity.update();
        
        // Single loop through entities for update, draw and postUpdate
        const entitiesToKeep = [];
        for(let i = 0; i < this.state.entities.length; i++) {
            let e = this.state.entities[i];
            let result = e.update();    
            
            if(result) {
                entitiesToKeep.push(e);
                e.draw();
                e.postUpdate();
            }
        }
        
        // Replace the entities array with only entities that should be kept
        this.state.entities = entitiesToKeep;
        
        this.gameEntity.postUpdate();
        this.gameEntity.draw();
        
        // Add any new entities
        this.entitiesToAdd.forEach((entity) => this.state.addEntity(entity));
        this.entitiesToAdd = [];
    }

    gameLoop() {
        this.ctx.clearRect(0, 0, this.canvasBuffer.width, this.canvasBuffer.height);
        this.finalCtx.clearRect(0, 0, this.canvas.width, this.canvas.height);

        if(this.mapRenderer) {
            this.mapRenderer.renderBG(this.state.tileMapData, this.state.paths);
        }
        if (!this.state.isPaused) {
            this.update();
        }         
        if(this.mapRenderer) {
            this.mapRenderer.renderFG();
        }
        this.drawUI();
        this.finalCtx.drawImage(this.canvasBuffer, 0, 0);
        this.animationFrameId = requestAnimationFrame(() => this.gameLoop());
    }

    stopGameLoop() {
        if (this.animationFrameId) {
            cancelAnimationFrame(this.animationFrameId);
            this.animationFrameId = null;
        }
    }

    addEntity(entity) {
        this.entitiesToAdd.push(entity);
        return entity;
    }

    loadConfig() {
        let config = localStorage.getItem("currentProject");

        if (!config) {
            config = DEFAULT_PROJECT_CONFIG;
        } else {
            config = JSON.parse(localStorage.getItem(config));   
        }

        return config.objectTypes;
    }

    createEntity(x, y, type) {
        const entity = new (this.libraryClasses.Entity)(this, x, y, type);
        return entity;
    }

    // Abstract UI drawing method to be implemented by subclasses
    drawUI() {
        // Implementation remains the same
    }
}

export { Engine };