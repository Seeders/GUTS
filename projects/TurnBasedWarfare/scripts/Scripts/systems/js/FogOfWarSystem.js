class FogOfWarSystem extends engine.BaseSystem {
    constructor(game) {
        super(game);
        this.game.fogOfWarSystem = this;
        this.componentTypes = this.game.componentManager.getComponentTypes();

        this.VISION_RADIUS = 500;
        this.WORLD_SIZE = this.game.worldSystem.extendedSize;
        this.FOG_TEXTURE_SIZE = 64;

        // Line of sight settings (optimized)
        this.LOS_ENABLED = true; // Start disabled for testing
        this.LOS_RAYS_PER_UNIT = 32; // Reduced from 64
        this.LOS_SAMPLE_DISTANCE = 12; // Increased from 25 (fewer samples)
        this.LOS_UNIT_BLOCKING_ENABLED = true;
        this.LOS_UNIT_HEIGHT = 25;
        this.LOS_UNIT_BLOCK_RADIUS = 25;

        // Spatial grid for fast unit queries
        this.spatialGridSize = 100;
        this.spatialGrid = new Map();

        this.fogRenderTarget = null;
        this.explorationRenderTarget = null;
        this.explorationRenderTargetPingPong = null;
        this.fogScene = null;
        this.fogCamera = null;
        this.fogPass = null;

        // Reusable pools
        this.circlePool = [];
        this.circleGeometry = null;
        this.circleMaterial = null;
        
        // LOS mesh pool with geometry reuse
        this.losGeometryPool = [];
        this.losMeshPool = [];
        this.losMaterial = null;
        
        this.accumulationMaterial = null;
        this.accumulationQuad = null;
        this.accumulationScene = null;
        this.accumulationCamera = null;
        
        this.cachedVisibilityBuffer = new Uint8Array(this.FOG_TEXTURE_SIZE * this.FOG_TEXTURE_SIZE);
        this.cachedExplorationBuffer = new Uint8Array(this.FOG_TEXTURE_SIZE * this.FOG_TEXTURE_SIZE);
        this.visibilityCacheValid = false;
        this.explorationCacheValid = false;
        this.isVisibleAtCount = 0;
        this.isExploredAtCount = 0;
        
        // Pre-allocate reusable arrays
        this.tempVisiblePoints = new Array(this.LOS_RAYS_PER_UNIT);
        for (let i = 0; i < this.LOS_RAYS_PER_UNIT; i++) {
            this.tempVisiblePoints[i] = { x: 0, z: 0 };
        }
        
        // Performance tracking
        this.frameStats = {
            losChecks: 0,
            terrainSamples: 0,
            unitChecks: 0
        };
    }

    init(params = {}) {
        this.params = params;
        
        this.fogRenderTarget = new THREE.WebGLRenderTarget(
            this.FOG_TEXTURE_SIZE,
            this.FOG_TEXTURE_SIZE,
            {
                minFilter: THREE.LinearFilter,
                magFilter: THREE.LinearFilter,
                format: THREE.RedFormat
            }
        );
        
        this.explorationRenderTarget = new THREE.WebGLRenderTarget(
            this.FOG_TEXTURE_SIZE,
            this.FOG_TEXTURE_SIZE,
            {
                minFilter: THREE.LinearFilter,
                magFilter: THREE.LinearFilter,
                format: THREE.RedFormat
            }
        );
        
        this.explorationRenderTargetPingPong = new THREE.WebGLRenderTarget(
            this.FOG_TEXTURE_SIZE,
            this.FOG_TEXTURE_SIZE,
            {
                minFilter: THREE.LinearFilter,
                magFilter: THREE.LinearFilter,
                format: THREE.RedFormat
            }
        );
        
        const halfSize = this.WORLD_SIZE / 2;
        this.fogCamera = new THREE.OrthographicCamera(
            -halfSize, halfSize,
            halfSize, -halfSize,
            0.1, 1000
        );
        this.fogCamera.position.set(0, 500, 0);
        this.fogCamera.lookAt(0, 0, 0);
        this.fogScene = new THREE.Scene();
        this.fogScene.background = new THREE.Color(0x000000);
        
        this.circleTexture = this.createGradientCircleTexture();
        
        this.circleGeometry = new THREE.CircleGeometry(1, 32);
        this.circleMaterial = new THREE.MeshBasicMaterial({
            map: this.circleTexture,
            transparent: true,
            side: THREE.DoubleSide,
            depthWrite: false
        });
        
        this.losMaterial = new THREE.MeshBasicMaterial({
            color: 0xffffff,
            transparent: true,
            opacity: 1.0,
            side: THREE.DoubleSide,
            depthWrite: false
        });
        
        this.accumulationMaterial = new THREE.ShaderMaterial({
            uniforms: {
                currentExploration: { value: null },
                newVisibility: { value: null }
            },
            vertexShader: `
                varying vec2 vUv;
                void main() {
                    vUv = uv;
                    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
                }
            `,
            fragmentShader: `
                uniform sampler2D currentExploration;
                uniform sampler2D newVisibility;
                varying vec2 vUv;
                
                void main() {
                    float explored = texture2D(currentExploration, vUv).r;
                    float visible = texture2D(newVisibility, vUv).r;
                    float newExploration = max(explored, visible);
                    gl_FragColor = vec4(newExploration, newExploration, newExploration, 1.0);
                }
            `
        });
        
        this.accumulationQuad = new THREE.Mesh(
            new THREE.PlaneGeometry(2, 2),
            this.accumulationMaterial
        );
        this.accumulationScene = new THREE.Scene();
        this.accumulationScene.add(this.accumulationQuad);
        this.accumulationCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
        
        console.log('[FogOfWarSystem] Optimized GPU fog with LOS initialized');
    }

    postAllInit() {
        if (this.game.postProcessingSystem) {
            this.createFogPass();
            this.game.postProcessingSystem.registerPass('fog', {
                enabled: true,
                pass: this.fogPass
            });
        }
    }

    update() {
        this.isVisibleAtCount = 0;
        this.isExploredAtCount = 0;
        
        // Reset frame stats
        this.frameStats.losChecks = 0;
        this.frameStats.terrainSamples = 0;
        this.frameStats.unitChecks = 0;
        
        // Update spatial grid for unit blocking
        if (this.LOS_UNIT_BLOCKING_ENABLED) {
            this.updateSpatialGrid();
        }
    }

    /**
     * Build spatial grid for fast unit proximity queries
     */
    updateSpatialGrid() {
        this.spatialGrid.clear();
        
        // Get all units (with HEALTH component)
        const allUnits = this.game.getEntitiesWith(
            this.componentTypes.POSITION,
            this.componentTypes.UNIT_TYPE
        );
        
        allUnits.forEach(entityId => {
            const pos = this.game.getComponent(entityId, this.componentTypes.POSITION);
            const unitType = this.game.getComponent(entityId, this.componentTypes.UNIT_TYPE);
            if (!pos) return;
            
            const gridX = Math.floor(pos.x / this.spatialGridSize);
            const gridZ = Math.floor(pos.z / this.spatialGridSize);
            const key = `${gridX},${gridZ}`;
            
            if (!this.spatialGrid.has(key)) {
                this.spatialGrid.set(key, []);
            }
            
            this.spatialGrid.get(key).push({
                x: pos.x,
                z: pos.z,
                y: pos.y,
                id: entityId,
                ...unitType
            });
        });
        
        

    }

    /**
     * Get nearby units using spatial grid (much faster than checking all units)
     */
    getNearbyUnits(x, z, radius) {
        const nearbyUnits = [];
        const gridRadius = Math.ceil(radius / this.spatialGridSize);
        const centerGridX = Math.floor(x / this.spatialGridSize);
        const centerGridZ = Math.floor(z / this.spatialGridSize);
        
        for (let gz = -gridRadius; gz <= gridRadius; gz++) {
            for (let gx = -gridRadius; gx <= gridRadius; gx++) {
                const key = `${centerGridX + gx},${centerGridZ + gz}`;
                const units = this.spatialGrid.get(key);
                if (units) {
                    nearbyUnits.push(...units);
                }
            }
        }
        
        return nearbyUnits;
    }

    /**
     * Optimized LOS check using tile-based terrain checking
     */
    hasLineOfSight(from, to, unitType, viewerEntityId = null) {
        if (!this.LOS_ENABLED) return true;
        
        const dx = to.x - from.x;
        const dz = to.z - from.z;
        const distanceSq = dx * dx + dz * dz;
        const distance = Math.sqrt(distanceSq);
        const gridSize = this.game.getCollections().configs.game.gridSize;
        
        if (distance < gridSize*2) return true;
        
        this.frameStats.losChecks++;
        
        const terrainSystem = this.game.terrainSystem;
        if (!terrainSystem) {
            console.warn('[FogOfWar] No terrain system found!');
            return true;
        }
        
        // Get terrain heights at endpoints
        const fromTerrainHeight = terrainSystem.getTerrainHeightAtPositionSmooth(from.x, from.z);
        const toTerrainHeight = terrainSystem.getTerrainHeightAtPositionSmooth(to.x, to.z);
        
        // Eye level heights
        const fromEyeHeight = fromTerrainHeight + unitType.height;
        const toEyeHeight = toTerrainHeight + unitType.height;
        
        // Check tile-based terrain blocking using Bresenham's algorithm
        if (!this.checkTileBasedLOS(from, to, fromEyeHeight, toTerrainHeight)) {
            return false;
        }
        if(fromTerrainHeight > toTerrainHeight){
            return true;
        }
        // Get nearby units for blocking check
        let nearbyUnits = [];
        if (this.LOS_UNIT_BLOCKING_ENABLED) {
            const midX = (from.x + to.x) / 2;
            const midZ = (from.z + to.z) / 2;
            nearbyUnits = this.getNearbyUnits(midX, midZ, distance / 2 + unitType.size);
            nearbyUnits = nearbyUnits.filter(u => u.id !== viewerEntityId);
        }
        
        // Check unit/tree blocking (still use ray sampling for this)
        if (this.LOS_UNIT_BLOCKING_ENABLED && nearbyUnits.length > 0) {
            const numSamples = Math.max(2, Math.ceil(distance / this.LOS_SAMPLE_DISTANCE));
            const stepX = dx / numSamples;
            const stepZ = dz / numSamples;
            
            for (let i = 1; i < numSamples; i++) {
                const t = i / numSamples;
                const sampleX = from.x + stepX * i;
                const sampleZ = from.z + stepZ * i;
                const rayHeight = fromEyeHeight + (toEyeHeight - fromEyeHeight) * t;
                
                for (const unit of nearbyUnits) {
                    this.frameStats.unitChecks++;
                    
                    const dx = sampleX - unit.x;
                    const dz = sampleZ - unit.z;
                    const distSq = dx * dx + dz * dz;
                    
                    if (distSq < this.LOS_UNIT_BLOCK_RADIUS * this.LOS_UNIT_BLOCK_RADIUS) {            
                        if (rayHeight < unit.y+unit.height) {
                            return false;
                        }
                    }
                }
            }
        }
        
        return true;
    }

    /**
     * Check LOS using tile-based terrain with Bresenham's line algorithm
     * Much faster than raycasting terrain heights!
     */
    checkTileBasedLOS(from, to, fromEyeHeight, toTerrainHeight) {
        if(fromEyeHeight < toTerrainHeight){
            return false;
        }
        const terrainSystem = this.game.terrainSystem;
        const gridSize = this.game.getCollections().configs.game.gridSize;
        
        // Convert WORLD to GRID
        const fromGridX = Math.floor((from.x + terrainSystem.terrainSize / 2) / gridSize);
        const fromGridZ = Math.floor((from.z + terrainSystem.terrainSize / 2) / gridSize);
        const toGridX = Math.floor((to.x + terrainSystem.terrainSize / 2) / gridSize);
        const toGridZ = Math.floor((to.z + terrainSystem.terrainSize / 2) / gridSize);
        
        const tiles = this.bresenhamLine(fromGridX, fromGridZ, toGridX, toGridZ);
        
        for (let i = 1; i < tiles.length - 1; i++) {
            const tile = tiles[i];
            const t = i / (tiles.length - 1);
            
            // ✅ CONVERT GRID BACK TO WORLD (center of tile)
            const worldX = tile.x * gridSize - terrainSystem.terrainSize / 2;
            const worldZ = tile.z * gridSize - terrainSystem.terrainSize / 2;
            
            // ✅ Ray height (interpolated)
            const rayHeight = fromEyeHeight + (toTerrainHeight - fromEyeHeight) * t;
            
            // ✅ REAL terrain height at WORLD position
            const terrainHeight = terrainSystem.getTerrainHeightAtPositionSmooth(worldX, worldZ);
            
            this.frameStats.terrainSamples++;
            
            // ✅ Block if ray below terrain
            if (rayHeight <= terrainHeight) {  
                return false;
            }
        }
        
        return true;
    }

    /**
     * Bresenham's line algorithm - returns all grid tiles along a line
     */
    bresenhamLine(x0, z0, x1, z1) {
        const tiles = [];
        
        const dx = Math.abs(x1 - x0);
        const dz = Math.abs(z1 - z0);
        const sx = x0 < x1 ? 1 : -1;
        const sz = z0 < z1 ? 1 : -1;
        let err = dx - dz;
        
        let x = x0;
        let z = z0;
        
        while (true) {
            tiles.push({ x, z });
            
            if (x === x1 && z === z1) break;
            
            const e2 = 2 * err;
            if (e2 > -dz) {
                err -= dz;
                x += sx;
            }
            if (e2 < dx) {
                err += dx;
                z += sz;
            }
        }
        
        return tiles;
    }

    /**
     * Generate visibility shape with optimizations
     */
    generateLOSVisibilityShape(unitPos, visionRadius, unitType, entityId) {
        const angleStep = (Math.PI * 2) / this.LOS_RAYS_PER_UNIT;
        
        // Get terrain height once

        for (let i = 0; i < this.LOS_RAYS_PER_UNIT; i++) {
            const angle = i * angleStep;
            const dirX = Math.cos(angle);
            const dirZ = Math.sin(angle);
            
            // Binary search with reduced iterations (4 instead of 6)
            let minDist = 0;
            let maxDist = visionRadius;
            let visibleDist = visionRadius;
            
            // First check max distance
            const maxX = unitPos.x + dirX * visionRadius;
            const maxZ = unitPos.z + dirZ * visionRadius;
            
            if (!this.hasLineOfSight(
                { x: unitPos.x, z: unitPos.z },
                { x: maxX, z: maxZ },
                unitType,
                entityId
            )) {
                // Binary search with 4 iterations (instead of 6)
                for (let iter = 0; iter < 4; iter++) {
                    const midDist = (minDist + maxDist) / 2;
                    const midX = unitPos.x + dirX * midDist;
                    const midZ = unitPos.z + dirZ * midDist;
                    
                    if (this.hasLineOfSight(
                        { x: unitPos.x, z: unitPos.z },
                        { x: midX, z: midZ },
                        unitType,
                        entityId
                    )) {
                        minDist = midDist;
                    } else {
                        maxDist = midDist;
                    }
                }
                visibleDist = minDist;
            }
            
            // Reuse pre-allocated point objects
            this.tempVisiblePoints[i].x = unitPos.x + dirX * visibleDist;
            this.tempVisiblePoints[i].z = unitPos.z + dirZ * visibleDist;
        }
        
        return this.tempVisiblePoints;
    }

    /**
     * Create/update mesh from visibility points with geometry reuse
     */
    updateVisibilityMesh(points, meshIndex) {
        if (points.length < 3) return null;
        
        const vertexCount = points.length * 3 * 3; // triangles * 3 vertices * 3 coords
        
        // Try to reuse existing geometry
        let geometry;
        if (meshIndex < this.losGeometryPool.length) {
            geometry = this.losGeometryPool[meshIndex];
            // Resize if needed
            const currentSize = geometry.attributes.position?.array.length || 0;
            if (currentSize !== vertexCount) {
                geometry.dispose();
                geometry = new THREE.BufferGeometry();
                this.losGeometryPool[meshIndex] = geometry;
            }
        } else {
            geometry = new THREE.BufferGeometry();
            this.losGeometryPool.push(geometry);
        }
        
        // Calculate center
        let centerX = 0, centerZ = 0;
        for (let i = 0; i < points.length; i++) {
            centerX += points[i].x;
            centerZ += points[i].z;
        }
        centerX /= points.length;
        centerZ /= points.length;
        
        // Create or update vertex buffer
        let vertices;
        if (geometry.attributes.position) {
            vertices = geometry.attributes.position.array;
            // Expand array if needed
            if (vertices.length !== vertexCount) {
                vertices = new Float32Array(vertexCount);
            }
        } else {
            vertices = new Float32Array(vertexCount);
        }
        
        // Fill vertices (triangle fan from center)
        // The fog camera looks down from Y=500, so we create a flat mesh in XZ plane at Y=0
        let vertIdx = 0;
        for (let i = 0; i < points.length; i++) {
            const nextI = (i + 1) % points.length;
            
            // Center point
            vertices[vertIdx++] = centerX;
            vertices[vertIdx++] = 0;
            vertices[vertIdx++] = centerZ;
            
            // Current point
            vertices[vertIdx++] = points[i].x;
            vertices[vertIdx++] = 0;
            vertices[vertIdx++] = points[i].z;
            
            // Next point
            vertices[vertIdx++] = points[nextI].x;
            vertices[vertIdx++] = 0;
            vertices[vertIdx++] = points[nextI].z;
        }
        
        if (!geometry.attributes.position || geometry.attributes.position.array !== vertices) {
            geometry.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
        }
        geometry.attributes.position.needsUpdate = true;
        geometry.computeBoundingSphere();
        
        // Reuse or create mesh
        let mesh;
        if (meshIndex < this.losMeshPool.length) {
            mesh = this.losMeshPool[meshIndex];
            if (mesh.geometry !== geometry) {
                mesh.geometry = geometry;
            }
        } else {
            mesh = new THREE.Mesh(geometry, this.losMaterial);
            this.losMeshPool.push(mesh);
            this.fogScene.add(mesh);
        }
        
        // Position mesh at origin (vertices are already in world space)
        mesh.position.set(0, 0, 0);
        mesh.rotation.set(0, 0, 0);
        mesh.scale.set(1, 1, 1);
        mesh.visible = true;
        
        return mesh;
    }

    createFogPass() {
        this.fogPass = {
            enabled: true,
            needsSwap: true,
            clear: false,
                                    
            uniforms: {
                tDiffuse: { value: null },
                tDepth: { value: null },
                fogTexture: { value: this.fogRenderTarget.texture },
                explorationTexture: { value: this.explorationRenderTarget.texture },
                worldSize: { value: this.WORLD_SIZE },
                cameraNear: { value: 1 },
                cameraFar: { value: 100 },
                cameraWorldMatrix: { value: new THREE.Matrix4() },
                cameraProjectionMatrixInv: { value: new THREE.Matrix4() }
            },
            
            material: null,
            fsQuad: null,
            fsQuadScene: null,
            fsQuadCamera: null
        };

        this.fogPass.material = new THREE.ShaderMaterial({
            uniforms: this.fogPass.uniforms,
            vertexShader: `
                varying vec2 vUv;
                void main() {
                    vUv = uv;
                    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
                }
            `,
            fragmentShader: `
                uniform sampler2D tDiffuse;
                uniform sampler2D tDepth;
                uniform sampler2D fogTexture;
                uniform sampler2D explorationTexture;
                uniform float worldSize;
                uniform float cameraNear;
                uniform float cameraFar;
                uniform mat4 cameraWorldMatrix;
                uniform mat4 cameraProjectionMatrixInv;

                varying vec2 vUv;
                
                float readDepth(vec2 coord) {
                    return texture2D(tDepth, coord).x;
                }
                
                vec3 getWorldPosition(vec2 uv, float depth) {
                    float x = uv.x * 2.0 - 1.0;
                    float y = uv.y * 2.0 - 1.0;
                    float z = depth * 2.0 - 1.0;
                    
                    vec4 clipPos = vec4(x, y, z, 1.0);
                    vec4 viewPos = cameraProjectionMatrixInv * clipPos;
                    viewPos /= viewPos.w;
                    vec4 worldPos = cameraWorldMatrix * viewPos;
                    
                    return worldPos.xyz;
                }

                void main() {
                    vec4 sceneColor = texture2D(tDiffuse, vUv);
                    float unexploredIntensity = 0.025;
                    float exploredIntensity = 0.2;
                    
                    float depth = readDepth(vUv);
                    vec3 worldPos = getWorldPosition(vUv, depth);
                    
                    float halfSize = worldSize * 0.5;
                    vec2 fogUV = vec2(
                        (worldPos.x + halfSize) / worldSize,
                        (-worldPos.z + halfSize) / worldSize
                    );
                    
                    vec3 grayscale = vec3(dot(sceneColor.rgb, vec3(0.299, 0.587, 0.114)));
                    
                    float inset = 1e-4;
                    if (fogUV.x < inset || fogUV.x > 1.0 - inset ||
                        fogUV.y < inset || fogUV.y > 1.0 - inset) {
                        gl_FragColor = vec4(grayscale * unexploredIntensity, 1.0);
                        return;
                    }
                    
                    vec4 fogSample = texture2D(fogTexture, fogUV);
                    float visibleGradient = fogSample.r;
                    
                    vec4 explorationSample = texture2D(explorationTexture, fogUV);
                    float explorationGradient = explorationSample.r;
                    
                    vec3 exploredColor = sceneColor.rgb * exploredIntensity;
                    vec3 visibleColor = mix(exploredColor, sceneColor.rgb, visibleGradient);
                    vec3 finalColor = mix(grayscale * unexploredIntensity, visibleColor, explorationGradient);
                    
                    gl_FragColor = vec4(finalColor, 1.0);
                }
            `
        });
        
        const geometry = new THREE.PlaneGeometry(2, 2);
        const mesh = new THREE.Mesh(geometry, this.fogPass.material);
        const scene = new THREE.Scene();
        scene.add(mesh);
        const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
        
        this.fogPass.fsQuadScene = scene;
        this.fogPass.fsQuadCamera = camera;
        
        const fogPassObj = this.fogPass;
        const fogSystemRef = this;
        
        this.fogPass.fsQuad = {
            render: (renderer) => {
                renderer.render(fogPassObj.fsQuadScene, fogPassObj.fsQuadCamera);
            }
        };
        
        this.fogPass.render = function(renderer, writeBuffer, readBuffer) {
            if (fogSystemRef.game.camera) {
                fogPassObj.uniforms.cameraWorldMatrix.value.copy(fogSystemRef.game.camera.matrixWorld);
                fogPassObj.uniforms.cameraProjectionMatrixInv.value.copy(fogSystemRef.game.camera.projectionMatrixInverse);
                fogPassObj.uniforms.cameraNear.value = fogSystemRef.game.camera.near;
                fogPassObj.uniforms.cameraFar.value = fogSystemRef.game.camera.far;
            }
            
            fogSystemRef.renderFogTexture();
            
            fogPassObj.uniforms.tDiffuse.value = readBuffer.texture;
            fogPassObj.uniforms.tDepth.value = readBuffer.depthTexture;
            
            if (fogPassObj.needsSwap) {
                renderer.setRenderTarget(writeBuffer);
            } else {
                renderer.setRenderTarget(null);
            }
            
            fogPassObj.fsQuad.render(renderer);
        };
                
        this.fogPass.setSize = function(width, height) {
            // No-op
        };
    }

    renderFogTexture() {
        const myTeam = this.game.state.mySide;
        if (!myTeam) return;

        const myUnits = this.game.getEntitiesWith(
            this.componentTypes.POSITION,
            this.componentTypes.TEAM,
            this.componentTypes.HEALTH
        ).filter(id => {
            const team = this.game.getComponent(id, this.componentTypes.TEAM);
            return team?.team === myTeam;
        });

        // Hide all meshes
        this.circlePool.forEach(circle => circle.visible = false);
        this.losMeshPool.forEach(mesh => mesh.visible = false);

        let meshIndex = 0;
        let debugCount = 0;

        myUnits.forEach((entityId) => {
            const pos = this.game.getComponent(entityId, this.componentTypes.POSITION);
            const unitType = this.game.getComponent(entityId, this.componentTypes.UNIT_TYPE);
            if (!pos) return;

            const visionRadius = unitType?.visionRange || this.VISION_RADIUS;

            if (this.LOS_ENABLED) {
                const visiblePoints = this.generateLOSVisibilityShape(
                    { x: pos.x, z: pos.z },
                    visionRadius,
                    unitType,
                    entityId
                );
                
                this.updateVisibilityMesh(visiblePoints, meshIndex);
      
                meshIndex++;
            } else {
                let circle;
                if (meshIndex < this.circlePool.length) {
                    circle = this.circlePool[meshIndex];
                    circle.visible = true;
                } else {
                    circle = new THREE.Mesh(this.circleGeometry, this.circleMaterial);
                    circle.rotation.x = -Math.PI / 2;
                    this.circlePool.push(circle);
                    this.fogScene.add(circle);
                }
                circle.scale.set(visionRadius, visionRadius, visionRadius);
                circle.position.set(pos.x, 0, pos.z);
                meshIndex++;
            }
        });

        // Render visibility
        this.game.renderer.setRenderTarget(this.fogRenderTarget);
        this.game.renderer.render(this.fogScene, this.fogCamera);
        
        // Accumulate exploration
        this.accumulationMaterial.uniforms.currentExploration.value = this.explorationRenderTarget.texture;
        this.accumulationMaterial.uniforms.newVisibility.value = this.fogRenderTarget.texture;
        
        this.game.renderer.setRenderTarget(this.explorationRenderTargetPingPong);
        this.game.renderer.render(this.accumulationScene, this.accumulationCamera);
        
        const temp = this.explorationRenderTarget;
        this.explorationRenderTarget = this.explorationRenderTargetPingPong;
        this.explorationRenderTargetPingPong = temp;
        
        this.fogPass.uniforms.explorationTexture.value = this.explorationRenderTarget.texture;
        
        this.game.renderer.setRenderTarget(null);
        
        this.visibilityCacheValid = false;
        this.explorationCacheValid = false;
        
   
    }

    createGradientCircleTexture() {
        const size = 128;
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d');
        
        const centerX = size / 2;
        const centerY = size / 2;
        const radius = size / 2;
        
        const gradient = ctx.createRadialGradient(centerX, centerY, 0, centerX, centerY, radius);
        gradient.addColorStop(0, 'rgba(255, 255, 255, 1.0)');
        gradient.addColorStop(0.7, 'rgba(255, 255, 255, 1.0)');
        gradient.addColorStop(1.0, 'rgba(255, 255, 255, 0.0)');
        
        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, size, size);
        
        const texture = new THREE.CanvasTexture(canvas);
        texture.needsUpdate = true;
        return texture;
    }

    setVisionRadius(radius) {
        this.VISION_RADIUS = radius;
    }

    setLOSEnabled(enabled) {
        this.LOS_ENABLED = enabled;
        console.log(`[FogOfWarSystem] LOS ${enabled ? 'enabled' : 'disabled'}`);
    }

    setLOSUnitBlocking(enabled) {
        this.LOS_UNIT_BLOCKING_ENABLED = enabled;
    }


    /**
     * Debug method to adjust LOS parameters at runtime
     */
    setLOSParams(params) {
        if (params.rays !== undefined) this.LOS_RAYS_PER_UNIT = params.rays;
        if (params.sampleDistance !== undefined) this.LOS_SAMPLE_DISTANCE = params.sampleDistance;
        if (params.unitHeight !== undefined) this.LOS_UNIT_HEIGHT = params.unitHeight;
        if (params.unitBlockRadius !== undefined) this.LOS_UNIT_BLOCK_RADIUS = params.unitBlockRadius;

    }

    updateVisibilityCache() {
        if (this.visibilityCacheValid) return;
        
        this.game.renderer.readRenderTargetPixels(
            this.fogRenderTarget,
            0, 0,
            this.FOG_TEXTURE_SIZE,
            this.FOG_TEXTURE_SIZE,
            this.cachedVisibilityBuffer
        );
        
        this.visibilityCacheValid = true;
    }

    updateExplorationCache() {
        if (this.explorationCacheValid) return;
        
        this.game.renderer.readRenderTargetPixels(
            this.explorationRenderTarget,
            0, 0,
            this.FOG_TEXTURE_SIZE,
            this.FOG_TEXTURE_SIZE,
            this.cachedExplorationBuffer
        );
        
        this.explorationCacheValid = true;
    }

    isVisibleAt(x, z) {
        this.isVisibleAtCount += 1;
        const uv = this.worldToUV(x, z);
        if (!uv) return false;
        
        this.updateVisibilityCache();
        
        const px = Math.floor(uv.x * this.FOG_TEXTURE_SIZE);
        const py = Math.floor(uv.y * this.FOG_TEXTURE_SIZE);
        const index = (py * this.FOG_TEXTURE_SIZE + px);
        
        return this.cachedVisibilityBuffer[index] > 0;
    }

    isExploredAt(x, z) {
        this.isExploredAtCount += 1;
        const uv = this.worldToUV(x, z);
        if (!uv) return false;
        
        this.updateExplorationCache();
        
        const px = Math.floor(uv.x * this.FOG_TEXTURE_SIZE);
        const py = Math.floor(uv.y * this.FOG_TEXTURE_SIZE);
        const index = (py * this.FOG_TEXTURE_SIZE + px);
        
        return this.cachedExplorationBuffer[index] > 0;
    }

    worldToUV(x, z) {
        const half = this.WORLD_SIZE * 0.5;
        let u = (x + half) / this.WORLD_SIZE;
        let v = (-z + half) / this.WORLD_SIZE;

        if (u < 0 || u > 1 || v < 0 || v > 1) {
            return null;
        }

        return { x: u, y: v };
    }

    resetExploration() {
        this.game.renderer.setRenderTarget(this.explorationRenderTarget);
        this.game.renderer.clear();
        this.game.renderer.setRenderTarget(this.explorationRenderTargetPingPong);
        this.game.renderer.clear();
        this.game.renderer.setRenderTarget(null);
        this.explorationCacheValid = false;
    }

    dispose() {
        if (this.fogRenderTarget) this.fogRenderTarget.dispose();
        if (this.explorationRenderTarget) this.explorationRenderTarget.dispose();
        if (this.explorationRenderTargetPingPong) this.explorationRenderTargetPingPong.dispose();
        if (this.game.postProcessingSystem) this.game.postProcessingSystem.removePass('fog');
        if (this.circleGeometry) this.circleGeometry.dispose();
        if (this.circleMaterial) this.circleMaterial.dispose();
        if (this.circleTexture) this.circleTexture.dispose();
        if (this.accumulationMaterial) this.accumulationMaterial.dispose();
        if (this.accumulationQuad) this.accumulationQuad.geometry.dispose();
        if (this.losMaterial) this.losMaterial.dispose();
        
        this.losGeometryPool.forEach(geom => geom.dispose());
        this.circlePool = [];
        this.losMeshPool = [];
        this.losGeometryPool = [];
        this.spatialGrid.clear();
    }
}