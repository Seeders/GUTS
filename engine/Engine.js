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
        this.config = this.loadCollections();
      
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
        this.isometric = this.config.configs.game.isIsometric || false;

        await this.loadAssets();

        
        this.setupHTML();
        this.setupEventListeners();
        this.setupScriptEnvironment();
        this.preCompileScripts();
        this.loader = new (this.libraryClasses.GameLoader)(this.config);  
        this.project = this.loader.getProject();        
        // Use ModuleManager's script environment

        this.animationFrameId = requestAnimationFrame(() => this.gameLoop());
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
            const mouseX = (e.clientX - rect.left) * scaleX + (this.isometric ? 0 : -( this.canvas.width - this.state.mapGridWidth * this.config.configs.game.gridSize) / 2);
            const mouseY = (e.clientY - rect.top) * scaleY + (this.isometric ? 0 : -( this.canvas.height - this.state.mapGridWidth * this.config.configs.game.gridSize) / 2);
    
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
    gameLoop() {
        this.ctx.clearRect(0, 0, this.canvasBuffer.width, this.canvasBuffer.height);
        this.finalCtx.clearRect(0, 0, this.canvas.width, this.canvas.height);

        if(this.project && this.project.update) {
            this.project.update();   
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

    loadCollections() {
        let currentProject = localStorage.getItem("currentProject");
        let gameData = DEFAULT_PROJECT_CONFIG;
        if (currentProject) {
            gameData = JSON.parse(localStorage.getItem(currentProject));   
        }

        return gameData.objectTypes;
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