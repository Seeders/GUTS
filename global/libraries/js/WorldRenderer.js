/**
 * WorldRenderer - 3D terrain and world rendering using Three.js
 *
 * Handles:
 * - Scene, camera, renderer initialization
 * - Terrain mesh rendering with height maps
 * - Cliff entity generation
 * - Liquid surfaces (water, lava)
 * - Extension planes for infinite terrain
 * - Lighting (ambient, directional, hemisphere)
 * - Fog and shadows
 * - Post-processing effects
 *
 * Works with TerrainDataManager for terrain data
 * Reusable in both game and editor contexts
 */
class WorldRenderer {
    constructor(config = {}) {
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
        this.groundVertices = null;
        this.grass = null;
        this.liquidMeshes = [];

        // Extension planes
        this.extensionPlanes = [];

        // Lighting
        this.ambientLight = null;
        this.directionalLight = null;
        this.hemisphereLight = null;

        // Uniforms for shaders
        this.uniforms = {};

        // Settings and data (injected from outside)
        this.terrainDataManager = null;
        this.tileMapper = null;
        this.collections = null;

        // Configuration
        this.config = {
            enableShadows: true,
            enableFog: true,
            enablePostProcessing: true,
            enableGrass: false,
            enableLiquidSurfaces: true,
            enableCliffs: true,
            pixelSize: 1,
            ...config
        };

        // Timing
        this.clock = new THREE.Clock();
        this.timer = 0;

        // Orbit controls
        this.controls = null;

        // Window resize handler
        this.onWindowResizeHandler = this.onWindowResize.bind(this);

        this.initialized = false;
    }

    /**
     * Initialize Three.js scene, camera, renderer
     * @param {HTMLCanvasElement} canvas - Canvas element to render to
     * @param {Object} cameraSettings - Camera configuration
     * @param {boolean} [enableControls] - Whether to enable OrbitControls
     */
    initializeThreeJS(canvas, cameraSettings, enableControls = false) {
        if (!canvas) {
            console.error('WorldRenderer: Canvas element required');
            return false;
        }

        // Create scene
        this.scene = new THREE.Scene();

        // Setup camera (orthographic or perspective based on settings)
        const width = canvas.clientWidth || window.innerWidth;
        const height = canvas.clientHeight || window.innerHeight;

        if (cameraSettings.fov) {
            // Perspective camera
            this.camera = new THREE.PerspectiveCamera(
                cameraSettings.fov,
                width / height,
                cameraSettings.near || 0.1,
                cameraSettings.far || 30000
            );
        } else if (cameraSettings.zoom) {
            // Orthographic camera
            this.camera = new THREE.OrthographicCamera(
                width / -2,
                width / 2,
                height / 2,
                height / -2,
                cameraSettings.near || 0.1,
                cameraSettings.far || 30000
            );
            this.camera.zoom = cameraSettings.zoom;
            this.camera.updateProjectionMatrix();
        }

        // Position camera
        if (cameraSettings.position) {
            const pos = typeof cameraSettings.position === 'string'
                ? JSON.parse(cameraSettings.position)
                : cameraSettings.position;
            this.camera.position.set(pos.x, pos.y, pos.z);
        }

        // Set camera look at
        if (cameraSettings.lookAt) {
            const lookAt = typeof cameraSettings.lookAt === 'string'
                ? JSON.parse(cameraSettings.lookAt)
                : cameraSettings.lookAt;
            this.camera.lookAt(lookAt.x, lookAt.y, lookAt.z);
        }

        // Create renderer
        this.renderer = new THREE.WebGLRenderer({
            canvas: canvas,
            antialias: false,
            alpha: true
        });
        this.renderer.setSize(width, height);
        this.renderer.outputColorSpace = THREE.SRGBColorSpace;

        // Setup OrbitControls if requested
        if (enableControls && typeof THREE_.OrbitControls !== 'undefined') {
            this.setupOrbitControls(cameraSettings.lookAt);
        }

        // Window resize handling
        window.addEventListener('resize', this.onWindowResizeHandler);

        this.initialized = true;
        return true;
    }

