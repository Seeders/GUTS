class FogOfWarSystem extends GUTS.BaseSystem {
    static services = [
        'getExplorationTexture',
        'getFogTexture',
        'invalidateLOSCache',
        'isVisibleAt'
    ];

    static serviceDependencies = [
        'getWorldExtendedSize',
        'registerPostProcessingPass',
        'getGridSize',
        'getTerrainSize',
        'hasLineOfSight',
        'getActivePlayerTeam',
        'getUnitTypeDef',
        'removePostProcessingPass'
    ];

    constructor(game) {
        super(game);
        this.game.fogOfWarSystem = this;

        this.VISION_RADIUS = 500;
        this.WORLD_SIZE = null; // Set in onSceneLoad when terrain is available
        this.FOG_TEXTURE_SIZE = 256;

        // Line of sight settings (optimized)
        this.LOS_ENABLED = true;
        this.LOS_RAYS_PER_UNIT = 16;
        this.LOS_SAMPLE_DISTANCE = 12;
        this.LOS_UNIT_BLOCKING_ENABLED = true;
        this.LOS_UNIT_HEIGHT = 25;
        this.LOS_UNIT_BLOCK_RADIUS = 25;

        this.fogRenderTarget = null;
        this.explorationRenderTarget = null;
        this.explorationRenderTargetPingPong = null;
        this.fogScene = null;
        this.fogCamera = null;
        this.fogPass = null;

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

        // Frame-based cache invalidation to prevent redundant GPU reads
        this.lastVisibilityCacheFrame = -1;
        this.lastExplorationCacheFrame = -1;
        this.currentFrame = 0;

        // Position-based dirty tracking - only recalculate LOS when units move
        this._unitPositions = new Map();  // entityId -> {x, z}
        this._fowDirty = true;            // Force initial calculation
        this._positionThreshold = 2;      // Minimum movement to trigger recalc (in world units)

        // Reusable array to avoid per-frame allocations from .filter()
        this._myUnits = [];

        // Cached values that don't change per-frame
        this._cachedGridSize = null;
        this._cachedTerrainSize = null;

        // Tile-based LOS cache - key: "tileX_tileZ_visionRadius" -> cached visibility points array
        // LOS only depends on tile position and terrain (which is static)
        this._losCache = new Map();
        this._losCacheMaxSize = 500;  // Limit cache size to prevent memory bloat
        
        // Pre-allocate reusable arrays
        this.tempVisiblePoints = new Array(this.LOS_RAYS_PER_UNIT);
        for (let i = 0; i < this.LOS_RAYS_PER_UNIT; i++) {
            this.tempVisiblePoints[i] = { x: 0, z: 0 };
        }
       
    }

    init(params = {}) {
        this.params = params;
        // Rendering initialized in onSceneLoad when world size is available
    }

    onSceneLoad(sceneData) {
        // Get world size now that terrain is loaded
        this.WORLD_SIZE = this.call.getWorldExtendedSize();

        if (!this.WORLD_SIZE) {
            console.warn('[FogOfWarSystem] World size not available');
            return;
        }

        // Initialize rendering now that we have world size
        this.initRendering();

        // Create fog pass now that render targets exist
        if (this.game.postProcessingSystem && !this.fogPass) {
            this.createFogPass();
            this.call.registerPostProcessingPass( 'fog', {
                enabled: true,
                pass: this.fogPass
            });
        }

        // Force initial fog calculation
        this._fowDirty = true;
    }

    getExplorationTexture() {
        return this.explorationRenderTarget?.texture || null;
    }

    getFogTexture() {
        return this.fogRenderTarget?.texture || null;
    }
    initRendering(){
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
        
    }

    postAllInit() {
        // Fog pass is now created in onSceneLoad after render targets are initialized
    }


    /**
     * Get cached grid size for tile calculations
     */
    _getGridSize() {
        if (this._cachedGridSize === null) {
            this._cachedGridSize = this.call.getGridSize();
        }
        return this._cachedGridSize;
    }

    /**
     * Get cached terrain size for tile calculations
     */
    _getTerrainSize() {
        if (this._cachedTerrainSize === null) {
            this._cachedTerrainSize = this.call.getTerrainSize();
        }
        return this._cachedTerrainSize;
    }

    /**
     * Convert world position to tile position
     */
    _worldToTile(x, z) {
        const gridSize = this._getGridSize();
        const terrainSize = this._getTerrainSize();
        return {
            tileX: Math.floor((x + terrainSize / 2) / gridSize),
            tileZ: Math.floor((z + terrainSize / 2) / gridSize)
        };
    }

    /**
     * Get tile center in world coordinates
     */
    _tileToWorld(tileX, tileZ) {
        const gridSize = this._getGridSize();
        const terrainSize = this._getTerrainSize();
        return {
            x: (tileX + 0.5) * gridSize - terrainSize / 2,
            z: (tileZ + 0.5) * gridSize - terrainSize / 2
        };
    }

    generateLOSVisibilityShape(unitPos, visionRadius, unitType, entityId) {
        // Convert to tile position for cache lookup
        const { tileX, tileZ } = this._worldToTile(unitPos.x, unitPos.z);
        const cacheKey = `${tileX}_${tileZ}_${visionRadius}`;

        // Check cache first
        const cached = this._losCache.get(cacheKey);
        if (cached) {
            // Apply cached distances to current unit position
            const angleStep = (Math.PI * 2) / this.LOS_RAYS_PER_UNIT;
            for (let i = 0; i < this.LOS_RAYS_PER_UNIT; i++) {
                const angle = i * angleStep;
                this.tempVisiblePoints[i].x = unitPos.x + Math.cos(angle) * cached[i];
                this.tempVisiblePoints[i].z = unitPos.z + Math.sin(angle) * cached[i];
            }
            return this.tempVisiblePoints;
        }

        // Calculate LOS shape (cache miss)
        const angleStep = (Math.PI * 2) / this.LOS_RAYS_PER_UNIT;
        const distances = new Float32Array(this.LOS_RAYS_PER_UNIT);

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
            if (!this.call.hasLineOfSight(
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
                    if (this.call.hasLineOfSight(
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

            distances[i] = visibleDist;
            this.tempVisiblePoints[i].x = unitPos.x + dirX * visibleDist;
            this.tempVisiblePoints[i].z = unitPos.z + dirZ * visibleDist;
        }

        // Cache the distances (limit cache size with simple eviction)
        if (this._losCache.size >= this._losCacheMaxSize) {
            // Remove oldest entry (first key)
            const firstKey = this._losCache.keys().next().value;
            this._losCache.delete(firstKey);
        }
        this._losCache.set(cacheKey, distances);

        return this.tempVisiblePoints;
    }

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
                cameraProjectionMatrixInv: { value: new THREE.Matrix4() },
                isPerspective: { value: 0.0 },
                viewerPos: { value: new THREE.Vector3() },
                viewerTerrainHeight: { value: 0.0 }
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
                uniform float isPerspective;
                uniform vec3 viewerPos;
                uniform float viewerTerrainHeight;

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

                    // Height-based visibility boost for geometry below viewer's terrain level
                    // This fixes the issue where walls/cliffs at lower terrain get incorrectly fogged
                    // because their XZ position maps to a "blocked" region in the 2D fog map
                    float heightDiff = worldPos.y - viewerTerrainHeight;
                    if (heightDiff < 0.0) {
                        // Pixel is below viewer's terrain level - check distance to viewer
                        float dx = worldPos.x - viewerPos.x;
                        float dz = worldPos.z - viewerPos.z;
                        float distToViewer = sqrt(dx * dx + dz * dz);

                        // Sample fog at the viewer's position to see if viewer has any visibility
                        vec2 viewerFogUV = vec2(
                            (viewerPos.x + halfSize) / worldSize,
                            (-viewerPos.z + halfSize) / worldSize
                        );
                        vec4 viewerFogSample = texture2D(fogTexture, viewerFogUV);

                        // If viewer has visibility and this pixel is reasonably close and below viewer,
                        // boost its visibility (walls facing the viewer should be visible)
                        if (viewerFogSample.r > 0.5 && distToViewer < 500.0) {
                            // Boost visibility for geometry below viewer's height
                            // More boost for geometry further below and closer to viewer
                            float heightBoost = clamp(-heightDiff / 50.0, 0.0, 1.0);
                            float distFactor = 1.0 - clamp(distToViewer / 500.0, 0.0, 1.0);
                            visibleGradient = max(visibleGradient, heightBoost * distFactor);
                        }
                    }

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
            const camera = fogSystemRef.game.call('getCamera');

            if (camera) {
                fogPassObj.uniforms.cameraWorldMatrix.value.copy(camera.matrixWorld);
                fogPassObj.uniforms.cameraProjectionMatrixInv.value.copy(camera.projectionMatrixInverse);
                fogPassObj.uniforms.cameraNear.value = camera.near;
                fogPassObj.uniforms.cameraFar.value = camera.far;
                fogPassObj.uniforms.isPerspective.value = camera.isPerspectiveCamera ? 1.0 : 0.0;
            }

            // Update viewer position for height-based fog correction
            if (fogSystemRef._myUnits && fogSystemRef._myUnits.length > 0) {
                const viewerEntityId = fogSystemRef._myUnits[0];
                const transform = fogSystemRef.game.getComponent(viewerEntityId, 'transform');
                if (transform && transform.position) {
                    fogPassObj.uniforms.viewerPos.value.set(
                        transform.position.x,
                        transform.position.y,
                        transform.position.z
                    );
                    // Get terrain height at viewer position
                    const terrainHeight = fogSystemRef.game.hasService('getTerrainHeightAtPosition')
                        ? fogSystemRef.game.call('getTerrainHeightAtPosition', transform.position.x, transform.position.z) || 0
                        : 0;
                    fogPassObj.uniforms.viewerTerrainHeight.value = terrainHeight;
                }
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

    /**
     * Check if any unit has moved enough to require FOW recalculation
     */
    _checkUnitMovement(myUnits) {
        let hasMoved = false;

        // Track which entities are still active (reuse set to avoid allocation)
        if (!this._activeUnitIds) this._activeUnitIds = new Set();
        this._activeUnitIds.clear();

        for (const entityId of myUnits) {
            this._activeUnitIds.add(entityId);

            const transform = this.game.getComponent(entityId, "transform");
            const pos = transform?.position;
            if (!pos) continue;

            let lastPos = this._unitPositions.get(entityId);
            if (!lastPos) {
                // New unit - create position object and mark as moved
                this._unitPositions.set(entityId, { x: pos.x, z: pos.z });
                hasMoved = true;
            } else {
                const dx = pos.x - lastPos.x;
                const dz = pos.z - lastPos.z;
                const distSq = dx * dx + dz * dz;
                if (distSq > this._positionThreshold * this._positionThreshold) {
                    // Update position in place (no new object allocation)
                    lastPos.x = pos.x;
                    lastPos.z = pos.z;
                    hasMoved = true;
                }
            }
        }

        // Check for removed units and clean them up
        for (const entityId of this._unitPositions.keys()) {
            if (!this._activeUnitIds.has(entityId)) {
                this._unitPositions.delete(entityId);
                hasMoved = true;
            }
        }

        return hasMoved;
    }

    /**
     * Force FOW recalculation (call when worldObjects change, etc.)
     */
    invalidateFOW() {
        this._fowDirty = true;
    }

    /**
     * Invalidate LOS cache - call when terrain/worldObjects change
     * Can invalidate specific tiles or entire cache
     */
    invalidateLOSCache(worldX = null, worldZ = null, radius = null) {
        if (worldX === null) {
            // Clear entire cache
            this._losCache.clear();
        } else if (radius !== null) {
            // Clear tiles within radius of world position
            const gridSize = this._getGridSize();
            const { tileX: centerTileX, tileZ: centerTileZ } = this._worldToTile(worldX, worldZ);
            const tileRadius = Math.ceil(radius / gridSize) + 1;

            // Remove affected cache entries
            for (const key of this._losCache.keys()) {
                const [tileX, tileZ] = key.split('_').map(Number);
                const dx = tileX - centerTileX;
                const dz = tileZ - centerTileZ;
                if (dx * dx + dz * dz <= tileRadius * tileRadius) {
                    this._losCache.delete(key);
                }
            }
        }
        this._fowDirty = true;
    }

    renderFogTexture() {
        // Guard against rendering before initialization or after cleanup
        if (!this.fogRenderTarget || !this.explorationRenderTarget || !this.fogScene) {
            return;
        }

        const myTeam = this.call.getActivePlayerTeam();
        // myTeam can be 0 (neutral) which is falsy, so check for undefined/null explicitly
        if (myTeam === undefined || myTeam === null) return;

        const allUnitsWithTeam = this.game.getEntitiesWith(
            "transform",
            "team",
            "health"
        );

        // Reuse array instead of .filter() which allocates new array each frame
        this._myUnits.length = 0;
        for (let i = 0; i < allUnitsWithTeam.length; i++) {
            const id = allUnitsWithTeam[i];
            const team = this.game.getComponent(id, "team");
            if (team?.team === myTeam) {
                this._myUnits.push(id);
            }
        }

        // Check if any unit has moved - if not, skip expensive LOS recalculation
        const needsRecalc = this._fowDirty || this._checkUnitMovement(this._myUnits);

        if (!needsRecalc) {
            // Still need to increment frame for visibility cache
            this.currentFrame++;
            return;
        }

        this._fowDirty = false;

        // Hide all meshes
        this.losMeshPool.forEach(mesh => mesh.visible = false);

        let meshIndex = 0;

        for (const entityId of this._myUnits) {
            const transform = this.game.getComponent(entityId, "transform");
            const pos = transform?.position;
            const unitTypeComp = this.game.getComponent(entityId, "unitType");
            const unitType = this.call.getUnitTypeDef( unitTypeComp);
            if (!pos) continue;

            const visionRadius = unitType?.visionRange || this.VISION_RADIUS;

            const visiblePoints = this.generateLOSVisibilityShape(
                { x: pos.x, z: pos.z },
                visionRadius,
                unitType,
                entityId
            );

            this.updateVisibilityMesh(visiblePoints, meshIndex);

            meshIndex++;
        }

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

        // Increment frame counter - caches will be updated once per frame on first visibility check
        this.currentFrame++;
    }

    updateVisibilityCache() {
        // Only read pixels once per frame using frame counter
        if (this.lastVisibilityCacheFrame === this.currentFrame) return;

        this.game.renderer.readRenderTargetPixels(
            this.fogRenderTarget,
            0, 0,
            this.FOG_TEXTURE_SIZE,
            this.FOG_TEXTURE_SIZE,
            this.cachedVisibilityBuffer
        );

        this.lastVisibilityCacheFrame = this.currentFrame;
    }

    updateExplorationCache() {
        // Only read pixels once per frame using frame counter
        if (this.lastExplorationCacheFrame === this.currentFrame) return;

        this.game.renderer.readRenderTargetPixels(
            this.explorationRenderTarget,
            0, 0,
            this.FOG_TEXTURE_SIZE,
            this.FOG_TEXTURE_SIZE,
            this.cachedExplorationBuffer
        );

        this.lastExplorationCacheFrame = this.currentFrame;
    }

    //only available on CLIENT
    isVisibleAt(x, z) {
        const uv = this.worldToUV(x, z);
        if (!uv) return false;
        
        this.updateVisibilityCache();
        
        const px = Math.floor(uv.x * this.FOG_TEXTURE_SIZE);
        const py = Math.floor(uv.y * this.FOG_TEXTURE_SIZE);
        const index = (py * this.FOG_TEXTURE_SIZE + px);
        
        return this.cachedVisibilityBuffer[index] > 0;
    }

    //only available on CLIENT
    isExploredAt(x, z) {
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
        if (this.game.postProcessingSystem) this.call.removePostProcessingPass( 'fog');
        if (this.accumulationMaterial) this.accumulationMaterial.dispose();
        if (this.accumulationQuad) this.accumulationQuad.geometry.dispose();
        if (this.losMaterial) this.losMaterial.dispose();

        this.losGeometryPool.forEach(geom => geom.dispose());
        this.losMeshPool = [];
        this.losGeometryPool = [];
    }

    /**
     * Called when scene is unloaded - cleanup all fog of war resources
     * Note: dispose() is called by SceneManager after onSceneUnload
     */
    onSceneUnload() {
    }
}
