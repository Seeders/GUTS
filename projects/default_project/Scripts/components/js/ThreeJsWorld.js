class ThreeJsWorld extends engine.Component {
    init({
        containerSelector = '#gameContainer',
        width = window.innerWidth,
        height = window.innerHeight,
        useControls = true}) {
        if (!this.game.config.configs.game.is3D) {
            return;
        }
        this.level = this.game.config.levels[this.game.state.level];
        this.world = this.game.config.worlds[this.level.world];
        this.lightingSettings = this.game.config.lightings[this.world.lighting];
        this.shadowSettings = this.game.config.shadows[this.world.shadow];
        this.fogSettings = this.game.config.fogs[this.world.fog]; 
        this.heightMapSettings = this.game.config.heightMaps[this.world.heightMap];      
        this.cameraSettings = this.game.config.cameras[this.world.camera];

        this.showStats = false;
        this.clock = new THREE.Clock();
        this.onWindowResizeHandler = this.onWindowResize.bind(this);
        this.game.heightMapConfig = this.heightMapSettings;
        this.terrainSize = 768;
        this.extensionSize = this.world.extensionSize;
        this.extendedSize = this.terrainSize + 2 * this.world.extensionSize;
        this.heightMapResolution = this.extendedSize / this.heightMapSettings.resolutionDivisor;
        this.container = document.querySelector(containerSelector) || document.body;
        this.renderer = new THREE.WebGLRenderer({ antialias: true, canvas: this.game.canvas });
        this.renderer.setSize(width, height);
        this.renderer.setPixelRatio(window.devicePixelRatio);
        this.renderer.shadowMap.enabled = this.shadowSettings.enabled;
        this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        this.uniforms = {};
        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(this.world.backgroundColor);

        if (this.fogSettings.enabled) {
            this.scene.fog = new THREE.FogExp2(this.fogSettings.color, this.fogSettings.density);
        }

        this.camera = new THREE.PerspectiveCamera(
            this.cameraSettings.fov,
            width / height,
            this.cameraSettings.near,
            this.cameraSettings.far
        );
        let cameraPos = JSON.parse(this.cameraSettings.position);

        this.camera.position.set(
            cameraPos.x,
            cameraPos.y,
            cameraPos.z
        );
        let lookAt = JSON.parse(this.cameraSettings.lookAt);
        this.camera.lookAt(
            lookAt.x,
            lookAt.y,
            lookAt.z
        );

        if (useControls) {
            this.controls = new THREE.OrbitControls(this.camera, this.renderer.domElement);
            this.controls.target.set(
                lookAt.x,
                lookAt.y,
                lookAt.z
            );
            this.controls.maxPolarAngle = Math.PI / 2.05;
            this.controls.minPolarAngle = 0.1;
            this.controls.enableDamping = true;
            this.controls.dampingFactor = 0.05;
            this.controls.update();
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
        this.directionalLight.position.set(this.extendedSize * 2, this.extendedSize * 2, this.extendedSize * 2);
        this.directionalLight.castShadow = this.shadowSettings.enabled;

        if (this.shadowSettings.enabled) {
            this.directionalLight.shadow.mapSize.width = this.shadowSettings.mapSize;
            this.directionalLight.shadow.mapSize.height = this.shadowSettings.mapSize;
            this.directionalLight.shadow.camera.near = 0.5;
            this.directionalLight.shadow.camera.far = 20000;
            this.directionalLight.shadow.bias = this.shadowSettings.bias;
            this.directionalLight.shadow.normalBias = this.shadowSettings.normalBias;
            this.directionalLight.shadow.radius = this.shadowSettings.radius;

            const d = this.extendedSize * 0.6;
            this.directionalLight.shadow.camera.left = -d;
            this.directionalLight.shadow.camera.right = d;
            this.directionalLight.shadow.camera.top = d;
            this.directionalLight.shadow.camera.bottom = -d;

            this.directionalLight.target.position.set(-this.extendedSize * 2, 0, -this.extendedSize * 2);
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
        this.tileMap = this.game.config.levels[this.game.state.level].tileMap;
        this.setupGround();
        this.generateLiquidSurfaceMesh(0);
        this.generateLiquidSurfaceMesh(1);
        if (this.showStats) {
            this.stats = new Stats();
            this.container.appendChild(this.stats.dom);
        }

        window.addEventListener('resize', this.onWindowResizeHandler);

        this.game.scene = this.scene;
        this.game.camera = this.camera;
        this.game.renderer = this.renderer;
        this.game.ground = this.ground;
        this.drawn = false;
        this.timer = 0;
    }

    setupGround() {
        this.groundCanvas = document.createElement('canvas');
        this.groundCanvas.width = this.extendedSize;
        this.groundCanvas.height = this.extendedSize;
        this.groundCtx = this.groundCanvas.getContext('2d');

        let bgColor = this.tileMap.terrainTypes[this.tileMap.extensionTerrainType].color;
        let colorToUse = bgColor.paletteColor ? this.game.palette[bgColor.paletteColor] : bgColor;
        this.groundCtx.fillStyle = colorToUse;
        this.groundCtx.fillRect(0, 0, this.extendedSize, this.extendedSize);

        this.groundTexture = new THREE.CanvasTexture(this.groundCanvas);
        this.groundTexture.wrapS = THREE.ClampToEdgeWrapping;
        this.groundTexture.wrapT = THREE.ClampToEdgeWrapping;
        this.groundTexture.minFilter = THREE.LinearFilter;
        this.groundTexture.magFilter = THREE.LinearFilter;

        if (this.heightMapSettings) {
            this.createHeightMapTerrain();
        } else {
            const groundGeometry = new THREE.PlaneGeometry(this.extendedSize, this.extendedSize);
            this.groundMaterial = this.getGroundMaterial();
            this.ground = new THREE.Mesh(groundGeometry, this.groundMaterial);
            this.ground.rotation.x = -Math.PI / 2;
            this.ground.position.set(this.terrainSize / 2, 0, this.terrainSize / 2);
            this.ground.receiveShadow = true;
            this.scene.add(this.ground);
        }
    }

    createHeightMapTerrain() {
        this.heightMapData = new Float32Array(this.extendedSize * this.extendedSize);
        this.terrainTypes = this.tileMap.terrainTypes || [];
        this.heightStep = this.heightMapSettings.heightStep;

        const segments = this.heightMapResolution;
        const groundGeometry = new THREE.PlaneGeometry(
            this.extendedSize,
            this.extendedSize,
            segments,
            segments
        );

        this.groundVertices = groundGeometry.attributes.position;

        this.groundMaterial = this.getGroundMaterial();

        this.ground = new THREE.Mesh(groundGeometry, this.groundMaterial);
        this.ground.rotation.x = -Math.PI / 2;
        this.ground.position.set(this.terrainSize / 2, 0, this.terrainSize / 2);
        this.ground.receiveShadow = true;

        this.scene.add(this.ground);
    }

    updateHeightMap() {
        if (!this.heightMapSettings.enabled || !this.game.terrainCanvasBuffer) return;

        try {
            const terrainCanvas = this.game.terrainCanvasBuffer;
            const ctx = terrainCanvas.getContext('2d');
            const terrainData = ctx.getImageData(0, 0, terrainCanvas.width, terrainCanvas.height).data;

            const terrainTypeColors = this.createTerrainTypeColorMap();

            this.heightMapData = new Float32Array(this.extendedSize * this.extendedSize);

            const extensionTerrainType = this.tileMap.extensionTerrainType;
            const extensionHeight = extensionTerrainType * this.heightStep;

            for (let z = 0; z < this.extendedSize; z++) {
                for (let x = 0; x < this.extendedSize; x++) {
                    this.heightMapData[z * this.extendedSize + x] = extensionHeight;
                }
            }

            for (let z = 0; z < this.terrainSize; z++) {
                for (let x = 0; x < this.terrainSize; x++) {
                    const pixelIndex = (z * terrainCanvas.width + x) * 4;
                    const r = terrainData[pixelIndex];
                    const g = terrainData[pixelIndex + 1];
                    const b = terrainData[pixelIndex + 2];
                    const colorKey = `${r},${g},${b}`;
            
                    const typeIndex = terrainTypeColors[colorKey];
                    let height = typeIndex !== undefined ? typeIndex * this.heightStep : extensionHeight;
            
                    // Check neighboring pixels for lower terrain types
                    let neighborCheckDist = this.heightMapSettings.resolutionDivisor;
                    const neighbors = [
                        { x: x-neighborCheckDist, z: z },   // left
                        { x: x+neighborCheckDist, z: z },   // right
                        { x: x, z: z-neighborCheckDist },   // top
                        { x: x, z: z+neighborCheckDist },   // bottom
                        { x: x-neighborCheckDist, z: z-neighborCheckDist }, // top-left
                        { x: x+neighborCheckDist, z: z-neighborCheckDist }, // top-right
                        { x: x-neighborCheckDist, z: z+neighborCheckDist }, // bottom-left
                        { x: x+neighborCheckDist, z: z+neighborCheckDist }  // bottom-right
                    ];
                    let lowestNeighborType = Infinity;
                    for (const neighbor of neighbors) {
                        if (neighbor.x >= 0 && neighbor.x < this.terrainSize && 
                            neighbor.z >= 0 && neighbor.z < this.terrainSize) {
                            
                            const neighborIndex = (neighbor.z * terrainCanvas.width + neighbor.x) * 4;
                            const nr = terrainData[neighborIndex];
                            const ng = terrainData[neighborIndex + 1];
                            const nb = terrainData[neighborIndex + 2];
                            const neighborKey = `${nr},${ng},${nb}`;
                            
                            const neighborTypeIndex = terrainTypeColors[neighborKey];
                            if (neighborTypeIndex !== undefined && neighborTypeIndex < typeIndex && neighborTypeIndex < lowestNeighborType) {
                                // If neighbor is lower terrain, use its height
                                lowestNeighborType = neighborTypeIndex;
                            }
                        }
                    }
                    if (lowestNeighborType < typeIndex) {
                        height = lowestNeighborType * this.heightStep;
                    }
            
                    const extX = x + this.extensionSize;
                    const extZ = z + this.extensionSize;
                    this.heightMapData[extZ * this.extendedSize + extX] = height;
                }
            }

            this.applyHeightMapToGeometry();

        } catch (e) {
            console.warn('Failed to update height map:', e);
        }
    }

    createTerrainTypeColorMap() {
        const colorMap = {};
        const terrainTypes = this.terrainTypes;

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

        for (let z = 0; z < verticesPerRow; z++) {
            for (let x = 0; x < verticesPerRow; x++) {
                const vertexIndex = (z * verticesPerRow + x);
                const idx = vertexIndex * 3;

                const nx = x / segments;
                const nz = z / segments;

                const terrainX = Math.floor(nx * (this.extendedSize - 1));
                const terrainZ = Math.floor(nz * (this.extendedSize - 1));

                const heightIndex = terrainZ * this.extendedSize + terrainX;
                const height = this.heightMapData[heightIndex] || 0;

                // const finalHeight = this.heightMapSettings.smoothing ?
                //     this.smoothHeight(terrainX, terrainZ) : height;

                positions[idx + 2] = height;
            }
        }

        this.groundVertices.needsUpdate = true;
        geometry.computeVertexNormals();
    }

    getGroundMaterial() {
        return new THREE.MeshStandardMaterial({
            map: this.groundTexture,
            side: THREE.DoubleSide,
            metalness: 0.0,
            roughness: 0.8
        });
    }

    onWindowResize() {
        const width = this.container.clientWidth || window.innerWidth;
        const height = this.container.clientHeight || window.innerHeight;

        this.camera.aspect = width / height;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(width, height);
    }

    update() {
        if (!this.game.config.configs.game.is3D) {
            return;
        }
        if (this.controls) {
            this.controls.update();
        }
        if (!isNaN(this.game.deltaTime)) {
            this.timer += this.game.deltaTime;
        }
        if (this.stats) {
            this.stats.update();
        }
        if (!this.drawn && this.groundTexture && this.game.mapRenderer && this.game.mapRenderer.isMapCached) {
            this.groundCtx.drawImage(this.game.terrainCanvasBuffer, this.extensionSize, this.extensionSize);
            this.groundTexture.needsUpdate = true;

            if (this.heightMapSettings.enabled) {
                this.updateHeightMap();
            }

            this.addGrassToTerrain();
            this.drawn = true;
        }
        for(const key in this.uniforms) {
            this.uniforms[key].time = { value: this.timer };            
        }
        this.renderer.render(this.scene, this.camera);
    }

    addGrassToTerrain() {
        const bladeWidth = 12;
        const bladeHeight = 18;
        const grassGeometry = this.createCurvedBladeGeometry(bladeWidth, bladeHeight);
        grassGeometry.translate(0, bladeHeight / 2, 0);
        const grassCount = 1000000;

        const phases = new Float32Array(grassCount);
        for (let i = 0; i < grassCount; i++) {
            phases[i] = Math.random() * Math.PI * 2;
        }
        grassGeometry.setAttribute('instancePhase', new THREE.InstancedBufferAttribute(phases, 1));

        const grassTexture = this.createGrassTexture();
        const grassShader = this.game.config.shaders[this.level.grassShader];
        this.uniforms['grass'] = JSON.parse(grassShader.uniforms);
        
        this.uniforms['grass'].windDirection = { value: new THREE.Vector2(this.uniforms['grass'].windDirection.value[0], this.uniforms['grass'].windDirection.value[1]).normalize()};
        this.uniforms['grass'].map = { value: grassTexture };
        const uniforms = this.uniforms['grass'];
        this.grassMaterial = new THREE.ShaderMaterial({
            vertexShader: grassShader.vertexScript,
            fragmentShader: grassShader.fragmentScript,
            uniforms: uniforms
        });

        this.grassShader = this.grassMaterial;
        const grass = new THREE.InstancedMesh(grassGeometry, this.grassMaterial, grassCount);
        grass.castShadow = true;
        grass.receiveShadow = true;

        const dummy = new THREE.Object3D();

        if (this.groundCanvas) {
            const ctx = this.groundCanvas.getContext('2d');
            try {
                const terrainData = ctx.getImageData(0, 0, this.groundCanvas.width, this.groundCanvas.height).data;
                let grassArea = this.extendedSize;
                let placedGrassCount = 0;

                for (let i = 0; i < grassCount; i++) {
                    const x = Math.floor(Math.random() * grassArea);
                    const z = Math.floor(Math.random() * grassArea);
                    const pixelIndex = (z * this.groundCanvas.width + x) * 4;
                    const r = terrainData[pixelIndex];
                    const g = terrainData[pixelIndex + 1];
                    const b = terrainData[pixelIndex + 2];

                    if (g > r && g > b ) {
                        placedGrassCount++;
                        const rotationY = Math.random() * Math.PI * 2;
                        const scale = 0.7 + Math.random() * 0.5;

                        let height = 0;
                        if (this.heightMapSettings.enabled) {
                            const terrainX = Math.min(Math.floor(x), this.extendedSize - 1);
                            const terrainZ = Math.min(Math.floor(z), this.extendedSize - 1);
                            height = this.heightMapData[terrainZ * this.extendedSize + terrainX] || 0;
                        }

                        dummy.position.set(x - grassArea / 2 + this.terrainSize / 2, height - bladeHeight, z - grassArea / 2 + this.terrainSize / 2);
                        dummy.rotation.set(0, rotationY, 0);
                        dummy.scale.set(scale, scale, scale);
                        dummy.updateMatrix();

                        grass.setMatrixAt(i, dummy.matrix);
                    }
                }

            } catch (e) {
                console.warn('Failed to get terrainCanvasBuffer data:', e);
            }
        }

        grass.instanceMatrix.needsUpdate = true;
        this.scene.add(grass);
        this.grass = grass;
    }

    onDestroy() {
        window.removeEventListener('resize', this.onWindowResizeHandler);
        this.renderer.dispose();
        if (this.stats?.dom?.parentElement) {
            this.stats.dom.parentElement.removeChild(this.stats.dom);
        }
        if (this.renderer.domElement?.parentElement) {
            this.renderer.domElement.parentElement.removeChild(this.renderer.domElement);
        }
        if (this.grass) {
            this.grass.geometry.dispose();
            this.grass.material.dispose();
        }
        this.ground.geometry?.dispose();
        this.groundMaterial?.dispose();
        this.groundTexture?.dispose();
        this.groundCanvas = null;
        this.game.scene = null;
        this.game.camera = null;
        this.game.renderer = null;
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

        for (let i = 0; i < vertexCount; i++) {
            const posIndex = i * 3;
            const uvIndex = i * 2;

            const y = positions[posIndex + 1];
            const normalizedY = y / height;

            newUVs[uvIndex] = uvs[uvIndex];
            newUVs[uvIndex + 1] = normalizedY;
        }

        shapeGeom.setAttribute('uv', new THREE.BufferAttribute(newUVs, 2));

        return shapeGeom;
    }

    createGrassTexture() {
        const canvas = document.createElement('canvas');
        canvas.width = 4;
        canvas.height = 32;
        const ctx = canvas.getContext('2d');

        const gradient = ctx.createLinearGradient(0, canvas.height, 0, 0);
        gradient.addColorStop(0.0, this.game.palette["greenDColor"]);
        gradient.addColorStop(0.8, this.game.palette["greenMColor"]);
        gradient.addColorStop(1.0, this.game.palette["redLColor"]);

        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        const texture = new THREE.CanvasTexture(canvas);
        texture.wrapS = THREE.RepeatWrapping;
        texture.wrapT = THREE.ClampToEdgeWrapping;
        texture.magFilter = THREE.LinearFilter;
        texture.minFilter = THREE.LinearFilter;
        return texture;
    }

    generateLiquidSurfaceMesh(terrainType) {
        const terrainMap = this.tileMap.terrainMap;
        const gridSize = this.game.config.configs.game.gridSize;
        const rows = terrainMap.length;
        const cols = terrainMap[0].length;
        
        // Arrays to store vertices, indices, and UVs for the BufferGeometry
        const vertices = [];
        const indices = [];
        const uvs = [];
        
        // Amount to extend the perimeter (e.g., 10% of gridSize)
        const extensionAmount = gridSize * 0.25; // Adjust as needed        
  
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
            vertices.push(x * gridSize, 0.1, z * gridSize);
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
        
            // Log the bottom-right corner for debugging
            if (ext.extendRight && ext.extendDown) {
                console.log(`Bottom-right corner at (${origX}, ${origZ}): Before extension - x: ${vertices[idx]}, z: ${vertices[idx + 2]}`);
            }
        
            if (ext.extendLeft) vertices[idx] -= extensionAmount; // Extend left
            if (ext.extendRight) vertices[idx] += extensionAmount; // Extend right
            if (ext.extendUp) vertices[idx + 2] -= extensionAmount; // Extend north (decrease z)
            if (ext.extendDown) vertices[idx + 2] += extensionAmount; // Extend south (increase z)
        
            if (ext.extendRight && ext.extendDown) {
                console.log(`Bottom-right corner at (${origX}, ${origZ}): After extension - x: ${vertices[idx]}, z: ${vertices[idx + 2]}`);
            }
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
        const waterShader = this.game.config.shaders[this.level.waterShader];
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
        waterMesh.position.y = (terrainType + 2) * this.heightMapSettings.heightStep;
        this.scene.add(waterMesh); // Assuming `this.scene` is your THREE.js scene
    }
}