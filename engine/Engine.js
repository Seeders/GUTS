import { TOWER_DEFENSE_CONFIG } from "../config/game_td_config.js";
import { ModuleLoader } from "./ModuleLoader.js";

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
        this.displayLoadScreen();
        this.config = this.loadConfig();
      
        if (!this.config) {
            console.error("Failed to load game configuration");
            return;
        }
        this.state = new (this.libraryClasses.GameState)(this.config);  
        let projectConfig = this.config.configs.game;
        if( projectConfig.libraries ) {
            this.moduleLoader = new ModuleLoader(this, this.config, document.body, document.body, this.engineClasses);           
            this.libraryClasses = await this.moduleLoader.loadModules({ "game" : projectConfig });
        }

        await this.loadAssets();

        this.isometric = this.config.configs.game.isIsometric || false;
        this.setupHTML();
        this.state.tileMapData = this.config.levels[this.state.level].tileMap;   
 
        this.translator = new (this.libraryClasses.CoordinateTranslator)(this.config.configs.game, this.config.levels[this.state.level].tileMap.terrainMap.length, this.isometric);
        this.spatialGrid = new (this.libraryClasses.SpatialGrid)(this.config.levels[this.state.level].tileMap.terrainMap.length, this.config.configs.game.gridSize);
        const terrainImages = this.imageManager.getImages("levels", this.state.level);
        this.terrainTileMapper = new (this.libraryClasses.TileMap)(this, {}, {CanvasUtility: this.libraryClasses.CanvasUtility});
        this.terrainTileMapper.init(this.terrainCanvasBuffer, this.config.configs.game.gridSize, terrainImages, this.isometric);
        this.scriptCache = new Map(); // Cache compiled scripts
        this.setupScriptEnvironment();
        this.preCompileScripts();
        this.gameEntity = this.createEntityFromConfig(0, 0, 'game', { gameConfig: this.config.configs.game, terrainCanvasBuffer: this.terrainCanvasBuffer, canvasBuffer: this.canvasBuffer, environment: this.config.environment, imageManager: this.imageManager, levelName: this.state.level, level: this.config.levels[this.state.level] });
        this.animationFrameId = requestAnimationFrame(() => this.gameLoop());
        this.setupEventListeners();
        this.imageManager.dispose();

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
        this.applicationTarget.innerHTML = this.config.configs.game.html; 
        const styleEl = document.createElement("style");
        styleEl.innerHTML = this.config.configs.game.css;
        document.head.appendChild(styleEl);
        this.setupCanvas();
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
            const mouseX = (e.clientX - rect.left) * scaleX + (this.isometric ? 0 : -( this.canvas.width - this.state.tileMapData.size *  this.config.configs.game.gridSize) / 2);
            const mouseY = (e.clientY - rect.top) * scaleY;
    
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

    displayLoadScreen() {
        this.applicationTarget.innerHTML = `
        <div class='loading-screen' style='
      border: none;
      border-radius: 1.5em;
      background: #2d2d2d;
      color: #ffffff;
      width: 600px;
      height: 400px;
      position: absolute;
      left: 0;
      right: 0;
      bottom: 0;
      top: 0;
      margin: auto;
      display: flex;
      align-items: center;
      justify-content: center;
      box-shadow: 0 4px 15px rgba(0, 0, 0, 0.3);
      overflow: hidden;
    '>
      <div style='
        position: relative;
        font-family: Arial, sans-serif;
        font-size: 1.5em;
        letter-spacing: 2px;
        text-transform: uppercase;
      '>
        Loading
        <span style='
          animation: dots 1.5s infinite;
        '>
          <span style='opacity: 0.5; animation: dotFade 1.5s infinite 0s;'>.</span>
          <span style='opacity: 0.5; animation: dotFade 1.5s infinite 0.2s;'>.</span>
          <span style='opacity: 0.5; animation: dotFade 1.5s infinite 0.4s;'>.</span>
        </span>
      </div>
      <style>
        @keyframes dotFade {
          0% { opacity: 0.5; }
          50% { opacity: 1; }
          100% { opacity: 0.5; }
        }
      </style>
    </div>
        `;
    }

    reset() {

    }

    setupScriptEnvironment() {
        // Safe execution context with all imported modules
        this.scriptContext = {
            game: this,
            Entity: this.libraryClasses.Entity,
            Component: this.libraryClasses.Component,
            getFunction: (typeName) => this.scriptCache.get(typeName) || this.compileScript(this.config.functions[typeName].script, typeName),
            // Add a way to access other compiled scripts
            getComponent: (typeName) => this.scriptCache.get(typeName) || this.compileScript(this.config.components[typeName].script, typeName),
            getRenderer: (typeName) => this.scriptCache.get(typeName) || this.compileScript(this.config.renderers[typeName].script, typeName),
            Math: Math,
            console: {
                log: (...args) => console.log('[Script]', ...args),
                error: (...args) => console.error('[Script]', ...args)
            }
        };
    }

    // Pre-compile all scripts to ensure availability
    preCompileScripts() {
        for (let componentType in this.config.components) {
            const componentDef = this.config.components[componentType];
            if (componentDef.script) {
                this.compileScript(componentDef.script, componentType);
            }
        }
        for (let componentType in this.config.renderers) {
            const componentDef = this.config.renderers[componentType];
            if (componentDef.script) {
                this.compileScript(componentDef.script, componentType);
            }
        }
        for( let func in this.config.functions) {
            const compiledFunction = new Function('return ' + this.config.functions[func].script)();
            this.scriptCache.set(func, compiledFunction);
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
                    const ScriptComponent = this.scriptCache.get(componentType);
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
                    const ScriptComponent = this.scriptCache.get(rendererType);
                    if (ScriptComponent) {
                        entity.addRenderer(ScriptComponent, params);                  
                    }
                }
            });
        }
        return entity;
    }


    compileScript(scriptText, typeName) {
        if (this.scriptCache.has(typeName)) {
            return this.scriptCache.get(typeName);
        }

        try {
            const defaultConstructor = `
                constructor(game, parent, params) {
                    super(game, parent, params);
                }
            `;

            const constructorMatch = scriptText.match(/constructor\s*\([^)]*\)\s*{[^}]*}/);
            let classBody = constructorMatch ? scriptText : `${defaultConstructor}\n${scriptText}`;

            // Inject scriptContext into the Function scope
            const scriptFunction = new Function(
                'engine',
                `
                    return class ${typeName} extends engine.Component {
                        ${classBody}
                    }
                `
            );

            const ScriptClass = scriptFunction(this.scriptContext);
            this.scriptCache.set(typeName, ScriptClass);
            return ScriptClass;
        } catch (error) {
            console.error(`Error compiling script for ${typeName}:`, error);
            return this.libraryClasses.Component; // Fallback to base Component
        }
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
            this.mapRenderer.renderBG(this.state, this.state.tileMapData, this.state.tileMap, this.state.paths);
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

        if( !config ) {
            config = TOWER_DEFENSE_CONFIG;
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
    }
}

export { Engine };