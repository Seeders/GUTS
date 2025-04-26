class InfiniWorld extends engine.Component {
    init({
      containerSelector = '#gameContainer',
      width = window.innerWidth,
      height = window.innerHeight,
      useControls = false
    }) {
      if (!this.game.config.configs.game.is3D) return;
  
      // Initialize core properties
      this.clock = new THREE.Clock();
      this.onWindowResizeHandler = this.onWindowResize.bind(this);
      this.container = document.querySelector(containerSelector) || document.body;
      this.renderer = new THREE.WebGLRenderer({ antialias: true, canvas: this.game.canvas, alpha: true });
      this.renderer.setSize(width, height);
      this.renderer.shadowMap.enabled = true;
      this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
      this.scene = new THREE.Scene();
      this.scene.background = new THREE.Color(0x87ceeb);
      this.uniforms = {};
  
      // Camera setup
      this.camera = new THREE.PerspectiveCamera(75, width / height, 0.1, 10000);
      this.camera.position.set(0, 50, 100);
      this.camera.lookAt(0, 0, 0);
  
      // Lighting setup
      this.ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
      this.scene.add(this.ambientLight);
      let shadowCameraSize = 500;
      let directionLightDistance = 250;
      this.directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
      this.directionalLight.castShadow = true;
      this.directionalLight.shadow.mapSize.set(2048, 2048); // Increase resolution for sharper shadows
      this.directionalLight.shadow.camera.near = 0.01; // Closer near plane for precision
      this.directionalLight.shadow.camera.far = 2000; // Increase far plane to cover tall terrain
      this.directionalLight.shadow.camera.left = -shadowCameraSize; // Expand bounds
      this.directionalLight.shadow.camera.right = shadowCameraSize;
      this.directionalLight.shadow.camera.top = shadowCameraSize;
      this.directionalLight.shadow.camera.bottom = -shadowCameraSize;
      this.directionalLight.shadow.bias = -0.00001; // Add bias to reduce shadow acne
      this.directionalLight.shadow.normalBias = 0.75; // Reduce artifacts on slopes
      this.directionalLight.position.set(this.camera.position.x + directionLightDistance, directionLightDistance, this.camera.position.z + directionLightDistance);
      this.scene.add(this.directionalLight);
  
      // Fog setup
      this.scene.fog = new THREE.FogExp2(0x87ceeb, 0.0002);
  
      // Terrain configuration
      this.chunkSize = 512;
      this.chunkResolution = 32;
      this.renderDistance = 8;
      this.chunks = new Map();
      this.heightScale = 10;
      this.objectCache = new Map();
  
      // Initialize SimplexNoise and biomes for getTerrainHeight
      this.noise = new (this.game.libraryClasses.SimplexNoise)(); // Fixed seed for consistency
      this.biomes = {
        plains: {
          groundColor: { r: 0.502, g: 0.753, b: 0.439 }, // Matches worker
          noiseSettings: {
            elevation: { scale: 0.0002, octaves: 4, persistence: 0.5, lacunarity: 2.0, heightScale: 10 },
            detail: { scale: 0.001, octaves: 2, persistence: 0.8, lacunarity: 1.5, heightScale: 2 }
          },
          objects: [
            { type: 'tree', density: 0.02, maxSlope: 0.8 },
            { type: 'rock', density: 0.01, maxSlope: 0.3 }
          ]
        },
        forest: {
          groundColor: { r: 0.251, g: 0.502, b: 0.251 }, // Matches worker
          noiseSettings: {
            elevation: { scale: 0.0003, octaves: 5, persistence: 0.6, lacunarity: 2.2, heightScale: 15 },
            detail: { scale: 0.001, octaves: 3, persistence: 0.7, lacunarity: 1.8, heightScale: 3 }
          },
          objects: [
            { type: 'tree', density: 0.05, maxSlope: 0.8 },
            { type: 'rock', density: 0.05, maxSlope: 0.2 }
          ]
        },
        mountain: {
          groundColor: { r: 0.565, g: 0.565, b: 0.565 }, // Matches worker
          noiseSettings: {
            elevation: { scale: 0.00005, octaves: 6, persistence: 0.7, lacunarity: 2.5, heightScale: 200 },
            detail: { scale: 0.002, octaves: 4, persistence: 0.6, lacunarity: 2.0, heightScale: 5 },
            ridge: { scale: 0.001, power: 2.5, heightScale: 20 }
          },
          objects: [{ type: 'rock', density: 0.3, maxSlope: 0.6 }]
        },
        desert: {
          groundColor: { r: 0.878, g: 0.753, b: 0.439 }, // Matches worker
          noiseSettings: {
            elevation: { scale: 0.0001, octaves: 3, persistence: 0.4, lacunarity: 1.8, heightScale: 5 },
            detail: { scale: 0.001, octaves: 2, persistence: 0.5, lacunarity: 1.3, heightScale: 1 }
          },
          objects: [{ type: 'rock', density: 0.1, maxSlope: 0.25 }]
        }
      };
  
      // Initialize Web Worker from Blob
      const workerCode = this.getWorkerCode();
      const blob = new Blob([workerCode], { type: 'application/javascript' });
      this.worker = new Worker(URL.createObjectURL(blob));
      this.worker.onmessage = this.handleWorkerMessage.bind(this);
      this.pendingChunks = new Map();
  
      // Initialize terrain
      this.setupInitialChunks();
  
      window.addEventListener('resize', this.onWindowResizeHandler);
      this.game.scene = this.scene;
      this.game.camera = this.camera;
      this.game.renderer = this.renderer;
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
        const pool = new (this.game.libraryClasses.InstancePool)(geometry, material, 1000);
        this.scene.add(pool.mesh);
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
  
      // Generate up to maxChunksPerFrame
      for (let i = 0; i < Math.min(maxChunksPerFrame, chunksToGenerate.length); i++) {
        const { x, z } = chunksToGenerate[i];
        await this.generateChunk(x, z);
      }
  
      // Remove old chunks
      for (const [chunkKey, chunkData] of this.chunks) {
        if (!newChunks.has(chunkKey) && !chunkData.isGenerating) {
          if (chunkData.terrainMesh) {
            this.scene.remove(chunkData.terrainMesh);
            chunkData.terrainMesh.geometry.dispose();
            chunkData.terrainMesh.material.dispose();
          }
          chunkData.objectMeshes.forEach((groups, type) => {
            groups.forEach(group => {
              if (group.mesh) {
                this.scene.remove(group.mesh);
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
        }
      }
    }
  
    handleWorkerMessage(e) {
      const { cx, cz, positions, indices, colors, normals, vegetation } = e.data;
      const chunkKey = `${cx},${cz}`;
      const chunkData = this.pendingChunks.get(chunkKey);
      if (!chunkData) return;
    
      try {
        // Attempt to weld vertices with neighboring chunks
        this.weldChunkVertices(cx, cz, positions, normals);
        
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
        geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
        geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
        geometry.setIndex(indices);
    
        const material = new THREE.MeshStandardMaterial({
          vertexColors: true,
          roughness: 0.8,
          metalness: 0.0,
          side: THREE.FrontSide
        });
        
        const mesh = new THREE.Mesh(geometry, material);
        mesh.position.set(cx * this.chunkSize, 0, cz * this.chunkSize);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        mesh.material.needsUpdate = true;
        this.scene.add(mesh);
        chunkData.terrainMesh = mesh;
    
        // Process vegetation data (unchanged)
        chunkData.collisionAABBs = new Map();
        vegetation.forEach(({ type, data }) => {
          if (type.endsWith('_collision')) {
            const objectType = type.replace('_collision', '');
            chunkData.collisionAABBs.set(objectType, data);
          } else {
            const model = this.game.modelManager.getModel('worldObjects', type);
            if (!model) {
              console.warn(`Model not found: ${type}`);
              return;
            }
            this.processModelType(type, model, data, chunkData);
          }
        });
        
        this.renderer.shadowMap.needsUpdate = true;
    
        chunkData.isGenerating = false;
        this.pendingChunks.delete(chunkKey);
      } catch (error) {
        console.error(`Failed to process chunk ${chunkKey}:`, error);
        this.chunks.delete(chunkKey);
        this.pendingChunks.delete(chunkKey);
      }
    }
    
    weldChunkVertices(cx, cz, positions, normals) {
      const res = this.chunkResolution;
      const neighborChunks = [
        { key: `${cx-1},${cz}`, edge: 'right', dir: 'left' },   // Left neighbor
        { key: `${cx+1},${cz}`, edge: 'left', dir: 'right' },   // Right neighbor
        { key: `${cx},${cz-1}`, edge: 'top', dir: 'bottom' },   // Bottom neighbor
        { key: `${cx},${cz+1}`, edge: 'bottom', dir: 'top' }    // Top neighbor
      ];
      
      // Process each potential neighbor
      neighborChunks.forEach(({ key, edge, dir }) => {
        const neighbor = this.chunks.get(key);
        if (!neighbor || !neighbor.terrainMesh) return;
    
        const neighborGeom = neighbor.terrainMesh.geometry;
        const neighborPos = neighborGeom.attributes.position;
        const neighborNorm = neighborGeom.attributes.normal;
        
        // Function to get vertex index
        const getVertexIndex = (x, z) => (z * (res + 1) + x);
        
        // Weld vertices along the shared edge
        if (dir === 'left') {
          // Current chunk's left edge to neighbor's right edge
          for (let z = 0; z <= res; z++) {
            const thisIdx = getVertexIndex(0, z);
            const neighborIdx = getVertexIndex(res, z);
            
            // Get world position from neighbor
            const nx = neighborPos.array[neighborIdx * 3] + neighbor.terrainMesh.position.x;
            const ny = neighborPos.array[neighborIdx * 3 + 1] + neighbor.terrainMesh.position.y;
            const nz = neighborPos.array[neighborIdx * 3 + 2] + neighbor.terrainMesh.position.z;
            
            // Convert to local position for this chunk
            positions[thisIdx * 3] = nx - cx * this.chunkSize;
            positions[thisIdx * 3 + 1] = ny;
            positions[thisIdx * 3 + 2] = nz - cz * this.chunkSize;
            
            // Average the normals
            for (let i = 0; i < 3; i++) {
              normals[thisIdx * 3 + i] = (normals[thisIdx * 3 + i] + neighborNorm.array[neighborIdx * 3 + i]) / 2;
            }
            
            // Normalize the normal
            const nx1 = normals[thisIdx * 3];
            const ny1 = normals[thisIdx * 3 + 1];
            const nz1 = normals[thisIdx * 3 + 2];
            const len = Math.sqrt(nx1*nx1 + ny1*ny1 + nz1*nz1);
            if (len > 0.00001) {
              normals[thisIdx * 3] = nx1 / len;
              normals[thisIdx * 3 + 1] = ny1 / len;
              normals[thisIdx * 3 + 2] = nz1 / len;
            }
          }
        } else if (dir === 'right') {
          // Current chunk's right edge to neighbor's left edge
          for (let z = 0; z <= res; z++) {
            const thisIdx = getVertexIndex(res, z);
            const neighborIdx = getVertexIndex(0, z);
            
            // Get world position from neighbor
            const nx = neighborPos.array[neighborIdx * 3] + neighbor.terrainMesh.position.x;
            const ny = neighborPos.array[neighborIdx * 3 + 1] + neighbor.terrainMesh.position.y;
            const nz = neighborPos.array[neighborIdx * 3 + 2] + neighbor.terrainMesh.position.z;
            
            // Convert to local position for this chunk
            positions[thisIdx * 3] = nx - cx * this.chunkSize;
            positions[thisIdx * 3 + 1] = ny;
            positions[thisIdx * 3 + 2] = nz - cz * this.chunkSize;
            
            // Average the normals
            for (let i = 0; i < 3; i++) {
              normals[thisIdx * 3 + i] = (normals[thisIdx * 3 + i] + neighborNorm.array[neighborIdx * 3 + i]) / 2;
            }
            
            // Normalize the normal
            const nx1 = normals[thisIdx * 3];
            const ny1 = normals[thisIdx * 3 + 1];
            const nz1 = normals[thisIdx * 3 + 2];
            const len = Math.sqrt(nx1*nx1 + ny1*ny1 + nz1*nz1);
            if (len > 0.00001) {
              normals[thisIdx * 3] = nx1 / len;
              normals[thisIdx * 3 + 1] = ny1 / len;
              normals[thisIdx * 3 + 2] = nz1 / len;
            }
          }
        } else if (dir === 'bottom') {
          // Current chunk's bottom edge to neighbor's top edge
          for (let x = 0; x <= res; x++) {
            const thisIdx = getVertexIndex(x, 0);
            const neighborIdx = getVertexIndex(x, res);
            
            // Get world position from neighbor
            const nx = neighborPos.array[neighborIdx * 3] + neighbor.terrainMesh.position.x;
            const ny = neighborPos.array[neighborIdx * 3 + 1] + neighbor.terrainMesh.position.y;
            const nz = neighborPos.array[neighborIdx * 3 + 2] + neighbor.terrainMesh.position.z;
            
            // Convert to local position for this chunk
            positions[thisIdx * 3] = nx - cx * this.chunkSize;
            positions[thisIdx * 3 + 1] = ny;
            positions[thisIdx * 3 + 2] = nz - cz * this.chunkSize;
            
            // Average the normals
            for (let i = 0; i < 3; i++) {
              normals[thisIdx * 3 + i] = (normals[thisIdx * 3 + i] + neighborNorm.array[neighborIdx * 3 + i]) / 2;
            }
            
            // Normalize the normal
            const nx1 = normals[thisIdx * 3];
            const ny1 = normals[thisIdx * 3 + 1];
            const nz1 = normals[thisIdx * 3 + 2];
            const len = Math.sqrt(nx1*nx1 + ny1*ny1 + nz1*nz1);
            if (len > 0.00001) {
              normals[thisIdx * 3] = nx1 / len;
              normals[thisIdx * 3 + 1] = ny1 / len;
              normals[thisIdx * 3 + 2] = nz1 / len;
            }
          }
        } else if (dir === 'top') {
          // Current chunk's top edge to neighbor's bottom edge
          for (let x = 0; x <= res; x++) {
            const thisIdx = getVertexIndex(x, res);
            const neighborIdx = getVertexIndex(x, 0);
            
            // Get world position from neighbor
            const nx = neighborPos.array[neighborIdx * 3] + neighbor.terrainMesh.position.x;
            const ny = neighborPos.array[neighborIdx * 3 + 1] + neighbor.terrainMesh.position.y;
            const nz = neighborPos.array[neighborIdx * 3 + 2] + neighbor.terrainMesh.position.z;
            
            // Convert to local position for this chunk
            positions[thisIdx * 3] = nx - cx * this.chunkSize;
            positions[thisIdx * 3 + 1] = ny;
            positions[thisIdx * 3 + 2] = nz - cz * this.chunkSize;
            
            // Average the normals
            for (let i = 0; i < 3; i++) {
              normals[thisIdx * 3 + i] = (normals[thisIdx * 3 + i] + neighborNorm.array[neighborIdx * 3 + i]) / 2;
            }
            
            // Normalize the normal
            const nx1 = normals[thisIdx * 3];
            const ny1 = normals[thisIdx * 3 + 1];
            const nz1 = normals[thisIdx * 3 + 2];
            const len = Math.sqrt(nx1*nx1 + ny1*ny1 + nz1*nz1);
            if (len > 0.00001) {
              normals[thisIdx * 3] = nx1 / len;
              normals[thisIdx * 3 + 1] = ny1 / len;
              normals[thisIdx * 3 + 2] = nz1 / len;
            }
          }
        }
        
        // Update the neighbor's geometry to match the welds
        neighborGeom.attributes.position.needsUpdate = true;
        neighborGeom.attributes.normal.needsUpdate = true;
      });
    }
  
    checkTreeCollisions(playerAABB) {
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
              if (this.aabbIntersects(playerAABB, aabb)) {
                collisions.push(aabb);
              }
            });
          }
          const rockAABBs = chunkData.collisionAABBs.get('rock');
          if(rockAABBs){
            rockAABBs.forEach(aabb => {
              if (this.aabbIntersects(playerAABB, aabb)) {
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
      if (!this.game.config.configs.game.is3D) return;
      this.timer += this.game.deltaTime || 0;
      this.updateChunks();
    
      const cameraPos = this.camera.position;
    
      // Update directional light position smoothly every frame
      this.directionalLight.position.set(cameraPos.x + 500, 500, cameraPos.z + 500);
      this.directionalLight.target.position.set(cameraPos.x, 0, cameraPos.z);
      this.directionalLight.target.updateMatrixWorld();
    
      // Update shadow camera smoothly every frame
      const shadowCamera = this.directionalLight.shadow.camera;
    
      // Center shadow camera on the player's position
      const terrainHeight = this.getTerrainHeight(cameraPos.x, cameraPos.z);
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
      const width = this.container.clientWidth || window.innerWidth;
      const height = this.container.clientHeight || window.innerHeight;
      this.camera.aspect = width / height;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(width, height);
      this.game.canvas.style.width = `${width}px`;
      this.game.canvas.style.height = `${height}px`;
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
          this.scene.add(instancedMesh);
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
    
  
    getTerrainHeight(x, z) {
      const weights = this.getBiomeWeights(x, z);
      let totalHeight = 0;
  
      for (const biomeName in weights) {
        const weight = weights[biomeName];
        if (weight === 0) continue;
  
        const biome = this.biomes[biomeName];
        let height = 0;
  
        // Elevation noise
        height += this.fractalNoise(x, z, biome.noiseSettings.elevation);
  
        // Detail noise
        height += this.fractalNoise(x * 2, z * 2, biome.noiseSettings.detail);
  
        // Ridge noise for mountains only
        if (biomeName === 'mountain' && biome.noiseSettings.ridge) {
          const ridgeNoise = Math.abs(this.noise.noise2D(
            x * biome.noiseSettings.ridge.scale,
            z * biome.noiseSettings.ridge.scale
          ));
          height += Math.pow(ridgeNoise, biome.noiseSettings.ridge.power) * biome.noiseSettings.ridge.heightScale;
        }
  
        totalHeight += height * weight;
      }
  
      return totalHeight;
    }
  
    getBiomeWeights(wx, wz) {
      const biomeNoise = this.noise.noise2D(wx * 0.00001, wz * 0.00001);
      const biomeValue = (biomeNoise + 1) / 2;
      const weights = {};
      const thresholds = [
        { biome: 'plains', range: [0.0, 0.4] },
        { biome: 'forest', range: [0.2, 0.6] },
        { biome: 'mountain', range: [0.5, 0.8] },
        { biome: 'desert', range: [0.7, 1.0] }
      ];
    
      thresholds.forEach(({ biome, range }) => {
        const [min, max] = range;
        let weight = 0;
        if (biomeValue >= min && biomeValue <= max) {
          weight = 1 - Math.abs(biomeValue - (min + max) / 2) / ((max - min) / 2);
          weight = Math.max(0, weight);
        }
        weights[biome] = Math.round(weight * 1000) / 1000; // Round weights for consistency
      });
    
      const totalWeight = Object.values(weights).reduce((sum, w) => sum + w, 0);
      if (totalWeight > 0) {
        for (const biome in weights) {
          weights[biome] = Math.round((weights[biome] / totalWeight) * 1000) / 1000;
        }
      } else {
        weights.plains = 1;
      }
      return weights;
    }
  
    fractalNoise(x, y, settings) {
      let value = 0;
      let amplitude = 1;
      let frequency = 1;
  
      for (let i = 0; i < settings.octaves; i++) {
        value += this.noise.noise2D(x * frequency * settings.scale, y * frequency * settings.scale) * amplitude;
        amplitude *= settings.persistence;
        frequency *= settings.lacunarity;
      }
      return value * settings.heightScale;
    }
  
    onDestroy() {
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
      this.renderer.dispose();
      this.renderer.forceContextLoss();
  
      this.game.scene = null;
      this.game.camera = null;
      this.game.renderer = null;
    }
  
    getWorkerCode() {
      return `
        ${this.game.config.libraries["SimplexNoise"].script}
  
        class WorkerUtils {
          constructor() {
            this.noise = new SimplexNoise();
            this.biomes = ${JSON.stringify(this.biomes)};
            this.chunkSize = ${this.chunkSize};
            this.chunkResolution = ${this.chunkResolution};
          }

          fractalNoise(x, y, settings) {
            let value = 0;
            let amplitude = 1;
            let frequency = 1;
            for (let i = 0; i < settings.octaves; i++) {
              value += this.noise.noise2D(x * frequency * settings.scale, y * frequency * settings.scale) * amplitude;
              amplitude *= settings.persistence;
              frequency *= settings.lacunarity;
            }
            return value * settings.heightScale;
          }

          getBiomeWeights(wx, wz) {
            const biomeNoise = this.noise.noise2D(wx * 0.00001, wz * 0.00001);
            const biomeValue = (biomeNoise + 1) / 2;
            const weights = {};
            const thresholds = [
              { biome: 'plains', range: [0.0, 0.4] },
              { biome: 'forest', range: [0.2, 0.6] },
              { biome: 'mountain', range: [0.5, 0.8] },
              { biome: 'desert', range: [0.7, 1.0] }
            ];

            thresholds.forEach(({ biome, range }) => {
              const [min, max] = range;
              let weight = 0;
              if (biomeValue >= min && biomeValue <= max) {
                weight = 1 - Math.abs(biomeValue - (min + max) / 2) / ((max - min) / 2);
                weight = Math.max(0, weight);
              }
              weights[biome] = weight;
            });

            const totalWeight = Object.values(weights).reduce((sum, w) => sum + w, 0);
            if (totalWeight > 0) {
              for (const biome in weights) {
                weights[biome] /= totalWeight;
              }
            } else {
              weights.plains = 1;
            }
            return weights;
          }

          getHeight(wx, wz) {
            const weights = this.getBiomeWeights(wx, wz);
            let totalHeight = 0;
            for (const biomeName in weights) {
              const weight = weights[biomeName];
              if (weight === 0) continue;
              const biome = this.biomes[biomeName];
              let height = 0;
              height += this.fractalNoise(wx, wz, biome.noiseSettings.elevation);
              height += this.fractalNoise(wx * 2, wz * 2, biome.noiseSettings.detail);
              if (biomeName === 'mountain' && biome.noiseSettings.ridge) {
                const ridgeNoise = Math.abs(this.noise.noise2D(wx * biome.noiseSettings.ridge.scale, wz * biome.noiseSettings.ridge.scale));
                height += Math.pow(ridgeNoise, biome.noiseSettings.ridge.power) * biome.noiseSettings.ridge.heightScale;
              }
              totalHeight += height * weight;
            }
            return totalHeight;
          }

          calculateSlope(wx, wz) {
            const delta = 1.0;
            const dx = this.getHeight(wx + delta, wz) - this.getHeight(wx - delta, wz);
            const dz = this.getHeight(wx, wz + delta) - this.getHeight(wx, wz - delta);
            return Math.sqrt(dx * dx + dz * dz) / (2 * delta);
          }

          generateChunk(cx, cz, chunkSize, chunkResolution) {
            const geometryData = {
                positions: [],
                colors: [],
                normals: [],
                biomeMap: []
              };

              const size = chunkSize / chunkResolution;
              // Generate positions
              for (let z = 0; z <= chunkResolution; z++) {
                for (let x = 0; x <= chunkResolution; x++) {
                  const vx = x * size - chunkSize / 2;
                  const vz = z * size - chunkSize / 2;
                  const wx = cx * chunkSize + vx;
                  const wz = cz * chunkSize + vz;
                  const height = this.getHeight(wx, wz);
                  geometryData.positions.push(vx, height, vz);
                  geometryData.biomeMap.push({
                    weights: this.getBiomeWeights(wx, wz),
                    position: { x: wx, y: height, z: wz },
                    slope: this.calculateSlope(wx, wz)
                  });
                }
              }

              // Initialize normals and contribution counters
              const normals = new Array(geometryData.positions.length).fill(0);
              const contributions = new Array(geometryData.positions.length / 3).fill(0);
              const indices = [];

              for (let z = 0; z < chunkResolution; z++) {
                for (let x = 0; x < chunkResolution; x++) {
                  const a = x + (z * (chunkResolution + 1));
                  const b = a + 1;
                  const c = a + chunkResolution + 1;
                  const d = c + 1;
                  
                  // Use counterclockwise winding order
                  indices.push(a, c, b); // First triangle
                  indices.push(c, d, b); // Second triangle

                  // Compute vertices positions for normal calculation
                  const v0 = [
                    geometryData.positions[a * 3], 
                    geometryData.positions[a * 3 + 1], 
                    geometryData.positions[a * 3 + 2]
                  ];
                  const v1 = [
                    geometryData.positions[b * 3], 
                    geometryData.positions[b * 3 + 1], 
                    geometryData.positions[b * 3 + 2]
                  ];
                  const v2 = [
                    geometryData.positions[c * 3], 
                    geometryData.positions[c * 3 + 1], 
                    geometryData.positions[c * 3 + 2]
                  ];
                  const v3 = [
                    geometryData.positions[d * 3], 
                    geometryData.positions[d * 3 + 1], 
                    geometryData.positions[d * 3 + 2]
                  ];

                  // First triangle (a, c, b)
                  let edge1 = [v2[0] - v0[0], v2[1] - v0[1], v2[2] - v0[2]]; // c - a
                  let edge2 = [v1[0] - v0[0], v1[1] - v0[1], v1[2] - v0[2]]; // b - a
                  let normal1 = [
                    edge1[1] * edge2[2] - edge1[2] * edge2[1],
                    edge1[2] * edge2[0] - edge1[0] * edge2[2],
                    edge1[0] * edge2[1] - edge1[1] * edge2[0]
                  ];
                  
                  let mag1 = Math.sqrt(normal1[0] * normal1[0] + normal1[1] * normal1[1] + normal1[2] * normal1[2]);
                  if (mag1 < 0.00001) {
                    normal1 = [0, 1, 0]; // Default upward normal
                  } else {
                    normal1[0] /= mag1;
                    normal1[1] /= mag1;
                    normal1[2] /= mag1;
                    if (normal1[1] < 0) {
                      normal1[0] = -normal1[0];
                      normal1[1] = -normal1[1];
                      normal1[2] = -normal1[2];
                    }
                  }

                  // Second triangle (c, d, b)
                  let edge3 = [v3[0] - v2[0], v3[1] - v2[1], v3[2] - v2[2]]; // d - c
                  let edge4 = [v1[0] - v2[0], v1[1] - v2[1], v1[2] - v2[2]]; // b - c
                  let normal2 = [
                    edge3[1] * edge4[2] - edge3[2] * edge4[1],
                    edge3[2] * edge4[0] - edge3[0] * edge4[2],
                    edge3[0] * edge4[1] - edge3[1] * edge4[0]
                  ];
                  
                  let mag2 = Math.sqrt(normal2[0] * normal2[0] + normal2[1] * normal2[1] + normal2[2] * normal2[2]);
                  if (mag2 < 0.00001) {
                    normal2 = [0, 1, 0]; // Default upward normal
                  } else {
                    normal2[0] /= mag2;
                    normal2[1] /= mag2;
                    normal2[2] /= mag2;
                    if (normal2[1] < 0) {
                      normal2[0] = -normal2[0];
                      normal2[1] = -normal2[1];
                      normal2[2] = -normal2[2];
                    }
                  }

                  // Accumulate normals at each vertex
                  // First triangle (a, c, b)
                  normals[a * 3] += normal1[0];
                  normals[a * 3 + 1] += normal1[1];
                  normals[a * 3 + 2] += normal1[2];
                  contributions[a]++;
                  
                  normals[c * 3] += normal1[0];
                  normals[c * 3 + 1] += normal1[1];
                  normals[c * 3 + 2] += normal1[2];
                  contributions[c]++;
                  
                  normals[b * 3] += normal1[0];
                  normals[b * 3 + 1] += normal1[1];
                  normals[b * 3 + 2] += normal1[2];
                  contributions[b]++;
                  
                  // Second triangle (c, d, b)
                  normals[c * 3] += normal2[0];
                  normals[c * 3 + 1] += normal2[1];
                  normals[c * 3 + 2] += normal2[2];
                  
                  normals[d * 3] += normal2[0];
                  normals[d * 3 + 1] += normal2[1];
                  normals[d * 3 + 2] += normal2[2];
                  contributions[d]++;
                  
                  normals[b * 3] += normal2[0];
                  normals[b * 3 + 1] += normal2[1];
                  normals[b * 3 + 2] += normal2[2];
                }
              }

              // Normalize accumulated vertex normals
              for (let i = 0; i < contributions.length; i++) {
                if (contributions[i] > 0) {
                  const idx = i * 3;
                  const nx = normals[idx];
                  const ny = normals[idx + 1];
                  const nz = normals[idx + 2];
                  
                  const mag = Math.sqrt(nx * nx + ny * ny + nz * nz);
                  
                  if (mag > 0.00001) {
                    normals[idx] = nx / mag;
                    normals[idx + 1] = ny / mag;
                    normals[idx + 2] = nz / mag;
                  } else {
                    // Default normal for degenerate cases
                    normals[idx] = 0;
                    normals[idx + 1] = 1;
                    normals[idx + 2] = 0;
                  }
                } else {
                  // Should never happen if mesh is properly constructed
                  const idx = i * 3;
                  normals[idx] = 0;
                  normals[idx + 1] = 1;
                  normals[idx + 2] = 0;
                }
              }

              geometryData.normals = normals;

            // Rest of the vegetation and color generation remains the same
            geometryData.biomeMap.forEach(({ weights }) => {
              let r = 0, g = 0, b = 0;
              for (const biomeName in weights) {
                const weight = weights[biomeName];
                const { r: br, g: bg, b: bb } = this.biomes[biomeName].groundColor;
                r += br * weight;
                g += bg * weight;
                b += bb * weight;
              }
              geometryData.colors.push(r, g, b);
            });

            // Vegetation generation (unchanged)
            const vegetation = new Map();
            geometryData.biomeMap.forEach(({ weights, position, slope }) => {
              const objectTypes = new Map();
              for (const biomeName in weights) {
                const biome = this.biomes[biomeName];
                biome.objects.forEach(objDef => {
                  if (!objectTypes.has(objDef.type)) {
                    objectTypes.set(objDef.type, []);
                  }
                  objectTypes.get(objDef.type).push({
                    density: objDef.density,
                    maxSlope: objDef.maxSlope,
                    weight: weights[biomeName]
                  });
                });
              }

              objectTypes.forEach((defs, type) => {
                let blendedDensity = 0;
                let blendedMaxSlope = 0;
                let totalWeight = 0;

                defs.forEach(def => {
                  blendedDensity += def.density * def.weight;
                  blendedMaxSlope += def.maxSlope * def.weight;
                  totalWeight += def.weight;
                });

                if (totalWeight === 0) return;

                blendedDensity /= totalWeight;
                blendedMaxSlope /= totalWeight;

                const instances = vegetation.get(type) || [];
                const collisionData = vegetation.get(type + '_collision') || [];

                if (Math.random() < blendedDensity && slope <= blendedMaxSlope) {
                  const instance = {
                    position: { x: position.x, y: position.y - 5, z: position.z },
                    rotation: Math.random() * Math.PI * 2,
                    scale: 0.8 + Math.random() * 0.4
                  };
                  instances.push(instance);

                  let aabb;
                  if (type === 'tree') {
                    const trunkRadius = 5.0 * instance.scale;
                    const trunkHeight = 20.0 * instance.scale;
                    aabb = {
                      min: {
                        x: position.x - trunkRadius,
                        y: position.y,
                        z: position.z - trunkRadius
                      },
                      max: {
                        x: position.x + trunkRadius,
                        y: position.y + trunkHeight,
                        z: position.z + trunkRadius
                      }
                    };
                  } else if (type === 'rock') {
                    const rockRadius = 1.0 * instance.scale;
                    const rockHeight = 1.0 * instance.scale;
                    aabb = {
                      min: {
                        x: position.x - rockRadius,
                        y: position.y,
                        z: position.z - rockRadius
                      },
                      max: {
                        x: position.x + rockRadius,
                        y: position.y + rockHeight,
                        z: position.z + rockRadius
                      }
                    };
                  }

                  if (aabb) {
                    collisionData.push(aabb);
                  }
                }

                vegetation.set(type, instances);
                if (collisionData.length > 0) {
                  vegetation.set(type + '_collision', collisionData);
                }
              });
            });

            return {
              cx,
              cz,
              positions: geometryData.positions,
              indices,
              colors: geometryData.colors,
              normals: geometryData.normals, // Include normals in the result
              vegetation: Array.from(vegetation.entries()).map(([type, data]) => ({ type, data }))
            };
          }
        }

  
        const utils = new WorkerUtils();
  
        self.onmessage = function(e) {
          const { cx, cz, chunkSize, chunkResolution } = e.data;
          const result = utils.generateChunk(cx, cz, chunkSize, chunkResolution);
          self.postMessage(result);
        };
      `;
    }
  }