    /**
     * Setup OrbitControls for camera manipulation
     */
    setupOrbitControls(lookAt) {
        if (typeof THREE_.OrbitControls === 'undefined') {
            console.warn('WorldRenderer: THREE.OrbitControls not found');
            return;
        }

        const lookAtPos = lookAt ? (typeof lookAt === 'string' ? JSON.parse(lookAt) : lookAt) : { x: 0, y: 0, z: 0 };

        this.controls = new THREE_.OrbitControls(this.camera, this.renderer.domElement);

        // Use Ctrl+Right Click for rotation, Right Click alone for pan
        this.controls.mouseButtons = {
            LEFT: null,                    // Left click disabled (used for editing)
            MIDDLE: null,                  // Middle click disabled (conflicts with browser scroll)
            RIGHT: THREE.MOUSE.PAN         // Right click for panning (default)
        };

        this.controls.target.set(lookAtPos.x, lookAtPos.y, lookAtPos.z);
        this.controls.maxPolarAngle = Math.PI / 2.05;
        this.controls.minPolarAngle = 0.1;
        this.controls.enableDamping = true;
        this.controls.dampingFactor = 0.05;
        this.controls.screenSpacePanning = false;
        this.controls.minDistance = 50;
        this.controls.maxDistance = 1000;

        // Add modifier key detection for Ctrl+Right Click rotation
        this.ctrlPressed = false;

        const handleKeyDown = (event) => {
            if (event.ctrlKey || event.metaKey) {
                this.ctrlPressed = true;
                // Switch right click to rotate when Ctrl is held
                this.controls.mouseButtons.RIGHT = THREE.MOUSE.ROTATE;
            }
        };

        const handleKeyUp = (event) => {
            if (!event.ctrlKey && !event.metaKey) {
                this.ctrlPressed = false;
                // Switch right click back to pan when Ctrl is released
                this.controls.mouseButtons.RIGHT = THREE.MOUSE.PAN;
            }
        };

        // Store event handlers for cleanup
        this.controlsKeyHandlers = { handleKeyDown, handleKeyUp };

        window.addEventListener('keydown', handleKeyDown);
        window.addEventListener('keyup', handleKeyUp);

        this.controls.update();
    }

    /**
     * Setup scene background color
     */
    setBackgroundColor(color) {
        if (this.scene && color) {
            this.scene.background = new THREE.Color(color);
        }
    }

    /**
     * Setup fog in the scene
     */
    setupFog(fogSettings) {
        if (!fogSettings || !fogSettings.enabled) return;

        this.scene.fog = new THREE.FogExp2(
            fogSettings.color,
            fogSettings.density
        );
    }

    /**
     * Setup lighting (ambient, directional, hemisphere)
     */
    setupLighting(lightingSettings, shadowSettings, extendedSize) {
        if (!lightingSettings) {
            lightingSettings = {
                ambientColor: '#404040',
                ambientIntensity: 0.6,
                directionalColor: '#ffffff',
                directionalIntensity: 1.0,
                skyColor: '#87CEEB',
                groundColor: '#ffffff',
                hemisphereIntensity: 0.4
            };
        }

        // Ambient light
        this.ambientLight = new THREE.AmbientLight(
            lightingSettings.ambientColor,
            lightingSettings.ambientIntensity
        );
        this.scene.add(this.ambientLight);

        // Directional light
        this.directionalLight = new THREE.DirectionalLight(
            lightingSettings.directionalColor,
            lightingSettings.directionalIntensity
        );

        // Position directional light
        if (lightingSettings.direction) {
            const direction = typeof lightingSettings.direction === 'string'
                ? JSON.parse(lightingSettings.direction)
                : lightingSettings.direction;
            this.directionalLight.position.set(
                -direction.x * extendedSize,
                -direction.y * extendedSize,
                -direction.z * extendedSize
            );
        }

        // Setup shadows
        if (shadowSettings?.enabled && this.config.enableShadows) {
            this.renderer.shadowMap.enabled = true;
            this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

            this.directionalLight.castShadow = true;
            this.directionalLight.shadow.mapSize.width = shadowSettings.mapSize;
            this.directionalLight.shadow.mapSize.height = shadowSettings.mapSize;
            this.directionalLight.shadow.camera.near = 0.5;
            this.directionalLight.shadow.camera.far = 20000;
            this.directionalLight.shadow.bias = shadowSettings.bias;
            this.directionalLight.shadow.normalBias = shadowSettings.normalBias;
            this.directionalLight.shadow.radius = shadowSettings.radius;

            const d = extendedSize * 0.75;
            this.directionalLight.shadow.camera.left = -d;
            this.directionalLight.shadow.camera.right = d;
            this.directionalLight.shadow.camera.top = d;
            this.directionalLight.shadow.camera.bottom = -d;

            this.directionalLight.target.position.set(0, 0, 0);
            this.directionalLight.target.updateMatrixWorld();
            this.directionalLight.shadow.camera.updateProjectionMatrix();
        }

        this.scene.add(this.directionalLight);
        this.scene.add(this.directionalLight.target);

        // Hemisphere light
        this.hemisphereLight = new THREE.HemisphereLight(
            lightingSettings.skyColor,
            lightingSettings.groundColor,
            lightingSettings.hemisphereIntensity
        );
        this.scene.add(this.hemisphereLight);
    }

