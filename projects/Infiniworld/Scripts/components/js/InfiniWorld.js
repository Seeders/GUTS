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
      this.uniforms = {};
  
      // Camera setup
      this.camera = this.game.camera || new THREE.PerspectiveCamera(75, width / height, 0.1, 10000);
     
      // Terrain configuration
      this.heightMap = this.game.getCollections().heightMaps[this.world.heightMap];
      this.chunkSize = this.heightMap.chunkSize;
      this.chunkResolution = this.heightMap.chunkResolution;
      this.renderDistance = this.heightMap.renderDistance;
      this.heightScale = this.heightMap.heightScale;

      // Lighting setup
      this.lighting = this.game.getCollections().lightings[this.world.lighting];  
      this.shadow = this.game.getCollections().shadows[this.world.shadow];  
      this.fog = this.game.getCollections().fogs[this.world.fog];       
      
      
      const skyColor = parseInt(this.lighting.skyColor.replace('#', ''), 16);
      this.scene.background = new THREE.Color(skyColor);

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
      const fogColor = parseInt(this.fog.color.replace('#', ''), 16);
      this.fog = new THREE.FogExp2(fogColor, this.fog.density);
      this.scene.fog = this.fog;
      
  
      this.chunks = new Map();
      this.objectCache = new Map();
  
      // Initialize SimplexNoise and biomes for getTerrainHeight
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
            worldObjects: worldObjectSpawns
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
  
      // Generate up to maxChunksPerFrame
      for (let i = 0; i < Math.min(maxChunksPerFrame, chunksToGenerate.length); i++) {
        const { x, z } = chunksToGenerate[i];
        await this.generateChunk(x, z);
      }
  
      // Remove old chunks
      for (const [chunkKey, chunkData] of this.chunks) {
        if (!newChunks.has(chunkKey) && !chunkData.isGenerating) {
          if (chunkData.terrainMesh) {
            this.rootGroup.remove(chunkData.terrainMesh);
            chunkData.terrainMesh.geometry.dispose();
            chunkData.terrainMesh.material.dispose();
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
        this.rootGroup.add(mesh);
        chunkData.terrainMesh = mesh;
    
        // Process vegetation data (unchanged)
        chunkData.collisionAABBs = new Map();
        vegetation.forEach(({ worldObject, data }) => {
          if (worldObject.endsWith('_collision')) {
            const objectType = worldObject.replace('_collision', '');
            chunkData.collisionAABBs.set(objectType, data);
          } else {
            const model = this.game.modelManager.getModel('worldObjects', worldObject);
            if (!model) {
              console.warn(`Model not found: ${worldObject}`);
              return;
            }
            this.processModelType(worldObject, model, data, chunkData);
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
    getTerrainHeight(x, z) {
      return this.terrainGenerator.getHeight(x, z);
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
  
    getWorkerCode() {
      return `
        ${this.game.getCollections().libraries["SimplexNoise"].script}
  
        ${this.game.getCollections().libraries["TerrainGenerator"].script}
  
        const terrainGenerator = new TerrainGenerator();
        terrainGenerator.init(${JSON.stringify(this.biomes)}, ${this.chunkSize}, ${this.chunkResolution});
  
        self.onmessage = function(e) {
          const { cx, cz, chunkSize, chunkResolution } = e.data;
          const result = terrainGenerator.generateChunk(cx, cz, chunkSize, chunkResolution);
          self.postMessage(result);
        };
      `;
    }
  }