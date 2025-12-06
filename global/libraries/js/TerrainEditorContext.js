/**
 * TerrainEditorContext - ECS game context for the Terrain Map Editor
 * Extends BaseECSGame to use the same ECS infrastructure as the game
 */
class TerrainEditorContext extends GUTS.BaseECSGame {
    constructor(gameEditor, canvas) {
        super(gameEditor);
        this.canvas = canvas;
        this.gameEditor = gameEditor;
        this.isServer = false;

        // State (required by systems)
        this.state = {
            isPaused: false,
            now: 0,
            deltaTime: 0.016,
            gameOver: false,
            victory: false,
            level: null
        };

        // Game services
        this.gameManager = new GUTS.GameServices();

        // Component generator
        this.componentGenerator = new GUTS.ComponentGenerator(this.getCollections().components);
        this.gameManager.register("getComponents", this.componentGenerator.getComponents.bind(this.componentGenerator));
        this.gameManager.register("getCollections", () => this.getCollections());

        // Animation loop
        this.animationFrameId = null;
        this.clock = new THREE.Clock();
    }

    /**
     * Initialize systems from provided list
     * @param {Array<string>} systemNames - Names of systems to initialize
     */
    async initialize(systemNames = []) {
        // Initialize model manager
        if (!this.modelManager) {
            const palette = this.gameEditor.getPalette();
            this.modelManager = new GUTS.ModelManager(
                this.gameEditor,
                {},
                { ShapeFactory: GUTS.ShapeFactory, palette, textures: this.getCollections().textures }
            );

            // Load all models
            for (const objectType in this.getCollections()) {
                await this.modelManager.loadModels(objectType, this.getCollections()[objectType]);
            }
        }

        // Initialize systems in order
        for (const systemName of systemNames) {
            if (GUTS[systemName]) {
                try {
                    const systemInst = new GUTS[systemName](this);
                    systemInst.enabled = true;

                    if (systemInst.init) {
                        systemInst.init({ canvas: this.canvas });
                    }

                    this.systems.push(systemInst);
                } catch (e) {
                    console.warn(`[TerrainEditorContext] Could not initialize ${systemName}:`, e);
                }
            }
        }

        console.log('[TerrainEditorContext] Initialized with systems:', systemNames);
    }

    /**
     * Notify systems that a scene has loaded
     * @param {Object} sceneData - Scene data for systems
     */
    async loadScene(sceneData = {}) {
        for (const system of this.systems) {
            if (system.onSceneLoad) {
                system.onSceneLoad(sceneData);
            }
        }

        for (const system of this.systems) {
            if (system.postSceneLoad) {
                await system.postSceneLoad(sceneData);
            }
        }

        for (const system of this.systems) {
            if (system.postAllInit) {
                system.postAllInit();
            }
        }
    }

    /**
     * Start the render/update loop
     */
    startRenderLoop() {
        const loop = () => {
            const deltaTime = this.clock.getDelta();
            this.state.deltaTime = deltaTime;
            this.state.now += deltaTime;

            // Update enabled systems
            for (const system of this.systems) {
                if (!system.enabled) continue;
                if (system.update) {
                    system.update();
                }
            }

            // Update and render via WorldSystem's worldRenderer
            if (this.worldSystem?.worldRenderer) {
                this.worldSystem.worldRenderer.update(deltaTime);
                this.worldSystem.worldRenderer.render();
            }

            this.animationFrameId = requestAnimationFrame(loop);
        };

        loop();
    }

    /**
     * Stop the render loop
     */
    stopRenderLoop() {
        if (this.animationFrameId) {
            cancelAnimationFrame(this.animationFrameId);
            this.animationFrameId = null;
        }
    }

    /**
     * Cleanup resources
     */
    destroy() {
        this.stopRenderLoop();

        for (const system of this.systems) {
            if (system.onSceneUnload) {
                system.onSceneUnload();
            }
            if (system.destroy) {
                system.destroy();
            }
        }

        this.systems = [];

        const entityIds = Array.from(this.entities.keys());
        for (const entityId of entityIds) {
            this.destroyEntity(entityId);
        }
    }
}

// Export
if (typeof module !== 'undefined' && module.exports) {
    module.exports = TerrainEditorContext;
}

if (typeof GUTS !== 'undefined') {
    GUTS.TerrainEditorContext = TerrainEditorContext;
}

export default TerrainEditorContext;
export { TerrainEditorContext };
