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
        this.game.register('getWorldScene', () => this.worldRenderer?.getScene());
        this.game.register('getCamera', () => this.worldRenderer?.camera);
        this.game.register('getWorldExtendedSize', () => this.game.terrainSystem?.terrainDataManager?.extendedSize);
        this.game.register('getGroundTexture', () => this.worldRenderer?.getGroundTexture());
        this.game.register('getGroundMesh', () => this.worldRenderer?.getGroundMesh());
        this.game.register('getHeightStep', () => this.game.terrainSystem?.terrainDataManager?.heightStep);
        this.game.register('getBaseTerrainHeight', () => {
            const tdm = this.game.terrainSystem?.terrainDataManager;
            if (!tdm) return 0;
            return tdm.heightStep * (tdm.tileMap?.extensionHeight || 0);
        });
        this.game.register('initWorldFromTerrain', this.initWorldFromTerrain.bind(this));

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
        console.log('[WorldSystem] onSceneLoad - terrain entities found:', terrainEntities.length);

        if (terrainEntities.length > 0) {
            const terrainEntityId = terrainEntities[0];
            const terrainComponent = this.game.getComponent(terrainEntityId, 'terrain');
            console.log('[WorldSystem] terrain component:', terrainComponent);
            this.initWorldFromTerrain(terrainComponent, terrainEntityId);
            console.log('[WorldSystem] initWorldFromTerrain completed, game.scene:', this.game.scene ? 'exists' : 'null');
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

        this.initializeThreeJS(terrainComponent.level, terrainComponent.world);
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

        const collections = this.game.getCollections();
        const level = collections.levels?.[levelName];
        const effectiveWorldName = worldName || level?.world;
        const world = collections.worlds?.[effectiveWorldName];
        const cameraSettings = collections.cameras?.[world?.camera];

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

        // Expose to game object
        this.game.camera = this.camera;
        this.game.scene = this.scene;
        this.game.uiScene = this.uiScene;
        this.game.renderer = this.renderer;

        // Setup world rendering - store promise so postSceneLoad can wait for it
        this.setupWorldRenderingPromise = this.setupWorldRendering(levelName, effectiveWorldName);
    }

    /**
     * Setup world rendering after Three.js is initialized
     * @param {string} levelName - The level name
     * @param {string} worldName - The world name
     */
    async setupWorldRendering(levelName, worldName) {
        const collections = this.game.getCollections();
        const world = collections.worlds?.[worldName];
        const gameConfig = collections.configs?.game || {};

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
        const lightingSettings = collections.lightings?.[world?.lighting];
        const shadowSettings = collections.shadows?.[world?.shadow];
        this.worldRenderer.setupLighting(lightingSettings, shadowSettings, terrainDataManager.extendedSize);

        // Setup ground with terrain data
        this.worldRenderer.setupGround(terrainDataManager, this.game.terrainTileMapper, terrainDataManager.heightMapSettings);

        // Pass game reference to WorldRenderer for service calls
        this.worldRenderer.game = this.game;

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

        // Add environment entity visuals
        if (terrainDataManager.tileMap?.worldObjects) {
            terrainDataManager.tileMap.worldObjects.forEach(envObj => {
                this.addWorldEntityVisuals(envObj);
            });
        }

        // Note: Cliff spawning moved to postSceneLoad to ensure EntityRenderer is available

        this.initialized = true;
    }

    /**
     * Called after all systems have processed onSceneLoad
     * Used for operations that need other systems to be fully initialized
     */
    async postSceneLoad(sceneData) {
        console.log('[WorldSystem] postSceneLoad called, worldRenderer:', this.worldRenderer ? 'exists' : 'null');
        if (!this.worldRenderer) return;

        // Wait for async setupWorldRendering to complete if it's still running
        if (this.setupWorldRenderingPromise) {
            console.log('[WorldSystem] Waiting for setupWorldRendering to complete...');
            await this.setupWorldRenderingPromise;
            console.log('[WorldSystem] setupWorldRendering completed');
        }

        // Update instance capacities now that RenderSystem has initialized EntityRenderer
        if (this.game.renderSystem) {
            this.game.renderSystem.updateInstanceCapacities();
        }

        // Spawn cliff entities using WorldRenderer
        // Note: useExtension = false because analyzeCliffs() returns coordinates in tile space (not extended space)
        const entityRenderer = this.game.call('getEntityRenderer');
        console.log('[WorldSystem] entityRenderer from service:', entityRenderer ? 'exists' : 'null');
        if (entityRenderer) {
            console.log('[WorldSystem] Spawning cliffs...');
            await this.worldRenderer.spawnCliffs(entityRenderer, false);
            console.log('[WorldSystem] Cliffs spawned');
        } else {
            console.warn('[WorldSystem] EntityRenderer not available for cliff spawning');
        }

        // Spawn terrain detail objects (grass, rocks, etc.)
        if (this.game.hasService('spawnTerrainDetails')) {
            await this.game.call('spawnTerrainDetails');
        }
    }

    postAllInit() {
        this.setupPostProcessing();
    }

    setupPostProcessing() {
        const gameConfig = this.game.getCollections()?.configs?.game;
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
                        renderer.render(this.scene, this.camera);
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

        console.log('[WorldSystem] Registered post-processing passes');
    }

    /**
     * Add visual components (RENDERABLE) to existing world entities
     * Entities are created by TerrainSystem with gameplay components
     * WorldSystem only adds the visual representation on the client
     */
    addWorldEntityVisuals(worldObj) {
        const Components = this.game.call('getComponents');

        // Find the existing entity created by TerrainSystem using grid coordinates
        const entityId = `env_${worldObj.type}_${worldObj.gridX}_${worldObj.gridZ}`;

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

        // Update composer if exists (PostProcessingSystem may not be loaded)
        if (this.game.hasService('getPostProcessingComposer')) {
            const composer = this.game.call('getPostProcessingComposer');
            if (composer) {
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
                this.game.call('renderPostProcessing');
                return;
            }
        }
        this.worldRenderer.render();
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

    /**
     * Initialize terrain tile mapper for editor contexts
     * Similar to EditorLoader.initTerrainTileMapper but called lazily when terrain is loaded
     * @param {string} levelName - Level name
     * @param {Object} terrainDataManager - TerrainDataManager instance
     * @param {Object} gameConfig - Game configuration
     */
    async initTerrainTileMapper(levelName, terrainDataManager, gameConfig) {
        const collections = this.game.getCollections();
        const level = collections.levels?.[levelName];
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

        // Initialize tile mapper
        this.game.terrainTileMapper = new GUTS.TileMap({});
        this.game.terrainTileMapper.init(
            terrainCanvasBuffer,
            gameConfig.gridSize,
            terrainImages,
            gameConfig.isIsometric,
            { skipCliffTextures: false, terrainTypeNames }
        );

        console.log(`[WorldSystem] Initialized terrain tile mapper for level: ${levelName}`);
    }

    destroy() {
        this.cleanupWorld();
        this.initialized = false;
    }
}