    /**
     * Create ground mesh with texture and height map
     */
    setupGround(terrainDataManager, tileMapper, heightMapSettings) {
        this.terrainDataManager = terrainDataManager;
        this.tileMapper = tileMapper;

        const tileMap = terrainDataManager.tileMap;
        const extendedSize = terrainDataManager.extendedSize;
        const extensionSize = terrainDataManager.extensionSize;

        // Create ground canvas
        this.groundCanvas = document.createElement('canvas');
        this.groundCanvas.width = extendedSize;
        this.groundCanvas.height = extendedSize;
        this.groundCtx = this.groundCanvas.getContext('2d');

        // Fill extension area with sprite texture pattern
        const extensionTerrainType = tileMap.extensionTerrainType || 0;

        if (tileMapper && tileMapper.layerSpriteSheets && tileMapper.layerSpriteSheets[extensionTerrainType]) {
            const fullSprite = tileMapper.layerSpriteSheets[extensionTerrainType].sprites[0];

            if (fullSprite) {
                const spriteSize = fullSprite.width;
                for (let y = 0; y < extendedSize; y += spriteSize) {
                    for (let x = 0; x < extendedSize; x += spriteSize) {
                        this.groundCtx.drawImage(fullSprite, x, y);
                    }
                }
            }
        }

        // Create ground texture
        this.groundTexture = new THREE.CanvasTexture(this.groundCanvas);
        this.groundTexture.wrapS = THREE.ClampToEdgeWrapping;
        this.groundTexture.wrapT = THREE.ClampToEdgeWrapping;
        this.groundTexture.minFilter = THREE.NearestFilter;
        this.groundTexture.magFilter = THREE.NearestFilter;
        this.groundTexture.colorSpace = THREE.SRGBColorSpace;

        // Create ground geometry with segments for height map
        const heightMapResolution = heightMapSettings?.enabled
            ? (extendedSize / (heightMapSettings.resolutionDivisor || 1))
            : 1;

        const segments = heightMapResolution || 1;
        const groundGeometry = new THREE.PlaneGeometry(
            extendedSize,
            extendedSize,
            segments,
            segments
        );

        this.groundVertices = groundGeometry.attributes.position;

        // Create ground material
        const groundMaterial = new THREE.MeshStandardMaterial({
            map: this.groundTexture,
            side: THREE.DoubleSide,
            metalness: 0.0,
            roughness: 1
        });

        // Create ground mesh
        this.ground = new THREE.Mesh(groundGeometry, groundMaterial);
        this.ground.rotation.x = -Math.PI / 2;
        this.ground.position.set(0, 0, 0);
        this.ground.receiveShadow = this.config.enableShadows;
        this.ground.castShadow = this.config.enableShadows;

        this.scene.add(this.ground);

        // Add BVH acceleration for raycasting
        if (typeof THREE_.three_MeshBVH !== 'undefined') {
            THREE.BufferGeometry.prototype.computeBoundsTree = THREE_.three_MeshBVH.computeBoundsTree;
            THREE.BufferGeometry.prototype.disposeBoundsTree = THREE_.three_MeshBVH.disposeBoundsTree;
            THREE.Mesh.prototype.raycast = THREE_.three_MeshBVH.acceleratedRaycast;
        }
    }

    /**
     * Update ground texture with terrain tiles
     */
    updateGroundTexture() {
        if (!this.tileMapper || !this.groundCtx) {
            console.warn('WorldRenderer: TileMapper or ground context not available');
            return;
        }

        const extensionSize = this.terrainDataManager.extensionSize;

        // Draw terrain data onto ground canvas
        this.groundCtx.drawImage(
            this.tileMapper.canvas,
            extensionSize,
            extensionSize
        );

        this.groundTexture.needsUpdate = true;

        // Update height map if enabled
        if (this.terrainDataManager.heightMapSettings?.enabled) {
            this.updateHeightMap();
        }
    }

