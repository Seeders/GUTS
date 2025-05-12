class InfiniWorld extends engine.Component {
    init({
      containerSelector = '#gameContainer',
      width = window.innerWidth,
      height = window.innerHeight,
      isEditor,
      world,
      clock = new THREE.Clock()   
    }) {
      this.container = document.querySelector(containerSelector) || document.body;
      this.gameConfig = this.game.getCollections().configs.game;      
      this.world = this.game.getCollections().worlds[world];
      this.rootGroup = new window.THREE.Group(); // Main container for all shapes
      this.rootGroup.name = "infiniWorldGroup";      
      this.canvas = this.game.canvas;
      if(!this.canvas) {
        this.canvas = this.container.querySelector("canvas");
      }
      // Initialize core properties
      this.clock = clock;
      this.onWindowResizeHandler = this.onWindowResize.bind(this);
      this.renderer = this.game.renderer || new THREE.WebGLRenderer({ antialias: true, canvas: this.canvas, alpha: true });
      if(!isEditor){
        this.renderer.setSize(width, height);
      }
      this.renderer.shadowMap.enabled = true;
      this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    
      this.scene = this.game.scene || new window.THREE.Scene();
      this.scene.add(this.rootGroup);
      this.uniforms = new Map();
      this.cameraData = this.game.getCollections().cameras[this.world.camera];  
      // Camera setup
      this.camera = this.game.camera || new THREE.PerspectiveCamera(this.cameraData.fov, width / height, this.cameraData.near, this.cameraData.far);
     
      // Terrain configuration
      this.heightMap = this.game.getCollections().heightMaps[this.world.heightMap];
      this.chunkSize = this.heightMap.chunkSize;
      this.chunkResolution = this.heightMap.chunkResolution;
      this.renderDistance = this.heightMap.renderDistance;
      this.heightScale = this.heightMap.heightScale;

      // Lighting setup
      this.lighting = this.game.getCollections().lightings[this.world.lighting];  
      this.shadow = this.game.getCollections().shadows[this.world.shadow];  
      this.fogData = this.game.getCollections().fogs[this.world.fog];       
      
      
      const skyColor = parseInt(this.lighting.skyColor.replace('#', ''), 16);
            // Create a large sphere for the sky
      const skyGeometry = new THREE.SphereGeometry(this.renderDistance * this.chunkSize, 32, 32); // Large enough to enclose the scene
     
      const skyMaterial = new THREE.MeshBasicMaterial({
        color: skyColor, // Use the same sky color
        side: THREE.BackSide // Render the inside of the sphere
      });
      this.skyDome = new THREE.Mesh(skyGeometry, skyMaterial);
      
      this.rootGroup.add(this.skyDome);


      const ambientColor = parseInt(this.lighting.ambientColor.replace('#', ''), 16);
      this.ambientLight = new THREE.AmbientLight(ambientColor, this.lighting.ambientIntensity);
      this.rootGroup.add(this.ambientLight);
    
       
      const directionalColor = parseInt(this.lighting.directionalColor.replace('#', ''), 16);
      this.directionalLight = new THREE.DirectionalLight(directionalColor, this.lighting.directionalIntensity);
      this.directionalLight.castShadow = true;
      this.directionalLight.shadow.mapSize.set(this.shadow.mapSize, this.shadow.mapSize); // Increase resolution for sharper shadows
      this.directionalLight.shadow.camera.near = 0.01; // Closer near plane for precision
      this.directionalLight.shadow.camera.far = this.shadow.mapSize; // Increase far plane to cover tall terrain
      this.directionalLight.shadow.camera.left = -this.shadow.radius; // Expand bounds
      this.directionalLight.shadow.camera.right = this.shadow.radius;
      this.directionalLight.shadow.camera.top = this.shadow.radius;
      this.directionalLight.shadow.camera.bottom = -this.shadow.radius;
      this.directionalLight.shadow.bias = this.shadow.bias; // Add bias to reduce shadow acne
      this.directionalLight.shadow.normalBias = this.shadow.normalBias; // Reduce artifacts on slopes
      this.directionalLight.position.set(this.camera.position.x + this.chunkSize / 2, this.chunkSize / 2, this.camera.position.z + this.chunkSize / 2);
      this.rootGroup.add(this.directionalLight);
    
      // Fog setup
      
      if(this.fogData.enabled){
        const fogColor = parseInt(this.fogData.color.replace('#', ''), 16);
        this.fog = new THREE.Fog(fogColor, 0, (1 - this.fogData.density) * this.renderDistance * this.chunkSize);
        this.scene.fog = this.fog;
      }
  
      this.chunks = new Map();
      this.objectCache = new Map();
  
      this.noise = new (this.game.moduleManager.libraryClasses.SimplexNoise)(); // Fixed seed for consistency
      let biomes = {};
      this.world.biomes.forEach((biomeName) => {
          let biomeObjData = this.game.getCollections().biomes[biomeName];
          let elevationNoiseData = this.game.getCollections().noiseSettings[biomeObjData.elevationNoiseSetting];
          let detailNoiseData = this.game.getCollections().noiseSettings[biomeObjData.detailNoiseSetting];

          let worldObjectSpawns = [];
          biomeObjData.worldObjectSpawns.forEach((worldObjectSpawn) => {
            worldObjectSpawns.push(this.game.getCollections().worldObjectSpawns[worldObjectSpawn]);
          })
          let groundColor = new THREE.Color(biomeObjData.groundColor);
          biomes[biomeName] = {
            groundColor: {
                r: groundColor.r,
                g: groundColor.g,
                b: groundColor.b
            },
            noiseSettings: {
              elevation: elevationNoiseData,
              detail: detailNoiseData
            },
            worldObjects: worldObjectSpawns,
            range: JSON.parse(biomeObjData.range)
          }

          if(biomeName == "mountain"){     
            let ridgeNoiseData = this.game.getCollections().noiseSettings[biomeObjData.ridgeNoiseSetting];
            biomes[biomeName].noiseSettings.ridge = ridgeNoiseData;
          }
      });
      this.biomes = biomes;
      this.terrainGenerator = new (this.game.moduleManager.libraryClasses.TerrainGenerator)(); 
      this.terrainGenerator.init(this.biomes, this.chunkSize, this.chunkResolution, this.noise);
  
      // Initialize Web Worker from Blob
      const workerCode = this.getWorkerCode();
      const blob = new Blob([workerCode], { type: 'application/javascript' });
      this.worker = new Worker(URL.createObjectURL(blob));
      this.worker.onmessage = this.handleWorkerMessage.bind(this);
      this.pendingChunks = new Map();
      this.chunkGeometry = new Map();
      this.staticAABBsToRemove = [];
      // Initialize terrain
      this.setupInitialChunks();
  
     // window.addEventListener('resize', this.onWindowResizeHandler);
      this.game.scene = this.scene;
      this.game.camera = this.camera;
      this.game.renderer = this.renderer;
      this.game.terrain = this;
      this.timer = 0;
    }

    async setupInitialChunks() {
      const cameraChunkX = Math.floor(this.camera.position.x / this.chunkSize);
      const cameraChunkZ = Math.floor(this.camera.position.z / this.chunkSize);
      const promises = [];
  
      for (let x = cameraChunkX - this.renderDistance; x <= cameraChunkX + this.renderDistance; x++) {
        for (let z = cameraChunkZ - this.renderDistance; z <= cameraChunkZ + this.renderDistance; z++) {
          promises.push(this.generateChunk(x, z));
        }
      }
  
      await Promise.all(promises);
    }
  
    async generateChunk(cx, cz) {
      const chunkKey = `${cx},${cz}`;
      if (this.chunks.has(chunkKey)) return;
  
      const chunkData = {
        terrainMesh: null,
        objectMeshes: new Map(),
        isGenerating: true
      };
      this.chunks.set(chunkKey, chunkData);
      this.pendingChunks.set(chunkKey, chunkData);
  
      // Send message to worker
      this.worker.postMessage({
        cx,
        cz,
        chunkSize: this.chunkSize,
        chunkResolution: this.chunkResolution
      });
    }
  
    getInstancedMeshPool(type, geometry, material) {
      if (!this.objectPools) this.objectPools = new Map();
  
      const key = `${type}-${geometry.uuid}`;
      if (!this.objectPools.has(key)) {
        const pool = new (this.game.moduleManager.libraryClasses.InstancePool)(geometry, material, 1000);
        this.rootGroup.add(pool.mesh);
        this.objectPools.set(key, pool);
      }
      return this.objectPools.get(key);
    }
  
    async updateChunks() {
      const cameraChunkX = Math.floor(this.camera.position.x / this.chunkSize);
      const cameraChunkZ = Math.floor(this.camera.position.z / this.chunkSize);
      const newChunks = new Set();
      const chunksToGenerate = [];
      const maxChunksPerFrame = 2;
  
      for (let x = cameraChunkX - this.renderDistance; x <= cameraChunkX + this.renderDistance; x++) {
          for (let z = cameraChunkZ - this.renderDistance; z <= cameraChunkZ + this.renderDistance; z++) {
              const chunkKey = `${x},${z}`;
              newChunks.add(chunkKey);
              if (!this.chunks.has(chunkKey) && !this.pendingChunks.has(chunkKey)) {
                  chunksToGenerate.push({ x, z });
              }
          }
      }
  
      chunksToGenerate.sort((a, b) => {
          const distA = Math.hypot(a.x - cameraChunkX, a.z - cameraChunkZ);
          const distB = Math.hypot(b.x - cameraChunkX, b.z - cameraChunkZ);
          return distA - distB;
      });
  
      for (let i = 0; i < Math.min(maxChunksPerFrame, chunksToGenerate.length); i++) {
          const { x, z } = chunksToGenerate[i];
          await this.generateChunk(x, z);
      }
      this.staticAABBsToRemove = [];
      // Remove old chunks
      for (const [chunkKey, chunkData] of this.chunks) {
          if (!newChunks.has(chunkKey) && !chunkData.isGenerating) {
              let parts = chunkKey.split(',');
              let x = parts[0];
              let z = parts[1];
              this.staticAABBsToRemove = [...this.staticAABBsToRemove, ...this.getStaticAABBsAt(x, z)];
              if (chunkData.terrainMesh) {
                  this.rootGroup.remove(chunkData.terrainMesh);
                  chunkData.terrainMesh.geometry.dispose();
                  chunkData.terrainMesh.material.dispose();
              }
              if (chunkData.waterMesh) {
                  this.rootGroup.remove(chunkData.waterMesh);
                  chunkData.waterMesh.geometry.dispose();
                  chunkData.waterMesh.material.dispose();
              }
              chunkData.objectMeshes.forEach((groups, type) => {
                  groups.forEach(group => {
                      if (group.mesh) {
                          this.rootGroup.remove(group.mesh);
                          group.mesh.geometry.dispose();
                          if (Array.isArray(group.mesh.material)) {
                              group.mesh.material.forEach(mat => mat.dispose());
                          } else {
                              group.mesh.material.dispose();
                          }
                          group.mesh.dispose();
                      }
                  });
              });
              this.chunks.delete(chunkKey);
              this.uniforms.delete(chunkKey);
          }
      }      
  }
  getStaticAABBsToRemove() {
    return this.staticAABBsToRemove;
  }
  handleWorkerMessage(e) {    
    const { cx, cz, positions, indices, colors, normals, vegetation } = e.data;
    const chunkKey = `${cx},${cz}`;
    const chunkData = this.pendingChunks.get(chunkKey);
    if (!chunkData) return;

    try {
        // Copy positions and normals for manipulation
        const adjustedPositions = positions.slice();
        const adjustedNormals = normals.slice();
        const vertexCountPerRow = this.chunkResolution + 1;

        // IMPROVEMENT: Use integer-based positioning for chunk placement
        // This helps prevent floating point errors from accumulating
        const chunkWorldX = Math.round(cx * this.chunkSize);
        const chunkWorldZ = Math.round(cz * this.chunkSize);

        // Enhanced shared edge processing 
        const processSharedEdge = (thisChunk, neighborChunk, edgeSelector, neighborEdgeSelector) => {
            if (!neighborChunk || !neighborChunk.terrainMesh) return;
            
            const thisGeom = {
                positions: adjustedPositions,
                normals: adjustedNormals
            };
            
            const neighborGeom = {
                positions: neighborChunk.terrainMesh.geometry.attributes.position.array,
                normals: neighborChunk.terrainMesh.geometry.attributes.normal.array
            };
            
            // Get vertices along the shared edge
            const thisIndices = edgeSelector(vertexCountPerRow);
            const neighborIndices = neighborEdgeSelector(vertexCountPerRow);
            
            // For each vertex along the edge
            for (let i = 0; i < thisIndices.length; i++) {
                const thisIdx = thisIndices[i];
                const neighborIdx = neighborIndices[i];
                
                // CRITICAL FIX: Ensure absolute world positions match exactly
                // Calculate world position of the neighbor vertex
                const neighborWorldX = neighborChunk.terrainMesh.position.x + neighborGeom.positions[neighborIdx*3];
                const neighborWorldY = neighborChunk.terrainMesh.position.y + neighborGeom.positions[neighborIdx*3+1];
                const neighborWorldZ = neighborChunk.terrainMesh.position.z + neighborGeom.positions[neighborIdx*3+2];
                
                // Set local position based on exact world position of neighbor
                // This ensures perfect alignment with zero gaps
                const localX = neighborWorldX - chunkWorldX;
                const localY = neighborWorldY; // Y doesn't need offset since chunks are at y=0
                const localZ = neighborWorldZ - chunkWorldZ;
                
                // Apply exact position to eliminate gaps completely
                thisGeom.positions[thisIdx*3] = localX;
                thisGeom.positions[thisIdx*3+1] = localY;
                thisGeom.positions[thisIdx*3+2] = localZ;
                
                // Average the normals for smooth lighting across chunk boundaries
                const n1 = [
                    thisGeom.normals[thisIdx*3], 
                    thisGeom.normals[thisIdx*3+1], 
                    thisGeom.normals[thisIdx*3+2]
                ];
                const n2 = [
                    neighborGeom.normals[neighborIdx*3], 
                    neighborGeom.normals[neighborIdx*3+1], 
                    neighborGeom.normals[neighborIdx*3+2]
                ];
                
                // Calculate average normal
                const avgNormal = [
                    (n1[0] + n2[0]) / 2,
                    (n1[1] + n2[1]) / 2,
                    (n1[2] + n2[2]) / 2
                ];
                
                // Normalize the averaged normal
                const mag = Math.sqrt(
                    avgNormal[0] * avgNormal[0] + 
                    avgNormal[1] * avgNormal[1] + 
                    avgNormal[2] * avgNormal[2]
                );
                
                if (mag > 0.00001) {
                    avgNormal[0] /= mag;
                    avgNormal[1] /= mag;
                    avgNormal[2] /= mag;
                    
                    // Apply to current chunk
                    adjustedNormals[thisIdx*3] = avgNormal[0];
                    adjustedNormals[thisIdx*3+1] = avgNormal[1];
                    adjustedNormals[thisIdx*3+2] = avgNormal[2];
                    
                    // Also update the neighbor's normal in memory
                    neighborChunk.terrainMesh.geometry.attributes.normal.array[neighborIdx*3] = avgNormal[0];
                    neighborChunk.terrainMesh.geometry.attributes.normal.array[neighborIdx*3+1] = avgNormal[1];
                    neighborChunk.terrainMesh.geometry.attributes.normal.array[neighborIdx*3+2] = avgNormal[2];
                }
            }
            
            // Mark the neighbor's geometry for update
            neighborChunk.terrainMesh.geometry.attributes.normal.needsUpdate = true;
            neighborChunk.terrainMesh.geometry.attributes.position.needsUpdate = true;
        };
        
        // Process each edge with its neighboring chunk
        const neighbors = [
            // [neighborKey, thisEdgeFn, neighborEdgeFn]
            [`${cx - 1},${cz}`, // Left neighbor
                (vpr) => Array.from({length: vpr}, (_, z) => z * vpr), // Left edge 
                (vpr) => Array.from({length: vpr}, (_, z) => z * vpr + (vpr - 1)) // Right edge
            ],
            [`${cx + 1},${cz}`, // Right neighbor
                (vpr) => Array.from({length: vpr}, (_, z) => z * vpr + (vpr - 1)), // Right edge
                (vpr) => Array.from({length: vpr}, (_, z) => z * vpr) // Left edge
            ],
            [`${cx},${cz - 1}`, // Bottom neighbor
                (vpr) => Array.from({length: vpr}, (_, x) => x), // Bottom edge
                (vpr) => Array.from({length: vpr}, (_, x) => (vpr - 1) * vpr + x) // Top edge
            ],
            [`${cx},${cz + 1}`, // Top neighbor
                (vpr) => Array.from({length: vpr}, (_, x) => (vpr - 1) * vpr + x), // Top edge
                (vpr) => Array.from({length: vpr}, (_, x) => x) // Bottom edge
            ]
        ];

        // Process all neighbor edges
        for (const [neighborKey, thisEdgeFn, neighborEdgeFn] of neighbors) {
            processSharedEdge(
                chunkData,
                this.chunks.get(neighborKey),
                thisEdgeFn,
                neighborEdgeFn
            );
        }

        // Fix corner vertices by finding diagonal neighbors
        const cornerVertices = [
            {pos: 0, // Bottom left
             neighbors: [`${cx-1},${cz}`, `${cx},${cz-1}`, `${cx-1},${cz-1}`]},
            {pos: vertexCountPerRow - 1, // Bottom right
             neighbors: [`${cx+1},${cz}`, `${cx},${cz-1}`, `${cx+1},${cz-1}`]},
            {pos: (vertexCountPerRow - 1) * vertexCountPerRow, // Top left
             neighbors: [`${cx-1},${cz}`, `${cx},${cz+1}`, `${cx-1},${cz+1}`]},
            {pos: vertexCountPerRow * vertexCountPerRow - 1, // Top right
             neighbors: [`${cx+1},${cz}`, `${cx},${cz+1}`, `${cx+1},${cz+1}`]}
        ];

        // Process each corner to ensure diagonal neighbors connect properly
        for (const corner of cornerVertices) {
            let validNeighbors = [];
            let sumPos = [0, 0, 0];
            let sumNormal = [0, 0, 0];
            let count = 0;
            
            // Add this chunk's corner
            sumPos[0] += adjustedPositions[corner.pos*3];
            sumPos[1] += adjustedPositions[corner.pos*3+1];
            sumPos[2] += adjustedPositions[corner.pos*3+2];
            sumNormal[0] += adjustedNormals[corner.pos*3];
            sumNormal[1] += adjustedNormals[corner.pos*3+1];
            sumNormal[2] += adjustedNormals[corner.pos*3+2];
            count++;

            // Find corresponding vertices in neighbors
            for (const neighborKey of corner.neighbors) {
                const neighbor = this.chunks.get(neighborKey);
                if (!neighbor || !neighbor.terrainMesh) continue;
                
                // Determine which corner of the neighbor corresponds to our corner
                let neighborCornerPos;
                if (neighborKey === `${cx-1},${cz-1}`) { // Diagonal bottom-left
                    neighborCornerPos = vertexCountPerRow * vertexCountPerRow - 1; // Top-right of neighbor
                } else if (neighborKey === `${cx+1},${cz-1}`) { // Diagonal bottom-right
                    neighborCornerPos = (vertexCountPerRow - 1) * vertexCountPerRow; // Top-left of neighbor
                } else if (neighborKey === `${cx-1},${cz+1}`) { // Diagonal top-left
                    neighborCornerPos = vertexCountPerRow - 1; // Bottom-right of neighbor
                } else if (neighborKey === `${cx+1},${cz+1}`) { // Diagonal top-right
                    neighborCornerPos = 0; // Bottom-left of neighbor
                } else if (neighborKey === `${cx-1},${cz}`) { // Left
                    neighborCornerPos = corner.pos === 0 ? vertexCountPerRow - 1 : 
                                     vertexCountPerRow * vertexCountPerRow - 1;
                } else if (neighborKey === `${cx+1},${cz}`) { // Right
                    neighborCornerPos = corner.pos === vertexCountPerRow - 1 ? 0 : 
                                     (vertexCountPerRow - 1) * vertexCountPerRow;
                } else if (neighborKey === `${cx},${cz-1}`) { // Bottom
                    neighborCornerPos = corner.pos === 0 ? 
                                     (vertexCountPerRow - 1) * vertexCountPerRow : 
                                     vertexCountPerRow * vertexCountPerRow - 1;
                } else if (neighborKey === `${cx},${cz+1}`) { // Top
                    neighborCornerPos = corner.pos === (vertexCountPerRow - 1) * vertexCountPerRow ? 
                                     0 : vertexCountPerRow - 1;
                }

                if (neighborCornerPos !== undefined) {
                    const nGeom = neighbor.terrainMesh.geometry;
                    const nPos = nGeom.attributes.position.array;
                    const nNorm = nGeom.attributes.normal.array;
                    
                    // Calculate world position of neighbor's vertex
                    const worldX = neighbor.terrainMesh.position.x + nPos[neighborCornerPos*3];
                    const worldY = neighbor.terrainMesh.position.y + nPos[neighborCornerPos*3+1];
                    const worldZ = neighbor.terrainMesh.position.z + nPos[neighborCornerPos*3+2];
                    
                    // Add to sums
                    sumPos[0] += worldX - chunkWorldX; // Convert to local coords
                    sumPos[1] += worldY;
                    sumPos[2] += worldZ - chunkWorldZ;
                    sumNormal[0] += nNorm[neighborCornerPos*3];
                    sumNormal[1] += nNorm[neighborCornerPos*3+1];
                    sumNormal[2] += nNorm[neighborCornerPos*3+2];
                    count++;
                    
                    validNeighbors.push({
                        chunk: neighbor,
                        pos: neighborCornerPos
                    });
                }
            }
            
            if (count > 1) {
                // Average positions and normals
                const avgPos = [sumPos[0]/count, sumPos[1]/count, sumPos[2]/count];
                const avgNorm = [sumNormal[0]/count, sumNormal[1]/count, sumNormal[2]/count];
                
                // Normalize the normal
                const mag = Math.sqrt(avgNorm[0]*avgNorm[0] + avgNorm[1]*avgNorm[1] + avgNorm[2]*avgNorm[2]);
                if (mag > 0.00001) {
                    avgNorm[0] /= mag;
                    avgNorm[1] /= mag;
                    avgNorm[2] /= mag;
                }
                
                // Apply to this chunk
                adjustedPositions[corner.pos*3] = avgPos[0];
                adjustedPositions[corner.pos*3+1] = avgPos[1];
                adjustedPositions[corner.pos*3+2] = avgPos[2];
                adjustedNormals[corner.pos*3] = avgNorm[0];
                adjustedNormals[corner.pos*3+1] = avgNorm[1];
                adjustedNormals[corner.pos*3+2] = avgNorm[2];
                
                // Apply to all valid neighbors too
                for (const n of validNeighbors) {
                    const worldX = chunkWorldX + avgPos[0];
                    const worldY = avgPos[1]; // Y position is absolute
                    const worldZ = chunkWorldZ + avgPos[2];
                    
                    // Convert world position to neighbor's local space
                    const neighborLocalX = worldX - n.chunk.terrainMesh.position.x;
                    const neighborLocalY = worldY - n.chunk.terrainMesh.position.y;
                    const neighborLocalZ = worldZ - n.chunk.terrainMesh.position.z;
                    
                    // Apply position and normal
                    const nGeom = n.chunk.terrainMesh.geometry;
                    nGeom.attributes.position.array[n.pos*3] = neighborLocalX;
                    nGeom.attributes.position.array[n.pos*3+1] = neighborLocalY;
                    nGeom.attributes.position.array[n.pos*3+2] = neighborLocalZ;
                    nGeom.attributes.normal.array[n.pos*3] = avgNorm[0];
                    nGeom.attributes.normal.array[n.pos*3+1] = avgNorm[1];
                    nGeom.attributes.normal.array[n.pos*3+2] = avgNorm[2];
                    
                    // Mark for update
                    nGeom.attributes.position.needsUpdate = true;
                    nGeom.attributes.normal.needsUpdate = true;
                }
            }
        }

        // Create geometry with adjusted positions and normals
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.Float32BufferAttribute(adjustedPositions, 3));
        geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
        geometry.setAttribute('normal', new THREE.Float32BufferAttribute(adjustedNormals, 3));
        geometry.setIndex(indices);

        // Improved material settings for gap-free appearance
        const material = new THREE.MeshStandardMaterial({
            vertexColors: true,
            roughness: 0.9, 
            metalness: 0.1,
            side: THREE.FrontSide,
            flatShading: false,
            dithering: true,
            // NEW: Add slight overdraw to help with small gaps
            polygonOffset: true,
            polygonOffsetFactor: -1,  // Slight offset to prevent z-fighting
            polygonOffsetUnits: -1
        });

        // Create mesh with precise positioning
        const mesh = new THREE.Mesh(geometry, material);
        mesh.position.set(chunkWorldX, 0, chunkWorldZ); // Use exact integer positions
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        mesh.material.needsUpdate = true;
        mesh.userData.isTerrain = true;
        this.rootGroup.add(mesh);
        chunkData.terrainMesh = mesh;
        chunkData.geometry = {
          positions: [...geometry.attributes.position.array],
          indices: [...geometry.index.array]
        };
        chunkData.position = new THREE.Vector3(chunkWorldX, 0, chunkWorldZ);
    //    this.chunkGeometry.set(chunkKey, geometry);
        // Generate water mesh
        const waterMesh = this.generateWaterMesh(cx, cz, adjustedPositions);
        if (waterMesh) {
            // Position water mesh exactly to avoid gaps
            waterMesh.position.set(chunkWorldX, 0, chunkWorldZ);
            this.rootGroup.add(waterMesh);
            chunkData.waterMesh = waterMesh;
        }

        // Process vegetation data
        chunkData.collisionAABBs = new Map();
        vegetation.forEach(({ worldObject, data }) => {
            if (worldObject.endsWith('_collision')) {
                const objectType = worldObject.replace('_collision', '');
                chunkData.collisionAABBs.set(objectType, data);
            } else {
                const model = this.game.modelManager.getModel('worldObjectPrefabs', worldObject);
                if (!model) {
                    console.warn(`Model not found: ${worldObject}`);
                    return;
                }
                this.processModelType(worldObject, model, data, chunkData);
            }
        });

        // Force shadow map update to avoid shadow artifacts at boundaries
        this.renderer.shadowMap.needsUpdate = true;

        // Mark chunk as ready
        chunkData.isGenerating = false;
        this.pendingChunks.delete(chunkKey);
    } catch (error) {
        console.error(`Failed to process chunk ${chunkKey}:`, error);
        this.chunks.delete(chunkKey);
        this.pendingChunks.delete(chunkKey);
    }
}

    getStaticAABBs() {
      const cameraChunkX = Math.floor(this.camera.position.x / this.chunkSize);
      const cameraChunkZ = Math.floor(this.camera.position.z / this.chunkSize);
      let staticAABBs = [];

      // Check nearby chunks
      for (let x = cameraChunkX - 1; x <= cameraChunkX + 1; x++) {
        for (let z = cameraChunkZ - 1; z <= cameraChunkZ + 1; z++) {
          staticAABBs = [...staticAABBs, ...this.getStaticAABBsAt(x, z)];
        }
      }
      return staticAABBs;
    }
    getStaticAABBsAt(cx, cz){
      const chunkKey = `${cx},${cz}`;
      const chunkData = this.chunks.get(chunkKey);
      if (!chunkData) return [];
      if(chunkData.collisionAABBs){
        const treeAABBs = chunkData.collisionAABBs.get('tree');

      
        return [...(treeAABBs || [])];        
      }
      return [];
    }
      
    checkTreeCollisions(colliderAABB) {
      const collisions = [];
      const cameraChunkX = Math.floor(this.camera.position.x / this.chunkSize);
      const cameraChunkZ = Math.floor(this.camera.position.z / this.chunkSize);
    
      // Check nearby chunks
      for (let x = cameraChunkX - 1; x <= cameraChunkX + 1; x++) {
        for (let z = cameraChunkZ - 1; z <= cameraChunkZ + 1; z++) {
          const chunkKey = `${x},${z}`;
          const chunkData = this.chunks.get(chunkKey);
          if (!chunkData) continue;
    
          const treeAABBs = chunkData.collisionAABBs.get('tree');
          if(treeAABBs){
            treeAABBs.forEach(aabb => {
              if (this.aabbIntersects(colliderAABB, aabb)) {
                collisions.push(aabb);
              }
            });
          }
          const rockAABBs = chunkData.collisionAABBs.get('rock');
          if(rockAABBs){
            rockAABBs.forEach(aabb => {
              if (this.aabbIntersects(colliderAABB, aabb)) {
                collisions.push(aabb);
              }
            });
          }
        }
      }
      return collisions;
    }
    
    aabbIntersects(aabb1, aabb2) {
      return (
        aabb1.min.x <= aabb2.max.x &&
        aabb1.max.x >= aabb2.min.x &&
        aabb1.min.y <= aabb2.max.y &&
        aabb1.max.y >= aabb2.min.y &&
        aabb1.min.z <= aabb2.max.z &&
        aabb1.max.z >= aabb2.min.z
      );
    }


    update() {
      if (!this.game.getCollections().configs.game.is3D) return;
      this.timer += this.game.deltaTime || 0;
      this.skyDome.position.set(this.camera.position.x, 0, this.camera.position.z); // Center it around the camera
      this.updateChunks();
    
      const cameraPos = this.camera.position;
    
      // Update directional light position smoothly every frame
      this.directionalLight.position.set(cameraPos.x + 500, 500, cameraPos.z + 500);
      this.directionalLight.target.position.set(cameraPos.x, 0, cameraPos.z);
      this.directionalLight.target.updateMatrixWorld();
    
      // Update shadow camera smoothly every frame
      const shadowCamera = this.directionalLight.shadow.camera;
    
      // Center shadow camera on the player's position
      const terrainHeight = this.getTerrainHeight(cameraPos);
      shadowCamera.position.set(cameraPos.x, terrainHeight + 500, cameraPos.z);
      shadowCamera.lookAt(cameraPos.x, terrainHeight, cameraPos.z);
      shadowCamera.updateProjectionMatrix();
      shadowCamera.updateMatrixWorld();
    
      // Only force shadow map update when terrain changes (e.g., new chunks)
      // This is already handled in handleWorkerMessage with this.renderer.shadowMap.needsUpdate = true
    
      for (const key in this.uniforms) {
        this.uniforms[key].time = { value: this.timer };
      }
    
      this.renderer.render(this.scene, this.camera);
    }
  
    onWindowResize() {
   
      if(this.canvas){

        const width = this.container.clientWidth || window.innerWidth;
        const height = this.container.clientHeight || window.innerHeight;
        this.camera.aspect = width / height;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(width, height);
        this.canvas.style.width = `${width}px`;
        this.canvas.style.height = `${height}px`;
      }
    }
  
    processModelType(type, model, instances, chunkData) {
        // Ensure model’s world matrices are up-to-date
        model.updateMatrixWorld(true);
    
        // Collect mesh data with transformations relative to model root
        const meshData = [];
        model.traverse(node => {
          if (node.isMesh) {
            const parent = node.parent;
            const parentWorldMatrix = parent.matrixWorld.clone();
            const localMatrix = node.matrix.clone();
    
            // Compute transformation relative to model root
            const relativeMatrix = new THREE.Matrix4();
            relativeMatrix.copy(parentWorldMatrix);
            relativeMatrix.multiply(localMatrix);
    
            meshData.push({
              mesh: node,
              relativeMatrix: relativeMatrix
            });
          }
        });
    
        if (meshData.length === 0) {
          console.warn(`No meshes found in model: ${type}`);
          return;
        }
    
        // Create instanced meshes for each mesh in the model
        const instanceGroups = meshData.map(({ mesh, relativeMatrix }) => {
          const instancedMesh = new THREE.InstancedMesh(
            mesh.geometry,
            mesh.material.clone(), // Clone material to avoid shared state
            instances.length
          );
          instancedMesh.userData.relativeMatrix = relativeMatrix;
          instancedMesh.castShadow = true;
          instancedMesh.receiveShadow = true;
          instancedMesh.material.needsUpdate = true; // Force material update
          this.rootGroup.add(instancedMesh);
          return { mesh: instancedMesh, instances: [] };
        });
    
        // Set instance transformations
        const matrix = new THREE.Matrix4();
        const dummy = new THREE.Object3D();
    
        instances.forEach((instance, index) => {
          // Set base transformation from worker data
          dummy.position.set(
            instance.position.x,
            instance.position.y,
            instance.position.z
          );
          dummy.rotation.y = instance.rotation;
          dummy.scale.setScalar(instance.scale);
          dummy.updateMatrix();
    
          // Apply base transformation combined with each mesh’s relative matrix
          instanceGroups.forEach((group, meshIndex) => {
            matrix.copy(dummy.matrix);
            matrix.multiply(group.mesh.userData.relativeMatrix);
            group.mesh.setMatrixAt(index, matrix);
            group.instances.push(index);
          });
        });
    
        // Update instance matrices
        instanceGroups.forEach(group => {
          group.mesh.instanceMatrix.needsUpdate = true;
          this.renderer.shadowMap.needsUpdate = true; // Force shadow map update
        });
    
        // Store instance groups in chunk data
        chunkData.objectMeshes.set(type, instanceGroups);
    }
    getTerrainHeight(position) {
      // Create a raycaster
      const raycaster = new THREE.Raycaster();
      
      // Set the ray origin high above the position
      const rayOrigin = new THREE.Vector3(position.x, this.chunkSize * 2, position.z);
      
      // Set the ray direction downward
      const rayDirection = new THREE.Vector3(0, -1, 0);
      raycaster.set(rayOrigin, rayDirection);
      
      // Collect visible terrain chunks to test against
      const chunks = [];
      const cameraChunkX = Math.floor(position.x / this.chunkSize);
      const cameraChunkZ = Math.floor(position.z / this.chunkSize);
      
      // Check nearby chunks (optimization: only check chunks in a certain radius)
      for (let x = cameraChunkX - 1; x <= cameraChunkX + 1; x++) {
        for (let z = cameraChunkZ - 1; z <= cameraChunkZ + 1; z++) {
          const chunkKey = `${x},${z}`;
          const chunkData = this.chunks.get(chunkKey);
          if (chunkData && chunkData.terrainMesh) {
            chunks.push(chunkData.terrainMesh);
          }
        }
      }
      
      // Perform the raycast
      const intersects = raycaster.intersectObjects(chunks, false);
      
      // If there's an intersection, return the y-coordinate
      if (intersects.length > 0) {
        return intersects[0].point.y;
      }
      
      return 0;//this.terrainGenerator.getHeight(position);
    }

    getReflectionAt(position, velocity, restitution) {
        const normal = this.getTerrainNormal(position);
        const dotProduct = 
            velocity.x * normal.x + 
            velocity.y * normal.y + 
            velocity.z * normal.z;
        
        // Only reflect if moving toward the surface
        if (dotProduct < 0) {
            let r = (restitution || 0.3);
            const slopeAmount = 1 - normal.y;
            // Calculate reflection vector correctly (r affects the entire reflection, not just normal component)
            // v_reflect = v - 2(v·n)n then scaled by restitution
            let reflection = new THREE.Vector3(
                velocity.x - 2 * dotProduct * normal.x,
                velocity.y - 2 * dotProduct * normal.y,
                velocity.z - 2 * dotProduct * normal.z
            );


            if(dotProduct > -10 || slopeAmount > .5 ){          
             // r = normal.y;
              r = .99;
              // Scale by restitution (energy loss on bounce)
            }
            reflection.x *= r;
            reflection.y *= r;
            reflection.z *= r;
            
            return reflection;
        } else {
            // Not heading into surface, return original velocity
            return { ...velocity };
        }
    } 
    getTerrainNormal(position) {
        // Create a raycaster
        const raycaster = new THREE.Raycaster();
        
        // Set the ray origin high above the position
        const rayOrigin = new THREE.Vector3(position.x, this.chunkSize * 2, position.z);
        
        // Set the ray direction downward
        const rayDirection = new THREE.Vector3(0, -1, 0);
        raycaster.set(rayOrigin, rayDirection);
        
        // Collect visible terrain chunks to test against
        const chunks = [];
        const cameraChunkX = Math.floor(position.x / this.chunkSize);
        const cameraChunkZ = Math.floor(position.z / this.chunkSize);
        
        // Check nearby chunks
        for (let x = cameraChunkX - 1; x <= cameraChunkX + 1; x++) {
            for (let z = cameraChunkZ - 1; z <= cameraChunkZ + 1; z++) {
                const chunkKey = `${x},${z}`;
                const chunkData = this.chunks.get(chunkKey);
                if (chunkData && chunkData.terrainMesh) {
                    chunks.push(chunkData.terrainMesh);
                }
            }
        }
        
        // Perform the raycast
        const intersects = raycaster.intersectObjects(chunks, false);
        
        // If there's an intersection, return the face normal
        if (intersects.length > 0) {
            return {
                x: intersects[0].face.normal.x,
                y: intersects[0].face.normal.y,
                z: intersects[0].face.normal.z
            };
        }
        
        // Fallback to upward normal if no intersection found
        return { x: 0, y: 1, z: 0 };
    }
    destroy() {
      window.removeEventListener('resize', this.onWindowResizeHandler);
  
      // Cleanup all chunks
      for (const [, chunkData] of this.chunks) {
        if (chunkData.terrainMesh) {
          this.scene.remove(chunkData.terrainMesh);
          chunkData.terrainMesh.geometry.dispose();
          if (chunkData.terrainMesh.material) {
            if (Array.isArray(chunkData.terrainMesh.material)) {
              chunkData.terrainMesh.material.forEach(mat => mat.dispose());
            } else {
              chunkData.terrainMesh.material.dispose();
            }
          }
        }
        chunkData.objectMeshes.forEach((groups, type) => {
          groups.forEach(group => {
            if (group.mesh) {
              this.scene.remove(group.mesh);
              group.mesh.geometry.dispose();
              if (group.mesh.material) {
                if (Array.isArray(group.mesh.material)) {
                  group.mesh.material.forEach(mat => mat.dispose());
                } else {
                  group.mesh.material.dispose();
                }
              }
              group.mesh.dispose();
            }
          });
        });
      }
  
      // Cleanup object pools
      if (this.objectPools) {
        this.objectPools.forEach(pool => {
          if (pool.mesh) {
            this.scene.remove(pool.mesh);
            pool.mesh.geometry.dispose();
            if (pool.mesh.material) {
              if (Array.isArray(pool.mesh.material)) {
                pool.mesh.material.forEach(mat => mat.dispose());
              } else {
                pool.mesh.material.dispose();
              }
            }
            pool.mesh.dispose();
          }
        });
        this.objectPools.clear();
      }
  
      // Cleanup object cache
      this.objectCache.forEach(mesh => {
        this.scene.remove(mesh);
        mesh.geometry.dispose();
        if (mesh.material) {
          if (Array.isArray(mesh.material)) {
            mesh.material.forEach(mat => mat.dispose());
          } else {
            mesh.material.dispose();
          }
        }
      });
      this.objectCache.clear();
  
      // Terminate worker and clean up Blob URL
      if (this.worker) {
        this.worker.terminate();
        this.worker = null;
      }
      this.pendingChunks.clear();
      this.chunks.clear();
      this.scene.remove(this.rootGroup);
    }
    generateWaterMesh(cx, cz, terrainPositions) {
      const chunkKey = `${cx},${cz}`;
  
      // Create a plane with higher resolution for visible waves
      const geometry = new THREE.PlaneGeometry(this.chunkSize, this.chunkSize, 64, 64);
      geometry.rotateX(-Math.PI / 2); // Align with terrain
  
      // Adjust UVs to be continuous across chunks
      const uvAttribute = geometry.attributes.uv;
      const positionAttribute = geometry.attributes.position;
      for (let i = 0; i < uvAttribute.count; i++) {
          const x = positionAttribute.getX(i) + (cx * this.chunkSize + this.chunkSize / 2);
          const z = positionAttribute.getZ(i) + (cz * this.chunkSize + this.chunkSize / 2);
          // Scale UVs based on world position
          uvAttribute.setXY(i, x / this.chunkSize, z / this.chunkSize);
      }
      uvAttribute.needsUpdate = true;
  
      // Parse hex color
      const parseHexColor = (hex) => {
          const r = parseInt(hex.slice(1, 3), 16) / 255;
          const g = parseInt(hex.slice(3, 5), 16) / 255;
          const b = parseInt(hex.slice(5, 7), 16) / 255;
          return { r, g, b };
      };
  
      // Get water shader from configuration
      const waterShader = this.game.getCollections().shaders["water"];
      this.uniforms[chunkKey] = JSON.parse(waterShader.uniforms);
  
      // Set colors (fix color assignment)
      const liquidColorHex = "#1E90FF"; // DodgerBlue for water
      const foamColorHex = "#FFFFFF"; // White for foam
      const liquidColor = parseHexColor(liquidColorHex);
      const foamColor = parseHexColor(foamColorHex);
  
      // Vectorize properties
      const vectorizeProps = waterShader.vectors;
      vectorizeProps.forEach((prop) => {
          if (this.uniforms[chunkKey][prop]) {
              if (prop.toLowerCase().endsWith("color")) {
                  const color = prop.toLowerCase().startsWith("foam") ? foamColor : liquidColor;
                  this.uniforms[chunkKey][prop].value = new THREE.Vector3(color.r, color.g, color.b);
              } else {
                  let arr = this.uniforms[chunkKey][prop].value;
                  this.uniforms[chunkKey][prop].value = new THREE.Vector3(arr[0], arr[1], arr[2]);
              }
          }
      });
  
      // Set additional uniforms
      this.uniforms[chunkKey].fogColor = { value: new THREE.Color(this.fogData.color) };
      this.uniforms[chunkKey].fogDensity = this.fogData.enabled ? { value: this.fogData.density } : { value: 0 };
      const data = new Float32Array(this.chunkResolution * this.chunkResolution);
      for (let z = 0; z < this.chunkResolution; z++) {
        for (let x = 0; x < this.chunkResolution; x++) {
          const index = Math.floor((z * this.chunkResolution + x)*3);
          data[Math.floor(index / 3)] = terrainPositions[index+1];
        }
      }
      const heightmapTexture = new THREE.DataTexture(
        data,
        this.chunkResolution,
        this.chunkResolution,
        THREE.RedFormat,
        THREE.FloatType
      );
      heightmapTexture.needsUpdate = true;

      this.uniforms[chunkKey].terrainHeightmap = { value: heightmapTexture };
      this.uniforms[chunkKey].terrainSize = { value: new THREE.Vector2(this.chunkResolution, this.chunkResolution) };
      this.uniforms[chunkKey].terrainOffset = { value: new THREE.Vector2(cx, cz) };
      this.uniforms[chunkKey].foamWidth = { value: 0.5 }; // Adjust for wider/narrower foam bands
      this.uniforms[chunkKey].foamColor = { value: new THREE.Vector3(1.0, 1.0, 1.0) }; 
      // Create the shader material
      const material = new THREE.ShaderMaterial({
          uniforms: this.uniforms[chunkKey],
          vertexShader: waterShader.vertexScript,
          fragmentShader: waterShader.fragmentScript,
          side: THREE.DoubleSide, // Use DoubleSide to avoid culling issues
          transparent: true
      });
  
      // Create water mesh
      const waterMesh = new THREE.Mesh(geometry, material);
      waterMesh.position.set(cx * this.chunkSize + this.chunkSize / 2, 0.1, cz * this.chunkSize + this.chunkSize / 2); // Center in chunk
      waterMesh.name = `water_${chunkKey}`;
      waterMesh.receiveShadow = true;
  
      return waterMesh;
  }

    getWorkerCode() {
      return `
        ${this.game.getCollections().libraries["SimplexNoise"].script}
  
        ${this.game.getCollections().libraries["TerrainGenerator"].script}
  
        const noise = new SimplexNoise();
        const terrainGenerator = new TerrainGenerator();
        terrainGenerator.init(${JSON.stringify(this.biomes)}, ${this.chunkSize}, ${this.chunkResolution}, noise);
  
        self.onmessage = function(e) {
          const { cx, cz, chunkSize, chunkResolution } = e.data;
          const result = terrainGenerator.generateChunk(cx, cz, chunkSize, chunkResolution);
          self.postMessage(result);
        };
      `;
    }
  }