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
        this.gameManager = null;  // For accessing GridSystem coordinate transformations

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
        let width = canvas.clientWidth || window.innerWidth;
        let height = canvas.clientHeight || window.innerHeight;

        if (cameraSettings.fov) {
            // Perspective camera
            this.camera = new THREE.PerspectiveCamera(
                cameraSettings.fov,
                width / height,
                cameraSettings.near || 0.1,
                cameraSettings.far || 30000
            );
        } else if (cameraSettings.zoom) {
            // Orthographic camera - make frustum smaller to prevent hitting terrain when rotated
            const frustumScale = 1;  // Smaller frustum stays above terrain
      
            this.camera = new THREE.OrthographicCamera(
                (width / -2) * frustumScale,
                (width / 2) * frustumScale,
                (height / 2) * frustumScale,
                (height / -2) * frustumScale,
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
        if (enableControls && typeof THREE.OrbitControls !== 'undefined') {
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
        if (typeof THREE.OrbitControls === 'undefined') {
            console.warn('WorldRenderer: THREE.OrbitControls not found');
            return;
        }

        const lookAtPos = lookAt ? (typeof lookAt === 'string' ? JSON.parse(lookAt) : lookAt) : { x: 0, y: 0, z: 0 };

        this.controls = new THREE.OrbitControls(this.camera, this.renderer.domElement);

        // Disable built-in keyboard controls (we handle modifier keys manually)
        this.controls.enableKeys = false;
        if (this.controls.keys) {
            this.controls.keys = {}; // Clear any default key bindings
        }

        // Disable orbit rotation - we'll handle rotation manually for in-place rotation
        this.controls.enableRotate = false;

        // Use Right Click for pan only
        this.controls.mouseButtons = {
            LEFT: null,                    // Left click disabled (used for editing)
            MIDDLE: null,                  // Middle click disabled (conflicts with browser scroll)
            RIGHT: THREE.MOUSE.PAN         // Right click for panning
        };

        this.controls.target.set(lookAtPos.x, lookAtPos.y, lookAtPos.z);
        this.controls.enableDamping = true;
        this.controls.dampingFactor = 0.05;
        this.controls.screenSpacePanning = false;

        // Custom rotation variables
        this.ctrlPressed = false;
        this.shiftPressed = false;
        this.isRotating = false;
        this.lastMouseX = 0;
        this.lastMouseY = 0;
        this.cameraRotationX = 0; // Vertical rotation (pitch)
        this.cameraRotationY = 0; // Horizontal rotation (yaw)

        // Initialize rotation from camera's current orientation
        const direction = new THREE.Vector3();
        this.camera.getWorldDirection(direction);
        this.cameraRotationY = Math.atan2(direction.x, direction.z);
        this.cameraRotationX = Math.asin(-direction.y);

        // Constrain target Y position to prevent near-plane clipping through terrain
        this.controls.addEventListener('change', () => {
            if (this.controls.target.y < -100) {
                this.controls.target.y = -100;
            }
        });

        const handleKeyDown = (event) => {
            if (event.shiftKey) {
                this.shiftPressed = true;
            }

            if (event.ctrlKey || event.metaKey) {
                this.ctrlPressed = true;
            }
        };

        const handleKeyUp = (event) => {
            if (!event.shiftKey) {
                this.shiftPressed = false;
            }

            if (!event.ctrlKey && !event.metaKey) {
                this.ctrlPressed = false;
            }
        };

        const handleMouseDown = (event) => {
            if (event.button === 2 && this.ctrlPressed) { // Right click + Ctrl
                this.isRotating = true;
                this.lastMouseX = event.clientX;
                this.lastMouseY = event.clientY;
                event.preventDefault();
            }
        };

        const handleMouseMove = (event) => {
            if (this.isRotating && this.ctrlPressed) {
                const deltaX = event.clientX - this.lastMouseX;
                const deltaY = event.clientY - this.lastMouseY;

                // Update rotation angles
                this.cameraRotationY -= deltaX * 0.001; // Horizontal rotation
                this.cameraRotationX += deltaY * 0.001; // Vertical rotation

                // Clamp vertical rotation to prevent flipping
                this.cameraRotationX = Math.max(-Math.PI / 2 + 0.1, Math.min(Math.PI / 2 - 0.1, this.cameraRotationX));

                // Apply rotation to camera
                this.updateCameraRotation();

                this.lastMouseX = event.clientX;
                this.lastMouseY = event.clientY;
                event.preventDefault();
            }
        };

        const handleMouseUp = (event) => {
            if (event.button === 2) {
                this.isRotating = false;
            }
        };

        // Store event handlers for cleanup
        this.controlsKeyHandlers = { handleKeyDown, handleKeyUp };
        this.controlsMouseHandlers = { handleMouseDown, handleMouseMove, handleMouseUp };

        window.addEventListener('keydown', handleKeyDown);
        window.addEventListener('keyup', handleKeyUp);
        this.renderer.domElement.addEventListener('mousedown', handleMouseDown);
        this.renderer.domElement.addEventListener('mousemove', handleMouseMove);
        this.renderer.domElement.addEventListener('mouseup', handleMouseUp);

        this.controls.update();
    }

    /**
     * Update camera rotation in place
     */
    updateCameraRotation() {
        if (!this.camera) return;

        // Calculate look direction based on rotation angles
        const direction = new THREE.Vector3(
            Math.sin(this.cameraRotationY) * Math.cos(this.cameraRotationX),
            -Math.sin(this.cameraRotationX),
            Math.cos(this.cameraRotationY) * Math.cos(this.cameraRotationX)
        );

        // Update controls target to be in front of camera
        const lookDistance = 100;
        this.controls.target.copy(this.camera.position).add(direction.multiplyScalar(lookDistance));

        // Make camera look at the target
        this.camera.lookAt(this.controls.target);
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

        // Create ground material with flat shading for sharp terrain steps
        const groundMaterial = new THREE.MeshStandardMaterial({
            map: this.groundTexture,
            side: THREE.DoubleSide,
            metalness: 0.0,
            roughness: 1,
            flatShading: true
        });

        // Create ground mesh
        this.ground = new THREE.Mesh(groundGeometry, groundMaterial);
        this.ground.rotation.x = -Math.PI / 2;
        this.ground.position.set(0, 0, 0);
        this.ground.receiveShadow = this.config.enableShadows;
        this.ground.castShadow = this.config.enableShadows;

        this.scene.add(this.ground);

        // Add BVH acceleration for raycasting
        if (typeof THREE.THREEMeshBVH !== 'undefined') {
            THREE.BufferGeometry.prototype.computeBoundsTree = THREE.THREEMeshBVH.computeBoundsTree;
            THREE.BufferGeometry.prototype.disposeBoundsTree = THREE.THREEMeshBVH.disposeBoundsTree;
            THREE.Mesh.prototype.raycast = THREE.THREEMeshBVH.acceleratedRaycast;
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
        if (!this.terrainDataManager.heightMapSettings?.enabled) {
            return;
        }

        // Always use heightMap data from tileMap directly
        // Cliff meshes will handle visual transitions at edges
        if (!this.terrainDataManager.tileMap?.heightMap) {
            console.warn('WorldRenderer: No heightMap data available in tileMap');
            return;
        }

        this.terrainDataManager.processHeightMapFromData();
        this.applyHeightMapToGeometry(this.terrainDataManager.heightMapData);
    }

    /**
     * Apply height from heightMapData to a single vertex
     * @private
     */
    _updateVertexHeight(x, z, segments, verticesPerRow, positions, heightMapData, extendedSize) {
        const vertexIndex = (z * verticesPerRow + x);
        const idx = vertexIndex * 3;

        const nx = x / segments;
        const nz = z / segments;

        // Map vertex to exact heightmap pixel position
        // Use round to snap to nearest pixel for proper alignment
        const terrainX = Math.round(nx * (extendedSize - 1));
        const terrainZ = Math.round(nz * (extendedSize - 1));

        // Clamp to valid bounds
        const clampedX = Math.max(0, Math.min(terrainX, extendedSize - 1));
        const clampedZ = Math.max(0, Math.min(terrainZ, extendedSize - 1));

        const heightIndex = clampedZ * extendedSize + clampedX;
        let height = heightMapData[heightIndex] || 0;

        // Check for ramps at this position
        const gridSize = this.terrainDataManager.gridSize;
        const extensionSize = this.terrainDataManager.extensionSize;

        // Get grid position for this pixel
        const gridX = Math.floor((clampedX - extensionSize) / gridSize);
        const gridZ = Math.floor((clampedZ - extensionSize) / gridSize);

        // Get position within the tile (0 to 1)
        const tileX = ((clampedX - extensionSize) % gridSize) / gridSize;
        const tileZ = ((clampedZ - extensionSize) % gridSize) / gridSize;

        // Check if there's a ramp affecting this position
        let rampHeight = null;
        const heightMap = this.terrainDataManager.tileMap?.heightMap;

        if (heightMap && gridX >= 0 && gridX < heightMap[0]?.length &&
            gridZ >= 0 && gridZ < heightMap.length) {

            const currentTileHeight = heightMap[gridZ][gridX];
            const heightStep = this.terrainDataManager.heightStep;

            // Helper to create continuous ramp slope across 2 tiles
            const checkContinuousRamp = (highGridX, highGridZ, lowGridX, lowGridZ, posInRamp) => {
                const hasRamp = this.terrainDataManager.hasRampAt(highGridX, highGridZ);
                if (!hasRamp) return null;

                // Validate both tiles exist
                if (lowGridX < 0 || lowGridX >= heightMap[0]?.length ||
                    lowGridZ < 0 || lowGridZ >= heightMap.length) {
                    return null;
                }

                const highHeight = heightMap[highGridZ][highGridX];
                const lowHeight = heightMap[lowGridZ][lowGridX];

                if (lowHeight >= highHeight) return null; // Not a downward slope

                // Create ONE continuous slope spanning 2 tiles
                // posInRamp: 0 = far edge of high tile, 1 = cliff edge, 2 = far edge of low tile
                // We want the slope to extend from the high tile through the low tile
                const t = Math.max(0, Math.min(1, posInRamp / 2)); // Normalize to 0-1 over 2 tiles
                const smoothT = t * t * (3 - 2 * t); // Smoothstep

                return highHeight * heightStep * (1 - smoothT) + lowHeight * heightStep * smoothT;
            };

            // Check all 4 directions for ramps
            // For each direction, check both if current tile is high or low

            // North direction (Z-)
            if (gridZ > 0) {
                const northHeight = heightMap[gridZ - 1][gridX];
                if (currentTileHeight > northHeight) {
                    // Current tile is higher - check for north ramp on current tile
                    const pos = 1 + (1 - tileZ); // 1 at edge, 2 at far south
                    const slope = checkContinuousRamp(gridX, gridZ, gridX, gridZ - 1, pos);
                    if (slope !== null) rampHeight = slope;
                } else if (northHeight > currentTileHeight) {
                    // North tile is higher - check for south ramp on north tile extending here
                    const pos = 1 + tileZ; // 1 at edge, 2 at far south
                    const slope = checkContinuousRamp(gridX, gridZ - 1, gridX, gridZ, pos);
                    if (slope !== null) rampHeight = slope;
                }
            }

            // South direction (Z+)
            if (gridZ < heightMap.length - 1) {
                const southHeight = heightMap[gridZ + 1][gridX];
                if (currentTileHeight > southHeight) {
                    // Current tile is higher - check for south ramp on current tile
                    const pos = 1 + tileZ; // 1 at edge, 2 at far north
                    const slope = checkContinuousRamp(gridX, gridZ, gridX, gridZ + 1, pos);
                    if (slope !== null) rampHeight = slope;
                } else if (southHeight > currentTileHeight) {
                    // South tile is higher - check for north ramp on south tile extending here
                    const pos = 1 + (1 - tileZ); // 1 at edge, 2 at far north
                    const slope = checkContinuousRamp(gridX, gridZ + 1, gridX, gridZ, pos);
                    if (slope !== null) rampHeight = slope;
                }
            }

            // West direction (X-)
            if (gridX > 0) {
                const westHeight = heightMap[gridZ][gridX - 1];
                if (currentTileHeight > westHeight) {
                    // Current tile is higher - check for west ramp on current tile
                    const pos = 1 + (1 - tileX); // 1 at edge, 2 at far east
                    const slope = checkContinuousRamp(gridX, gridZ, gridX - 1, gridZ, pos);
                    if (slope !== null) rampHeight = slope;
                } else if (westHeight > currentTileHeight) {
                    // West tile is higher - check for east ramp on west tile extending here
                    const pos = 1 + tileX; // 1 at edge, 2 at far east
                    const slope = checkContinuousRamp(gridX - 1, gridZ, gridX, gridZ, pos);
                    if (slope !== null) rampHeight = slope;
                }
            }

            // East direction (X+)
            if (gridX < heightMap[0].length - 1) {
                const eastHeight = heightMap[gridZ][gridX + 1];
                if (currentTileHeight > eastHeight) {
                    // Current tile is higher - check for east ramp on current tile
                    const pos = 1 + tileX; // 1 at edge, 2 at far west
                    const slope = checkContinuousRamp(gridX, gridZ, gridX + 1, gridZ, pos);
                    if (slope !== null) rampHeight = slope;
                } else if (eastHeight > currentTileHeight) {
                    // East tile is higher - check for west ramp on east tile extending here
                    const pos = 1 + (1 - tileX); // 1 at edge, 2 at far west
                    const slope = checkContinuousRamp(gridX + 1, gridZ, gridX, gridZ, pos);
                    if (slope !== null) rampHeight = slope;
                }
            }
        }

        // If there's a ramp at this position, use the ramp height
        if (rampHeight !== null) {
            positions[idx + 2] = rampHeight;
            return;
        }

        // Otherwise, check immediate neighbors to create vertical walls instead of slopes
        // Use the lowest neighbor height to pull terrain back from cliff edges
        const neighbors = [
            { x: clampedX - 1, z: clampedZ },     // Left
            { x: clampedX + 1, z: clampedZ },     // Right
            { x: clampedX, z: clampedZ - 1 },     // Top
            { x: clampedX, z: clampedZ + 1 },     // Bottom
        ];

        for (const neighbor of neighbors) {
            if (neighbor.x >= 0 && neighbor.x < extendedSize &&
                neighbor.z >= 0 && neighbor.z < extendedSize) {
                const neighborIndex = neighbor.z * extendedSize + neighbor.x;
                const neighborHeight = heightMapData[neighborIndex] || 0;

                if (neighborHeight < height) {
                    height = neighborHeight;
                }
            }
        }

        positions[idx + 2] = height;
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

        // Update all vertex heights using shared logic
        for (let z = 0; z < verticesPerRow; z++) {
            for (let x = 0; x < verticesPerRow; x++) {
                this._updateVertexHeight(x, z, segments, verticesPerRow, positions, heightMapData, extendedSize);
            }
        }

        this.groundVertices.needsUpdate = true;

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

        // Update only affected vertices using shared logic
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

                this._updateVertexHeight(x, z, segments, verticesPerRow, positions, heightMapData, extendedSize);
            }
        }

        // Mark for update
        this.groundVertices.needsUpdate = true;

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
     * Spawn cliff entities based on terrain height analysis
     * @param {Object} entityRenderer - EntityRenderer instance
     * @param {boolean} useExtension - Whether to account for extension size (true for game, false for editor)
     */
    async spawnCliffs(entityRenderer, useExtension = false) {
        if (!this.terrainDataManager || !entityRenderer) {
            console.warn('[WorldRenderer] Cannot spawn cliffs: missing dependencies');
            return;
        }

        // Clear existing cliff entities
        entityRenderer.clearEntitiesByType('cliffs');

        // Analyze height map for cliff positions
        const cliffData = this.terrainDataManager.analyzeCliffs();

        if (cliffData.length === 0) {
            console.log('[WorldRenderer] No cliffs to spawn (no height differences)');
            return;
        }

        console.log(`[WorldRenderer] Spawning ${cliffData.length} cliffs...`);

        const heightStep = this.terrainDataManager.heightStep;

        // Use GameManager coordinate functions if available, otherwise fallback to manual calculation
        const useGameManager = this.gameManager !== null;

        if (!useGameManager) {
            console.warn('[WorldRenderer] GameManager not set, using fallback coordinate calculations');
        }

        // Spawn each cliff
        let spawnedCount = 0;
        for (const cliff of cliffData) {
            let tileWorldPos, worldPos;

            if (useGameManager) {
                // Use GridSystem coordinate transformations via gameManager
                tileWorldPos = this.gameManager.call('tileToWorld', cliff.gridX, cliff.gridZ, useExtension);
                worldPos = this.gameManager.call('applyQuadrantOffset', tileWorldPos.x, tileWorldPos.z, cliff.quadrant);
            } else {
                // Fallback: manual calculation
                const gridSize = this.terrainDataManager.gridSize;
                const terrainSize = this.terrainDataManager.tileMap.size * gridSize;

                const tileWorldX = useExtension
                    ? (cliff.gridX + this.terrainDataManager.extensionSize) * gridSize - this.terrainDataManager.extendedSize / 2 + gridSize / 2
                    : cliff.gridX * gridSize - terrainSize / 2 + gridSize / 2;
                const tileWorldZ = useExtension
                    ? (cliff.gridZ + this.terrainDataManager.extensionSize) * gridSize - this.terrainDataManager.extendedSize / 2 + gridSize / 2
                    : cliff.gridZ * gridSize - terrainSize / 2 + gridSize / 2;

                // Quadrant offsets
                const quarterGrid = gridSize / 4;
                let worldX = tileWorldX;
                let worldZ = tileWorldZ;

                switch (cliff.quadrant) {
                    case 'TL':
                        worldX -= quarterGrid;
                        worldZ -= quarterGrid;
                        break;
                    case 'TR':
                        worldX += quarterGrid;
                        worldZ -= quarterGrid;
                        break;
                    case 'BL':
                        worldX -= quarterGrid;
                        worldZ += quarterGrid;
                        break;
                    case 'BR':
                        worldX += quarterGrid;
                        worldZ += quarterGrid;
                        break;
                }

                worldPos = { x: worldX, z: worldZ };
            }

            // Cliffs sit 2 levels below tile height
            const mapHeight = this.terrainDataManager.tileMap.heightMap?.[cliff.gridZ]?.[cliff.gridX] || 0;
            const cliffBottomHeight = (mapHeight - 2) * heightStep;

            const entityId = `cliffs_${cliff.gridX}_${cliff.gridZ}_${cliff.quadrant}_${cliff.type}`;

            const spawned = await entityRenderer.spawnEntity(entityId, {
                collection: 'cliffs',
                type: cliff.type,
                position: { x: worldPos.x, y: cliffBottomHeight, z: worldPos.z },
                rotation: cliff.rotation
            });

            if (spawned) spawnedCount++;
        }

        console.log(`[WorldRenderer] Spawned ${spawnedCount}/${cliffData.length} cliffs`);
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
    getGroundTexture() {
        return this.groundTexture;
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

        // Clean up orbit controls mouse handlers
        if (this.controlsMouseHandlers && this.renderer && this.renderer.domElement) {
            this.renderer.domElement.removeEventListener('mousedown', this.controlsMouseHandlers.handleMouseDown);
            this.renderer.domElement.removeEventListener('mousemove', this.controlsMouseHandlers.handleMouseMove);
            this.renderer.domElement.removeEventListener('mouseup', this.controlsMouseHandlers.handleMouseUp);
            this.controlsMouseHandlers = null;
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