    /**
     * Update height map geometry from terrain data
     */
    updateHeightMap() {
        if (!this.terrainDataManager.heightMapSettings?.enabled || !this.tileMapper.heightMapCanvas) {
            return;
        }

        try {
            const heightMapCanvas = this.tileMapper.heightMapCanvas;
            const heightMapCtx = heightMapCanvas.getContext('2d', { willReadFrequently: true });

            const heightMapImageData = heightMapCtx.getImageData(0, 0, heightMapCanvas.width, heightMapCanvas.height);
            const heightData = heightMapImageData.data;

            const extendedSize = this.terrainDataManager.extendedSize;
            const terrainSize = this.terrainDataManager.terrainSize;
            const extensionSize = this.terrainDataManager.extensionSize;
            const heightStep = this.terrainDataManager.heightStep;

            const heightMapData = new Float32Array(extendedSize * extendedSize);

            // Set extension area to extension terrain height
            const extensionTerrainType = this.terrainDataManager.tileMap.extensionTerrainType || 0;
            const extensionHeight = extensionTerrainType * heightStep;

            // Initialize all points with extension height
            for (let z = 0; z < extendedSize; z++) {
                for (let x = 0; x < extendedSize; x++) {
                    heightMapData[z * extendedSize + x] = extensionHeight;
                }
            }

            // Process the actual terrain area using height map data
            const scaleX = heightMapCanvas.width / terrainSize;
            const scaleZ = heightMapCanvas.height / terrainSize;

            for (let z = 0; z < terrainSize; z++) {
                for (let x = 0; x < terrainSize; x++) {
                    // Sample from height map
                    const heightMapX = Math.floor(x * scaleX);
                    const heightMapZ = Math.floor(z * scaleZ);

                    const pixelIndex = (heightMapZ * heightMapCanvas.width + heightMapX) * 4;
                    const heightValue = heightData[pixelIndex]; // Red channel (grayscale)

                    // Convert grayscale value back to height index
                    const heightIndex = Math.floor(heightValue / 32);
                    let height = heightIndex * heightStep;

                    // Check neighboring pixels for cliff smoothing
                    const neighborCheckDist = this.terrainDataManager.heightMapSettings.resolutionDivisor || 1;
                    const neighbors = [
                        { x: x - neighborCheckDist, z: z },
                        { x: x + neighborCheckDist, z: z },
                        { x: x, z: z - neighborCheckDist },
                        { x: x, z: z + neighborCheckDist },
                        { x: x - neighborCheckDist, z: z - neighborCheckDist },
                        { x: x + neighborCheckDist, z: z - neighborCheckDist },
                        { x: x - neighborCheckDist, z: z + neighborCheckDist },
                        { x: x + neighborCheckDist, z: z + neighborCheckDist }
                    ];

                    let lowestNeighborHeight = height;
                    for (const neighbor of neighbors) {
                        if (neighbor.x >= 0 && neighbor.x < terrainSize &&
                            neighbor.z >= 0 && neighbor.z < terrainSize) {

                            const neighborHMapX = Math.floor(neighbor.x * scaleX);
                            const neighborHMapZ = Math.floor(neighbor.z * scaleZ);
                            const neighborIndex = (neighborHMapZ * heightMapCanvas.width + neighborHMapX) * 4;
                            const neighborHeightValue = heightData[neighborIndex];
                            const neighborHeightIndex = Math.floor(neighborHeightValue / 32);
                            const neighborHeight = neighborHeightIndex * heightStep;

                            if (neighborHeight < lowestNeighborHeight) {
                                lowestNeighborHeight = neighborHeight;
                            }
                        }
                    }

                    height = lowestNeighborHeight;

                    // Set height in extended coordinate system
                    const extX = x + extensionSize;
                    const extZ = z + extensionSize;
                    heightMapData[extZ * extendedSize + extX] = height;
                }
            }

            this.applyHeightMapToGeometry(heightMapData);

        } catch (e) {
            console.warn('Failed to update height map:', e);
        }
    }

