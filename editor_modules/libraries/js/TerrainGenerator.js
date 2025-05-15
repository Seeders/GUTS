class TerrainGenerator {
    init(biomes, chunkSize, chunkResolution, noise) {
        this.noise = noise;
        this.biomes = biomes;
        this.chunkSize = chunkSize;
        this.chunkResolution = chunkResolution;
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

    getBiomeWeights(position) {
        const wx = position.x;
        const wz = position.z;
        const biomeNoise = this.noise.noise2D(wx * 0.00001, wz * 0.00001);
        const biomeValue = (biomeNoise + 1) / 2;
        const weights = {};

        Object.keys(this.biomes).forEach((biomeName) => {
            const biome = this.biomes[biomeName];
            const [min, max] = biome.range.elevation || biome.range; // Adjust for range format
            let weight = 0;
            if (biomeValue >= min && biomeValue <= max) {
                weight = 1 - Math.abs(biomeValue - (min + max) / 2) / ((max - min) / 2);
                weight = Math.max(0, weight);
            }
            weights[biomeName] = weight;
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

    getBiomeAt(x, z) {
        const position = { x, z };
        const weights = this.getBiomeWeights(position);
        let maxWeight = 0;
        let selectedBiome = "plains";
        for (const biomeName in weights) {
            if (weights[biomeName] > maxWeight) {
                maxWeight = weights[biomeName];
                selectedBiome = biomeName;
            }
        }
        return selectedBiome;
    }

    getHeight(position) {
        const wx = position.x;
        const wz = position.z;
        const weights = this.getBiomeWeights(position);
        let totalHeight = 0;
        for (const biomeName in weights) {
            const weight = weights[biomeName];
            if (weight === 0) continue;
            const biome = this.biomes[biomeName];
            let height = 0;
            height += this.fractalNoise(wx, wz, biome.noiseSettings.elevation);
            height += this.fractalNoise(wx * 2, wz * 2, biome.noiseSettings.detail);
            if (biome.noiseSettings.ridge) {
                const ridgeNoise = Math.abs(this.noise.noise2D(wx * biome.noiseSettings.ridge.scale, wz * biome.noiseSettings.ridge.scale));
                height += Math.pow(ridgeNoise, biome.noiseSettings.ridge.power) * biome.noiseSettings.ridge.heightScale;
            }
            totalHeight += height * weight;
        }
        return totalHeight;
    }

    getNormalAt(position) {
        const heightAtPoint = this.getHeight(position);
        const sampleDistance = 1;

        const heightAtPointPlusX = this.getHeight({ x: position.x + sampleDistance, z: position.z });
        const heightAtPointPlusZ = this.getHeight({ x: position.x, z: position.z + sampleDistance });

        const tangentX = { x: sampleDistance, y: heightAtPointPlusX - heightAtPoint, z: 0 };
        const tangentZ = { x: 0, y: heightAtPointPlusZ - heightAtPoint, z: sampleDistance };

        const normal = {
            x: -tangentX.y * tangentZ.z + tangentX.z * tangentZ.y,
            y: tangentX.x * tangentZ.z - tangentX.z * tangentZ.x,
            z: -tangentX.x * tangentZ.y + tangentX.y * tangentZ.x
        };

        const normalLength = Math.sqrt(normal.x * normal.x + normal.y * normal.y + normal.z * normal.z);
        normal.x /= normalLength || 1;
        normal.y /= normalLength || 1;
        normal.z /= normalLength || 1;

        return normal;
    }

    getReflectionAt(position, velocity, restitution) {

        const normal = this.getNormalAt(position);
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

    getSlope(position) {
        const wx = position.x;
        const wz = position.z;
        const delta = 1.0;

        const dx = this.getHeight({ x: wx + delta, z: wz }) - this.getHeight({ x: wx - delta, z: wz });
        const dz = this.getHeight({ x: wx, z: wz + delta }) - this.getHeight({ x: wx, z: wz - delta });
        return Math.sqrt(dx * dx + dz * dz) / (2 * delta);
    }

    getRandomFromPosition(position, seed = 0) {
        const a = 12345.6789 * (position.x + 1);
        const b = 9876.54321 * (position.z + 1);
        const c = 567.89 * seed;
        const val = Math.sin(a + b + c) * 43758.5453;
        return val - Math.floor(val);
    }

    generateChunk(cx, cz, chunkSize, chunkResolution) {
        const geometryData = {
            positions: [],
            colors: [],
            normals: [],
            biomeMap: [],
            heightmap: []
        };

        const size = chunkSize / chunkResolution;
        const vertexHeights = new Map();
        const nx = chunkResolution + 1;
        const ny = chunkResolution + 1;

        // Initialize heightmap as a flat array
        const heights = new Array(nx * ny).fill(0);

        for (let z = 0; z < ny; z++) {
            for (let x = 0; x < nx; x++) {
                const vx = x * size - chunkSize / 2;
                const vz = z * size - chunkSize / 2;
                const wx = cx * chunkSize + vx;
                const wz = cz * chunkSize + vz;

                const boundaryKey = `${Math.round(wx * 1000) / 1000},${Math.round(wz * 1000) / 1000}`;
                let height;
                if ((x === 0 || x === chunkResolution || z === 0 || z === chunkResolution) && vertexHeights.has(boundaryKey)) {
                    height = vertexHeights.get(boundaryKey);
                } else {
                    const position = { x: wx, z: wz };
                    height = this.getHeight(position);
                    if (x === 0 || x === chunkResolution || z === 0 || z === chunkResolution) {
                        vertexHeights.set(boundaryKey, height);
                    }
                }

                // Store height in row-major order: index = z * nx + x
                heights[x * nx + z] = height;

                const position = { x: wx, y: height, z: wz };
                geometryData.positions.push(vx, height, vz);
                geometryData.biomeMap.push({
                    weights: this.getBiomeWeights(position),
                    position: position,
                    slope: this.getSlope(position)
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

                indices.push(a, c, b); // First triangle
                indices.push(c, d, b); // Second triangle

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
                let edge1 = [v2[0] - v0[0], v2[1] - v0[1], v2[2] - v0[2]];
                let edge2 = [v1[0] - v0[0], v1[1] - v0[1], v1[2] - v0[2]];
                let normal1 = [
                    edge1[1] * edge2[2] - edge1[2] * edge2[1],
                    edge1[2] * edge2[0] - edge1[0] * edge2[2],
                    edge1[0] * edge2[1] - edge1[1] * edge2[0]
                ];

                let mag1 = Math.sqrt(normal1[0] * normal1[0] + normal1[1] * normal1[1] + normal1[2] * normal1[2]);
                if (mag1 < 0.00001) {
                    normal1 = [0, 1, 0];
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
                let edge3 = [v3[0] - v2[0], v3[1] - v2[1], v3[2] - v2[2]];
                let edge4 = [v1[0] - v2[0], v1[1] - v2[1], v1[2] - v2[2]];
                let normal2 = [
                    edge3[1] * edge4[2] - edge3[2] * edge4[1],
                    edge3[2] * edge4[0] - edge3[0] * edge4[2],
                    edge3[0] * edge4[1] - edge3[1] * edge4[0]
                ];

                let mag2 = Math.sqrt(normal2[0] * normal2[0] + normal2[1] * normal2[1] + normal2[2] * normal2[2]);
                if (mag2 < 0.00001) {
                    normal2 = [0, 1, 0];
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
                contributions[c]++;

                normals[d * 3] += normal2[0];
                normals[d * 3 + 1] += normal2[1];
                normals[d * 3 + 2] += normal2[2];
                contributions[d]++;

                normals[b * 3] += normal2[0];
                normals[b * 3 + 1] += normal2[1];
                normals[b * 3 + 2] += normal2[2];
                contributions[b]++;
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
                    normals[idx] = 0;
                    normals[idx + 1] = 1;
                    normals[idx + 2] = 0;
                }
            } else {
                const idx = i * 3;
                normals[idx] = 0;
                normals[idx + 1] = 1;
                normals[idx + 2] = 0;
            }
        }

        geometryData.normals = normals;

        // Generate colors (unchanged)
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
                biome.worldObjects.forEach(objDef => {
                    if (!objectTypes.has(objDef.worldObjectPrefab)) {
                        objectTypes.set(objDef.worldObjectPrefab, []);
                    }
                    objectTypes.get(objDef.worldObjectPrefab).push({
                        density: objDef.density,
                        maxSlope: objDef.maxSlope,
                        weight: weights[biomeName]
                    });
                });
            }
            let index = 0;
            objectTypes.forEach((defs, worldObjectPrefab) => {
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
                index++;
                const instances = vegetation.get(worldObjectPrefab) || [];
                const collisionData = vegetation.get(worldObjectPrefab + '_collision') || [];
    
                if (this.getRandomFromPosition({ x: position.x * index * 10000, y:0, z: position.z * index * 10000}, 1) < blendedDensity && slope <= blendedMaxSlope) {
                    const instance = {
                        position: { x: position.x, y: position.y - 5, z: position.z },
                        rotation: this.getRandomFromPosition(position, 2) * Math.PI * 2,
                        scale: 0.8 + this.getRandomFromPosition(position, 3) * 0.4
                    };
                    instances.push(instance);

                    let aabb;
                    if (worldObjectPrefab.endsWith('tree')) {
                        const trunkRadius = 7.0 * instance.scale;
                        const trunkHeight = 40.0 * instance.scale;
                        aabb = {
                            id: `${worldObjectPrefab}_${position.x}_${position.z}`,
                            min: {
                                x: position.x - trunkRadius,
                                y: position.y - trunkHeight,
                                z: position.z - trunkRadius
                            },
                            max: {
                                x: position.x + trunkRadius,
                                y: position.y + trunkHeight,
                                z: position.z + trunkRadius
                            }
                        };
                    } else if (worldObjectPrefab.endsWith('rock')) {
                        const rockRadius = 5.0 * instance.scale;
                        const rockHeight = 10.0 * instance.scale;
                        aabb = {
                            id: `${worldObjectPrefab}_${position.x}_${position.z}`,
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

                vegetation.set(worldObjectPrefab, instances);
                if (collisionData.length > 0) {
                    vegetation.set(`${worldObjectPrefab}_collision`, collisionData);
                }
            });
        });

        return {
            cx,
            cz,
            positions: geometryData.positions,
            indices,
            colors: geometryData.colors,
            normals: geometryData.normals,
            vegetation: Array.from(vegetation.entries()).map(([worldObject, data]) => ({ worldObject, data })),
            heightmap: {
                heights: heights,
                nx: nx, // Number of points in x direction
                ny: ny, // Number of points in z direction
                scale: {x: chunkSize, y: 1, z: chunkSize} // Scale of each grid cell
            }
        };
    }
}