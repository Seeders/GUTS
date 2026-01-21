class WorldSystem extends GUTS.BaseSystem {
    static services = [
        'getWorldScene',
        'getCamera',
        'getWorldExtendedSize',
        'getGroundTexture',
        'getGroundMesh',
        'getHeightStep',
        'getBaseTerrainHeight',
        'initWorldFromTerrain'
    ];

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
            shadowsEnabled: terrainComponent.shadowsEnabled !== false,
            fogEnabled: terrainComponent.fogEnabled !== false,
            enablePostProcessing: true,
            grassEnabled: terrainComponent.grassEnabled || false,
            liquidsEnabledurfaces: terrainComponent.liquidsEnabled !== false,
            cliffsEnabled: terrainComponent.cliffsEnabled !== false
        });

        // Level and world are stored as numeric indices
        const levelName = this.reverseEnums.levels[terrainComponent.level];
        const worldName = this.reverseEnums.worlds[terrainComponent.world];
        this.initializeThreeJS(levelName, worldName);
    }

    /**
     * Create WorldRenderer with specified options
     * @param {Object} options - WorldRenderer options
     */
    createWorldRenderer(options = {}) {
        // Clean up existing renderer
        if (this.worldRenderer) {
            this.worldRenderer.dispose();
        }

        this.worldRenderer = new GUTS.WorldRenderer({
            game: this.game,
            shadowsEnabled: options.shadowsEnabled !== false,
            fogEnabled: options.fogEnabled !== false,
            enablePostProcessing: options.enablePostProcessing !== false,
            grassEnabled: options.grassEnabled || false,
            liquidsEnabledurfaces: options.liquidsEnabledurfaces !== false,
            cliffsEnabled: options.cliffsEnabled !== false
        });
    }

    /**
     * Clean up world resources
     */
    cleanupWorld() {
        if (this.worldRenderer) {
            this.worldRenderer.dispose();
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

    // Service methods for static services registration
    getWorldScene() {
        return this.worldRenderer?.getScene();
    }

    getCamera() {
        return this.worldRenderer?.camera;
    }

    getWorldExtendedSize() {
        return this.game.terrainSystem?.terrainDataManager?.extendedSize;
    }

    getGroundTexture() {
        return this.worldRenderer?.getGroundTexture();
    }

    getGroundMesh() {
        return this.worldRenderer?.getGroundMesh();
    }

    getHeightStep() {
        return this.game.terrainSystem?.terrainDataManager?.heightStep;
    }

    getBaseTerrainHeight() {
        const tdm = this.game.terrainSystem?.terrainDataManager;
        if (!tdm) return 0;
        return tdm.heightStep * (tdm.tileMap?.extensionHeight || 0);
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

        // Use canvas from game context (for editor) or default to gameCanvas
        const gameCanvas = this.game.canvas || document.getElementById('gameCanvas');
        if (!gameCanvas) {
            console.error('WorldSystem: No canvas found!');
            return;
        }

        const level = this.collections.levels?.[levelName];
        const effectiveWorldName = worldName || level?.world;
        const world = this.collections.worlds?.[effectiveWorldName];
        const cameraSettings = this.collections.cameras?.[world?.camera];

        // Initialize Three.js through WorldRenderer
        // Never enable OrbitControls here - game uses CameraControlSystem, editors call setupOrbitControls manually
        this.worldRenderer.initializeThreeJS(gameCanvas, cameraSettings, false);

        // Add window resize listener
        window.addEventListener('resize', this.onWindowResizeHandler);

        // Cache references for game
        this.scene = this.worldRenderer.getScene();
        this.camera = this.worldRenderer.getCamera();
        this.renderer = this.worldRenderer.getRenderer();

        // Create UI scene separately (not part of WorldRenderer)
        this.uiScene = new THREE.Scene();

        // Expose to game object (scene/renderer still needed by other systems)
        this.game.scene = this.scene;
        this.game.uiScene = this.uiScene;
        this.game.renderer = this.renderer;

        // Register camera via service (CameraControlSystem manages the active camera)
        if (this.game.hasService('setCamera')) {
            this.game.call('setCamera', this.camera);
        }

        // Setup world rendering - store promise so postSceneLoad can wait for it
        this.setupWorldRenderingPromise = this.setupWorldRendering(levelName, effectiveWorldName);
    }

    /**
     * Setup world rendering after Three.js is initialized
     * @param {string} levelName - The level name
     * @param {string} worldName - The world name
     */
    async setupWorldRendering(levelName, worldName) {
        const world = this.collections.worlds?.[worldName];
        const gameConfig = this.collections.configs?.game || {};

        // Set background color
        this.worldRenderer.setBackgroundColor(world?.backgroundColor || '#87CEEB');

        // Wait for terrain to be ready
        const terrainDataManager = this.game.terrainSystem?.terrainDataManager;
        if (!terrainDataManager) {
            console.warn('[WorldSystem] TerrainDataManager not available');
            return;
        }

        // Initialize terrain tile mapper if not already set up (needed for editor context)
        if (!this.game.terrainTileMapper && this.game.imageManager) {
            await this.initTerrainTileMapper(levelName, terrainDataManager, gameConfig);
        }

        // Setup lighting
        const lightingSettings = this.collections.lightings?.[world?.lighting];
        const shadowSettings = this.collections.shadows?.[world?.shadow];
        this.worldRenderer.setupLighting(lightingSettings, shadowSettings, terrainDataManager.extendedSize);

        // Setup fog
        const fogSettings = this.collections.fogs?.[world?.fog];
        this.worldRenderer.setupFog(fogSettings);

        // Setup ground with terrain data
        this.worldRenderer.setupGround(terrainDataManager, this.game.terrainTileMapper, terrainDataManager.heightMapSettings);

        // Update extension configuration in GridSystem's CoordinateTranslator if available
        if (terrainDataManager.extensionSize) {
            this.game.call('updateCoordinateConfig', {
                extensionSize: terrainDataManager.extensionSize,
                extendedSize: terrainDataManager.extendedSize
            });
        }

        // Render terrain textures
        this.worldRenderer.renderTerrain();

        // Create extension planes
        this.worldRenderer.createExtensionPlanes();

        // Note: updateInstanceCapacities moved to postSceneLoad (RenderSystem needs to init first)
        // Note: Cliff spawning moved to postSceneLoad to ensure EntityRenderer is available

        this.initialized = true;
    }

    /**
     * Called after all systems have processed onSceneLoad
     * Used for operations that need other systems to be fully initialized
     */
    async postSceneLoad(sceneData) {
        if (!this.worldRenderer) return;

        // Wait for async setupWorldRendering to complete if it's still running
        if (this.setupWorldRenderingPromise) {
            await this.setupWorldRenderingPromise;
        }

        // Setup post-processing passes (must happen each scene load since passes are cleared on unload)
        this.setupPostProcessing();

        // Update instance capacities now that RenderSystem has initialized EntityRenderer
        this.game.call('updateInstanceCapacities');

        // Spawn cliff entities using WorldRenderer
        // Note: useExtension = false because analyzeCliffs() returns coordinates in tile space (not extended space)
        const entityRenderer = this.game.call('getEntityRenderer');
        if (entityRenderer) {
            await this.worldRenderer.spawnCliffs(entityRenderer, false);
        } else {
            console.warn('[WorldSystem] EntityRenderer not available for cliff spawning');
        }

        // Spawn terrain detail objects (grass, rocks, etc.)
        if (this.game.hasService('spawnTerrainDetails')) {
            await this.game.call('spawnTerrainDetails');
        }
    }

    postAllInit() {
        // Post-processing setup moved to postSceneLoad since it needs to happen on every scene load
        // (passes are cleared on scene unload, so they must be re-registered)
    }

    setupPostProcessing() {
        const gameConfig = this.collections.configs?.game;
        if (!gameConfig) return;

        // Check if PostProcessingSystem is available
        if (!this.game.hasService('registerPostProcessingPass')) {
            return; // PostProcessingSystem not loaded (e.g., in editor)
        }

        const pixelSize = gameConfig.pixelSize || 1;
        this.game.call('registerPostProcessingPass', 'render', {
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
                        const camera = this.game.call('getCamera');
                        renderer.render(this.scene, camera);
                    },

                    setSize: (width, height) => {
                        // No-op
                    }
                };
            }
        });
        // Register pixel pass
        // this.game.call('registerPostProcessingPass', 'pixel', {
        //     enabled: pixelSize !== 1,
        //     create: () => {
        //         const pixelPass = new THREE.RenderPixelatedPass(pixelSize, this.scene, this.camera);
        //         pixelPass.enabled = pixelSize !== 1;
        //         pixelPass.normalEdgeStrength = 0;
        //         return pixelPass;
        //     }
        // });

        // Register output pass (always last)
        this.game.call('registerPostProcessingPass', 'output', {
            enabled: true,
            create: () => {
                return new GUTS.OutputPass();
            }
        });

    }

    onWindowResize() {
        if (!this.worldRenderer) return;

        this.worldRenderer.onWindowResize();

        // Update composer if exists (PostProcessingSystem may not be loaded)
        if (this.game.hasService('getPostProcessingComposer')) {
            const composer = this.game.call('getPostProcessingComposer');
            if (composer && window.innerWidth > 0 && window.innerHeight > 0) {
                composer.setSize(window.innerWidth, window.innerHeight);
            }
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

        // Use post-processing if available, otherwise direct render
        if (this.game.hasService('getPostProcessingComposer')) {
            const composer = this.game.call('getPostProcessingComposer');
            if (composer) {
                // When using post-processing, worldRenderer.render() is bypassed,
                // so we need to update liquid shaders manually
                this.worldRenderer.updateLiquidShaders(this.game.state?.deltaTime || 0);
                this.game.call('renderPostProcessing');
                return;
            }
        }
        // worldRenderer.render() handles updateLiquidShaders() internally
        this.worldRenderer.render();
    }

    /**
     * Handle ambient light change event - forward to WorldRenderer
     * @param {Object} data - { color: THREE.Color, intensity: number }
     */
    ambientLightChanged(data) {
        if (this.worldRenderer?.setAmbientLightColor) {
            this.worldRenderer.setAmbientLightColor(data.color, data.intensity);
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

        // Level and world are stored as numeric indices
        const levelKey = this.reverseEnums.levels[terrainComponent.level];
        const worldKey = this.reverseEnums.worlds[terrainComponent.world];
        const level = this.collections.levels[levelKey];
        const world = this.collections.worlds[worldKey] ||
                      (level?.world ? this.collections.worlds?.[level.world] : null);
        const cameraSettings = world?.camera ? this.collections.cameras?.[world.camera] : null;

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

    /**
     * Initialize terrain tile mapper for editor contexts
     * Similar to EditorLoader.initTerrainTileMapper but called lazily when terrain is loaded
     * @param {string} levelName - Level name
     * @param {Object} terrainDataManager - TerrainDataManager instance
     * @param {Object} gameConfig - Game configuration
     */
    async initTerrainTileMapper(levelName, terrainDataManager, gameConfig) {
        const level = this.collections.levels?.[levelName];
        if (!level) {
            console.warn(`[WorldSystem] Level '${levelName}' not found for tile mapper`);
            return;
        }

        // Load terrain images if not already loaded
        await this.game.imageManager.loadImages("levels", { [levelName]: level });
        const terrainImages = this.game.imageManager.getImages("levels", levelName);

        // Create terrain canvas buffer
        const terrainCanvasBuffer = document.createElement('canvas');
        const tileMap = terrainDataManager.tileMap;
        if (tileMap?.terrainMap && tileMap.terrainMap.length > 0) {
            terrainCanvasBuffer.width = gameConfig.gridSize * tileMap.terrainMap[0].length;
            terrainCanvasBuffer.height = gameConfig.gridSize * tileMap.terrainMap.length;
        } else if (tileMap?.size) {
            const terrainSize = tileMap.size * gameConfig.gridSize;
            terrainCanvasBuffer.width = terrainSize;
            terrainCanvasBuffer.height = terrainSize;
        } else {
            terrainCanvasBuffer.width = 4096;
            terrainCanvasBuffer.height = 4096;
        }

        // Get terrain type names for dynamic index lookup
        const terrainTypeNames = tileMap?.terrainTypes || [];

        // Get cliff border terrain from cliffSet (if available)
        const world = this.collections.worlds?.[level.world];
        const cliffSet = world?.cliffSet ? this.collections.cliffSets?.[world.cliffSet] : null;
        const cliffBorderTerrain = cliffSet?.borderTerrain || null;

        // Initialize tile mapper
        this.game.terrainTileMapper = new GUTS.TileMap({});
        this.game.terrainTileMapper.init(
            terrainCanvasBuffer,
            gameConfig.gridSize,
            terrainImages,
            gameConfig.isIsometric,
            { skipCliffTextures: false, terrainTypeNames, cliffBorderTerrain }
        );

    }

    destroy() {
        this.cleanupWorld();
        this.initialized = false;
    }
}