    /**
     * Apply height map data to ground geometry
     */
    applyHeightMapToGeometry(heightMapData) {
        if (!this.ground || !this.groundVertices) return;

        const positions = this.groundVertices.array;
        const geometry = this.ground.geometry;
        const heightMapSettings = this.terrainDataManager.heightMapSettings;
        const extendedSize = this.terrainDataManager.extendedSize;

        const segments = extendedSize / (heightMapSettings?.resolutionDivisor || 1);
        const verticesPerRow = segments + 1;

        // Update vertex heights
        for (let z = 0; z < verticesPerRow; z++) {
            for (let x = 0; x < verticesPerRow; x++) {
                const vertexIndex = (z * verticesPerRow + x);
                const idx = vertexIndex * 3;

                const nx = x / segments;
                const nz = z / segments;

                const terrainX = Math.floor(nx * extendedSize);
                const terrainZ = Math.floor(nz * extendedSize);

                const heightIndex = terrainZ * extendedSize + terrainX;
                const height = heightMapData[heightIndex] || 0;

                positions[idx + 2] = height;
            }
        }

        this.groundVertices.needsUpdate = true;
        geometry.computeVertexNormals();

        // Rebuild BVH tree after geometry modification
        if (geometry.boundsTree) {
            geometry.disposeBoundsTree();
        }
        if (geometry.computeBoundsTree) {
            geometry.computeBoundsTree();
        }
    }

    /**
     * Update a specific region of the height map geometry (for localized editing)
     * This is more efficient than updating the entire mesh
     * @param {number} gridX - Grid X coordinate (terrain grid)
     * @param {number} gridZ - Grid Z coordinate (terrain grid)
     * @param {number} radius - Radius in grid cells to update
     */
    updateHeightMapRegion(gridX, gridZ, radius = 1) {
        if (!this.ground || !this.groundVertices || !this.terrainDataManager.heightMapData) return;

        const positions = this.groundVertices.array;
        const geometry = this.ground.geometry;
        const heightMapSettings = this.terrainDataManager.heightMapSettings;
        const extendedSize = this.terrainDataManager.extendedSize;
        const heightMapData = this.terrainDataManager.heightMapData;
        const gridSize = this.terrainDataManager.gridSize;

        const segments = extendedSize / (heightMapSettings?.resolutionDivisor || 1);
        const verticesPerRow = segments + 1;

        // Convert grid coordinates to extended coordinates (center of the tile)
        const extensionSize = this.terrainDataManager.extensionSize;
        const centerX = gridX * gridSize + extensionSize + gridSize / 2;
        const centerZ = gridZ * gridSize + extensionSize + gridSize / 2;

        // Calculate affected vertex range (add buffer for smooth transitions)
        const updateRadius = radius * gridSize;
        const minX = Math.max(0, centerX - updateRadius);
        const maxX = Math.min(extendedSize, centerX + updateRadius);
        const minZ = Math.max(0, centerZ - updateRadius);
        const maxZ = Math.min(extendedSize, centerZ + updateRadius);

        // Update only affected vertices
        for (let z = 0; z < verticesPerRow; z++) {
            for (let x = 0; x < verticesPerRow; x++) {
                const nx = x / segments;
                const nz = z / segments;

                const terrainX = Math.floor(nx * extendedSize);
                const terrainZ = Math.floor(nz * extendedSize);

                // Skip vertices outside the update region
                if (terrainX < minX || terrainX > maxX || terrainZ < minZ || terrainZ > maxZ) {
                    continue;
                }

                const vertexIndex = (z * verticesPerRow + x);
                const idx = vertexIndex * 3;

                const heightIndex = terrainZ * extendedSize + terrainX;
                const height = heightMapData[heightIndex] || 0;

                positions[idx + 2] = height;
            }
        }

        // Mark for update
        this.groundVertices.needsUpdate = true;

        // Recompute normals only for affected region if possible
        // For now, recompute all normals (could be optimized further)
        geometry.computeVertexNormals();

        // Rebuild BVH tree for the modified region
        if (geometry.boundsTree) {
            geometry.disposeBoundsTree();
        }
        if (geometry.computeBoundsTree) {
            geometry.computeBoundsTree();
        }
    }

