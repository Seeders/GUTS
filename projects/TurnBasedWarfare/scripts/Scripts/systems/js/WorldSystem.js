class WorldSystem extends GUTS.BaseSystem {
    constructor(game) {
        super(game);
        this.game.worldSystem = this;

        this.initialized = false;
        this.terrainEntityId = null;

        // WorldRenderer will be created when terrain is loaded
        this.worldRenderer = null;

        // Cached references for convenience
        this.scene = null;
        this.camera = null;
        this.renderer = null;
        this.composer = null;
        this.timer = 0;

        // Window resize handler
        this.onWindowResizeHandler = this.onWindowResize.bind(this);
    }

    init() {
        if (this.initialized) return;

        // Register gameManager methods - delegate to WorldRenderer and TerrainDataManager
        this.game.gameManager.register('getWorldScene', () => this.worldRenderer?.getScene());
        this.game.gameManager.register('getWorldExtendedSize', () => this.game.terrainSystem?.terrainDataManager?.extendedSize);
        this.game.gameManager.register('getGroundTexture', () => this.worldRenderer?.getGroundTexture());
        this.game.gameManager.register('getGroundMesh', () => this.worldRenderer?.getGroundMesh());
        this.game.gameManager.register('getHeightStep', () => this.game.terrainSystem?.terrainDataManager?.heightStep);
        this.game.gameManager.register('getBaseTerrainHeight', () => {
            const tdm = this.game.terrainSystem?.terrainDataManager;
            if (!tdm) return 0;
            return tdm.heightStep * (tdm.tileMap?.extensionHeight || 0);
        });
        this.game.gameManager.register('initWorldFromTerrain', this.initWorldFromTerrain.bind(this));

        // Add BVH extension functions for Three.js
        // Note: MeshBVH exports are flattened onto THREE namespace
        if (typeof THREE !== 'undefined') {
            if (THREE.MeshBVH && THREE.acceleratedRaycast) {
                THREE.BufferGeometry.prototype.computeBoundsTree = THREE.computeBoundsTree;
                THREE.BufferGeometry.prototype.disposeBoundsTree = THREE.disposeBoundsTree;
                THREE.Mesh.prototype.raycast = THREE.acceleratedRaycast;

                THREE.BatchedMesh.prototype.computeBoundsTree = THREE.computeBatchedBoundsTree;
                THREE.BatchedMesh.prototype.disposeBoundsTree = THREE.disposeBatchedBoundsTree;
                THREE.BatchedMesh.prototype.raycast = THREE.acceleratedRaycast;
            }
        }

        // WorldSystem waits for scene to load via onSceneLoad()
        // Terrain entity in scene triggers world initialization

        this.initialized = true;
    }

    /**
     * Called when a scene is loaded - looks for terrain entity to initialize world
     * @param {Object} sceneData - The scene configuration data
     */
    onSceneLoad(sceneData) {
        // Look for terrain entity in scene
        const terrainEntities = this.game.getEntitiesWith('terrain');

        if (terrainEntities.length > 0) {
            const terrainEntityId = terrainEntities[0];
            const terrainComponent = this.game.getComponent(terrainEntityId, 'terrain');
            this.initWorldFromTerrain(terrainComponent, terrainEntityId);
        }
        // If no terrain entity, world system won't initialize (no terrain = no world rendering)
    }

    /**
     * Called when a scene is unloaded
     */
    onSceneUnload() {
        this.cleanupWorld();
    }

    /**
     * Initialize world rendering from terrain component
     * @param {Object} terrainComponent - The terrain component data
     * @param {string} entityId - The entity ID that has the terrain component
     */
    initWorldFromTerrain(terrainComponent, entityId) {
        this.terrainEntityId = entityId;

        // Create WorldRenderer with settings from terrain component
        this.createWorldRenderer({
            enableShadows: terrainComponent.enableShadows !== false,
            enableFog: terrainComponent.enableFog !== false,
            enablePostProcessing: true,
            enableGrass: terrainComponent.enableGrass || false,
            enableLiquidSurfaces: terrainComponent.enableLiquids !== false,
            enableCliffs: terrainComponent.enableCliffs !== false
        });

        this.initializeThreeJS(terrainComponent.level, terrainComponent.world);
    }

    /**
     * Create WorldRenderer with specified options
     * @param {Object} options - WorldRenderer options
     */
    createWorldRenderer(options = {}) {
        // Clean up existing renderer
        if (this.worldRenderer) {
            this.worldRenderer.destroy();
        }

        this.worldRenderer = new GUTS.WorldRenderer({
            enableShadows: options.enableShadows !== false,
            enableFog: options.enableFog !== false,
            enablePostProcessing: options.enablePostProcessing !== false,
            enableGrass: options.enableGrass || false,
            enableLiquidSurfaces: options.enableLiquidSurfaces !== false,
            enableCliffs: options.enableCliffs !== false
        });
    }

    /**
     * Clean up world resources
     */
    cleanupWorld() {
        if (this.worldRenderer) {
            this.worldRenderer.destroy();
            this.worldRenderer = null;
        }

        window.removeEventListener('resize', this.onWindowResizeHandler);

        if (this.uiScene) {
            this.uiScene = null;
        }

        this.scene = null;
        this.camera = null;
        this.renderer = null;
        this.composer = null;
        this.terrainEntityId = null;
    }

    getScene() {
        return this.worldRenderer?.getScene();
    }

    /**
     * Initialize Three.js rendering for a specific level and world
     * @param {string} levelName - The level to load
     * @param {string} worldName - The world configuration to use (optional, derived from level if not provided)
     */
    initializeThreeJS(levelName, worldName = null) {
        if (!this.worldRenderer) {
            console.error('WorldSystem: WorldRenderer not created. Call createWorldRenderer first.');
            return;
        }

        const gameCanvas = document.getElementById('gameCanvas');
        if (!gameCanvas) {
            console.error('WorldSystem: gameCanvas not found!');
            return;
        }

        const collections = this.game.getCollections();
        const level = collections.levels?.[levelName];
        const effectiveWorldName = worldName || level?.world;
        const world = collections.worlds?.[effectiveWorldName];
        const cameraSettings = collections.cameras?.[world?.camera];

        // Initialize Three.js through WorldRenderer
        this.worldRenderer.initializeThreeJS(gameCanvas, cameraSettings, false);

        // Add window resize listener
        window.addEventListener('resize', this.onWindowResizeHandler);

        // Cache references for game
        this.scene = this.worldRenderer.getScene();
        this.camera = this.worldRenderer.getCamera();
        this.renderer = this.worldRenderer.getRenderer();

        // Create UI scene separately (not part of WorldRenderer)
        this.uiScene = new THREE.Scene();

        // Expose to game object
        this.game.camera = this.camera;
        this.game.scene = this.scene;
        this.game.uiScene = this.uiScene;
        this.game.renderer = this.renderer;

        // Setup world rendering
        this.setupWorldRendering(levelName, effectiveWorldName);
    }

    /**
     * Setup world rendering after Three.js is initialized
     * @param {string} levelName - The level name
     * @param {string} worldName - The world name
     */
    async setupWorldRendering(levelName, worldName) {
        const collections = this.game.getCollections();
        const world = collections.worlds?.[worldName];

        // Set background color
        this.worldRenderer.setBackgroundColor(world?.backgroundColor || '#87CEEB');

        // Wait for terrain to be ready
        const terrainDataManager = this.game.terrainSystem?.terrainDataManager;
        if (!terrainDataManager) {
            console.warn('[WorldSystem] TerrainDataManager not available');
            return;
        }

        // Setup lighting
        const lightingSettings = collections.lightings?.[world?.lighting];
        const shadowSettings = collections.shadows?.[world?.shadow];
        this.worldRenderer.setupLighting(lightingSettings, shadowSettings, terrainDataManager.extendedSize);

        // Setup ground with terrain data
        this.worldRenderer.setupGround(terrainDataManager, this.game.terrainTileMapper, terrainDataManager.heightMapSettings);

        // Pass GameManager to WorldRenderer
        this.worldRenderer.gameManager = this.game.gameManager;

        // Update extension configuration in GridSystem's CoordinateTranslator if available
        if (terrainDataManager.extensionSize) {
            this.game.gameManager.call('updateCoordinateConfig', {
                extensionSize: terrainDataManager.extensionSize,
                extendedSize: terrainDataManager.extendedSize
            });
        }

        // Render terrain textures
        this.worldRenderer.renderTerrain();

        // Create extension planes
        this.worldRenderer.createExtensionPlanes();

        // Update instance capacities now that terrain data is loaded
        if (this.game.renderSystem) {
            this.game.renderSystem.updateInstanceCapacities();
        }

        // Add environment entity visuals
        if (terrainDataManager.tileMap?.worldObjects) {
            terrainDataManager.tileMap.worldObjects.forEach(envObj => {
                this.addWorldEntityVisuals(envObj);
            });
        }

        // Spawn cliff entities using WorldRenderer
        // Note: useExtension = false because analyzeCliffs() returns coordinates in tile space (not extended space)
        const entityRenderer = this.game.gameManager.call('getEntityRenderer');
        if (entityRenderer) {
            await this.worldRenderer.spawnCliffs(entityRenderer, false);
        } else {
            console.warn('[WorldSystem] EntityRenderer not available for cliff spawning');
        }

        this.initialized = true;
    }

    postAllInit() {
        this.setupPostProcessing();
    }

    setupPostProcessing() {
        const gameConfig = this.game.getCollections()?.configs?.game;
        if (!gameConfig) return;

        const pixelSize = gameConfig.pixelSize || 1;
        this.game.gameManager.call('registerPostProcessingPass', 'render', {
            enabled: true,
            create: () => {
                return {
                    enabled: true,
                    needsSwap: true,
                    clear: true,
                    renderToScreen: false,

                    render: (renderer, writeBuffer, readBuffer, deltaTime, maskActive) => {
                        renderer.setRenderTarget(writeBuffer);
                        renderer.clear(true, true, true); // Clear color, depth, and stencil
                        renderer.render(this.scene, this.camera);
                    },

                    setSize: (width, height) => {
                        // No-op
                    }
                };
            }
        });
        // Register pixel pass
        // this.game.gameManager.call('registerPostProcessingPass', 'pixel', {
        //     enabled: pixelSize !== 1,
        //     create: () => {
        //         const pixelPass = new THREE.RenderPixelatedPass(pixelSize, this.scene, this.camera);
        //         pixelPass.enabled = pixelSize !== 1;
        //         pixelPass.normalEdgeStrength = 0;
        //         return pixelPass;
        //     }
        // });

        // Register output pass (always last)
        this.game.gameManager.call('registerPostProcessingPass', 'output', {
            enabled: true,
            create: () => {
                return new THREE.OutputPass();
            }
        });

        console.log('[WorldSystem] Registered post-processing passes');
    }

    /**
     * Add visual components (RENDERABLE) to existing world entities
     * Entities are created by TerrainSystem with gameplay components
     * WorldSystem only adds the visual representation on the client
     */
    addWorldEntityVisuals(worldObj) {
        const Components = this.game.gameManager.call('getComponents');

        // Find the existing entity created by TerrainSystem
        const entityId = `env_${worldObj.type}_${worldObj.x}_${worldObj.y}`;

        // Check if entity exists
        if (!this.game.entities.has(entityId)) {
            console.warn(`WorldSystem: World entity ${entityId} not found - TerrainSystem may not have created it`);
            return;
        }

        // Add Renderable component for visual representation
        if (!this.game.hasComponent(entityId, "renderable")) {
            this.game.addComponent(entityId, "renderable",
                {
                    objectType:'worldObjects', 
                    spawnType: worldObj.type, 
                    capacity: 1024
                });
        }

        this.game.triggerEvent('onEntityPositionUpdated', entityId);
    }

    onWindowResize() {
        if (!this.worldRenderer) return;

        this.worldRenderer.onWindowResize();

        // Update composer if exists
        const composer = this.game.gameManager.call('getPostProcessingComposer');
        if (composer) {
            composer.setSize(window.innerWidth, window.innerHeight);
        }
    }

    update() {
        if (!this.worldRenderer) return;

        this.timer += this.game.state.deltaTime;

        // Update WorldRenderer (handles controls, uniforms, etc.)
        const deltaTime = this.worldRenderer.clock.getDelta();
        this.worldRenderer.update(deltaTime);

        this.render();
    }

    render() {
        if (!this.worldRenderer) return;

        const composer = this.game.gameManager.call('getPostProcessingComposer');
        if (composer) {
            this.game.gameManager.call('renderPostProcessing');
        } else {
            this.worldRenderer.render();
        }
    }

    // Utility methods for external systems
    setControlsEnabled(enabled) {
        if (this.worldRenderer) {
            this.worldRenderer.setControlsEnabled(enabled);
        }
    }

    /**
     * Reset camera to default position based on terrain entity's world config
     */
    resetCamera() {
        if (!this.worldRenderer || !this.terrainEntityId) return;

        const terrainComponent = this.game.getComponent(this.terrainEntityId, 'terrain');
        if (!terrainComponent) return;

        const collections = this.game.getCollections();
        const level = collections.levels?.[terrainComponent.level];
        const world = collections.worlds?.[terrainComponent.world || level?.world];
        const cameraSettings = collections.cameras?.[world?.camera];

        if (cameraSettings) {
            this.worldRenderer.resetCamera(cameraSettings);
        }
    }

    // Terrain update methods for dynamic changes
    updateTerrain() {
        if (this.worldRenderer) {
            this.worldRenderer.updateTerrain();
        }
    }

    destroy() {
        this.cleanupWorld();
        this.initialized = false;
    }
}
