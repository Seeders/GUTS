class WorldSystem extends engine.BaseSystem {
    constructor(game) {
        super(game);
        this.game.worldSystem = this;
        
        this.initialized = false;
        
        // Core Three.js components
        this.scene = null;
        this.camera = null;
        this.renderer = null;
        this.composer = null;
        
        // Terrain and world objects
        this.ground = null;
        this.groundTexture = null;
        this.groundCanvas = null;
        this.groundCtx = null;
        this.grass = null;
        this.liquidMeshes = [];
        
        // Extension planes
        this.extensionPlanes = [];
        
        // Terrain canvas for tile mapping
        this.terrainCanvas = null;
        this.terrainCtx = null;
        
        // Lighting
        this.ambientLight = null;
        this.directionalLight = null;
        this.hemisphereLight = null;
        
        // Uniforms for shaders
        this.uniforms = {};
        
        // World data
        this.level = null;
        this.world = null;
        this.tileMap = null;
        this.heightMapData = null;
        // Settings from collections
        this.lightingSettings = null;
        this.shadowSettings = null;
        this.fogSettings = null;
        this.heightMapSettings = null;
        this.cameraSettings = null;
        
        this.heightStep = 0;
        // Timing
        this.clock = new THREE.Clock();
        this.timer = 0;
        this.terrainRendered = false;

        // Controls
        this.controls = null;

        // Window resize handler
        this.onWindowResizeHandler = this.onWindowResize.bind(this);
    }

    init() {
        if (this.initialized) return;

        this.game.gameManager.register('getTerrainHeightAtPosition', this.getTerrainHeightAtPosition.bind(this));
        this.game.gameManager.register('getWorldScene', this.getScene.bind(this));
        this.game.gameManager.register('getWorldExtendedSize', () => this.extendedSize);
        this.game.gameManager.register('getGroundTexture', () => this.groundTexture);
        this.game.gameManager.register('getGroundMesh', () => this.ground);
        this.game.gameManager.register('getHeightStep', () => this.heightStep);
        this.game.gameManager.register('getBaseTerrainHeight', () => this.heightStep * this.tileMap.extensionHeight);

        // Add the extension functions
        THREE.BufferGeometry.prototype.computeBoundsTree = THREE_.three_MeshBVH.computeBoundsTree;
        THREE.BufferGeometry.prototype.disposeBoundsTree = THREE_.three_MeshBVH.disposeBoundsTree;
        THREE.Mesh.prototype.raycast = THREE_.three_MeshBVH.acceleratedRaycast;

        THREE.BatchedMesh.prototype.computeBoundsTree = THREE_.three_MeshBVH.computeBatchedBoundsTree;
        THREE.BatchedMesh.prototype.disposeBoundsTree = THREE_.three_MeshBVH.disposeBatchedBoundsTree;
        THREE.BatchedMesh.prototype.raycast = THREE_.three_MeshBVH.acceleratedRaycast;
        this.initializeThreeJS();

        this.loadWorldData();
    }

    getScene() {
        return this.scene;
    }

    initializeThreeJS() {
        const gameCanvas = document.getElementById('gameCanvas');
        if (!gameCanvas) {
            console.error('WorldRenderSystem: gameCanvas not found!');
            return;
        }

        this.scene = new THREE.Scene();
        this.uiScene = new THREE.Scene();
        const currentLevel = this.game.state?.level || 'level1';
        this.level = this.game.getCollections().levels?.[currentLevel];
        this.world = this.game.getCollections().worlds[this.level.world];
        this.cameraData = this.game.getCollections().cameras[this.world.camera]; 
        const width = window.innerWidth;
        const height = window.innerHeight; 
      // Camera setup
        if(this.cameraData.fov){
            this.camera = new THREE.PerspectiveCamera(
                this.cameraData.fov,
                width / height,
                this.cameraData.near,
                this.cameraData.far
            );
        } else if(this.cameraData.zoom){
            this.camera = new THREE.OrthographicCamera(
                width / - 2, 
                width / 2, 
                height / 2, 
                height / - 2, 
                this.cameraData.near,
                this.cameraData.far
            );
            this.camera.zoom = this.cameraData.zoom;
            this.camera.updateProjectionMatrix();
        }

        this.renderer = new THREE.WebGLRenderer({ 
            canvas: gameCanvas,
            antialias: false,
            alpha: true
        });
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        
        window.addEventListener('resize', this.onWindowResizeHandler);
        
        this.game.camera = this.camera;
        this.game.scene = this.scene;
        this.game.uiScene = this.uiScene;
        this.game.renderer = this.renderer;
    }

    initializeTerrainCanvas() {
        this.terrainCanvas = document.createElement('canvas');
        this.terrainCanvas.width = 700;
        this.terrainCanvas.height = 500;
        this.terrainCtx = this.terrainCanvas.getContext('2d');
    }

    loadWorldData() {
        const collections = this.game.getCollections();
        if (!collections) {
            console.error('WorldRenderSystem: No collections found');
            return;
        }

        const currentLevel = this.game.state?.level || 'level1';
        this.level = collections.levels?.[currentLevel];
        
        if (!this.level) {
            console.error(`WorldRenderSystem: Level '${currentLevel}' not found`);
            return;
        }

        this.world = collections.worlds?.[this.level.world];
        if (!this.world) {
            console.error(`WorldRenderSystem: World '${this.level.world}' not found`);
            return;
        }

        this.lightingSettings = collections.lightings?.[this.world.lighting];
        this.shadowSettings = collections.shadows?.[this.world.shadow];
        this.fogSettings = collections.fogs?.[this.world.fog];
        this.heightMapSettings = collections.heightMaps?.[this.world.heightMap];
        this.cameraSettings = collections.cameras?.[this.world.camera];
        this.heightStep = this.heightMapSettings.heightStep;
        this.tileMap = this.level.tileMap;

        // Calculate world dimensions
        this.terrainSize = this.tileMap.size * collections.configs.game.gridSize;
        this.extensionSize = this.world.extensionSize || 0;
        this.extendedSize = this.terrainSize + 2 * this.extensionSize;
        this.heightMapResolution = this.extendedSize / (this.heightMapSettings?.resolutionDivisor || 1);
        
        this.renderer.shadowMap.enabled = this.shadowSettings?.enabled;
    }

    onGameStarted() {      
        this.initializeTerrainCanvas();

        if (this.world?.backgroundColor) {
            this.scene.background = new THREE.Color(this.world.backgroundColor);
        }

        this.setupFog();
        this.setupLighting();
        this.setupCamera();
        this.setupGround();
        
        this.createExtensionPlanes();
        
        if (this.tileMap?.terrainMap) {
            this.renderTerrain();
        } else {
            console.warn('WorldRenderSystem: No terrain map available during setup');
        }
        
        this.initialized = true;  
    }

    setupFog() {
        if (this.fogSettings?.enabled) {
            this.scene.fog = new THREE.FogExp2(
                this.fogSettings.color, 
                this.fogSettings.density
            );
        }
    }

    setupLighting() {
        if (!this.lightingSettings) {
            this.lightingSettings = {
                ambientColor: '#404040',
                ambientIntensity: 0.6,
                directionalColor: '#ffffff',
                directionalIntensity: 1.0,
                skyColor: '#87CEEB',
                groundColor: '#ffffff',
                hemisphereIntensity: 0.4
            };
        }

        this.ambientLight = new THREE.AmbientLight(
            this.lightingSettings.ambientColor,
            this.lightingSettings.ambientIntensity
        );
        this.scene.add(this.ambientLight);

        this.directionalLight = new THREE.DirectionalLight(
            this.lightingSettings.directionalColor,
            this.lightingSettings.directionalIntensity
        );
        if(this.lightingSettings.direction){
            this.lightingSettings.direction = JSON.parse(this.lightingSettings.direction);
            this.directionalLight.position.set(
                -this.lightingSettings.direction.x * this.extendedSize,  
                -this.lightingSettings.direction.y * this.extendedSize, 
                -this.lightingSettings.direction.z * this.extendedSize
            );
        }

        this.directionalLight.castShadow = this.shadowSettings?.enabled || false;

        if (this.shadowSettings?.enabled) {
            this.directionalLight.shadow.mapSize.width = this.shadowSettings.mapSize;
            this.directionalLight.shadow.mapSize.height = this.shadowSettings.mapSize;
            this.directionalLight.shadow.camera.near = 0.5;
            this.directionalLight.shadow.camera.far = 20000;
            this.directionalLight.shadow.bias = this.shadowSettings.bias;
            this.directionalLight.shadow.normalBias = this.shadowSettings.normalBias;
            this.directionalLight.shadow.radius = this.shadowSettings.radius;

            const d = this.extendedSize * 0.75;
            this.directionalLight.shadow.camera.left = -d;
            this.directionalLight.shadow.camera.right = d;
            this.directionalLight.shadow.camera.top = d;
            this.directionalLight.shadow.camera.bottom = -d;

            this.directionalLight.target.position.set(
                0, 
                0, 
                0
            );
            this.directionalLight.target.updateMatrixWorld();
            this.directionalLight.shadow.camera.updateProjectionMatrix();
        }

        this.scene.add(this.directionalLight);
        this.scene.add(this.directionalLight.target);

        this.hemisphereLight = new THREE.HemisphereLight(
            this.lightingSettings.skyColor,
            this.lightingSettings.groundColor,
            this.lightingSettings.hemisphereIntensity
        );
        this.scene.add(this.hemisphereLight);

    }

    postAllInit(){
        
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

    setupCamera() {
        if (!this.cameraSettings) {
            this.cameraSettings = {
                position: '{"x":0,"y":200,"z":300}',
                lookAt: '{"x":0,"y":0,"z":0}',
                fov: 60,
                near: 1,
                far: 30000
            };
        }

        const cameraPos = JSON.parse(this.cameraSettings.position);
       // this.camera.position.set(cameraPos.x, cameraPos.y, cameraPos.z);

        const lookAt = JSON.parse(this.cameraSettings.lookAt);
       // this.camera.lookAt(lookAt.x, lookAt.y, lookAt.z);

        if (this.cameraSettings.fov && this.camera.isPerspectiveCamera) {
            this.camera.fov = this.cameraSettings.fov;
            this.camera.near = this.cameraSettings.near || 0.1;
            this.camera.far = this.cameraSettings.far || 30000;
            this.camera.updateProjectionMatrix();
        }

       // this.setupOrbitControls(lookAt);

     
    }

    setupOrbitControls(lookAt) {
        if (typeof THREE_.OrbitControls === 'undefined') {
            console.warn('WorldRenderSystem: THREE.OrbitControls not found.');
            return;
        }

        this.controls = new THREE_.OrbitControls(this.camera, this.renderer.domElement);
        this.controls.mouseButtons = {
            LEFT: null,                           // Disable left click
            MIDDLE: THREE.MOUSE.ROTATE,          // Middle mouse for rotation
            RIGHT: THREE.MOUSE.PAN               // Right mouse for panning (optional)
        };
        this.controls.target.set(lookAt.x, lookAt.y, lookAt.z);
        this.controls.maxPolarAngle = Math.PI / 2.05;
        this.controls.minPolarAngle = 0.1;
        this.controls.enableDamping = true;
        this.controls.dampingFactor = 0.05;
        this.controls.screenSpacePanning = false;
        this.controls.minDistance = 50;
        this.controls.maxDistance = 1000;
        
        this.controls.update();
        
    }

    setupGround() {
        if (!this.tileMap) {
            console.warn('WorldRenderSystem: No tile map found');
            return;
        }

        this.groundCanvas = document.createElement('canvas');
        this.groundCanvas.width = this.extendedSize;
        this.groundCanvas.height = this.extendedSize;
        this.groundCtx = this.groundCanvas.getContext('2d');

        // Fill extension area with sprite texture pattern instead of solid color
        const extensionTerrainType = this.tileMap.extensionTerrainType || 0;
        const tileMapper = this.game.terrainTileMapper;

        if (tileMapper && tileMapper.layerSpriteSheets && tileMapper.layerSpriteSheets[extensionTerrainType]) {
            // Use the Full sprite (index 0) from the extension terrain type
            const fullSprite = tileMapper.layerSpriteSheets[extensionTerrainType].sprites[0];

            if (fullSprite) {
                // Tile the sprite across the entire ground canvas
                const spriteSize = fullSprite.width;
                for (let y = 0; y < this.extendedSize; y += spriteSize) {
                    for (let x = 0; x < this.extendedSize; x += spriteSize) {
                        this.groundCtx.drawImage(fullSprite, x, y);
                    }
                }
            }
        }

        this.groundTexture = new THREE.CanvasTexture(this.groundCanvas);
        this.groundTexture.wrapS = THREE.ClampToEdgeWrapping;
        this.groundTexture.wrapT = THREE.ClampToEdgeWrapping;
        this.groundTexture.minFilter = THREE.NearestFilter;
        this.groundTexture.magFilter = THREE.NearestFilter;

        const segments = this.heightMapResolution || 1;
        const groundGeometry = new THREE.PlaneGeometry(
            this.extendedSize,
            this.extendedSize,
            segments,
            segments
        );

        this.groundVertices = groundGeometry.attributes.position;
        const groundMaterial = new THREE.MeshStandardMaterial({
            map: this.groundTexture,
            side: THREE.DoubleSide,
            metalness: 0.0,
            roughness: 1
        });

        this.ground = new THREE.Mesh(groundGeometry, groundMaterial);
        this.ground.rotation.x = -Math.PI / 2;
        // Center the ground at origin instead of offset
        this.ground.position.set(0, 0, 0);
        this.ground.receiveShadow = true;
        this.ground.castShadow = true;

        this.scene.add(this.ground);

        this.heightMapData = new Float32Array(this.extendedSize * this.extendedSize);
    }

    getGroundMesh() {
        return this.ground;
    }

    createExtensionPlanes() {
        if (!this.tileMap) return;

        // Get the extension terrain type
        const extensionTerrainType = this.tileMap.extensionTerrainType || 0;

        // Extension settings
        const extensionDistance = 19000; // How far the planes extend
        const detailedGroundSize = this.extendedSize; // Size of your existing detailed ground
        const halfDetailedSize = detailedGroundSize / 2;

        // Get the sprite texture for the extension terrain type
        const tileMapper = this.game.terrainTileMapper;
        let extensionTexture;

        if (tileMapper && tileMapper.layerSpriteSheets && tileMapper.layerSpriteSheets[extensionTerrainType]) {
            // Use the Full sprite (index 0) from the extension terrain type
            const fullSprite = tileMapper.layerSpriteSheets[extensionTerrainType].sprites[0];

            if (fullSprite) {
                // Create texture from the sprite canvas
                extensionTexture = new THREE.CanvasTexture(fullSprite);
                extensionTexture.wrapS = THREE.RepeatWrapping;
                extensionTexture.wrapT = THREE.RepeatWrapping;
                extensionTexture.minFilter = THREE.NearestFilter;
                extensionTexture.magFilter = THREE.NearestFilter;
            }
        }

        // Fallback to solid color if sprite not available
        if (!extensionTexture) {
            const terrainTypes = this.tileMap.terrainTypes || [];
            let bgColor = terrainTypes[extensionTerrainType]?.color;

            if (bgColor?.paletteColor && this.game.palette) {
                bgColor = this.game.palette[bgColor.paletteColor];
            }

            const extensionColor = bgColor || '#333333';
            const extensionCanvas = document.createElement('canvas');
            extensionCanvas.width = 1;
            extensionCanvas.height = 1;
            const extensionCtx = extensionCanvas.getContext('2d');
            extensionCtx.fillStyle = extensionColor;
            extensionCtx.fillRect(0, 0, 1, 1);

            extensionTexture = new THREE.CanvasTexture(extensionCanvas);
            extensionTexture.wrapS = THREE.RepeatWrapping;
            extensionTexture.wrapT = THREE.RepeatWrapping;
            extensionTexture.minFilter = THREE.NearestFilter;
            extensionTexture.magFilter = THREE.NearestFilter;
        }

        // Create material for extension planes with repeating texture
        const extensionMaterial = new THREE.MeshStandardMaterial({
            map: extensionTexture,
            side: THREE.DoubleSide,
            metalness: 0.0,
            roughness: 0.8,
            fog: false
        });
        
        // Store extension planes for cleanup
        this.extensionPlanes = [];
    
        const extensionHeight = extensionTerrainType * this.heightStep;

        // 1. North plane (positive Z)
        const northGeometry = new THREE.PlaneGeometry(detailedGroundSize + 2 * extensionDistance, extensionDistance);
        const northPlane = new THREE.Mesh(northGeometry, extensionMaterial.clone());
        northPlane.rotation.x = -Math.PI / 2;
        northPlane.position.set(0, extensionHeight, halfDetailedSize + extensionDistance / 2);
        northPlane.receiveShadow = true;
        this.scene.add(northPlane);
        this.extensionPlanes.push(northPlane);
        
        // 2. South plane (negative Z)
        const southGeometry = new THREE.PlaneGeometry(detailedGroundSize + 2 * extensionDistance, extensionDistance);
        const southPlane = new THREE.Mesh(southGeometry, extensionMaterial.clone());
        southPlane.rotation.x = -Math.PI / 2;
        southPlane.position.set(0, extensionHeight, -halfDetailedSize - extensionDistance / 2);
        southPlane.receiveShadow = true;
        this.scene.add(southPlane);
        this.extensionPlanes.push(southPlane);
        
        // 3. East plane (positive X)
        const eastGeometry = new THREE.PlaneGeometry(extensionDistance, detailedGroundSize);
        const eastPlane = new THREE.Mesh(eastGeometry, extensionMaterial.clone());
        eastPlane.rotation.x = -Math.PI / 2;
        eastPlane.position.set(halfDetailedSize + extensionDistance / 2, extensionHeight, 0);
        eastPlane.receiveShadow = true;
        this.scene.add(eastPlane);
        this.extensionPlanes.push(eastPlane);
        
        // 4. West plane (negative X)  
        const westGeometry = new THREE.PlaneGeometry(extensionDistance, detailedGroundSize);
        const westPlane = new THREE.Mesh(westGeometry, extensionMaterial.clone());
        westPlane.rotation.x = -Math.PI / 2;
        westPlane.position.set(-halfDetailedSize - extensionDistance / 2, extensionHeight, 0);
        westPlane.receiveShadow = true;
        this.scene.add(westPlane);
        this.extensionPlanes.push(westPlane);
        
    }

    renderTerrain() {
        if (!this.tileMap?.terrainMap) {
            console.warn('WorldRenderSystem: No terrain map data found');
            return;
        }

        
        // Clear terrain canvas
        this.terrainCtx.clearRect(0, 0, this.terrainCanvas.width, this.terrainCanvas.height);
        
        // Draw terrain tiles
        this.drawTerrainTiles(this.tileMap.terrainMap);
        
        // Update ground texture with terrain data
        this.updateGroundTexture();
        
        this.terrainRendered = true;
        
    }

    drawTerrainTiles(terrainMap) {
        // NEW: Pass heightMap if available (now in tileMap)
        const heightMap = this.tileMap?.heightMap || null;
        this.game.terrainTileMapper.draw(terrainMap, heightMap);
    }

    updateGroundTexture() {
        if (!this.terrainCanvas) {
            console.warn('WorldRenderSystem: No terrain canvas available for ground texture update');
            return;
        }

        // Draw terrain data onto ground canvas
        this.groundCtx.drawImage(
            this.game.terrainTileMapper.canvas, 
            this.extensionSize, 
            this.extensionSize
        );
        this.groundTexture.needsUpdate = true;
        
        if (this.heightMapSettings?.enabled) {
            this.updateHeightMap();
        }
        
        // Generate liquid surfaces
        if (this.tileMap?.terrainTypes) {
            this.generateLiquidSurfaceMesh(0); // Water
            this.generateLiquidSurfaceMesh(1); // Lava/other liquid
        }

        // Add grass
       // this.addGrassToTerrain();

        // Render environment objects
        this.renderEnvironmentObjects();
    }


    renderEnvironmentObjects() {
        if (!this.scene || !this.tileMap.environmentObjects || this.tileMap.environmentObjects.length === 0) {
            return;
        }

        // Create entities for each environment object
        this.tileMap.environmentObjects.forEach(obj => {
            this.createEnvironmentEntity(obj);
        });
    }

    createEnvironmentEntity(envObj) {
        const ComponentTypes = this.game.componentManager.getComponentTypes();
        const Components = this.game.componentManager.getComponents();

        const unitType = this.game.getCollections().worldObjects[envObj.type];
        unitType.collection = "worldObjects";
        unitType.id = envObj.type;
        // Calculate world position (matching your existing offset logic)
        const worldX = (envObj.x + this.extensionSize) - this.extendedSize / 2;
        const worldZ = (envObj.y + this.extensionSize) - this.extendedSize / 2;
        
        // Get terrain height
        let height = 0;
        if (this.heightMapSettings?.enabled) {
            height = this.game.gameManager.call('getTerrainHeightAtPosition', worldX, worldZ);
        }

        // Create entity with unique ID
        const entityId = this.game.createEntity(`env_${envObj.type}_${envObj.x}_${envObj.y}`);
        
        // Add Position component
        this.game.addComponent(entityId, ComponentTypes.POSITION, 
            Components.Position(worldX, height, worldZ));
                
        // Add Renderable component
        this.game.addComponent(entityId, ComponentTypes.RENDERABLE, 
            Components.Renderable('worldObjects', envObj.type, 1024));
        
        // Add Animation component for rotation and scale
        const rotation = Math.random() * Math.PI * 2;
        const scale = (0.8 + Math.random() * 0.4) * (envObj.type === 'rock' ? 1 : 50);
        this.game.addComponent(entityId, ComponentTypes.ANIMATION, 
            Components.Animation(scale, rotation, 0));
        
        // Add Facing component for rotation
        this.game.addComponent(entityId, ComponentTypes.FACING, 
            Components.Facing(rotation));
        
         this.game.addComponent(entityId, ComponentTypes.UNIT_TYPE, 
            Components.UnitType(
                unitType
            ));
        
        // Add Team component (neutral for environment objects)
        this.game.addComponent(entityId, ComponentTypes.TEAM, 
            Components.Team('neutral'));

        console.log('created tree');
        this.game.triggerEvent('onEntityPositionUpdated', entityId);
    }

    onWindowResize() {
        if (!this.camera || !this.renderer) return;
        
        const width = window.innerWidth;
        const height = window.innerHeight;

        this.camera.aspect = width / height;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(width, height);
        
        if (this.composer) {
            this.composer.setSize(width, height);
        }
    }

    update() {
        if (!this.initialized) return;

        this.timer += this.game.state.deltaTime;

        if (this.controls) {
            this.controls.update();
        }

        for (const key in this.uniforms) {
            if (this.uniforms[key].time) {
                this.uniforms[key].time.value = this.timer;
            }
        }

        this.render();
    }

    render() {
        if (!this.scene || !this.camera || !this.renderer) {
            console.warn('WorldRenderSystem: Missing components for rendering');
            return;
        }

        const composer = this.game.gameManager.call('getPostProcessingComposer');
        if (composer) {
            this.game.gameManager.call('renderPostProcessing');
        } else {
            this.renderer.render(this.scene, this.camera);
        }
    }

    updateHeightMap() {
        if (!this.heightMapSettings.enabled || !this.game.terrainTileMapper.heightMapCanvas) {
            console.warn('Height map not available from TileMapper');
            return;
        }

        try {
            const heightMapCanvas = this.game.terrainTileMapper.heightMapCanvas;
            const heightMapCtx = heightMapCanvas.getContext('2d', { willReadFrequently: true });
            
            // Get the height map image data directly from TileMapper
            const heightMapImageData = heightMapCtx.getImageData(0, 0, heightMapCanvas.width, heightMapCanvas.height);
            const heightData = heightMapImageData.data;

            this.heightMapData = new Float32Array(this.extendedSize * this.extendedSize);

            // Set extension area to extension terrain height
            const extensionTerrainType = this.tileMap.extensionTerrainType || 0;
            const extensionHeight = extensionTerrainType * this.heightStep;

            // Initialize all points with extension height
            for (let z = 0; z < this.extendedSize; z++) {
                for (let x = 0; x < this.extendedSize; x++) {
                    this.heightMapData[z * this.extendedSize + x] = extensionHeight;
                }
            }

            // Process the actual terrain area using height map data
            const scaleX = heightMapCanvas.width / this.terrainSize;
            const scaleZ = heightMapCanvas.height / this.terrainSize;

            for (let z = 0; z < this.terrainSize; z++) {
                for (let x = 0; x < this.terrainSize; x++) {
                    // Sample from height map
                    const heightMapX = Math.floor(x * scaleX);
                    const heightMapZ = Math.floor(z * scaleZ);
                    
                    const pixelIndex = (heightMapZ * heightMapCanvas.width + heightMapX) * 4;
                    const heightValue = heightData[pixelIndex]; // Red channel (grayscale)
                    
                    // Convert grayscale value back to height index
                    const heightIndex = Math.floor(heightValue / 32); // Inverse of scaling in TileMapper
                    let height = heightIndex * this.heightStep;

                    // Check neighboring pixels for cliff smoothing if needed
                    let neighborCheckDist = this.heightMapSettings.resolutionDivisor || 1;
                    const neighbors = [
                        { x: x - neighborCheckDist, z: z },   // left
                        { x: x + neighborCheckDist, z: z },   // right
                        { x: x, z: z - neighborCheckDist },   // top
                        { x: x, z: z + neighborCheckDist },   // bottom
                        { x: x - neighborCheckDist, z: z - neighborCheckDist }, // top-left
                        { x: x + neighborCheckDist, z: z - neighborCheckDist }, // top-right
                        { x: x - neighborCheckDist, z: z + neighborCheckDist }, // bottom-left
                        { x: x + neighborCheckDist, z: z + neighborCheckDist }  // bottom-right
                    ];

                    let lowestNeighborHeight = height;
                    for (const neighbor of neighbors) {
                        if (neighbor.x >= 0 && neighbor.x < this.terrainSize && 
                            neighbor.z >= 0 && neighbor.z < this.terrainSize) {
                            
                            const neighborHMapX = Math.floor(neighbor.x * scaleX);
                            const neighborHMapZ = Math.floor(neighbor.z * scaleZ);
                            const neighborIndex = (neighborHMapZ * heightMapCanvas.width + neighborHMapX) * 4;
                            const neighborHeightValue = heightData[neighborIndex];
                            const neighborHeightIndex = Math.floor(neighborHeightValue / 32);
                            const neighborHeight = neighborHeightIndex * this.heightStep;
                            
                            if (neighborHeight < lowestNeighborHeight) {
                                lowestNeighborHeight = neighborHeight;
                            }
                        }
                    }
                    
                    // Use the lowest neighbor height for cliff smoothing
                    height = lowestNeighborHeight;
                    // Set height in extended coordinate system
                    const extX = x + this.extensionSize;
                    const extZ = z + this.extensionSize;
                    this.heightMapData[extZ * this.extendedSize + extX] = height;
                }
            }

            this.applyHeightMapToGeometry();

        } catch (e) {
            console.warn('Failed to update height map from TileMapper:', e);
        }
    }
    findClosestTerrainType(r, g, b, terrainTypeColors) {
        let minDistance = Infinity;
        let bestTypeIndex = null;
        const toleranceSquared = 36;

        for (const [colorKey, typeIndex] of Object.entries(terrainTypeColors)) {
            const [cr, cg, cb] = colorKey.split(',').map(Number);
            const distance = ((r - cr) ** 2 + (g - cg) ** 2 + (b - cb) ** 2);
            
            if (distance < minDistance && distance < toleranceSquared) {
                minDistance = distance;
                bestTypeIndex = typeIndex;
            }
        }

        return bestTypeIndex;
    }

    createTerrainTypeColorMap() {
        const colorMap = {};
        const terrainTypes = this.tileMap.terrainTypes || [];

        for (let i = 0; i < terrainTypes.length; i++) {
            const terrainType = terrainTypes[i];
            let color = terrainType.color || {};

            if (color.paletteColor && this.game.palette) {
                const hexColor = this.game.palette[color.paletteColor];
                if (hexColor) {
                    const r = parseInt(hexColor.slice(1, 3), 16);
                    const g = parseInt(hexColor.slice(3, 5), 16);
                    const b = parseInt(hexColor.slice(5, 7), 16);
                    colorMap[`${r},${g},${b}`] = i;
                }
            } else {
                const hexColor = color;
                if (hexColor) {
                    const r = parseInt(hexColor.slice(1, 3), 16);
                    const g = parseInt(hexColor.slice(3, 5), 16);
                    const b = parseInt(hexColor.slice(5, 7), 16);
                    colorMap[`${r},${g},${b}`] = i;
                }
            }
        }

        return colorMap;
    }

    applyHeightMapToGeometry() {
        if (!this.ground || !this.groundVertices) return;

        const positions = this.groundVertices.array;
        const geometry = this.ground.geometry;
        const segments = this.heightMapResolution;
        const verticesPerRow = segments + 1;

        // First pass: Update vertex heights
        for (let z = 0; z < verticesPerRow; z++) {
            for (let x = 0; x < verticesPerRow; x++) {
                const vertexIndex = (z * verticesPerRow + x);
                const idx = vertexIndex * 3;

                const nx = x / segments;
                const nz = z / segments;

                const terrainX = Math.floor(nx * (this.extendedSize));
                const terrainZ = Math.floor(nz * (this.extendedSize));

                const heightIndex = terrainZ * this.extendedSize + terrainX;
                const height = this.heightMapData[heightIndex] || 0;

                positions[idx + 2] = height;
            }
        }

        this.groundVertices.needsUpdate = true;
        geometry.computeVertexNormals();
        
        // Second pass: Generate cliff entities using TileMap analysis
        this.generateCliffEntities();
    }

    generateCliffEntities() {
        if (!this.heightMapData || !this.tileMap?.terrainMap || !this.game.terrainTileMapper) return;

        const terrainMap = this.tileMap.terrainMap;
        const gridSize = this.game.getCollections().configs.game.gridSize;
        const rows = terrainMap.length;
        const cols = terrainMap[0].length;

        const mapAnalysis = this.game.terrainTileMapper.analyzeMap();

        mapAnalysis.forEach((tile, index) => {
            const x = (index % cols);
            const z = Math.floor(index / cols);

            // Use heightAnalysis for cliff placement (cliffs are based on height differences)
            const heightAnalysis = tile.heightAnalysis;

            // Only process tiles that have lower neighbors (cliff edges)
            if (heightAnalysis.neighborLowerCount > 0 || heightAnalysis.cornerLowerCount > 0) {
                this.placeCliffAtomsForTile(x, z, heightAnalysis, gridSize);
            }
        });
    }

    placeCliffAtomsForTile(x, z, heightAnalysis, gridSize) {

        if(this.game.gameManager.call('hasRampAt', x, z)){
            return;
        }
        // Convert grid coordinates to world coordinates
        const worldX = (x * gridSize + this.extensionSize) - this.extendedSize / 2;
        const worldZ = (z * gridSize + this.extensionSize) - this.extendedSize / 2;
        const offset = 0;
        const halfOffset = offset / 2;
        const halfGrid = gridSize / 2 + halfOffset;
        const quarterGrid = gridSize / 4 + halfOffset / 2; // Center of each quadrant


        // Calculate cliff bottom height
        let cliffBottomHeightIndex = heightAnalysis.heightIndex - 2;
        if (heightAnalysis.neighborLowerCount == 0 && heightAnalysis.cornerLowerCount == 0) {
            cliffBottomHeightIndex += 1;
        }
        const cliffHeight = cliffBottomHeightIndex * this.heightStep;

        // Array to store atom placements
        const atomPlacements = [];

        // Helper function to add atom
        const addAtom = (type, localX, localZ, rotation) => {
            atomPlacements.push({
                type,
                x: worldX + localX - halfOffset,
                z: worldZ + localZ - halfOffset,
                rotation
            });
        };

        // Track which quadrants are occupied by corners
        const topLeftOccupied = (heightAnalysis.topLess && heightAnalysis.leftLess) ||
                                (heightAnalysis.cornerTopLeftLess && !heightAnalysis.topLess && !heightAnalysis.leftLess);
        const topRightOccupied = (heightAnalysis.topLess && heightAnalysis.rightLess) ||
                                (heightAnalysis.cornerTopRightLess && !heightAnalysis.topLess && !heightAnalysis.rightLess);
        const botLeftOccupied = (heightAnalysis.botLess && heightAnalysis.leftLess) ||
                                (heightAnalysis.cornerBottomLeftLess && !heightAnalysis.botLess && !heightAnalysis.leftLess);
        const botRightOccupied = (heightAnalysis.botLess && heightAnalysis.rightLess) ||
                                (heightAnalysis.cornerBottomRightLess && !heightAnalysis.botLess && !heightAnalysis.rightLess);

        // Place corners first (they take priority) - CENTERED in their quadrants
        // Outer corners
        if (heightAnalysis.topLess && heightAnalysis.leftLess) {
            addAtom('atom_one', quarterGrid, quarterGrid, 0);
        }

        if (heightAnalysis.topLess && heightAnalysis.rightLess) {
            addAtom('atom_one', quarterGrid * 3, quarterGrid, Math.PI / 2);
        }

        if (heightAnalysis.botLess && heightAnalysis.leftLess) {
            addAtom('atom_one', quarterGrid, quarterGrid * 3, -Math.PI / 2);
        }

        if (heightAnalysis.botLess && heightAnalysis.rightLess) {
            addAtom('atom_one', quarterGrid * 3, quarterGrid * 3, Math.PI);
        }

        // Inner corners - CENTERED in their quadrants
        if (heightAnalysis.cornerTopLeftLess && !heightAnalysis.topLess && !heightAnalysis.leftLess) {
            addAtom('atom_three', quarterGrid, quarterGrid, 0);
        }

        if (heightAnalysis.cornerTopRightLess && !heightAnalysis.topLess && !heightAnalysis.rightLess) {
            addAtom('atom_three', quarterGrid * 3, quarterGrid, Math.PI / 2);
        }

        if (heightAnalysis.cornerBottomLeftLess && !heightAnalysis.botLess && !heightAnalysis.leftLess) {
            addAtom('atom_three', quarterGrid, quarterGrid * 3, -Math.PI / 2);
        }

        if (heightAnalysis.cornerBottomRightLess && !heightAnalysis.botLess && !heightAnalysis.rightLess) {
            addAtom('atom_three', quarterGrid * 3, quarterGrid * 3, Math.PI);
        }

        // Place edges in empty quadrants - CENTERED in their quadrants
        // Top edge uses top-left and top-right quadrants
        if (heightAnalysis.topLess) {
            if (!topLeftOccupied) {
                addAtom('atom_two', quarterGrid, quarterGrid, Math.PI / 2);
            }
            if (!topRightOccupied) {
                addAtom('atom_two', quarterGrid * 3, quarterGrid, Math.PI / 2);
            }
        }

        // Bottom edge uses bottom-left and bottom-right quadrants
        if (heightAnalysis.botLess) {
            if (!botLeftOccupied) {
                addAtom('atom_two', quarterGrid, quarterGrid * 3, -Math.PI / 2);
            }
            if (!botRightOccupied) {
                addAtom('atom_two', quarterGrid * 3, quarterGrid * 3, -Math.PI / 2);
            }
        }

        // Left edge uses top-left and bottom-left quadrants
        if (heightAnalysis.leftLess) {
            if (!topLeftOccupied) {
                addAtom('atom_two', quarterGrid, quarterGrid, 0);
            }
            if (!botLeftOccupied) {
                addAtom('atom_two', quarterGrid, quarterGrid * 3, 0);
            }
        }

        // Right edge uses top-right and bottom-right quadrants
        if (heightAnalysis.rightLess) {
            if (!topRightOccupied) {
                addAtom('atom_two', quarterGrid * 3, quarterGrid, Math.PI);
            }
            if (!botRightOccupied) {
                addAtom('atom_two', quarterGrid * 3, quarterGrid * 3, Math.PI);
            }
        }

        // Create entities for all atoms
        atomPlacements.forEach(atom => {
            this.createCliffEntity(atom.type, atom.x, cliffHeight, atom.z, atom.rotation);
        });
    }


    resetCliffs() {
        this.destroyAllCliffs();
        this.generateCliffEntities();
    }

    destroyAllCliffs() {
        const cliffs = this.game.getEntitiesWith('cliff');
        cliffs.forEach((cliff) => {
            this.game.destroyEntity(cliff);
        });
    }

    createCliffEntity(type, worldX, worldY, worldZ, rotation) {
        const cliffsType = "cliffs";
        const ComponentTypes = this.game.componentManager.getComponentTypes();
        const Components = this.game.componentManager.getComponents();

        const unitType = this.game.getCollections()[cliffsType]?.[type];
        if (!unitType) {
            console.warn(`Cliff type ${type} not found in cliffs collection`);
            return;
        }

        unitType.collection = cliffsType;
        unitType.id = type;        

        // Create entity with unique ID
        const entityId = this.game.createEntity(`${cliffsType}_${type}_${Math.round(worldX)}_${Math.round(worldZ)}_${Math.random()}`);

        // Add Position component
        this.game.addComponent(entityId, ComponentTypes.POSITION, 
            Components.Position(worldX, worldY, worldZ));

        // Add Renderable component
        this.game.addComponent(entityId, ComponentTypes.RENDERABLE, 
            Components.Renderable(cliffsType, type, 1024));

        // Add Animation component for rotation and scale
        this.game.addComponent(entityId, ComponentTypes.ANIMATION, 
            Components.Animation(1, rotation, 0));

        // Add Facing component for rotation
        this.game.addComponent(entityId, ComponentTypes.FACING, 
            Components.Facing(rotation));

        // Add UnitType component
        this.game.addComponent(entityId, ComponentTypes.UNIT_TYPE, 
            Components.UnitType(unitType));

        // Add Team component (neutral for cliffs)
        this.game.addComponent(entityId, ComponentTypes.TEAM, 
            Components.Team('cliff'));

        this.game.addComponent(entityId, "cliff", { type });

        this.game.triggerEvent('onEntityPositionUpdated', entityId);
    }

    generateLiquidSurfaceMesh(terrainType) {
        const terrainMap = this.tileMap.terrainMap;
        const gridSize = this.game.getCollections().configs.game.gridSize;
        const rows = terrainMap.length;
        const cols = terrainMap[0].length;
        
        // Arrays to store vertices, indices, and UVs for the BufferGeometry
        const vertices = [];
        const indices = [];
        const uvs = [];
        
        // Amount to extend the perimeter (e.g., 10% of gridSize)
        const extensionAmount = gridSize * 0.25; // Adjust as needed        

        // Calculate centering offset to match ground positioning
        const terrainWorldWidth = cols * gridSize;
        const terrainWorldHeight = rows * gridSize;
        const centerOffsetX = -terrainWorldWidth / 2;
        const centerOffsetZ = -terrainWorldHeight / 2;

        // Helper function to check if a tile is a water tile
        const isWaterTile = (x, z) => {
            if (x < 0 || x >= cols || z < 0 || z >= rows) return false;
            return terrainMap[z][x] === terrainType;
        };
        
        // Step 1: Generate a grid of vertices, but only for positions needed by water tiles
        const usedPositions = new Set();
        for (let z = 0; z < rows; z++) {
            for (let x = 0; x < cols; x++) {
                if (terrainMap[z][x] === terrainType) {
                    usedPositions.add(`${x},${z}`);     // Bottom-left
                    usedPositions.add(`${x + 1},${z}`); // Bottom-right
                    usedPositions.add(`${x + 1},${z + 1}`); // Bottom-right in your view (+z is south)
                    usedPositions.add(`${x},${z + 1}`); // Top-left
                }
            }
        }
        
        // Step 2: Create vertices for all used positions and store their original positions
        const positionToVertexIndex = new Map();
        const originalPositions = []; // Store original (x, z) for each vertex
        let vertexIndex = 0;
        for (const pos of usedPositions) {
            const [x, z] = pos.split(',').map(Number);
            positionToVertexIndex.set(pos, vertexIndex++);
            
            // Apply centering offset to match ground positioning
            const worldX = x * gridSize + centerOffsetX;
            const worldZ = z * gridSize + centerOffsetZ;
            
            vertices.push(worldX, 0.1, worldZ);
            originalPositions.push([x, z]); // Store original grid position
            uvs.push(x, z); // UVs based on grid position
        }
        
        // Step 3: Generate indices for water tiles, connecting them into a single mesh
        for (let z = 0; z < rows; z++) {
            for (let x = 0; x < cols; x++) {
                if (terrainMap[z][x] === terrainType) {
                    const bl = positionToVertexIndex.get(`${x},${z}`);
                    const br = positionToVertexIndex.get(`${x + 1},${z}`);
                    const tr = positionToVertexIndex.get(`${x + 1},${z + 1}`); // Bottom-right in your view
                    const tl = positionToVertexIndex.get(`${x},${z + 1}`);

                    indices.push(bl, br, tl);
                    indices.push(br, tr, tl);
                }
            }
        }
        
        // Step 4: Identify perimeter vertices and their extension directions
        const perimeterExtensions = new Map(); // Map vertexIndex to { extendLeft, extendRight, extendUp, extendDown }
        for (let z = 0; z < rows; z++) {
            for (let x = 0; x < cols; x++) {
                if (terrainMap[z][x] === terrainType) {
                    const isLeftEdge = !isWaterTile(x - 1, z);
                    const isRightEdge = !isWaterTile(x + 1, z);
                    const isBottomEdge = !isWaterTile(x, z - 1); // North
                    const isTopEdge = !isWaterTile(x, z + 1);    // South

                    // Bottom-left vertex (x, z)
                    if (isLeftEdge || isBottomEdge) {
                        const vIdx = positionToVertexIndex.get(`${x},${z}`);
                        if (!perimeterExtensions.has(vIdx)) perimeterExtensions.set(vIdx, { extendLeft: false, extendRight: false, extendUp: false, extendDown: false });
                        const ext = perimeterExtensions.get(vIdx);
                        if (isLeftEdge) ext.extendLeft = true;
                        if (isBottomEdge) ext.extendUp = true; // North
                    }

                    // Bottom-right vertex (x + 1, z)
                    if (isRightEdge || isBottomEdge) {
                        const vIdx = positionToVertexIndex.get(`${x + 1},${z}`);
                        if (!perimeterExtensions.has(vIdx)) perimeterExtensions.set(vIdx, { extendLeft: false, extendRight: false, extendUp: false, extendDown: false });
                        const ext = perimeterExtensions.get(vIdx);
                        if (isRightEdge) ext.extendRight = true;
                        if (isBottomEdge) ext.extendUp = true; // North
                    }

                    // Top-right vertex (x + 1, z + 1) - Bottom-right in your view
                    if (isRightEdge || isTopEdge) {
                        const vIdx = positionToVertexIndex.get(`${x + 1},${z + 1}`);
                        if (!perimeterExtensions.has(vIdx)) perimeterExtensions.set(vIdx, { extendLeft: false, extendRight: false, extendUp: false, extendDown: false });
                        const ext = perimeterExtensions.get(vIdx);
                        if (isRightEdge) ext.extendRight = true;
                        if (isTopEdge) ext.extendDown = true; // South
                    }

                    // Top-left vertex (x, z + 1)
                    if (isLeftEdge || isTopEdge) {
                        const vIdx = positionToVertexIndex.get(`${x},${z + 1}`);
                        if (!perimeterExtensions.has(vIdx)) perimeterExtensions.set(vIdx, { extendLeft: false, extendRight: false, extendUp: false, extendDown: false });
                        const ext = perimeterExtensions.get(vIdx);
                        if (isLeftEdge) ext.extendLeft = true;
                        if (isTopEdge) ext.extendDown = true; // South
                    }
                }
            }
        }
        
        // Step 5: Apply perimeter extensions
        perimeterExtensions.forEach((ext, vertexIndex) => {
            const idx = vertexIndex * 3;
            const [origX, origZ] = originalPositions[vertexIndex];     

            if (ext.extendLeft) vertices[idx] -= extensionAmount; // Extend left
            if (ext.extendRight) vertices[idx] += extensionAmount; // Extend right
            if (ext.extendUp) vertices[idx + 2] -= extensionAmount; // Extend north (decrease z)
            if (ext.extendDown) vertices[idx + 2] += extensionAmount; // Extend south (increase z)

       
        });
        
        // Step 6: Create the BufferGeometry
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
        geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
        geometry.setIndex(indices);
        geometry.computeVertexNormals(); // For lighting
        
        // Parse the hex color to RGB
        const parseHexColor = (hex) => {
            const r = parseInt(hex.slice(1, 3), 16) / 255;
            const g = parseInt(hex.slice(3, 5), 16) / 255;
            const b = parseInt(hex.slice(5, 7), 16) / 255;
            return { r, g, b };
        };
        
        const waterShader = this.game.getCollections().shaders[this.level.waterShader];
        
        // Use the hex color in a ShaderMaterial
        this.uniforms[terrainType] = JSON.parse(waterShader.uniforms);
        let vectorizeProps = JSON.parse(waterShader.vectors);
        vectorizeProps.forEach((prop => {
            if (this.uniforms[terrainType][prop]) {
                if( prop.toLowerCase().endsWith("color")){
                    const colorToUse = this.tileMap.terrainTypes[terrainType].color;
                    const { r, g, b } = parseHexColor(colorToUse);
                    this.uniforms[terrainType][prop].value = new THREE.Vector3(r, g, b);
                } else {
                    let arr = this.uniforms[terrainType][prop].value;
                    this.uniforms[terrainType][prop].value = new THREE.Vector3(arr[0], arr[1], arr[2]);
                }
            }
        }));
        
        this.uniforms[terrainType].fogColor = { value: new THREE.Color(this.fogSettings.color) };
        this.uniforms[terrainType].fogDensity = this.fogSettings.enabled ? { value: this.fogSettings.density } : 0;
        
        // Reference the uniforms
        const uniforms = this.uniforms[terrainType];
        
        // Create the shader material
        const material = new THREE.ShaderMaterial({
            uniforms: uniforms,
            vertexShader: waterShader.vertexScript,
            fragmentShader: waterShader.fragmentScript,
            side: THREE.DoubleSide,
            transparent: true
        });

        // Replace the MeshBasicMaterial with this ShaderMaterial in the mesh creation
        const waterMesh = new THREE.Mesh(geometry, material);        
        waterMesh.position.y = (terrainType + 1) * this.heightMapSettings.heightStep;
        
        // No additional position offset needed since vertices are already centered
        waterMesh.position.x = 0;
        waterMesh.position.z = 0;
        
        this.scene.add(waterMesh);
        this.liquidMeshes.push(waterMesh);

    }

    addGrassToTerrain() {
        const bladeWidth = 12;
        const bladeHeight = 18;
        const grassGeometry = this.createCurvedBladeGeometry(bladeWidth, bladeHeight);
        grassGeometry.translate(0, bladeHeight / 2, 0);
        const grassCount = 50000;

        const gridSize = this.game.getCollections().configs.game.gridSize;
        const phases = new Float32Array(grassCount);
        for (let i = 0; i < grassCount; i++) {
            phases[i] = Math.random() * Math.PI * 2;
        }
        grassGeometry.setAttribute('instancePhase', new THREE.InstancedBufferAttribute(phases, 1));

        const grassTexture = this.createGrassTexture();
        const grassShader = this.game.getCollections().shaders[this.level.grassShader];
        this.uniforms['grass'] = JSON.parse(grassShader.uniforms);
        
        this.uniforms['grass'].windDirection = { value: new THREE.Vector2(this.uniforms['grass'].windDirection.value[0], this.uniforms['grass'].windDirection.value[1]).normalize()};
        this.uniforms['grass'].map = { value: grassTexture };
        this.uniforms['grass'].fogColor = { value: new THREE.Color(this.fogSettings.color) };
        this.uniforms['grass'].fogDensity = this.fogSettings.enabled ? { value: this.fogSettings.density } : 0;
        const lightDirection = new THREE.Vector3();
        lightDirection.subVectors(this.directionalLight.position, this.directionalLight.target.position);
        lightDirection.normalize();

        this.uniforms['grass'].skyColor =  { value: new THREE.Color(this.lightingSettings.skyColor) }; // HemisphereLight sky color
        this.uniforms['grass'].groundColor = { value: new THREE.Color(this.lightingSettings.groundColor) }; // HemisphereLight ground color
        this.uniforms['grass'].hemisphereIntensity = { value: this.lightingSettings.hemisphereIntensity };

        const uniforms = this.uniforms['grass'];
        this.grassMaterial = new THREE.ShaderMaterial({
            vertexShader: grassShader.vertexScript,
            fragmentShader: grassShader.fragmentScript,
            uniforms: uniforms,
            transparent: true
        });

        this.grassShader = this.grassMaterial;
        
        grassGeometry.computeVertexNormals(); 
        const grass = new THREE.InstancedMesh(grassGeometry, this.grassMaterial, grassCount);
        grass.castShadow = true;
        grass.receiveShadow = false;

        const dummy = new THREE.Object3D();
        const grassArea = this.extendedSize;  
        const ctx = this.groundCanvas.getContext('2d');
        const terrainData = ctx.getImageData(0, 0, this.groundCanvas.width, this.groundCanvas.height).data;

        // Create a density map for grass placement
        const densityMap = new Float32Array(this.extendedSize * this.extendedSize);
        for (let z = 0; z < this.extendedSize; z++) {
            for (let x = 0; x < this.extendedSize; x++) {
                // Check current pixel for green dominance
                const pixelIndex = (z * this.groundCanvas.width + x) * 4;
                const isGreenDominant = (pixel) => {
                    const r = terrainData[pixel];
                    const g = terrainData[pixel + 1];
                    const b = terrainData[pixel + 2];
                    return g > r && g > b;
                };

                // Only set density if current pixel and all neighbors are green
                if (isGreenDominant(pixelIndex)) {
                    // Check 8 neighboring pixels
                    let checkDist = Math.ceil(gridSize / 10);
                    const neighbors = [
                        [-checkDist, -checkDist], [0, -checkDist], [checkDist, -checkDist],
                        [-checkDist,  0],                           [checkDist,  0],
                        [-checkDist,  checkDist], [0,  checkDist], [checkDist,  checkDist]
                    ];

                    let allNeighborsGreen = true;
                    for (const [dx, dz] of neighbors) {
                        const nx = x + dx;
                        const nz = z + dz;
                        
                        // Skip if neighbor is outside bounds
                        if (nx < 0 || nx >= this.extendedSize || nz < 0 || nz >= this.extendedSize) {
                            allNeighborsGreen = false;
                            break;
                        }

                        const neighborIndex = (nz * this.groundCanvas.width + nx) * 4;
                        if (!isGreenDominant(neighborIndex)) {
                            allNeighborsGreen = false;
                            break;
                        }
                    }

                    densityMap[z * this.extendedSize + x] = allNeighborsGreen ? 1 : 0;
                } else {
                    densityMap[z * this.extendedSize + x] = 0;
                }
            }
        }

        // Place grass based on density
        let placed = 0;
        for (let i = 0; i < grassCount * 2 && placed < grassCount; i++) {
            const x = Math.floor(Math.random() * grassArea);
            const z = Math.floor(Math.random() * grassArea);
            if (densityMap[z * this.extendedSize + x] > 0) {
                const rotationY = Math.random() * Math.PI * 2;
                const scale = 0.7 + Math.random() * 0.5;
                let height = this.heightMapSettings.enabled
                    ? this.heightMapData[Math.min(z, this.extendedSize - 1) * this.extendedSize + Math.min(x, this.extendedSize - 1)] || 0
                    : 0;
                dummy.position.set(x - grassArea / 2 , height - bladeHeight, z - grassArea / 2);
                dummy.rotation.set(0, rotationY, 0);
                dummy.scale.set(scale, scale, scale);
                dummy.updateMatrix();
                grass.setMatrixAt(placed++, dummy.matrix);
            }
        }

        grass.instanceMatrix.needsUpdate = true;
        this.scene.add(grass);
        this.grass = grass;
    }
    
    createCurvedBladeGeometry(width = 0.1, height = 1) {
        const shape = new THREE.Shape();
        shape.moveTo(0, 0);
        shape.quadraticCurveTo(width * 0.5, height * 0.5, 0, height);
    
        const shapeGeom = new THREE.ShapeGeometry(shape, 12);
        const positions = shapeGeom.attributes.position.array;
        const uvs = shapeGeom.attributes.uv.array;
        const vertexCount = positions.length / 3;
    
        const newUVs = new Float32Array(uvs.length);
        const newNormals = new Float32Array(positions.length);
    
        for (let i = 0; i < vertexCount; i++) {
            const posIndex = i * 3;
            const uvIndex = i * 2;
            const x = positions[posIndex];
            const y = positions[posIndex + 1];
            const normalizedY = y / height;
    
            newUVs[uvIndex] = uvs[uvIndex];
            newUVs[uvIndex + 1] = normalizedY;
    
            // Compute normal: approximate outward direction along curve
            const t = y / height; // Parameter along curve
            const curveX = width * 0.5 * (1 - t); // Quadratic curve approximation
            const tangent = new THREE.Vector2(curveX - x, y - (y - height * 0.5)).normalize();
            const normal = new THREE.Vector2(-tangent.y, tangent.x); // Perpendicular to tangent
            newNormals[posIndex] = normal.x;
            newNormals[posIndex + 1] = 0;
            newNormals[posIndex + 2] = normal.y;
        }
    
        shapeGeom.setAttribute('uv', new THREE.BufferAttribute(newUVs, 2));
        shapeGeom.setAttribute('normal', new THREE.BufferAttribute(newNormals, 3));
        return shapeGeom;
    }

    createGrassTexture() {
        const canvas = document.createElement('canvas');
        canvas.width = 4;
        canvas.height = 32;
        const ctx = canvas.getContext('2d');

        const gradient = ctx.createLinearGradient(0, canvas.height, 0, 0);
        gradient.addColorStop(0.0, this.game.palette["greenMColor"]);
        gradient.addColorStop(0.8, this.game.palette["greenMColor"]);
        gradient.addColorStop(1.0, this.game.palette["redLColor"]);

        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        const texture = new THREE.CanvasTexture(canvas);
        texture.wrapS = THREE.RepeatWrapping;
        texture.wrapT = THREE.ClampToEdgeWrapping;
        texture.magFilter = THREE.NearestFilter;
        texture.minFilter = THREE.NearestFilter;
        return texture;
    }

    // Utility methods for external systems
    setControlsEnabled(enabled) {
        if (this.controls) {
            this.controls.enabled = enabled;
        }
    }

    resetCamera() {
        if (!this.cameraSettings) return;

        const cameraPos = JSON.parse(this.cameraSettings.position);
        const lookAt = JSON.parse(this.cameraSettings.lookAt);

        if (this.controls) {
            this.controls.reset();
            this.camera.position.set(cameraPos.x, cameraPos.y, cameraPos.z);
            this.controls.target.set(lookAt.x, lookAt.y, lookAt.z);
            this.controls.update();
        } else {
         //   this.camera.position.set(cameraPos.x, cameraPos.y, cameraPos.z);
        //    this.camera.lookAt(lookAt.x, lookAt.y, lookAt.z);
        }

    }

    // Terrain update methods for dynamic changes
    updateTerrain() {
        this.terrainRendered = false;
        this._cachedColorMap = null;
        this.renderTerrain();
    }

    destroy() {

        // Clean up extension planes
        if (this.extensionPlanes) {
            this.extensionPlanes.forEach(plane => {
                this.scene.remove(plane);
                plane.geometry?.dispose();
                plane.material?.dispose();
            });
            this.extensionPlanes = [];
        }

        // Clean up ground
        if (this.ground) {
            this.scene.remove(this.ground);
            this.ground.geometry?.dispose();
            this.ground.material?.dispose();
        }

        // Clean up grass
        if (this.grass) {
            this.scene.remove(this.grass);
            this.grass.geometry?.dispose();
            this.grass.material?.dispose();
        }

        // Clean up liquid meshes
        this.liquidMeshes.forEach(mesh => {
            this.scene.remove(mesh);
            mesh.geometry?.dispose();
            mesh.material?.dispose();
        });
        this.liquidMeshes = [];

        // Clean up textures
        this.groundTexture?.dispose();

        // Clean up lights
        if (this.ambientLight) this.scene.remove(this.ambientLight);
        if (this.directionalLight) {
            this.scene.remove(this.directionalLight);
            this.scene.remove(this.directionalLight.target);
        }
        if (this.hemisphereLight) this.scene.remove(this.hemisphereLight);

        // Clean up Three.js core
        if (this.renderer) {
            this.renderer.dispose();
        }

        // Clean up composer
        if (this.composer) {
            this.composer.dispose();
        }

        // Clean up orbit controls
        if (this.controls) {
            this.controls.dispose();
            this.controls = null;
        }

        // Remove event listeners
        window.removeEventListener('resize', this.onWindowResizeHandler);

        // Clear references
        this.groundCanvas = null;
        this.terrainCanvas = null;
        this.scene = null;
        this.camera = null;
        this.renderer = null;
        this.composer = null;

        this.initialized = false;
    }

    // Add this method to the WorldSystem class

    getTerrainHeightAtPosition(worldX, worldZ) {
        // Check if height map is available and enabled
        if (!this.heightMapData || !this.heightMapSettings?.enabled) {
            return 0; // Fallback to flat ground
        }
        
        // Convert world coordinates to height map coordinates
        // The ground is centered at origin, so we need to offset by half the extended size
        const heightMapX = Math.floor(worldX + this.extendedSize / 2);
        const heightMapZ = Math.floor(worldZ + this.extendedSize / 2);
        
        // Ensure coordinates are within bounds
        if (heightMapX < 0 || heightMapX >= this.extendedSize || heightMapZ < 0 || heightMapZ >= this.extendedSize) {
            // Outside terrain bounds, use extension terrain height
            const extensionTerrainType = this.tileMap?.extensionTerrainType || 0;
            return extensionTerrainType * this.heightStep;
        }
        
        // Get height from height map
        const heightIndex = heightMapZ * this.extendedSize + heightMapX;
        return this.heightMapData[heightIndex] || 0;
    }

    // Optional: Add bilinear interpolation for smoother height transitions
    getTerrainHeightAtPositionSmooth(worldX, worldZ) {
        // Check if height map is available and enabled
        if (!this.heightMapData || !this.heightMapSettings?.enabled) {
            return 0; // Fallback to flat ground
        }
        
        // Convert world coordinates to height map coordinates (with decimal precision)
        const heightMapX = worldX + this.extendedSize / 2;
        const heightMapZ = worldZ + this.extendedSize / 2;
        
        // Get the four surrounding grid points
        const x0 = Math.floor(heightMapX);
        const x1 = x0 + 1;
        const z0 = Math.floor(heightMapZ);
        const z1 = z0 + 1;
        
        // Get fractional parts for interpolation
        const fx = heightMapX - x0;
        const fz = heightMapZ - z0;
        
        // Helper function to get height at specific grid point
        const getHeightAt = (x, z) => {
            if (x < 0 || x >= this.extendedSize || z < 0 || z >= this.extendedSize) {
                const extensionTerrainType = this.tileMap?.extensionTerrainType || 0;
                return extensionTerrainType * this.heightStep;
            }
            const heightIndex = z * this.extendedSize + x;
            return this.heightMapData[heightIndex] || 0;
        };
        
        // Get heights at the four corners
        const h00 = getHeightAt(x0, z0);
        const h10 = getHeightAt(x1, z0);
        const h01 = getHeightAt(x0, z1);
        const h11 = getHeightAt(x1, z1);
        
        // Bilinear interpolation
        const h0 = h00 * (1 - fx) + h10 * fx;
        const h1 = h01 * (1 - fx) + h11 * fx;
        return h0 * (1 - fz) + h1 * fz;
    }
}