    /**
     * Set height at a specific grid position and update the mesh
     * @param {number} gridX - Grid X coordinate
     * @param {number} gridZ - Grid Z coordinate
     * @param {number} heightLevel - Height level (0, 1, 2, etc.)
     */
    setHeightAtGridPosition(gridX, gridZ, heightLevel) {
        if (!this.terrainDataManager.heightMapData) return;

        const gridSize = this.terrainDataManager.gridSize;
        const extensionSize = this.terrainDataManager.extensionSize;
        const extendedSize = this.terrainDataManager.extendedSize;
        const heightStep = this.terrainDataManager.heightStep;

        const height = heightLevel * heightStep;

        // Debug: log grid size
        console.log(`[WorldRenderer] setHeightAtGridPosition: gridX=${gridX}, gridZ=${gridZ}, gridSize=${gridSize}, heightLevel=${heightLevel}`);

        // Update the height map data
        // Update the entire tile (gridSize x gridSize pixels)
        const extX = gridX * gridSize + extensionSize;
        const extZ = gridZ * gridSize + extensionSize;

        // First, set the base height for all pixels
        for (let dz = 0; dz < gridSize; dz++) {
            for (let dx = 0; dx < gridSize; dx++) {
                const finalX = extX + dx;
                const finalZ = extZ + dz;

                if (finalX >= 0 && finalX < extendedSize &&
                    finalZ >= 0 && finalZ < extendedSize) {
                    const heightIndex = finalZ * extendedSize + finalX;
                    this.terrainDataManager.heightMapData[heightIndex] = height;
                }
            }
        }

        // Update the mesh in this region (radius=2 to include neighbors for smooth transitions)
        this.updateHeightMapRegion(gridX, gridZ, 2);
    }

    /**
     * Batch update multiple height changes at once (more efficient)
     * @param {Array} changes - Array of {gridX, gridZ, heightLevel}
     */
    batchUpdateHeights(changes) {
        if (!this.terrainDataManager.heightMapData || !changes || changes.length === 0) return;

        const gridSize = this.terrainDataManager.gridSize;
        const extensionSize = this.terrainDataManager.extensionSize;
        const extendedSize = this.terrainDataManager.extendedSize;
        const heightStep = this.terrainDataManager.heightStep;

        // Track min/max affected coordinates for single region update
        let minGridX = Infinity, maxGridX = -Infinity;
        let minGridZ = Infinity, maxGridZ = -Infinity;

        // Apply all height changes to the data
        changes.forEach(change => {
            const { gridX, gridZ, heightLevel } = change;
            const height = heightLevel * heightStep;

            minGridX = Math.min(minGridX, gridX);
            maxGridX = Math.max(maxGridX, gridX);
            minGridZ = Math.min(minGridZ, gridZ);
            maxGridZ = Math.max(maxGridZ, gridZ);

            // Update the entire tile (gridSize x gridSize pixels)
            const extX = gridX * gridSize + extensionSize;
            const extZ = gridZ * gridSize + extensionSize;

            // Set height for all pixels in this tile
            for (let dz = 0; dz < gridSize; dz++) {
                for (let dx = 0; dx < gridSize; dx++) {
                    const finalX = extX + dx;
                    const finalZ = extZ + dz;

                    if (finalX >= 0 && finalX < extendedSize &&
                        finalZ >= 0 && finalZ < extendedSize) {
                        const heightIndex = finalZ * extendedSize + finalX;
                        this.terrainDataManager.heightMapData[heightIndex] = height;
                    }
                }
            }
        });

        // Update mesh for the bounding box of all changes
        const centerX = Math.floor((minGridX + maxGridX) / 2);
        const centerZ = Math.floor((minGridZ + maxGridZ) / 2);
        // Calculate radius to cover all changed tiles: (span + 1) / 2
        const spanX = maxGridX - minGridX + 1;
        const spanZ = maxGridZ - minGridZ + 1;
        const radius = Math.max(spanX, spanZ) / 2;

        this.updateHeightMapRegion(centerX, centerZ, radius);
    }

