import { Entity } from "./Entity.js";
import { Component } from "./Component.js";
import { SpatialGrid } from "./SpatialGrid.js";
import { ImageManager } from "./ImageManager.js";
import { CoordinateTranslator } from './CoordinateTranslator.js';
import { MapRenderer } from "./MapRenderer.js";
import { MapManager } from "./MapManager.js";
import { calculateDamage } from "../functions/calculateDamage.js";
import { calculateStats } from "../functions/calculateStats.js";
import { GameState } from "../engine/GameState.js";

class Engine {
    constructor(target) {
        this.entityId = 0;

        this.applicationTarget = document.getElementById(target);
        this.entitiesToAdd = [];
        
        this.currentTime = Date.now();
        this.lastTime = Date.now();
        this.deltaTime = 0;
    }

    async init() {
        this.displayLoadScreen();
        this.config = await this.loadConfig();
        if (!this.config) {
            console.error("Failed to load game configuration");
            return;
        }
        this.state = new GameState(this.config);  
      
        await this.loadImages();
 
        this.setupHTML();
        
        this.mapManager = new MapManager(); 
        const { tileMap, paths } = this.mapManager.generateMap(this.config.levels[this.state.level].tileMap);
        this.state.tileMap = tileMap;
        this.state.paths = paths;
        this.state.tileMapData = this.config.levels[this.state.level].tileMap;
        

        
        this.translator = new CoordinateTranslator(this.config.configs.game, this.config.levels[this.state.level].tileMap.terrainMap.length);
        this.spatialGrid = new SpatialGrid(this.config.levels[this.state.level].tileMap.terrainMap.length, this.config.configs.game.gridSize);
        this.mapRenderer = new MapRenderer(this.canvasBuffer, this.config.environment, this.imageManager, this.state.level, this.config.configs.game, this.config.levels[this.state.level].tileMap.terrainBGColor );   

        this.imageManager.dispose();

        this.scriptCache = new Map(); // Cache compiled scripts
        this.setupScriptEnvironment();
        this.preCompileScripts();
        this.gameEntity = this.createEntityFromConfig(0, 0, 'game');
        this.animationFrameId = requestAnimationFrame(() => this.gameLoop());
        this.setupEventListeners();

    }

    async loadImages() {
        this.imageManager = new ImageManager(this.config.configs.game.imageSize);    

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

    }

    setupEventListeners() {
        this.canvas.addEventListener('mousemove', (e) => {
            const rect = this.canvas.getBoundingClientRect();
            const mouseX = e.clientX - rect.left;
            const mouseY = e.clientY - rect.top;
            const gridPos = this.translator.isoToGrid(mouseX, mouseY);
            const snappedGrid = this.translator.snapToGrid(gridPos.x, gridPos.y);
            const pixelIsoPos = this.translator.pixelToIso(mouseX, mouseY);
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
            Entity: Entity,
            Component: Component,
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
        const entity = this.createEntity(x, y);
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
            return Component; // Fallback to base Component
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
        
        if (this.state.gameOver || this.state.victory || this.state.isLevelingUp) return;
        
        // Sort entities by y position for proper drawing order
        this.state.entities.sort((a, b) => {
            return (b.position.y * this.state.tileMap.length + b.position.x) - (a.position.y * this.state.tileMap.length + a.position.x)
        });
        this.gameEntity.update();
        // Update all entities
        for(let i = this.state.entities.length - 1; i >= 0; i--) {
            let e = this.state.entities[i];
            let result = e.update();     
            e.draw();
            e.postUpdate(); 
            if(!result) {               
                this.state.entities.splice(i, 1);
            }     
        }   
        this.gameEntity.draw();
        this.gameEntity.postUpdate();
    
        // Add any new entities
        this.entitiesToAdd.forEach((entity) => this.state.addEntity(entity));
        this.entitiesToAdd = [];
    }

    gameLoop() {
        this.ctx.clearRect(0, 0, this.canvasBuffer.width, this.canvasBuffer.height);
        this.finalCtx.clearRect(0, 0, this.canvas.width, this.canvas.height);

        this.mapRenderer.renderBG(this.state, this.state.tileMapData, this.state.tileMap, this.state.paths, true);
        
        if (!this.state.isPaused) {
            this.update();
        } 
        
        this.mapRenderer.renderFG();
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

    async loadConfig() {
        let gameData = localStorage.getItem("objectTypes");
        if(gameData) {
            return JSON.parse(gameData);
        }
        
        try {
            const response = await fetch('/config/game_config.json');
            if (!response.ok) throw new Error('File not found');
            return await response.json();
        } catch (error) {
            console.error('Error loading config:', error);
            return null;
        }
    }

    createEntity(x, y) {
        const entity = new Entity(this, x, y);
        return entity;
    }

    // Abstract UI drawing method to be implemented by subclasses
    drawUI() {
    }
}

export { Engine };