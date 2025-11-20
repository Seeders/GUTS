class WorldSystem extends engine.BaseSystem {
    constructor(game) {
        super(game);
        this.game.worldSystem = this;

        this.initialized = false;

        // Use global WorldRenderer for all 3D rendering
        this.worldRenderer = new WorldRenderer({
            enableShadows: true,
            enableFog: true,
            enablePostProcessing: true,
            enableGrass: false,
            enableLiquidSurfaces: true,
            enableCliffs: true
        });

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
        this.game.gameManager.register('getWorldScene', () => this.worldRenderer.getScene());
        this.game.gameManager.register('getWorldExtendedSize', () => this.game.terrainSystem.terrainDataManager.extendedSize);
        this.game.gameManager.register('getGroundTexture', () => this.worldRenderer.getGroundTexture());
        this.game.gameManager.register('getGroundMesh', () => this.worldRenderer.getGroundMesh());
        this.game.gameManager.register('getHeightStep', () => this.game.terrainSystem.terrainDataManager.heightStep);
        this.game.gameManager.register('getBaseTerrainHeight', () => {
            const tdm = this.game.terrainSystem.terrainDataManager;
            return tdm.heightStep * (tdm.tileMap.extensionHeight || 0);
        });

        // Add BVH extension functions for Three.js
        THREE.BufferGeometry.prototype.computeBoundsTree = THREE_.three_MeshBVH.computeBoundsTree;
        THREE.BufferGeometry.prototype.disposeBoundsTree = THREE_.three_MeshBVH.disposeBoundsTree;
        THREE.Mesh.prototype.raycast = THREE_.three_MeshBVH.acceleratedRaycast;

        THREE.BatchedMesh.prototype.computeBoundsTree = THREE_.three_MeshBVH.computeBatchedBoundsTree;
        THREE.BatchedMesh.prototype.disposeBoundsTree = THREE_.three_MeshBVH.disposeBatchedBoundsTree;
        THREE.BatchedMesh.prototype.raycast = THREE_.three_MeshBVH.acceleratedRaycast;

        this.initializeThreeJS();
    }

    getScene() {
        return this.worldRenderer.getScene();
    }

    initializeThreeJS() {
        const gameCanvas = document.getElementById('gameCanvas');
        if (!gameCanvas) {
            console.error('WorldSystem: gameCanvas not found!');
            return;
        }

        // Get level and world data
        const collections = this.game.getCollections();
        const currentLevel = this.game.state?.level || 'level1';
        const level = collections.levels?.[currentLevel];
        const world = collections.worlds?.[level.world];
        const cameraSettings = collections.cameras?.[world.camera];

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
    }

    onGameStarted() {
        // Get world data
        const collections = this.game.getCollections();
        const currentLevel = this.game.state?.level || 'level1';
        const level = collections.levels?.[currentLevel];
        const world = collections.worlds?.[level.world];

        // Set background color
        this.worldRenderer.setBackgroundColor(world?.backgroundColor || '#87CEEB');

        // Setup lighting
        const lightingSettings = collections.lightings?.[world.lighting];
        const shadowSettings = collections.shadows?.[world.shadow];
        this.worldRenderer.setupLighting(lightingSettings, shadowSettings,
            this.game.terrainSystem.terrainDataManager.extendedSize);

        // Setup camera position
        // const cameraSettings = collections.cameras?.[world.camera];
        // this.worldRenderer.setupCamera(cameraSettings);

        // Setup ground with terrain data
        const terrainDataManager = this.game.terrainSystem.terrainDataManager;
        this.worldRenderer.setupGround(terrainDataManager, this.game.terrainTileMapper,
            terrainDataManager.heightMapSettings);

        // Render terrain textures
        this.worldRenderer.renderTerrain();

        // Create extension planes
        this.worldRenderer.createExtensionPlanes();

        // Add environment entity visuals
        if (terrainDataManager.tileMap?.environmentObjects) {
            terrainDataManager.tileMap.environmentObjects.forEach(envObj => {
                this.addEnvironmentEntityVisuals(envObj);
            });
        }

        // Add cliff entity visuals
        this.addCliffEntityVisuals();

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
        this.game.gameManager.call('registerPostProcessingPass', 'pixel', {
            enabled: pixelSize !== 1,
            create: () => {
                const pixelPass = new THREE_.RenderPixelatedPass(pixelSize, this.scene, this.camera);
                pixelPass.enabled = pixelSize !== 1;
                pixelPass.normalEdgeStrength = 0;
                return pixelPass;
            }
        });

        // Register output pass (always last)
        this.game.gameManager.call('registerPostProcessingPass', 'output', {
            enabled: true,
            create: () => {
                return new THREE_.OutputPass();
            }
        });

        console.log('[WorldSystem] Registered post-processing passes');
    }

    /**
     * Add visual components (RENDERABLE) to existing environment entities
     * Entities are created by TerrainSystem with gameplay components
     * WorldSystem only adds the visual representation on the client
     */
    addEnvironmentEntityVisuals(envObj) {
        const ComponentTypes = this.game.componentManager.getComponentTypes();
        const Components = this.game.componentManager.getComponents();

        // Find the existing entity created by TerrainSystem
        const entityId = `env_${envObj.type}_${envObj.x}_${envObj.y}`;

        // Check if entity exists
        if (!this.game.entities.has(entityId)) {
            console.warn(`WorldSystem: Environment entity ${entityId} not found - TerrainSystem may not have created it`);
            return;
        }

        // Add Renderable component for visual representation
        if (!this.game.hasComponent(entityId, ComponentTypes.RENDERABLE)) {
            this.game.addComponent(entityId, ComponentTypes.RENDERABLE,
                Components.Renderable('worldObjects', envObj.type, 1024));
        }

        this.game.triggerEvent('onEntityPositionUpdated', entityId);
    }

    /**
     * Add visual components (RENDERABLE) to cliff entities
     * Cliffs are created by TerrainSystem with gameplay components
     * WorldSystem only adds the visual representation on the client
     */
    addCliffEntityVisuals() {
        const ComponentTypes = this.game.componentManager.getComponentTypes();
        const Components = this.game.componentManager.getComponents();

        // Find all cliff entities (they start with "cliff_")
        let cliffCount = 0;
        for (const entityId of this.game.entities.keys()) {
            if (entityId.startsWith('cliff_')) {
                // Add Renderable component for visual representation
                if (!this.game.hasComponent(entityId, ComponentTypes.RENDERABLE)) {
                    const unitType = this.game.getComponent(entityId, ComponentTypes.UNIT_TYPE);
                    if (unitType && unitType.collection === 'cliffs') {
                        this.game.addComponent(entityId, ComponentTypes.RENDERABLE,
                            Components.Renderable('cliffs', unitType.id, 1024));
                        cliffCount++;
                    }
                }
            }
        }

        if (cliffCount > 0) {
            console.log(`WorldSystem: Added visuals to ${cliffCount} cliff entities`);
        }
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
        if (!this.initialized) return;

        this.timer += this.game.state.deltaTime;

        // Update WorldRenderer (handles controls, uniforms, etc.)
        const deltaTime = this.worldRenderer.clock.getDelta();
        this.worldRenderer.update(deltaTime);

        this.render();
    }

    render() {
        if (!this.worldRenderer) {
            console.warn('WorldSystem: WorldRenderer not initialized');
            return;
        }

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

    resetCamera() {
        if (this.worldRenderer) {
            const collections = this.game.getCollections();
            const currentLevel = this.game.state?.level || 'level1';
            const level = collections.levels?.[currentLevel];
            const world = collections.worlds?.[level.world];
            const cameraSettings = collections.cameras?.[world.camera];

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
        // Clean up WorldRenderer
        if (this.worldRenderer) {
            this.worldRenderer.destroy();
            this.worldRenderer = null;
        }

        // Remove event listeners
        window.removeEventListener('resize', this.onWindowResizeHandler);

        // Clean up UI scene
        if (this.uiScene) {
            this.uiScene = null;
        }

        // Clear references
        this.scene = null;
        this.camera = null;
        this.renderer = null;
        this.composer = null;

        this.initialized = false;
    }
}