    /**
     * Create extension planes for infinite terrain appearance
     */
    createExtensionPlanes() {
        const tileMap = this.terrainDataManager.tileMap;
        const extendedSize = this.terrainDataManager.extendedSize;
        const heightStep = this.terrainDataManager.heightStep;

        if (!tileMap) return;

        const extensionTerrainType = tileMap.extensionTerrainType || 0;
        const extensionDistance = 19000; // How far the planes extend
        const detailedGroundSize = extendedSize;
        const halfDetailedSize = detailedGroundSize / 2;

        // Get the sprite texture for the extension terrain type
        let extensionTexture;

        if (this.tileMapper && this.tileMapper.layerSpriteSheets && this.tileMapper.layerSpriteSheets[extensionTerrainType]) {
            const fullSprite = this.tileMapper.layerSpriteSheets[extensionTerrainType].sprites[0];

            if (fullSprite) {
                extensionTexture = new THREE.CanvasTexture(fullSprite);
                extensionTexture.wrapS = THREE.RepeatWrapping;
                extensionTexture.wrapT = THREE.RepeatWrapping;
                extensionTexture.minFilter = THREE.NearestFilter;
                extensionTexture.magFilter = THREE.NearestFilter;
            }
        }

        // Fallback to solid color if sprite not available
        if (!extensionTexture) {
            const extensionCanvas = document.createElement('canvas');
            extensionCanvas.width = 1;
            extensionCanvas.height = 1;
            const extensionCtx = extensionCanvas.getContext('2d');
            extensionCtx.fillStyle = '#333333';
            extensionCtx.fillRect(0, 0, 1, 1);

            extensionTexture = new THREE.CanvasTexture(extensionCanvas);
            extensionTexture.wrapS = THREE.RepeatWrapping;
            extensionTexture.wrapT = THREE.RepeatWrapping;
            extensionTexture.minFilter = THREE.NearestFilter;
            extensionTexture.magFilter = THREE.NearestFilter;
        }

        // Create material for extension planes
        const extensionMaterial = new THREE.MeshStandardMaterial({
            map: extensionTexture,
            side: THREE.DoubleSide,
            metalness: 0.0,
            roughness: 0.8,
            fog: false
        });

        this.extensionPlanes = [];
        const extensionHeight = extensionTerrainType * heightStep;

        // North plane (positive Z)
        const northGeometry = new THREE.PlaneGeometry(detailedGroundSize + 2 * extensionDistance, extensionDistance);
        const northPlane = new THREE.Mesh(northGeometry, extensionMaterial.clone());
        northPlane.rotation.x = -Math.PI / 2;
        northPlane.position.set(0, extensionHeight, halfDetailedSize + extensionDistance / 2);
        northPlane.receiveShadow = this.config.enableShadows;
        this.scene.add(northPlane);
        this.extensionPlanes.push(northPlane);

        // South plane (negative Z)
        const southGeometry = new THREE.PlaneGeometry(detailedGroundSize + 2 * extensionDistance, extensionDistance);
        const southPlane = new THREE.Mesh(southGeometry, extensionMaterial.clone());
        southPlane.rotation.x = -Math.PI / 2;
        southPlane.position.set(0, extensionHeight, -halfDetailedSize - extensionDistance / 2);
        southPlane.receiveShadow = this.config.enableShadows;
        this.scene.add(southPlane);
        this.extensionPlanes.push(southPlane);

        // East plane (positive X)
        const eastGeometry = new THREE.PlaneGeometry(extensionDistance, detailedGroundSize);
        const eastPlane = new THREE.Mesh(eastGeometry, extensionMaterial.clone());
        eastPlane.rotation.x = -Math.PI / 2;
        eastPlane.position.set(halfDetailedSize + extensionDistance / 2, extensionHeight, 0);
        eastPlane.receiveShadow = this.config.enableShadows;
        this.scene.add(eastPlane);
        this.extensionPlanes.push(eastPlane);

        // West plane (negative X)
        const westGeometry = new THREE.PlaneGeometry(extensionDistance, detailedGroundSize);
        const westPlane = new THREE.Mesh(westGeometry, extensionMaterial.clone());
        westPlane.rotation.x = -Math.PI / 2;
        westPlane.position.set(-halfDetailedSize - extensionDistance / 2, extensionHeight, 0);
        westPlane.receiveShadow = this.config.enableShadows;
        this.scene.add(westPlane);
        this.extensionPlanes.push(westPlane);
    }

    /**
     * Render terrain using tile mapper
     */
    renderTerrain() {
        if (!this.tileMapper || !this.terrainDataManager.tileMap?.terrainMap) {
            console.warn('WorldRenderer: No tile mapper or terrain map data');
            return;
        }

        // Draw terrain tiles
        const heightMap = this.terrainDataManager.tileMap.heightMap || null;
        this.tileMapper.draw(this.terrainDataManager.tileMap.terrainMap, heightMap);

        // Update ground texture
        this.updateGroundTexture();
    }

    /**
     * Update specific terrain tiles (localized update for performance)
     * @param {Array} modifiedTiles - Array of {x, y} grid coordinates
     */
    updateTerrainTiles(modifiedTiles) {
        if (!this.tileMapper || !this.terrainDataManager.tileMap?.terrainMap || !modifiedTiles || modifiedTiles.length === 0) {
            return;
        }

        // Redraw only the modified tiles (TileMapper.redrawTiles includes neighbors for blending)
        this.tileMapper.redrawTiles(modifiedTiles);

        // Update ground texture only for affected regions
        this.updateGroundTextureRegion(modifiedTiles);
    }

