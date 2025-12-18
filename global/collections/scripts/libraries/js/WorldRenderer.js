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
        this.game = config.game || null;  // For accessing game services via call()

        // Configuration
        this.config = {
            shadowsEnabled: true,
            fogEnabled: true,
            enablePostProcessing: true,
            grassEnabled: false,
            liquidsEnabledurfaces: true,
            cliffsEnabled: true,
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
        // Use parent container size if available and non-zero, otherwise window size
        const parent = canvas.parentElement;
        let width = (parent && parent.clientWidth > 0) ? parent.clientWidth : window.innerWidth;
        let height = (parent && parent.clientHeight > 0) ? parent.clientHeight : window.innerHeight;

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
        // Set internal resolution but don't override CSS styles (prevents layout conflicts)
        this.renderer.setSize(width, height, false);
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
            LEFT: null,
            MIDDLE: null,
            RIGHT: THREE.MOUSE.PAN
        };

        this.controls.target.set(lookAtPos.x, lookAtPos.y, lookAtPos.z);
        this.controls.enableDamping = false;
        this.controls.screenSpacePanning = true;
        this.controls.enableZoom = false;

        // Base pan speed - feels right at about half starting height
        const basePanSpeed = 0.25;
        const referenceHeight = 500; // Height where basePanSpeed feels right

        // Dynamically adjust pan speed based on camera height
        const updatePanSpeed = () => {
            const height = Math.max(this.camera.position.y, 10);
            this.controls.panSpeed = basePanSpeed * (height / referenceHeight);
        };

        updatePanSpeed();
        this.controls.addEventListener('change', updatePanSpeed);

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

        // Minimum height above terrain
        this.minCameraY = 10;

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

        const handleWheel = (event) => {
            // Skip if controls are disposed
            if (!this.controls) return;

            event.preventDefault();

            // Get camera's forward direction
            const direction = new THREE.Vector3();
            this.camera.getWorldDirection(direction);

            // Move camera forward/backward based on wheel delta
            const moveSpeed = 50;
            const delta = event.deltaY > 0 ? -moveSpeed : moveSpeed;

            // Check if movement would put camera under terrain
            const newY = this.camera.position.y + direction.y * delta;
            if (newY < this.minCameraY) {
                return; // Don't move if it would go under terrain
            }

            this.camera.position.addScaledVector(direction, delta);
            this.controls.target.addScaledVector(direction, delta);
        };

        // Store event handlers for cleanup
        this.controlsKeyHandlers = { handleKeyDown, handleKeyUp };
        this.controlsMouseHandlers = { handleMouseDown, handleMouseMove, handleMouseUp, handleWheel };

        window.addEventListener('keydown', handleKeyDown);
        window.addEventListener('keyup', handleKeyUp);
        this.renderer.domElement.addEventListener('mousedown', handleMouseDown);
        this.renderer.domElement.addEventListener('mousemove', handleMouseMove);
        this.renderer.domElement.addEventListener('mouseup', handleMouseUp);
        this.renderer.domElement.addEventListener('wheel', handleWheel, { passive: false });

        this.controls.update();
    }

    /**
     * Update camera rotation in place
     */
    updateCameraRotation() {
        if (!this.camera || !this.controls) return;

        // Preserve the current distance to target
        const currentDistance = this.camera.position.distanceTo(this.controls.target);

        // Calculate look direction based on rotation angles
        const direction = new THREE.Vector3(
            Math.sin(this.cameraRotationY) * Math.cos(this.cameraRotationX),
            -Math.sin(this.cameraRotationX),
            Math.cos(this.cameraRotationY) * Math.cos(this.cameraRotationX)
        );

        // Update controls target to be in front of camera at the same distance
        this.controls.target.copy(this.camera.position).add(direction.multiplyScalar(currentDistance));

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

        // Set background color to match fog color so distant objects blend into the fog
        this.scene.background = new THREE.Color(fogSettings.color);
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
        if (shadowSettings?.enabled && this.config.shadowsEnabled) {
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

        // Use MeshLambertMaterial for terrain - supports shadows and lighting natively
        const groundMaterial = new THREE.MeshLambertMaterial({
            map: this.groundTexture,
            side: THREE.DoubleSide
        });

        // Store reference
        this.groundMaterial = groundMaterial;

        // Create ground mesh
        this.ground = new THREE.Mesh(groundGeometry, groundMaterial);
        this.ground.rotation.x = -Math.PI / 2;
        this.ground.position.set(0, 0, 0);
        this.ground.receiveShadow = this.config.shadowsEnabled;
        this.ground.castShadow = this.config.shadowsEnabled;

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

        // Generate liquid surfaces for water/lava tiles
        this.generateAllLiquidSurfaces();
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
     * Generate liquid surface mesh for a specific terrain type (water, lava, etc.)
     * @param {number} terrainType - The terrain type ID to generate liquid surfaces for
     */
    generateLiquidSurfaceMesh(terrainType) {
        if (!this.config.liquidsEnabledurfaces) {
            return;
        }

        const tileMap = this.terrainDataManager?.tileMap;
        if (!tileMap || !tileMap.terrainMap) {
            console.warn('WorldRenderer: Cannot generate liquid surfaces - no terrain map available');
            return;
        }

        const terrainMap = tileMap.terrainMap;
        const heightMap = tileMap.heightMap;
        const gridSize = this.terrainDataManager.gridSize;
        const rows = terrainMap.length;
        const cols = terrainMap[0].length;

        // Arrays to store vertices, indices, and UVs for the BufferGeometry
        const vertices = [];
        const indices = [];
        const uvs = [];

        // Amount to extend the perimeter (25% of gridSize to overlap with cliff edges)
        const extensionAmount = gridSize * 0.25;

        // Helper function to check if a tile is a liquid tile of this type
        const isLiquidTile = (x, z) => {
            if (x < 0 || x >= cols || z < 0 || z >= rows) return false;
            return terrainMap[z][x] === terrainType;
        };

        // Step 1: Generate a grid of vertices, but only for positions needed by liquid tiles
        const usedPositions = new Set();
        for (let z = 0; z < rows; z++) {
            for (let x = 0; x < cols; x++) {
                if (terrainMap[z][x] === terrainType) {
                    usedPositions.add(`${x},${z}`);         // Bottom-left
                    usedPositions.add(`${x + 1},${z}`);     // Bottom-right
                    usedPositions.add(`${x + 1},${z + 1}`); // Top-right
                    usedPositions.add(`${x},${z + 1}`);     // Top-left
                }
            }
        }

        // If no tiles of this type, skip mesh generation
        if (usedPositions.size === 0) {
            return;
        }


        // Step 2: Create vertices for all used positions and store their original positions
        const positionToVertexIndex = new Map();
        const originalPositions = []; // Store original (x, z) for each vertex
        const terrainSize = cols * gridSize; // Total terrain size
        const heightStep = (heightMap && this.terrainDataManager.heightMapSettings?.enabled)
            ? (this.terrainDataManager.heightMapSettings.heightStep || 1)
            : 1;

        let vertexIndex = 0;
        for (const pos of usedPositions) {
            const [x, z] = pos.split(',').map(Number);
            positionToVertexIndex.set(pos, vertexIndex++);

            // Convert grid coordinates to world coordinates (vertex at tile corner)
            // Using CoordinateTranslator formula: tileToWorldCorner
            const worldX = x * gridSize - terrainSize / 2;
            const worldZ = z * gridSize - terrainSize / 2;

            // Calculate Y height based on the tile this vertex belongs to
            // Use the tile at (x-1, z-1) if it exists and is a liquid tile, otherwise try other adjacent tiles
            let tileHeight = 0;
            if (heightMap && this.terrainDataManager.heightMapSettings?.enabled) {
                // Try to find an adjacent liquid tile to get height from
                // Priority: bottom-left, bottom-right, top-left, top-right
                if (x > 0 && z > 0 && terrainMap[z - 1]?.[x - 1] === terrainType) {
                    tileHeight = heightMap[z - 1][x - 1];
                } else if (z > 0 && x < cols && terrainMap[z - 1]?.[x] === terrainType) {
                    tileHeight = heightMap[z - 1][x];
                } else if (x > 0 && z < rows && terrainMap[z]?.[x - 1] === terrainType) {
                    tileHeight = heightMap[z][x - 1];
                } else if (x < cols && z < rows && terrainMap[z]?.[x] === terrainType) {
                    tileHeight = heightMap[z][x];
                }
            }

            const worldY = tileHeight * heightStep + 0.5 * heightStep;

            vertices.push(worldX, worldY, worldZ);
            originalPositions.push([x, z]); // Store original grid position
            uvs.push(x, z); // UVs based on grid position
        }

        // Step 3: Generate indices for liquid tiles, connecting them into a single mesh
        for (let z = 0; z < rows; z++) {
            for (let x = 0; x < cols; x++) {
                if (terrainMap[z][x] === terrainType) {
                    const bl = positionToVertexIndex.get(`${x},${z}`);
                    const br = positionToVertexIndex.get(`${x + 1},${z}`);
                    const tr = positionToVertexIndex.get(`${x + 1},${z + 1}`);
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
                    const isLeftEdge = !isLiquidTile(x - 1, z);
                    const isRightEdge = !isLiquidTile(x + 1, z);
                    const isBottomEdge = !isLiquidTile(x, z - 1); // North
                    const isTopEdge = !isLiquidTile(x, z + 1);    // South

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

                    // Top-right vertex (x + 1, z + 1)
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

        // Step 7: Create material - use shader from collections if available
        const terrainTypeData = tileMap.terrainTypes?.[terrainType];
        const terrainTypeName = terrainTypeData?.name || terrainTypeData || '';
        const isWater = typeof terrainTypeName === 'string' && terrainTypeName.toLowerCase().includes('water');
        const isLava = typeof terrainTypeName === 'string' && terrainTypeName.toLowerCase().includes('lava');

        // Determine which shader to use based on terrain type
        // waterShader/lavaShader are on the level object, not tileMap
        const level = this.terrainDataManager?.level;
        const shaderName = isWater ? level?.waterShader : (isLava ? level?.lavaShader : null);
        const collections = this.game?.getCollections?.() || {};
        const shaderDef = shaderName && collections.shaders?.[shaderName];

        let material;

        if (shaderDef && shaderDef.fragmentScript && shaderDef.vertexScript) {
            // Build uniforms from shader definition
            const shaderUniforms = {};

            if (shaderDef.uniforms) {
                for (const [key, uniformDef] of Object.entries(shaderDef.uniforms)) {
                    // Check if this is a vector uniform
                    const isVector = shaderDef.vectors?.includes(key);
                    let value = uniformDef.value;

                    if (isVector) {
                        if (Array.isArray(value)) {
                            value = new THREE.Vector3(value[0], value[1], value[2]);
                        } else if (typeof value === 'string' && value.startsWith('#')) {
                            // Convert hex color to Vector3
                            const color = new THREE.Color(value);
                            value = new THREE.Vector3(color.r, color.g, color.b);
                        } else {
                            value = new THREE.Vector3(0, 0, 0);
                        }
                    }

                    shaderUniforms[key] = { value };
                }
            }

            // Set liquid color from terrain type color if not already set
            let color = 0x0088ff;
            if (terrainTypeData?.color) {
                color = parseInt(terrainTypeData.color.replace('#', '0x'));
            }
            const threeColor = new THREE.Color(color);

            // Helper to check if a Vector3 uniform needs to be set
            // Catches: missing value, empty string, or default black Vector3(0,0,0)
            const needsColorValue = (uniform) => {
                if (!uniform) return false;
                const val = uniform.value;
                if (!val) return true;
                if (typeof val === 'string' && val.length === 0) return true;
                if (val.isVector3 && val.x === 0 && val.y === 0 && val.z === 0) return true;
                return false;
            };

            if (needsColorValue(shaderUniforms.liquidColor)) {
                shaderUniforms.liquidColor.value = new THREE.Vector3(threeColor.r, threeColor.g, threeColor.b);
            }
            if (needsColorValue(shaderUniforms.foamColor)) {
                // Lighter version for foam
                shaderUniforms.foamColor.value = new THREE.Vector3(
                    Math.min(1, threeColor.r + 0.3),
                    Math.min(1, threeColor.g + 0.3),
                    Math.min(1, threeColor.b + 0.3)
                );
            }

            // Add fog uniforms
            shaderUniforms.fogColor = { value: this.scene?.fog?.color || new THREE.Color(0xffffff) };
            shaderUniforms.fogDensity = { value: this.scene?.fog?.density || 0.01 };

            // Load texture if specified in shader definition
            if (shaderDef.texture && this.game?.imageManager) {
                const texture = this.game.imageManager.getTexture(shaderDef.texture);
                if (texture) {
                    // Configure texture for repeating
                    texture.wrapS = THREE.RepeatWrapping;
                    texture.wrapT = THREE.RepeatWrapping;
                    // Override colorSpace to NoColorSpace (empty string) to disable
                    // sRGB→linear conversion. ShaderMaterial doesn't convert back,
                    // so we need raw texture values to match other sprites.
                    texture.colorSpace = '';
                    shaderUniforms.overlayTexture = { value: texture };
                }
            }

            material = new THREE.ShaderMaterial({
                uniforms: shaderUniforms,
                vertexShader: shaderDef.vertexScript,
                fragmentShader: shaderDef.fragmentScript,
                transparent: true,
                side: THREE.DoubleSide,
                depthWrite: true
            });
        } else {
            // Fallback to standard material
            let color = 0x0088ff;
            let opacity = 0.7;

            if (terrainTypeData) {
                if (terrainTypeData.color) {
                    color = parseInt(terrainTypeData.color.replace('#', '0x'));
                }
                if (isLava) {
                    opacity = 0.9;
                }
            }

            material = new THREE.MeshStandardMaterial({
                color: color,
                transparent: true,
                opacity: opacity,
                side: THREE.DoubleSide,
                metalness: 0.1,
                roughness: 0.3
            });
        }

        // Step 8: Create mesh (vertices already have correct Y coordinates)
        const liquidMesh = new THREE.Mesh(geometry, material);
        liquidMesh.userData.terrainType = terrainType;
        this.scene.add(liquidMesh);
        this.liquidMeshes.push(liquidMesh);

    }

    /**
     * Generate all liquid surface meshes for all liquid terrain types
     */
    generateAllLiquidSurfaces() {
        if (!this.config.liquidsEnabledurfaces) {
            return;
        }

        const tileMap = this.terrainDataManager?.tileMap;
        if (!tileMap || !tileMap.terrainTypes) {
            console.warn('WorldRenderer: No tileMap or terrainTypes available for liquid generation');
            return;
        }

        // Clear existing liquid meshes
        this.clearLiquidSurfaces();

        // Generate liquid surfaces for each terrain type that should have liquid
        let liquidTypesFound = 0;
        Object.keys(tileMap.terrainTypes).forEach(terrainTypeId => {
            const terrainTypeName = tileMap.terrainTypes[terrainTypeId];

            // Check if this terrain type should have liquid surface
            // terrainTypes is typically an array/object where the value is the terrain name string
            const isLiquid = terrainTypeName && (
                terrainTypeName.toLowerCase().includes('water') ||
                terrainTypeName.toLowerCase().includes('lava') ||
                terrainTypeName.toLowerCase().includes('liquid')
            );

            if (isLiquid) {
                liquidTypesFound++;
                this.generateLiquidSurfaceMesh(parseInt(terrainTypeId));
            }
        });

    }

    /**
     * Clear all liquid surface meshes from the scene
     */
    clearLiquidSurfaces() {
        this.liquidMeshes.forEach(mesh => {
            if (mesh.geometry) mesh.geometry.dispose();
            if (mesh.material) mesh.material.dispose();
            this.scene.remove(mesh);
        });
        this.liquidMeshes = [];
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
            const rampExtension = 0.08; // 8% extension into adjacent tiles

            // North direction (Z-)
            if (gridZ > 0) {
                const northHeight = heightMap[gridZ - 1][gridX];
                if (currentTileHeight > northHeight) {
                    // Current tile is higher - check for north ramp on current tile
                    // pos: 0 at far south (full high), 1 at north edge (cliff)
                    const pos = 1 - tileZ;
                    const slope = checkContinuousRamp(gridX, gridZ, gridX, gridZ - 1, pos);
                    if (slope !== null) rampHeight = slope;
                } else if (northHeight > currentTileHeight) {
                    // North tile is higher - check for south ramp on north tile extending here
                    // pos: 1 at south edge (cliff), 2 at far north (full low)
                    const pos = 1 + tileZ;
                    const slope = checkContinuousRamp(gridX, gridZ - 1, gridX, gridZ, pos);
                    if (slope !== null) rampHeight = slope;
                }
                // Extend north-facing ramp west: check if east neighbor has north-facing ramp (high tile)
                if (rampHeight === null && gridX < heightMap[0].length - 1 && tileX > 1 - rampExtension) {
                    const eastTileHeight = heightMap[gridZ][gridX + 1];
                    const eastNorthHeight = heightMap[gridZ - 1]?.[gridX + 1];
                    if (eastTileHeight > eastNorthHeight) {
                        const pos = 1 - tileZ;
                        const slope = checkContinuousRamp(gridX + 1, gridZ, gridX + 1, gridZ - 1, pos);
                        if (slope !== null) rampHeight = slope;
                    }
                }
            }

            // Extend north-facing ramp west for low tile
            if (gridZ < heightMap.length - 1 && rampHeight === null && gridX < heightMap[0].length - 1 && tileX > 1 - rampExtension) {
                const eastSouthHeight = heightMap[gridZ + 1]?.[gridX + 1];
                const eastSameHeight = heightMap[gridZ]?.[gridX + 1];
                if (eastSouthHeight !== undefined && eastSouthHeight > eastSameHeight) {
                    const pos = 1 + (1 - tileZ); // pos 1-2 for low tile
                    const slope = checkContinuousRamp(gridX + 1, gridZ + 1, gridX + 1, gridZ, pos);
                    if (slope !== null) rampHeight = slope;
                }
            }

            // South direction (Z+)
            if (gridZ < heightMap.length - 1) {
                const southHeight = heightMap[gridZ + 1][gridX];
                if (currentTileHeight > southHeight) {
                    // Current tile is higher - check for south ramp on current tile
                    // pos: 0 at far north (full high), 1 at south edge (cliff)
                    const pos = tileZ;
                    const slope = checkContinuousRamp(gridX, gridZ, gridX, gridZ + 1, pos);
                    if (slope !== null) rampHeight = slope;
                } else if (southHeight > currentTileHeight) {
                    // South tile is higher - check for north ramp on south tile extending here
                    // pos: 1 at north edge (cliff), 2 at south edge (full low)
                    const pos = 2 - tileZ;
                    const slope = checkContinuousRamp(gridX, gridZ + 1, gridX, gridZ, pos);
                    if (slope !== null) rampHeight = slope;
                }
                // Extend south-facing ramp east: check if west neighbor has south-facing ramp (high tile)
                if (rampHeight === null && gridX > 0 && tileX < rampExtension) {
                    const westTileHeight = heightMap[gridZ][gridX - 1];
                    const westSouthHeight = heightMap[gridZ + 1]?.[gridX - 1];
                    if (westTileHeight > westSouthHeight) {
                        const pos = tileZ;
                        const slope = checkContinuousRamp(gridX - 1, gridZ, gridX - 1, gridZ + 1, pos);
                        if (slope !== null) rampHeight = slope;
                    }
                }
                // Extend south-facing ramp west: check if east neighbor has south-facing ramp (high tile)
                if (rampHeight === null && gridX < heightMap[0].length - 1 && tileX > 1 - rampExtension) {
                    const eastTileHeight = heightMap[gridZ][gridX + 1];
                    const eastSouthHeight = heightMap[gridZ + 1]?.[gridX + 1];
                    if (eastTileHeight > eastSouthHeight) {
                        const pos = tileZ;
                        const slope = checkContinuousRamp(gridX + 1, gridZ, gridX + 1, gridZ + 1, pos);
                        if (slope !== null) rampHeight = slope;
                    }
                }
            }

            // Extend south-facing ramp east for low tile
            if (gridZ > 0 && rampHeight === null && gridX > 0 && tileX < rampExtension) {
                const westNorthHeight = heightMap[gridZ - 1]?.[gridX - 1];
                const westSameHeight = heightMap[gridZ]?.[gridX - 1];
                if (westNorthHeight !== undefined && westNorthHeight > westSameHeight) {
                    const pos = 1 + tileZ; // pos 1-2 for low tile
                    const slope = checkContinuousRamp(gridX - 1, gridZ - 1, gridX - 1, gridZ, pos);
                    if (slope !== null) rampHeight = slope;
                }
            }

            // Extend south-facing ramp west for low tile
            if (gridZ > 0 && rampHeight === null && gridX < heightMap[0].length - 1 && tileX > 1 - rampExtension) {
                const eastNorthHeight = heightMap[gridZ - 1]?.[gridX + 1];
                const eastSameHeight = heightMap[gridZ]?.[gridX + 1];
                if (eastNorthHeight !== undefined && eastNorthHeight > eastSameHeight) {
                    const pos = 1 + tileZ; // pos 1-2 for low tile
                    const slope = checkContinuousRamp(gridX + 1, gridZ - 1, gridX + 1, gridZ, pos);
                    if (slope !== null) rampHeight = slope;
                }
            }

            // West direction (X-)
            if (gridX > 0) {
                const westHeight = heightMap[gridZ][gridX - 1];
                if (currentTileHeight > westHeight) {
                    // Current tile is higher - check for west ramp on current tile
                    // pos: 0 at far east (full high), 1 at west edge (cliff)
                    const pos = 1 - tileX;
                    const slope = checkContinuousRamp(gridX, gridZ, gridX - 1, gridZ, pos);
                    if (slope !== null) rampHeight = slope;
                } else if (westHeight > currentTileHeight) {
                    // West tile is higher - check for east ramp on west tile extending here
                    // pos: 1 at east edge (cliff), 2 at far west (full low)
                    const pos = 1 + tileX;
                    const slope = checkContinuousRamp(gridX - 1, gridZ, gridX, gridZ, pos);
                    if (slope !== null) rampHeight = slope;
                }
                // Extend west-facing ramp north: check if south neighbor has west-facing ramp (high tile)
                if (rampHeight === null && gridZ < heightMap.length - 1 && tileZ > 1 - rampExtension) {
                    const southTileHeight = heightMap[gridZ + 1]?.[gridX];
                    const southWestHeight = heightMap[gridZ + 1]?.[gridX - 1];
                    if (southTileHeight > southWestHeight) {
                        const pos = 1 - tileX;
                        const slope = checkContinuousRamp(gridX, gridZ + 1, gridX - 1, gridZ + 1, pos);
                        if (slope !== null) rampHeight = slope;
                    }
                }
            }

            // Extend west-facing ramp north for low tile
            if (gridX < heightMap[0].length - 1 && rampHeight === null && gridZ < heightMap.length - 1 && tileZ > 1 - rampExtension) {
                const southEastHeight = heightMap[gridZ + 1]?.[gridX + 1];
                const southSameHeight = heightMap[gridZ + 1]?.[gridX];
                if (southEastHeight !== undefined && southEastHeight > southSameHeight) {
                    const pos = 1 + (1 - tileX); // pos 1-2 for low tile
                    const slope = checkContinuousRamp(gridX + 1, gridZ + 1, gridX, gridZ + 1, pos);
                    if (slope !== null) rampHeight = slope;
                }
            }

            // East direction (X+)
            if (gridX < heightMap[0].length - 1) {
                const eastHeight = heightMap[gridZ][gridX + 1];
                if (currentTileHeight > eastHeight) {
                    // Current tile is higher - check for east ramp on current tile
                    // pos: 0 at far west (full high), 1 at east edge (cliff)
                    const pos = tileX;
                    const slope = checkContinuousRamp(gridX, gridZ, gridX + 1, gridZ, pos);
                    if (slope !== null) rampHeight = slope;
                } else if (eastHeight > currentTileHeight) {
                    // East tile is higher - check for west ramp on east tile extending here
                    // pos: 1 at west edge (cliff), 2 at east edge (full low)
                    const pos = 2 - tileX;
                    const slope = checkContinuousRamp(gridX + 1, gridZ, gridX, gridZ, pos);
                    if (slope !== null) rampHeight = slope;
                }
                // Extend east-facing ramp south: check if north neighbor has east-facing ramp (high tile)
                if (rampHeight === null && gridZ > 0 && tileZ < rampExtension) {
                    const northTileHeight = heightMap[gridZ - 1]?.[gridX];
                    const northEastHeight = heightMap[gridZ - 1]?.[gridX + 1];
                    if (northTileHeight > northEastHeight) {
                        const pos = tileX;
                        const slope = checkContinuousRamp(gridX, gridZ - 1, gridX + 1, gridZ - 1, pos);
                        if (slope !== null) rampHeight = slope;
                    }
                }
            }

            // Extend east-facing ramp south for low tile
            if (gridX > 0 && rampHeight === null && gridZ > 0 && tileZ < rampExtension) {
                const northWestHeight = heightMap[gridZ - 1]?.[gridX - 1];
                const northSameHeight = heightMap[gridZ - 1]?.[gridX];
                if (northWestHeight !== undefined && northWestHeight > northSameHeight) {
                    const pos = 1 + tileX; // pos 1-2 for low tile
                    const slope = checkContinuousRamp(gridX - 1, gridZ - 1, gridX, gridZ - 1, pos);
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
            return;
        }


        const heightStep = this.terrainDataManager.heightStep;

        // Use game services if available, otherwise fallback to manual calculation
        const useGameManager = this.game !== null;

        if (!useGameManager) {
            console.warn('[WorldRenderer] GameManager not set, using fallback coordinate calculations');
        }

        // Spawn each cliff
        let spawnedCount = 0;
        for (const cliff of cliffData) {
            let tileWorldPos, worldPos;

            if (useGameManager) {
                // Use GridSystem coordinate transformations via gameManager
                tileWorldPos = this.game.call('tileToWorld', cliff.gridX, cliff.gridZ, useExtension);
                worldPos = this.game.call('applyQuadrantOffset', tileWorldPos.x, tileWorldPos.z, cliff.quadrant);
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

            // Get height difference (defaults to 1 for backwards compatibility)
            const heightDiff = cliff.heightDiff || 1;
            const mapHeight = this.terrainDataManager.tileMap.heightMap?.[cliff.gridZ]?.[cliff.gridX] || 0;
            const cliffOffset = 0.0001;

            // Calculate the neighbor's height (where the cliff base should sit)
            const neighborHeight = mapHeight - heightDiff;

            // Spawn cliff pieces based on height difference
            // heightDiff 1: single original cliff (current behavior)
            // heightDiff 2: top + base
            // heightDiff 3+: top + (n-2) mids + base
            // Exception: atom_three doesn't use mid pieces

            if (heightDiff === 1) {
                // Single level cliff - use original type
                // Position at the neighbor's height level
                const cliffBottomHeight = neighborHeight * heightStep;
                const entityId = `cliffs_${cliff.gridX}_${cliff.gridZ}_${cliff.quadrant}_${cliff.type}`;

                const spawned = await entityRenderer.spawnEntity(entityId, {
                    collection: 'cliffs',
                    type: cliff.type,
                    position: { x: worldPos.x, y: cliffBottomHeight, z: worldPos.z },
                    rotation: cliff.rotation
                });

                if (spawned) spawnedCount++;
            } else {
                // Multi-level cliff - spawn top, mid(s), and base
                const baseType = cliff.type;
                const needsMids = baseType !== 'atom_three' && baseType !== 'atom_three_top'; // atom_three variants don't need mid pieces

                // Spawn top piece (at the top of the cliff, one level below tile height)
                // If baseType already ends with _top, don't add it again
                const topType = baseType.endsWith('_top') ? baseType : `${baseType}_top`;
                const topHeight = (mapHeight - 1) * heightStep + cliffOffset;
                const topEntityId = `cliffs_${cliff.gridX}_${cliff.gridZ}_${cliff.quadrant}_${topType}`;

                const topSpawned = await entityRenderer.spawnEntity(topEntityId, {
                    collection: 'cliffs',
                    type: topType,
                    position: { x: worldPos.x, y: topHeight, z: worldPos.z },
                    rotation: cliff.rotation
                });
                if (topSpawned) spawnedCount++;

                // Spawn mid pieces for each level between top and base (if needed)
                if (needsMids && heightDiff > 2) {
                    for (let level = 1; level < heightDiff - 1; level++) {
                        const midHeight = (mapHeight - 1 - level) * heightStep + cliffOffset;
                        const midEntityId = `cliffs_${cliff.gridX}_${cliff.gridZ}_${cliff.quadrant}_${baseType}_mid_${level}`;

                        const midSpawned = await entityRenderer.spawnEntity(midEntityId, {
                            collection: 'cliffs',
                            type: `${baseType}_mid`,
                            position: { x: worldPos.x, y: midHeight, z: worldPos.z },
                            rotation: cliff.rotation
                        });
                        if (midSpawned) spawnedCount++;
                    }
                }

                // Spawn base piece at the neighbor's height level
                // Skip base for atom_three_top - it's a top-only cliff type used near ramps
                if (!baseType.endsWith('_top')) {
                    const baseHeight = neighborHeight * heightStep + cliffOffset;
                    const baseEntityId = `cliffs_${cliff.gridX}_${cliff.gridZ}_${cliff.quadrant}_${baseType}_base`;

                    const baseSpawned = await entityRenderer.spawnEntity(baseEntityId, {
                        collection: 'cliffs',
                        type: `${baseType}_base`,
                        position: { x: worldPos.x, y: baseHeight, z: worldPos.z },
                        rotation: cliff.rotation
                    });
                    if (baseSpawned) spawnedCount++;
                }
            }
        }

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
            fog: true
        });

        this.extensionPlanes = [];
        const extensionHeight = extensionTerrainType * heightStep;

        // North plane (positive Z)
        const northGeometry = new THREE.PlaneGeometry(detailedGroundSize + 2 * extensionDistance, extensionDistance);
        const northPlane = new THREE.Mesh(northGeometry, extensionMaterial.clone());
        northPlane.rotation.x = -Math.PI / 2;
        northPlane.position.set(0, extensionHeight, halfDetailedSize + extensionDistance / 2);
        northPlane.receiveShadow = this.config.shadowsEnabled;
        this.scene.add(northPlane);
        this.extensionPlanes.push(northPlane);

        // South plane (negative Z)
        const southGeometry = new THREE.PlaneGeometry(detailedGroundSize + 2 * extensionDistance, extensionDistance);
        const southPlane = new THREE.Mesh(southGeometry, extensionMaterial.clone());
        southPlane.rotation.x = -Math.PI / 2;
        southPlane.position.set(0, extensionHeight, -halfDetailedSize - extensionDistance / 2);
        southPlane.receiveShadow = this.config.shadowsEnabled;
        this.scene.add(southPlane);
        this.extensionPlanes.push(southPlane);

        // East plane (positive X)
        const eastGeometry = new THREE.PlaneGeometry(extensionDistance, detailedGroundSize);
        const eastPlane = new THREE.Mesh(eastGeometry, extensionMaterial.clone());
        eastPlane.rotation.x = -Math.PI / 2;
        eastPlane.position.set(halfDetailedSize + extensionDistance / 2, extensionHeight, 0);
        eastPlane.receiveShadow = this.config.shadowsEnabled;
        this.scene.add(eastPlane);
        this.extensionPlanes.push(eastPlane);

        // West plane (negative X)
        const westGeometry = new THREE.PlaneGeometry(extensionDistance, detailedGroundSize);
        const westPlane = new THREE.Mesh(westGeometry, extensionMaterial.clone());
        westPlane.rotation.x = -Math.PI / 2;
        westPlane.position.set(-halfDetailedSize - extensionDistance / 2, extensionHeight, 0);
        westPlane.receiveShadow = this.config.shadowsEnabled;
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

        // Pass ramps data to tileMapper for cliff texture suppression
        const ramps = this.terrainDataManager.tileMap.ramps || [];
        this.tileMapper.setRamps(ramps);

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

        // Regenerate liquid surfaces to reflect terrain changes
        this.generateAllLiquidSurfaces();
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
     * Update liquid surface shader uniforms (for animation)
     */
    updateLiquidShaders() {
        if (this.liquidMeshes.length === 0) return;

        // Update timer
        this.timer += this.clock.getDelta();

        // Update time uniform for each liquid mesh
        this.liquidMeshes.forEach(mesh => {
            if (mesh.material && mesh.material.uniforms && mesh.material.uniforms.time) {
                mesh.material.uniforms.time.value = this.timer;
            }
        });
    }

    /**
     * Render the scene
     */
    render() {
        if (!this.scene || !this.camera || !this.renderer) {
            console.warn('WorldRenderer: Missing components for rendering');
            return;
        }

        // Update liquid shader time uniforms
        this.updateLiquidShaders();

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
        // Use parent container size if available and non-zero, otherwise window size
        // Don't use canvas.clientWidth as it can cause shrinking feedback loops
        const parent = canvas.parentElement;
        const width = (parent && parent.clientWidth > 0) ? parent.clientWidth : window.innerWidth;
        const height = (parent && parent.clientHeight > 0) ? parent.clientHeight : window.innerHeight;

        // Skip resize if dimensions are still zero or invalid (prevents WebGL framebuffer errors)
        if (width <= 0 || height <= 0) return;

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
        // Set internal resolution but don't override CSS styles (prevents layout conflicts)
        this.renderer.setSize(width, height, false);

        if (this.composer) {
            this.composer.setSize(width, height);
        }
    }

    /**
     * Set the ambient light color for liquid shaders (water, lava with custom animation shaders)
     * Note: Terrain now uses MeshLambertMaterial which responds to scene lights automatically
     * @param {THREE.Color|number|string} color - The ambient light color
     * @param {number} intensity - The ambient light intensity (multiplied with color)
     */
    setAmbientLightColor(color, intensity = 1.0) {
        const lightColor = new THREE.Color(color);
        lightColor.multiplyScalar(intensity);

        // Update liquid surface materials (water, lava use custom shaders for animation)
        for (const mesh of this.liquidMeshes) {
            if (mesh.material?.uniforms?.ambientLightColor) {
                mesh.material.uniforms.ambientLightColor.value.set(lightColor.r, lightColor.g, lightColor.b);
            }
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
