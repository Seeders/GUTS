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
      this.directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
      this.directionalLight.position.set(500, 500, 500);
      this.directionalLight.castShadow = true;
      this.directionalLight.shadow.mapSize.set(1024, 1024);
      this.directionalLight.shadow.camera.near = 0.5;
      this.directionalLight.shadow.camera.far = 2000;
      this.directionalLight.shadow.camera.left = -1000;
      this.directionalLight.shadow.camera.right = 1000;
      this.directionalLight.shadow.camera.top = 1000;
      this.directionalLight.shadow.camera.bottom = -1000;
      this.scene.add(this.directionalLight);
  
      // Fog setup
      this.scene.fog = new THREE.FogExp2(0x87ceeb, 0.0002);
  
      // Terrain configuration
      this.chunkSize = 128;
      this.chunkResolution = 16;
      this.renderDistance = 16;
      this.chunks = new Map();
      this.heightScale = 10;
      this.objectCache = new Map();
  
      // Initialize SimplexNoise and biomes for getTerrainHeight
      this.noise = new (this.game.libraryClasses.SimplexNoise)(12345); // Fixed seed for consistency
      this.biomes = {
        plains: {
          groundColor: { r: 0.502, g: 0.753, b: 0.439 }, // Matches worker
          noiseSettings: {
            elevation: { scale: 0.0002, octaves: 4, persistence: 0.5, lacunarity: 2.0, heightScale: 10 },
            detail: { scale: 0.01, octaves: 2, persistence: 0.8, lacunarity: 1.5, heightScale: 2 }
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
            detail: { scale: 0.015, octaves: 3, persistence: 0.7, lacunarity: 1.8, heightScale: 3 }
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
            detail: { scale: 0.02, octaves: 4, persistence: 0.6, lacunarity: 2.0, heightScale: 5 },
            ridge: { scale: 0.001, power: 2.5, heightScale: 20 }
          },
          objects: [{ type: 'rock', density: 0.3, maxSlope: 0.6 }]
        },
        desert: {
          groundColor: { r: 0.878, g: 0.753, b: 0.439 }, // Matches worker
          noiseSettings: {
            elevation: { scale: 0.0001, octaves: 3, persistence: 0.4, lacunarity: 1.8, heightScale: 5 },
            detail: { scale: 0.005, octaves: 2, persistence: 0.5, lacunarity: 1.3, heightScale: 1 }
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
      const { cx, cz, positions, indices, colors, vegetation } = e.data;
      const chunkKey = `${cx},${cz}`;
      const chunkData = this.pendingChunks.get(chunkKey);
      if (!chunkData) return;
  
      try {
        // Create geometry
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
        geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
        geometry.setIndex(indices);
        geometry.computeVertexNormals();
  
        // Flip normals
        const normals = geometry.attributes.normal.array;
        for (let i = 0; i < normals.length; i += 3) {
          normals[i + 1] *= -1;
        }
        geometry.attributes.normal.needsUpdate = true;
  
        // Create terrain mesh
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
        this.scene.add(mesh);
        chunkData.terrainMesh = mesh;
  
        // Process vegetation
        vegetation.forEach(({ type, instances }) => {
          const model = this.game.modelManager.getModel("worldObjects", type);
          if (!model) {
            console.warn(`Model not found: ${type}`);
            return;
          }
          this.processModelType(type, model, instances, chunkData);
        });
  
        chunkData.isGenerating = false;
        this.pendingChunks.delete(chunkKey);
      } catch (error) {
        console.error(`Failed to process chunk ${chunkKey}:`, error);
        this.chunks.delete(chunkKey);
        this.pendingChunks.delete(chunkKey);
      }
    }
  
    update() {
      if (!this.game.config.configs.game.is3D) return;
      this.timer += this.game.deltaTime || 0;
      this.updateChunks(); // Non-blocking, no await
  
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
      const meshes = [];
      model.traverse(child => {
        if (child instanceof THREE.Mesh) {
          meshes.push({
            geometry: child.geometry,
            material: child.material.clone()
          });
        }
      });
  
      const instanceGroups = meshes.map(({ geometry, material }) => {
        const instancedMesh = new THREE.InstancedMesh(geometry, material, instances.length);
        this.scene.add(instancedMesh);
        return { mesh: instancedMesh, instances: [] };
      });
  
      instances.forEach((instance, index) => {
        instanceGroups.forEach(group => {
          const matrix = new THREE.Matrix4().compose(
            new THREE.Vector3(instance.position.x, instance.position.y, instance.position.z),
            new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), instance.rotation),
            new THREE.Vector3().setScalar(instance.scale)
          );
          group.mesh.setMatrixAt(index, matrix);
          group.instances.push(index);
        });
      });
  
      instanceGroups.forEach(group => {
        group.mesh.instanceMatrix.needsUpdate = true;
      });
  
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
        // SimplexNoise implementation (based on Stefan Gustavson's algorithm)
        class SimplexNoise {
          constructor(seed = 12345) { // Fixed seed for consistency
            // Permutation table for randomization
            this.perm = new Uint8Array(256);
            this.seed = seed;
            this.initPermutation();
          }
  
          // Initialize permutation table with a seed
          initPermutation() {
            for (let i = 0; i < 256; i++) {
              this.perm[i] = i;
            }
            // Shuffle using a simple seeded random
            let rand = this.seededRandom();
            for (let i = 255; i > 0; i--) {
              const j = Math.floor(rand() * (i + 1));
              [this.perm[i], this.perm[j]] = [this.perm[j], this.perm[i]];
            }
          }
  
          // Simple seeded random number generator
          seededRandom() {
            let x = Math.sin(this.seed++) * 10000;
            return () => {
              x = Math.sin(x + this.seed++) * 10000;
              return x - Math.floor(x);
            };
          }
  
          // 2D Simplex noise function
          noise2D(x, y) {
            // Skew input coordinates to simplex grid
            const s = (x + y) * 0.366025403784; // F = (sqrt(3) - 1) / 2
            const i = Math.floor(x + s);
            const j = Math.floor(y + s);
  
            // Unskew back to get simplex cell origin
            const t = (i + j) * 0.211324865405; // G = (3 - sqrt(3)) / 6
            const X0 = i - t;
            const Y0 = j - t;
            const x0 = x - X0;
            const y0 = y - Y0;
  
            // Determine which simplex we're in
            const i1 = x0 > y0 ? 1 : 0;
            const j1 = x0 > y0 ? 0 : 1;
  
            // Offsets for second and third corners
            const x1 = x0 - i1 + 0.211324865405;
            const y1 = y0 - j1 + 0.211324865405;
            const x2 = x0 - 1 + 0.42264973081;
            const y2 = y0 - 1 + 0.42264973081;
  
            // Gradient indices
            const gi0 = this.perm[(i + this.perm[j & 255]) & 255] % 4;
            const gi1 = this.perm[(i + i1 + this.perm[(j + j1) & 255]) & 255] % 4;
            const gi2 = this.perm[(i + 1 + this.perm[(j + 1) & 255]) & 255] % 4;
  
            // Calculate contributions from each corner
            const n0 = this.contribution(x0, y0, gi0);
            const n1 = this.contribution(x1, y1, gi1);
            const n2 = this.contribution(x2, y2, gi2);
  
            // Sum contributions and normalize to [-1, 1]
            return (n0 + n1 + n2) * 70; // Scale to approximate [-1, 1]
          }
  
          // Calculate contribution from a corner
          contribution(x, y, gi) {
            // Distance falloff
            const t = 0.5 - x * x - y * y;
            if (t < 0) return 0;
  
            // Gradient vectors (simplified 2D)
            const gradients = [
              [1, 1], [-1, 1], [1, -1], [-1, -1]
            ];
            const grad = gradients[gi];
            const t2 = t * t;
            return t2 * t2 * (grad[0] * x + grad[1] * y);
          }
        }
  
        // Worker logic for chunk generation
        class WorkerUtils {
          constructor() {
            this.noise = new SimplexNoise(12345); // Fixed seed for consistency
            this.biomes = ${JSON.stringify(this.biomes)};
            this.chunkSize = 128;
            this.chunkResolution = 16;
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
  
            const indices = [];
            for (let z = 0; z < chunkResolution; z++) {
              for (let x = 0; x < chunkResolution; x++) {
                const a = x + (z * (chunkResolution + 1));
                const b = a + 1;
                const c = a + chunkResolution + 1;
                const d = c + 1;
                indices.push(a, c, b);
                indices.push(b, c, d);
              }
            }
  
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
  
            const vegetation = new Map();
            geometryData.biomeMap.forEach(({ weights, position, slope }) => {
              const biomeName = Object.keys(weights).reduce((a, b) => weights[a] > weights[b] ? a : b);
              const biome = this.biomes[biomeName];
              biome.objects.forEach(objDef => {
                if (Math.random() < objDef.density && slope <= objDef.maxSlope) {
                  const instances = vegetation.get(objDef.type) || [];
                  instances.push({
                    position: { x: position.x, y: position.y + 0.2, z: position.z },
                    rotation: Math.random() * Math.PI * 2,
                    scale: 0.8 + Math.random() * 0.4
                  });
                  vegetation.set(objDef.type, instances);
                }
              });
            });
  
            return {
              cx,
              cz,
              positions: geometryData.positions,
              indices,
              colors: geometryData.colors,
              vegetation: Array.from(vegetation.entries()).map(([type, instances]) => ({ type, instances }))
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