    /**
     * Update only the affected regions of the ground texture
     * @param {Array} modifiedTiles - Array of {x, y} grid coordinates
     */
    updateGroundTextureRegion(modifiedTiles) {
        if (!this.tileMapper || !this.groundCtx || !modifiedTiles || modifiedTiles.length === 0) {
            return;
        }

        const extensionSize = this.terrainDataManager.extensionSize;
        const gridSize = this.terrainDataManager.gridSize;

        // Calculate bounding box of all modified tiles
        let minX = Infinity, maxX = -Infinity;
        let minY = Infinity, maxY = -Infinity;

        modifiedTiles.forEach(tile => {
            minX = Math.min(minX, tile.x);
            maxX = Math.max(maxX, tile.x);
            minY = Math.min(minY, tile.y);
            maxY = Math.max(maxY, tile.y);
        });

        // Expand bounding box by 1 tile in each direction to account for neighbor blending
        // (redrawTiles automatically includes neighbors)
        minX = Math.max(0, minX - 1);
        maxX = Math.min(this.terrainDataManager.tileMap.terrainMap[0].length - 1, maxX + 1);
        minY = Math.max(0, minY - 1);
        maxY = Math.min(this.terrainDataManager.tileMap.terrainMap.length - 1, maxY + 1);

        // Convert grid coordinates to pixel coordinates
        const sourceX = minX * gridSize;
        const sourceY = minY * gridSize;
        const sourceWidth = (maxX - minX + 1) * gridSize;
        const sourceHeight = (maxY - minY + 1) * gridSize;

        // Copy only the affected region from tileMapper canvas to ground canvas
        this.groundCtx.drawImage(
            this.tileMapper.canvas,
            sourceX, sourceY, sourceWidth, sourceHeight,  // Source region
            extensionSize + sourceX, extensionSize + sourceY, sourceWidth, sourceHeight  // Dest region
        );

        this.groundTexture.needsUpdate = true;
    }

    /**
     * Update loop
     */
    update(deltaTime) {
        this.timer += deltaTime;

        // Update controls
        if (this.controls) {
            this.controls.update();
        }

        // Update shader uniforms
        for (const key in this.uniforms) {
            if (this.uniforms[key].time) {
                this.uniforms[key].time.value = this.timer;
            }
        }
    }

    /**
     * Render the scene
     */
    render() {
        if (!this.scene || !this.camera || !this.renderer) {
            console.warn('WorldRenderer: Missing components for rendering');
            return;
        }

        if (this.composer) {
            this.composer.render();
        } else {
            this.renderer.render(this.scene, this.camera);
        }
    }

    /**
     * Window resize handler
     */
    onWindowResize() {
        if (!this.camera || !this.renderer) return;

        const canvas = this.renderer.domElement;
        const width = canvas.clientWidth || window.innerWidth;
        const height = canvas.clientHeight || window.innerHeight;

        // Handle both PerspectiveCamera and OrthographicCamera
        if (this.camera.isPerspectiveCamera) {
            this.camera.aspect = width / height;
        } else if (this.camera.isOrthographicCamera) {
            this.camera.left = width / -2;
            this.camera.right = width / 2;
            this.camera.top = height / 2;
            this.camera.bottom = height / -2;
        }

        this.camera.updateProjectionMatrix();
        this.renderer.setSize(width, height);

        if (this.composer) {
            this.composer.setSize(width, height);
        }
    }

    /**
     * Get the ground mesh (for raycasting)
     */
    getGroundMesh() {
        return this.ground;
    }

    /**
     * Get the scene
     */
    getScene() {
        return this.scene;
    }

    /**
     * Get the camera
     */
    getCamera() {
        return this.camera;
    }

    /**
     * Get the renderer
     */
    getRenderer() {
        return this.renderer;
    }

    /**
     * Clean up all resources
     */
    dispose() {
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

        // Clean up orbit controls keyboard handlers
        if (this.controlsKeyHandlers) {
            window.removeEventListener('keydown', this.controlsKeyHandlers.handleKeyDown);
            window.removeEventListener('keyup', this.controlsKeyHandlers.handleKeyUp);
            this.controlsKeyHandlers = null;
        }

        // Remove event listeners
        window.removeEventListener('resize', this.onWindowResizeHandler);

        // Clear references
        this.groundCanvas = null;
        this.scene = null;
        this.camera = null;
        this.renderer = null;
        this.composer = null;

        this.initialized = false;
    }
}
