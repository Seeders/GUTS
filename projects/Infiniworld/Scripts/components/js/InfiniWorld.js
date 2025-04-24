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
        this.noise = new (this.game.libraryClasses.SimplexNoise)();
        this.heightScale = 10;
        
        // Enhanced noise parameters
        this.terrainNoiseSettings = {
            elevation: {
                scale: 0.002,
                octaves: 4,
                persistence: 0.5,
                lacunarity: 2.0,
            },
            detail: {
                scale: 0.002,
                octaves: 2,
                persistence: 0.8,
                lacunarity: 1.5,
            },
            ridge: {
                scale: 0.001,
                power: 2.5,
            },
            biome: {
                scale: 0.00001,
                transitionSharpness: 4.0,
            }
        };

        // Biome definitions
        this.biomes = {
            plains: {
                objects: [
                    { type: 'tree', density: 0.02, maxSlope: 0.8 },
                    { type: 'rock', density: 0.01, maxSlope: 0.3 }
                ],
                groundColor: new THREE.Color(0x80c070),
                noiseSettings: {
                    elevation: {
                        scale: 0.0002,
                        octaves: 4,
                        persistence: 0.5,
                        lacunarity: 2.0,
                        heightScale: 10
                    },
                    detail: {
                        scale: 0.01,
                        octaves: 2,
                        persistence: 0.8,
                        lacunarity: 1.5,
                        heightScale: 2
                    }
                }
            },
            forest: {
                objects: [
                    { type: 'tree', density: 0.05, maxSlope: 0.8 },
                    { type: 'rock', density: 0.05, maxSlope: 0.2 }
                ],
                groundColor: new THREE.Color(0x408040),
                noiseSettings: {
                    elevation: {
                        scale: 0.0003,
                        octaves: 5,
                        persistence: 0.6,
                        lacunarity: 2.2,
                        heightScale: 15
                    },
                    detail: {
                        scale: 0.015,
                        octaves: 3,
                        persistence: 0.7,
                        lacunarity: 1.8,
                        heightScale: 3
                    }
                }
            },
            mountain: {
                objects: [
                    { type: 'rock', density: 0.3, maxSlope: 0.6 }
                ],
                groundColor: new THREE.Color(0x909090),
                noiseSettings: {
                    elevation: {
                        scale: 0.00005,
                        octaves: 6,
                        persistence: 0.7,
                        lacunarity: 2.5,
                        heightScale: 200
                    },
                    detail: {
                        scale: 0.02,
                        octaves: 4,
                        persistence: 0.6,
                        lacunarity: 2.0,
                        heightScale: 5
                    },
                    ridge: {
                        scale: 0.001,
                        power: 2.5,
                        heightScale: 20
                    }
                }
            },
            desert: {
                objects: [
                    { type: 'rock', density: 0.1, maxSlope: 0.25 }
                ],
                groundColor: new THREE.Color(0xe0c070),
                noiseSettings: {
                    elevation: {
                        scale: 0.0001,
                        octaves: 3,
                        persistence: 0.4,
                        lacunarity: 1.8,
                        heightScale: 5 // Low height for flatter terrain
                    },
                    detail: {
                        scale: 0.005,
                        octaves: 2,
                        persistence: 0.5,
                        lacunarity: 1.3,
                        heightScale: 1 // Minimal detail for smooth dunes
                    }
                }
            }
        };
        this.objectCache = new Map(); // Cache for instanced meshes

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
    getHeight(wx, wz) {
        const weights = this.getBiomeWeights(wx, wz);
        let totalHeight = 0;
        
        for (const biomeName in weights) {
            const weight = weights[biomeName];
            if (weight === 0) continue;
            
            const biome = this.biomes[biomeName];
            let height = 0;
            
            // Elevation noise
            height += this.fractalNoise(wx, wz, biome.noiseSettings.elevation);
            
            // Detail noise
            height += this.fractalNoise(wx * 2, wz * 2, biome.noiseSettings.detail);
            
            // Ridge noise for mountains only
            if (biomeName === 'mountain' && biome.noiseSettings.ridge) {
                const ridgeNoise = Math.abs(this.noise.noise2D(
                    wx * biome.noiseSettings.ridge.scale,
                    wz * biome.noiseSettings.ridge.scale
                ));
                height += Math.pow(ridgeNoise, biome.noiseSettings.ridge.power) * biome.noiseSettings.ridge.heightScale;
            }
            
            totalHeight += height * weight;
        }
        
        return totalHeight;
    }

    fractalNoise(x, y, settings) {
        let value = 0;
        let amplitude = 1;
        let frequency = 1;
        
        for (let i = 0; i < settings.octaves; i++) {
            value += this.noise.noise2D(
                x * frequency * settings.scale,
                y * frequency * settings.scale
            ) * amplitude;
            
            amplitude *= settings.persistence;
            frequency *= settings.lacunarity;
        }
        return value * settings.heightScale;
    }
    getBiomeWeights(wx, wz) {
        const biomeNoise = this.noise.noise2D(
            wx * 0.00001, // Use a low scale for gradual biome transitions
            wz * 0.00001
        );
        
        const biomeValue = (biomeNoise + 1) / 2; // Normalize to [0, 1]
        const weights = {};
        
        // Define biome thresholds with overlap for blending
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
                // Linear interpolation within the range
                weight = 1 - Math.abs(biomeValue - (min + max) / 2) / ((max - min) / 2);
                weight = Math.max(0, weight); // Clamp to [0, 1]
            }
            weights[biome] = weight;
        });
        
        // Normalize weights to sum to 1
        const totalWeight = Object.values(weights).reduce((sum, w) => sum + w, 0);
        if (totalWeight > 0) {
            for (const biome in weights) {
                weights[biome] /= totalWeight;
            }
        } else {
            // Fallback to plains if no weights are assigned
            weights.plains = 1;
        }
        
        return weights;
    }
    getBiome(wx, wz) {
        const weights = this.getBiomeWeights(wx, wz);
        let maxWeight = 0;
        let selectedBiome = 'plains';
        
        for (const biomeName in weights) {
            if (weights[biomeName] > maxWeight) {
                maxWeight = weights[biomeName];
                selectedBiome = biomeName;
            }
        }
        
        return this.biomes[selectedBiome];
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
    
        try {
            await new Promise(resolve => setTimeout(() => {
                const geometry = new THREE.PlaneGeometry(
                    this.chunkSize,
                    this.chunkSize,
                    this.chunkResolution,
                    this.chunkResolution
                ).rotateX(-Math.PI/2);
                const positions = geometry.attributes.position.array;
                const biomeMap = [];
    
                for (let i = 0; i < positions.length; i += 3) {
                    const vx = positions[i];
                    const vz = positions[i + 2];
                    const wx = cx * this.chunkSize + vx;
                    const wz = cz * this.chunkSize + vz;
    
                    const height = this.getHeight(wx, wz);
                    positions[i + 1] = height;
    
                    biomeMap.push({
                        weights: this.getBiomeWeights(wx, wz),
                        position: new THREE.Vector3(wx, height, wz),
                        slope: this.calculateSlope(wx, wz)
                    });
                }
                geometry.computeVertexNormals();
    
                const normals = geometry.attributes.normal.array;
                for (let i = 0; i < normals.length; i += 3) {
                    normals[i + 1] *= -1;
                }
                geometry.attributes.normal.needsUpdate = true;
    
                const colors = new Float32Array(positions.length);
                for (let i = 0; i < positions.length; i += 3) {
                    const biomeData = biomeMap[i/3];
                    const color = new THREE.Color(0, 0, 0);
                    
                    // Blend colors based on biome weights
                    for (const biomeName in biomeData.weights) {
                        const weight = biomeData.weights[biomeName];
                        const biomeColor = this.biomes[biomeName].groundColor;
                        // Scale the biome color by weight and add to total color
                        const scaledColor = biomeColor.clone().multiplyScalar(weight);
                        color.add(scaledColor);
                    }
                    
                    // Adjust color based on height
                    color.multiplyScalar(0.9 + (positions[i + 1] / 30) * 0.2);
    
                    colors[i] = color.r;
                    colors[i + 1] = color.g;
                    colors[i + 2] = color.b;
                }
                geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    
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
    
                const vegetationMap = new Map();
                biomeMap.forEach(({ weights, position, slope }) => {
                    const biomeName = Object.keys(weights).reduce((a, b) => weights[a] > weights[b] ? a : b);
                    const biome = this.biomes[biomeName];
                    biome.objects.forEach(objDef => {
                        if (Math.random() < objDef.density && slope <= objDef.maxSlope) {
                            const instances = vegetationMap.get(objDef.type) || [];
                            const adjustedPos = this.adjustPosition(position.clone());
                            instances.push({
                                position: adjustedPos,
                                rotation: Math.random() * Math.PI * 2,
                                scale: 0.8 + Math.random() * 0.4
                            });
                            vegetationMap.set(objDef.type, instances);
                        }
                    });
                });
    
                vegetationMap.forEach((instances, type) => {
                    const model = this.game.modelManager.getModel("worldObjects", type);
                    if (!model) {
                        console.warn(`Model not found: ${type}`);
                        return;
                    }
                    this.processModelType(type, model, instances, chunkData);
                });
    
                chunkData.isGenerating = false;
                resolve();
            }, 0));
        } catch (error) {
            console.error(`Failed to generate chunk ${chunkKey}:`, error);
            this.chunks.delete(chunkKey);
        }
    }

    adjustPosition(position) {
        position.y = this.getHeight(position.x, position.z) + 0.2;
        return position;
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
    calculateSlope(wx, wz) {
        const delta = 1.0;
        const dx = this.getHeight(wx + delta, wz) - this.getHeight(wx - delta, wz);
        const dz = this.getHeight(wx, wz + delta) - this.getHeight(wx, wz - delta);
        return Math.sqrt(dx*dx + dz*dz) / (2 * delta);
    }

    async updateChunks() {
        const cameraChunkX = Math.floor(this.camera.position.x / this.chunkSize);
        const cameraChunkZ = Math.floor(this.camera.position.z / this.chunkSize);
        const newChunks = new Set();
        const chunksToGenerate = [];
        const maxChunksPerFrame = 2; // Limit to 2 chunks per frame
    
        // Identify chunks to generate
        for (let x = cameraChunkX - this.renderDistance; x <= cameraChunkX + this.renderDistance; x++) {
            for (let z = cameraChunkZ - this.renderDistance; z <= cameraChunkZ + this.renderDistance; z++) {
                const chunkKey = `${x},${z}`;
                newChunks.add(chunkKey);
                if (!this.chunks.has(chunkKey)) {
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
        const promises = chunksToGenerate.slice(0, maxChunksPerFrame).map(({ x, z }) => this.generateChunk(x, z));
        await Promise.all(promises);
    
        // Remove old chunks (unchanged)
        for (const [chunkKey, chunkData] of this.chunks) {
            if (!newChunks.has(chunkKey) && !chunkData.isGenerating) {
                // Dispose terrain mesh and object meshes (unchanged)
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
                this.chunks.delete(chunkKey);
            }
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
                    instance.position,
                    new THREE.Quaternion().setFromAxisAngle(
                        new THREE.Vector3(0, 1, 0),
                        instance.rotation
                    ),
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
        return this.getHeight(x, z);
    }

    onDestroy() {
        window.removeEventListener('resize', this.onWindowResizeHandler);

        // Cleanup all chunks
        for (const [, chunkData] of this.chunks) {
            // Dispose terrain mesh
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

            // Dispose instanced meshes
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
                        group.mesh.dispose(); // Dispose InstancedMesh
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

        this.chunks.clear();
        this.renderer.dispose();
        this.renderer.forceContextLoss(); // Ensure WebGL context is released

        this.game.scene = null;
        this.game.camera = null;
        this.game.renderer = null;
    }
}
