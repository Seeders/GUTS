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
      this.camera = new THREE.PerspectiveCamera(this.cameraData.fov, width / height, this.cameraData.near, this.cameraData.far);
    	this.composer = new THREE_.EffectComposer( this.renderer );
      this.pixelSize = 1;
      const renderPixelatedPass = new THREE_.RenderPixelatedPass( this.pixelSize, this.scene, this.camera );
      window.GUTS.postProcessors = {};
      window.GUTS.postProcessors.pixelPass = renderPixelatedPass;
      renderPixelatedPass.normalEdgeStrength = 0;
      
			this.composer.addPass( renderPixelatedPass );
			const outputPass = new THREE_.OutputPass();
			this.composer.addPass( outputPass );
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
      const skyGeometry = new THREE.SphereGeometry(this.cameraData.far * .9, 32, 32); // Large enough to enclose the scene
     
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
            range: biomeObjData.range,
            groundRestitution: biomeObjData.groundRestitution
          }

          if(biomeName == "mountain"){     
            let ridgeNoiseData = this.game.getCollections().noiseSettings[biomeObjData.ridgeNoiseSetting];
            biomes[biomeName].noiseSettings.ridge = ridgeNoiseData;
          }
      });
      this.biomes = biomes;
      this.terrainGenerator = new (this.game.moduleManager.libraryClasses.TerrainGenerator)(); 
      this.terrainGenerator.init(this.biomes, this.chunkSize, this.chunkResolution, this.noise);
  
      this.grassPerChunk = 131072;//2^17;
      // Initialize Web Worker from Blob
      this.grassTasks = [];
      this.grassBatchSize = 10000; // Process 10,000 instances per frame
      this.currentGrassTaskIndex = 0;

      this.pendingChunks = new Map();
      this.chunkGeometry = new Map();
      this.staticAABBsToRemove = [];
      this.grassBladeWidth = 4; // Adjusted for chunk scale
      this.grassBladeHeight = 10;
      this.grassShader = this.game.getCollections().shaders["grass"];
      const workerCode = this.getWorkerCode();
      const blob = new Blob([workerCode], { type: 'application/javascript' });
      this.worker = new Worker(URL.createObjectURL(blob));
      this.worker.onmessage = this.handleWorkerMessage.bind(this);
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
          this.generateChunk(x, z);
      }
      this.staticAABBsToRemove = [];
      const physics = this.game.gameEntity?.getComponent('game').physics;
      // Remove old chunks
      for (const [chunkKey, chunkData] of this.chunks) {
          if (!newChunks.has(chunkKey) && !chunkData.isGenerating) {
              let parts = chunkKey.split(',');
              let cx = parts[0];
              let cz = parts[1];
              this.staticAABBsToRemove = [...this.staticAABBsToRemove, ...this.getStaticAABBsAt(cx, cz)];
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
              if (chunkData.grassMesh) {
                  this.rootGroup.remove(chunkData.grassMesh);
                  chunkData.grassMesh.geometry.dispose();
                  chunkData.grassMesh.material.dispose();
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
              chunkData.grassData = null;
              physics.removeChunkColliders(cx, cz);
              this.chunks.delete(chunkKey);
              this.uniforms.delete(chunkKey);
          }
      }   
   
  }

  async updateGrassTasks() {
    if(this.grassTasks.length == 0) return;
    if(!this.currentGrassTask){
      this.currentGrassTask = this.grassTasks.pop();
    }
    const grassMesh = this.currentGrassTask.grassMesh;
    const dummy = new THREE.Object3D();
    let finishedChunk = false;
    // Use pre-computed grass data
    for(let i = 0; i < this.grassBatchSize; i++){
      let currentIndex = this.currentGrassTaskIndex + i;
      if (currentIndex >= this.grassPerChunk){
          this.currentGrassTaskIndex = 0;
          this.currentGrassTask = null;
          finishedChunk = true;
          grassMesh.needsUpdate = true;
          break; // Safety check
      }      
      const grass = this.currentGrassTask.grassData[currentIndex];

      dummy.position.set(grass.position.x, grass.position.y, grass.position.z);
      dummy.rotation.set(0, grass.rotation, 0);
      dummy.scale.set(grass.scale, grass.scale, grass.scale);
      dummy.updateMatrix();
      grassMesh.setMatrixAt(currentIndex, dummy.matrix);      
    };
    if(!finishedChunk){
      this.currentGrassTaskIndex += this.grassBatchSize;
    } 
    

  }

  getStaticAABBsToRemove() {
    return this.staticAABBsToRemove;
  }

  handleWorkerMessage(e) {      
    const { cx, cz, positions, indices, colors, normals, vegetation, grassData, restitution, friction } = e.data;
    const chunkKey = `${cx},${cz}`;
    const chunkData = this.pendingChunks.get(chunkKey);
    if (!chunkData) return;
    chunkData.cx = cx;
    chunkData.cz = cz;
    try {
        // Copy positions and normals for manipulation
        const adjustedPositions = positions.slice();
        const adjustedNormals = normals.slice();
        const vertexCountPerRow = this.chunkResolution + 1;

        chunkData.grassData = grassData;
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
          indices: [...geometry.index.array],
          normals: [...geometry.attributes.normal.array],
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

        // Add grass to chunk
        const grassMesh = this.addGrassToTerrain(cx, cz, grassData);
        if (grassMesh) {
          grassMesh.position.set(chunkWorldX, 0, chunkWorldZ);
          this.rootGroup.add(grassMesh);
          chunkData.grassMesh = grassMesh;
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
        chunkData.restitution = restitution;
        chunkData.friction = friction;
        // Mark chunk as ready
        chunkData.isGenerating = false;
        this.game.gameEntity?.getComponent('game').physics.addChunkCollider(chunkData);
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

  getStaticAABBsAt(cx, cz) {
      const chunkKey = `${cx},${cz}`;
      const chunkData = this.chunks.get(chunkKey);
      if (!chunkData || !chunkData.collisionAABBs) return [];

      let rockAndTreeAABBs = [];
      
      // Iterate through all collision types
      for (const [key, aabbs] of chunkData.collisionAABBs) {
          // Check if key ends with 'tree'
          if (key.endsWith('tree') || key.endsWith('rock')) {
              rockAndTreeAABBs = [...rockAndTreeAABBs, ...(aabbs || [])];
          }
      }
      
      return rockAndTreeAABBs;
  }
    
  checkStaticObjectCollisions(colliderAABB) {
    const collisions = [];
    const cameraChunkX = Math.floor(this.camera.position.x / this.chunkSize);
    const cameraChunkZ = Math.floor(this.camera.position.z / this.chunkSize);
  
    // Check nearby chunks
    for (let x = cameraChunkX - 1; x <= cameraChunkX + 1; x++) {
      for (let z = cameraChunkZ - 1; z <= cameraChunkZ + 1; z++) {
        const chunkKey = `${x},${z}`;
        const chunkData = this.chunks.get(chunkKey);
        if (!chunkData) continue;
  
        const treeAndRockAABBs = this.getStaticAABBsAt(x, z);
        if(treeAndRockAABBs){
          treeAndRockAABBs.forEach(aabb => {
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
   // this.updateGrassTasks(); // Process grass tasks incrementally

    const cameraPos = this.camera.position;
  
    // Update directional light position smoothly every frame
    this.directionalLight.position.set(cameraPos.x + 500, 500, cameraPos.z + 500);
    this.directionalLight.target.position.set(cameraPos.x, 0, cameraPos.z);
    this.directionalLight.target.updateMatrixWorld();
  
    // Update shadow camera smoothly every frame
    const shadowCamera = this.directionalLight.shadow.camera;
  
    // Center shadow camera on the player's position
    //const terrainHeight = this.getTerrainHeight(cameraPos);
    shadowCamera.position.set(cameraPos.x, 500, cameraPos.z);
    shadowCamera.lookAt(cameraPos.x, 0, cameraPos.z);
    shadowCamera.updateProjectionMatrix();
    shadowCamera.updateMatrixWorld();
  
    // Only force shadow map update when terrain changes (e.g., new chunks)
    // This is already handled in handleWorkerMessage with this.renderer.shadowMap.needsUpdate = true
    
  for (const [key, value] of this.uniforms.entries()) {
      value.time = { value: this.timer };
      value.cameraPosition = { value: { x: this.camera.position.x, y: this.camera.position.y, z: this.camera.position.z } };
  }
  	const rendererSize = this.renderer.getSize( new THREE.Vector2() );
    const aspectRatio = rendererSize.x / rendererSize.y;
  	this.pixelAlignFrustum( this.camera, aspectRatio, Math.floor( rendererSize.x / this.pixelSize ),
					Math.floor( rendererSize.y / this.pixelSize ) );

    this.renderer.render(this.scene, this.camera);
		this.composer.render();
  }
  pixelAlignFrustum( camera, aspectRatio, pixelsPerScreenWidth, pixelsPerScreenHeight ) {

			// 0. Get Pixel Grid Units
			const worldScreenWidth = ( ( camera.right - camera.left ) / camera.zoom );
			const worldScreenHeight = ( ( camera.top - camera.bottom ) / camera.zoom );
			const pixelWidth = worldScreenWidth / pixelsPerScreenWidth;
			const pixelHeight = worldScreenHeight / pixelsPerScreenHeight;

			// 1. Project the current camera position along its local rotation bases
			const camPos = new THREE.Vector3(); camera.getWorldPosition( camPos );
			const camRot = new THREE.Quaternion(); camera.getWorldQuaternion( camRot );
			const camRight = new THREE.Vector3( 1.0, 0.0, 0.0 ).applyQuaternion( camRot );
			const camUp = new THREE.Vector3( 0.0, 1.0, 0.0 ).applyQuaternion( camRot );
			const camPosRight = camPos.dot( camRight );
			const camPosUp = camPos.dot( camUp );

			// 2. Find how far along its position is along these bases in pixel units
			const camPosRightPx = camPosRight / pixelWidth;
			const camPosUpPx = camPosUp / pixelHeight;

			// 3. Find the fractional pixel units and convert to world units
			const fractX = camPosRightPx - Math.round( camPosRightPx );
			const fractY = camPosUpPx - Math.round( camPosUpPx );

			// 4. Add fractional world units to the left/right top/bottom to align with the pixel grid
			camera.left = - aspectRatio - ( fractX * pixelWidth );
			camera.right = aspectRatio - ( fractX * pixelWidth );
			camera.top = 1.0 - ( fractY * pixelHeight );
			camera.bottom = - 1.0 - ( fractY * pixelHeight );
			camera.updateProjectionMatrix();

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
        instancedMesh.material.transparent = false;
        instancedMesh.material.alphaTest = 0.1; // Set alpha test for transparency
        instancedMesh.material.needsUpdate = true; // Force material update
        instancedMesh.material.side = THREE.DoubleSide; // Set side to double for better visibility
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
getInterpolatedTerrainHeight(position) {
    // Determine the chunk containing the position
    let chunkX = Math.floor(position.x / this.chunkSize);
    let chunkZ = Math.floor(position.z / this.chunkSize);
    let localX = position.x - (chunkX * this.chunkSize);
    let localZ = position.z - (chunkZ * this.chunkSize);

    // Adjust chunk selection for boundary positions
    const halfChunk = this.chunkSize / 2;
    let chunkKey;
    if (localX === halfChunk) {
        chunkX += 1;
        localX -= this.chunkSize;
    } else if (localX === -halfChunk) {
        chunkX -= 1;
        localX += this.chunkSize;
    }
    if (localZ === halfChunk) {
        chunkZ += 1;
        localZ -= this.chunkSize;
    } else if (localZ === -halfChunk) {
        chunkZ -= 1;
        localZ += this.chunkSize;
    }
    chunkKey = `${chunkX},${chunkZ}`;

    // Get chunk data
    const chunkData = this.chunks.get(chunkKey);
    if (!chunkData || !chunkData.terrainMesh) {
        // Fallback to terrain generator if chunk is not loaded
        return this.terrainGenerator.getHeight({ x: position.x, z: position.z });
    }

    const terrainPositions = chunkData.terrainMesh.geometry.attributes.position.array;
    const vertexCountPerRow = this.chunkResolution + 1; // e.g., 33 for 32x32 tiles
    const step = this.chunkSize / this.chunkResolution; // e.g., 1024 / 32 = 32 units per tile

    // Map to grid coordinates (0 to chunkResolution)
    const x = (localX + this.chunkSize / 2) / step; // Map from [-chunkSize/2, chunkSize/2] to [0, chunkResolution]
    const z = (localZ + this.chunkSize / 2) / step;

    // Clamp grid coordinates to avoid out-of-bounds access
    const xIdx = Math.min(Math.max(Math.floor(x), 0), this.chunkResolution - 1);
    const zIdx = Math.min(Math.max(Math.floor(z), 0), this.chunkResolution - 1);
    const fx = Math.min(Math.max(x - xIdx, 0), 1); // Fractional part for interpolation
    const fz = Math.min(Math.max(z - zIdx, 0), 1);

    // Get heights of the four surrounding vertices
    const posIdx = (zIdx * vertexCountPerRow + xIdx) * 3;
    const h00 = terrainPositions[posIdx + 1]; // Height at (xIdx, zIdx)
    const h10 = xIdx + 1 < vertexCountPerRow ? terrainPositions[posIdx + 3 + 1] : h00; // Height at (xIdx+1, zIdx)
    const h01 = zIdx + 1 < vertexCountPerRow ? terrainPositions[(zIdx + 1) * vertexCountPerRow * 3 + xIdx * 3 + 1] : h00; // Height at (xIdx, zIdx+1)
    const h11 = xIdx + 1 < vertexCountPerRow && zIdx + 1 < vertexCountPerRow ? terrainPositions[(zIdx + 1) * vertexCountPerRow * 3 + (xIdx + 1) * 3 + 1] : h00; // Height at (xIdx+1, zIdx+1)

    // Perform bilinear interpolation
    const height = h00 * (1 - fx) * (1 - fz) +
                   h10 * fx * (1 - fz) +
                   h01 * (1 - fx) * fz +
                   h11 * fx * fz;

    return height;
}
  getTerrainHeight(position, useRaycast = false) {
  //    return this.getInterpolatedTerrainHeight(position);
    if(!useRaycast){      
      return this.terrainGenerator.getHeight(position);
    }
    // Create a raycaster
    const raycaster = new THREE.Raycaster();
    
    // Set the ray origin high above the position
    const rayOrigin = new THREE.Vector3(position.x, position.y + 10, position.z);
    
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
      return this.terrainGenerator.getReflectionAt(position, velocity, restitution);
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
    // window.removeEventListener('resize', this.onWindowResizeHandler); // Uncomment if needed

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
      if (chunkData.waterMesh) {
        this.scene.remove(chunkData.waterMesh);
        chunkData.waterMesh.geometry.dispose();
        chunkData.waterMesh.material.dispose();
      }
      if (chunkData.grassMesh) {
        this.scene.remove(chunkData.grassMesh);
        chunkData.grassMesh.geometry.dispose();
        chunkData.grassMesh.material.dispose();
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

    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
    this.pendingChunks.clear();
    this.chunks.clear();
    this.uniforms.clear();
    this.scene.remove(this.rootGroup);
  }


  generateWaterMesh(cx, cz, terrainPositions) {
    return;
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
  addGrassToTerrain(cx, cz, grassData) {
if(!grassData) return;
    const chunkKey = `${cx},${cz}`;
    const grassGeometry = this.createCurvedBladeGeometry(grassData.bladeWidth, grassData.bladeHeight);
    grassGeometry.translate(0, -grassData.bladeHeight * 0.6, 0);

    grassGeometry.setAttribute('instancePhase', new THREE.InstancedBufferAttribute(grassData.phases, 1));

    const grassTexture = this.createGrassTexture(grassData);
    const grassShader = this.grassShader;
    this.uniforms.set(`grass_${chunkKey}`, JSON.parse(grassShader.uniforms));

    const uniforms = this.uniforms.get(`grass_${chunkKey}`);
    uniforms.windDirection = { value: new THREE.Vector2(uniforms.windDirection.value[0], uniforms.windDirection.value[1]).normalize() };
    uniforms.map = { value: grassTexture };
    uniforms.fogColor = { value: new THREE.Color(this.fogData.color) };
    uniforms.fogDensity = this.fogData.enabled ? { value: this.fogData.density } : { value: 0 };
    const lightDirection = new THREE.Vector3();
    lightDirection.subVectors(this.directionalLight.position, this.directionalLight.target.position);
    lightDirection.normalize();
    // uniforms.directionalLightColor = { value: new THREE.Color(this.lighting.directionalColor) };
    // uniforms.directionalLightIntensity = { value: this.lighting.directionalIntensity };
    // uniforms.directionalLightDirection = { value: lightDirection };
    // uniforms.ambientLightColor = { value: new THREE.Color(this.lighting.ambientColor) };
    // uniforms.ambientLightIntensity = { value: this.lighting.ambientIntensity };
    uniforms.skyColor = { value: new THREE.Color(this.lighting.skyColor) };
    uniforms.groundColor = { value: new THREE.Color(this.lighting.groundColor) };
    uniforms.hemisphereIntensity = { value: this.lighting.hemisphereIntensity };
    uniforms.time = { value: this.timer };
    uniforms.cameraPosition = { value: new THREE.Vector3(0, 0, 0) }; // Updated dynamically
    uniforms.maxDistance = { value: 500.0 };

    const grassMaterial = new THREE.ShaderMaterial({
      vertexShader: grassShader.vertexScript,
      fragmentShader: grassShader.fragmentScript,
      uniforms: uniforms,
      side: THREE.DoubleSide
    });

    grassGeometry.computeVertexNormals();
    const grassMesh = new THREE.InstancedMesh(grassGeometry, grassMaterial, grassData.grassPerChunk);
    grassMesh.castShadow = false;
    grassMesh.receiveShadow = false;
    grassMesh.name = `grass_${chunkKey}`;
    const dummy = new THREE.Object3D();    
    // Use pre-computed grass data
    grassData.transforms.forEach((grass, index)=>{
      dummy.position.set(grass.position.x, grass.position.y, grass.position.z);
      dummy.rotation.set(0, grass.rotation, 0);
      dummy.scale.set(grass.scale, grass.scale, grass.scale);
      dummy.updateMatrix();
      grassMesh.setMatrixAt(index, dummy.matrix);      
    });
    grassMesh.needsUpdate = true;
    return grassMesh;
  }
  createCurvedBladeGeometry(width = 0.1, height = 1) {
    const shape = new THREE.Shape();
    shape.moveTo(0, -height, 0);
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

      const t = y / height;
      const curveX = width * 0.5 * (1 - t);
      const tangent = new THREE.Vector2(curveX - x, y - (y - height * 0.5)).normalize();
      const normal = new THREE.Vector2(-tangent.y, tangent.x);
      newNormals[posIndex] = normal.x;
      newNormals[posIndex + 1] = 0;
      newNormals[posIndex + 2] = normal.y;
    }

    shapeGeom.setAttribute('uv', new THREE.BufferAttribute(newUVs, 2));
    shapeGeom.setAttribute('normal', new THREE.BufferAttribute(newNormals, 3));
    return shapeGeom;
  }

  createGrassTexture(grassData) {
    const canvas = document.createElement('canvas');
    canvas.width = 4;
    canvas.height = 32;
    const ctx = canvas.getContext('2d');
    const gradient = ctx.createLinearGradient(0, canvas.height, 0, 0);
    gradient.addColorStop(0.0, grassData.baseColor);
    gradient.addColorStop(0.8, grassData.baseColor);
    gradient.addColorStop(1.0, grassData.tipColor);

    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const texture = new THREE.CanvasTexture(canvas);
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.ClampToEdgeWrapping;
    texture.magFilter = THREE.NearestFilter;
    texture.minFilter = THREE.NearestFilter;
    return texture;
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