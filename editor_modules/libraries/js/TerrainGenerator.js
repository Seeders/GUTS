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
    // Convert hex color (e.g., "#FF0000") to RGB object { r, g, b } with values in [0, 1]
    hexToRGB(hex) {
        const r = parseInt(hex.slice(1, 3), 16) / 255;
        const g = parseInt(hex.slice(3, 5), 16) / 255;
        const b = parseInt(hex.slice(5, 7), 16) / 255;
        return { r, g, b };
    }

    // Convert RGB object { r, g, b } (values in [0, 1]) to hex color string (e.g., "#FF0000")
    rgbToHex(rgb) {
        const r = Math.round(rgb.r * 255).toString(16).padStart(2, '0');
        const g = Math.round(rgb.g * 255).toString(16).padStart(2, '0');
        const b = Math.round(rgb.b * 255).toString(16).padStart(2, '0');
        return `#${r}${g}${b}`;
    }
    generateChunk(cx, cz, chunkSize, chunkResolution) {
        // Pre-calculate frequently used values
        const size = chunkSize / chunkResolution;
        const nx = chunkResolution + 1;
        const ny = chunkResolution + 1;
        const vertexCount = nx * ny;
        
        // Pre-allocate arrays for better performance
        const positions = new Float32Array(vertexCount * 3);
        const colors = new Float32Array(vertexCount * 3);
        const normals = new Float32Array(vertexCount * 3);
        const biomeMap = new Array(vertexCount);
        
        // Use a more efficient data structure for vertex heights
        const vertexHeights = new Map();

        // Generate positions and heights
        for (let z = 0, idx = 0, posIdx = 0; z < ny; z++) {
            for (let x = 0; x < nx; x++, idx++, posIdx += 3) {
                const vx = x * size - chunkSize / 2;
                const vz = z * size - chunkSize / 2;
                const wx = cx * chunkSize + vx;
                const wz = cz * chunkSize + vz;

                // Use a more efficient boundary key calculation
                let height;
                if ((x === 0 || x === chunkResolution || z === 0 || z === chunkResolution)) {
                    const boundaryKey = `${Math.floor(wx * 1000)},${Math.floor(wz * 1000)}`;
                    if (vertexHeights.has(boundaryKey)) {
                        height = vertexHeights.get(boundaryKey);
                    } else {
                        height = this.getHeight({x: wx, z: wz});
                        vertexHeights.set(boundaryKey, height);
                    }
                } else {
                    height = this.getHeight({x: wx, z: wz});
                }
                
                positions[posIdx] = vx;
                positions[posIdx + 1] = height;
                positions[posIdx + 2] = vz;
                
                const position = {x: wx, y: height, z: wz};
                biomeMap[idx] = {
                    weights: this.getBiomeWeights(position),
                    position: position,
                    slope: this.getSlope(position)
                };
            }
        }

        // Generate indices more efficiently
        const indexCount = chunkResolution * chunkResolution * 6;
        const indices = new Uint32Array(indexCount);
        
        // Initialize accumulator arrays for normals
        const normalAccum = new Float32Array(vertexCount * 3);
        const contributions = new Uint16Array(vertexCount);

        // Generate indices and calculate normals
        for (let z = 0, idx = 0; z < chunkResolution; z++) {
            for (let x = 0; x < chunkResolution; x++, idx += 6) {
                const a = x + (z * nx);
                const b = a + 1;
                const c = a + nx;
                const d = c + 1;

                // Store indices in a more compact way
                indices[idx] = a;
                indices[idx + 1] = c;
                indices[idx + 2] = b;
                indices[idx + 3] = c;
                indices[idx + 4] = d;
                indices[idx + 5] = b;
                
                // Calculate triangle normals more efficiently
                this._calculateTriangleNormals(
                    positions, a, c, b, d,
                    normalAccum, contributions
                );
            }
        }

        // Normalize accumulated normals
        this._normalizeNormals(normalAccum, contributions, normals);
        // Calculate vertex colors and vegetation
        const { vegetation, grassData, restitution, friction } = this._processVegetationAndColors(
            biomeMap, colors, positions, nx, ny, chunkSize, chunkResolution
        );

        return {
            cx,
            cz,
            positions: Array.from(positions),
            indices: Array.from(indices),
            colors: Array.from(colors),
            normals: Array.from(normals),
            restitution,
            friction,
            vegetation,
            grassData
        };
    }

    // Extracted method for triangle normal calculation
    _calculateTriangleNormals(positions, a, c, b, d, normalAccum, contributions) {
        // Calculate vertex positions for the first triangle
        const a3 = a * 3;
        const b3 = b * 3;
        const c3 = c * 3;
        const d3 = d * 3;
        
        // First triangle normal
        const normal1 = this._computeNormal(
            positions[a3], positions[a3 + 1], positions[a3 + 2],
            positions[c3], positions[c3 + 1], positions[c3 + 2],
            positions[b3], positions[b3 + 1], positions[b3 + 2]
        );
        
        // Second triangle normal
        const normal2 = this._computeNormal(
            positions[c3], positions[c3 + 1], positions[c3 + 2],
            positions[d3], positions[d3 + 1], positions[d3 + 2],
            positions[b3], positions[b3 + 1], positions[b3 + 2]
        );
        
        // Accumulate normals for first triangle
        this._accumulateNormal(normal1, normalAccum, a, contributions);
        this._accumulateNormal(normal1, normalAccum, c, contributions);
        this._accumulateNormal(normal1, normalAccum, b, contributions);
        
        // Accumulate normals for second triangle
        this._accumulateNormal(normal2, normalAccum, c, contributions);
        this._accumulateNormal(normal2, normalAccum, d, contributions);
        this._accumulateNormal(normal2, normalAccum, b, contributions);
    }

    // Compute normal from three vertices
    _computeNormal(x1, y1, z1, x2, y2, z2, x3, y3, z3) {
        // Calculate edges
        const e1x = x2 - x1;
        const e1y = y2 - y1;
        const e1z = z2 - z1;
        
        const e2x = x3 - x1;
        const e2y = y3 - y1;
        const e2z = z3 - z1;
        
        // Cross product
        let nx = e1y * e2z - e1z * e2y;
        let ny = e1z * e2x - e1x * e2z;
        let nz = e1x * e2y - e1y * e2x;
        
        // Normalize
        const mag = Math.sqrt(nx * nx + ny * ny + nz * nz);
        if (mag < 0.00001) {
            return [0, 1, 0];
        }
        
        nx /= mag;
        ny /= mag;
        nz /= mag;
        
        // Ensure normal points upward
        if (ny < 0) {
            nx = -nx;
            ny = -ny;
            nz = -nz;
        }
        
        return [nx, ny, nz];
    }

    // Accumulate normal at vertex
    _accumulateNormal(normal, normalAccum, vertexIndex, contributions) {
        const idx = vertexIndex * 3;
        normalAccum[idx] += normal[0];
        normalAccum[idx + 1] += normal[1];
        normalAccum[idx + 2] += normal[2];
        contributions[vertexIndex]++;
    }

    // Normalize accumulated normals
    _normalizeNormals(normalAccum, contributions, normals) {
        for (let i = 0, idx = 0; i < contributions.length; i++, idx += 3) {
            if (contributions[i] > 0) {
                const nx = normalAccum[idx];
                const ny = normalAccum[idx + 1];
                const nz = normalAccum[idx + 2];
                
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
                normals[idx] = 0;
                normals[idx + 1] = 1;
                normals[idx + 2] = 0;
            }
        }
    }

    // Extracted method for vegetation and color processing
    _processVegetationAndColors(biomeMap, colors, positions, nx, ny, chunkSize, chunkResolution) {
        const vegetation = new Map();
        let blendedGrass = null;
        let totalGrassWeight = 0;
        let restitution = 0;
        let friction = 0;
        for (let i = 0; i < biomeMap.length; i++) {
            const { weights, position, slope } = biomeMap[i];
            const objectTypes = new Map();
            
            // Calculate blended ground color
            let r = 0, g = 0, b = 0;
            for (const biomeName in weights) {
                const biome = this.biomes[biomeName];
                const weight = weights[biomeName];
                
                // Add weighted color contributions
                r += biome.groundColor.r * weight;
                g += biome.groundColor.g * weight;
                b += biome.groundColor.b * weight;
                if (weight === 0) continue;
                restitution += biome.groundRestitution * weight;
                friction += biome.groundFriction * weight;
                // Process biome objects
                this._processWorldObjects(biome, weight, objectTypes, position, slope, vegetation);
                
                // Process grass
                blendedGrass = this._processGrass(biome, weight, blendedGrass);
                totalGrassWeight += weight;
            }
            
            // Store the blended color
            const colorIdx = i * 3;
            colors[colorIdx] = r;
            colors[colorIdx + 1] = g;
            colors[colorIdx + 2] = b;
        }
        
        // Generate grass instances if needed
        const grassData = totalGrassWeight > 0 ? 
            this._finalizeGrass(blendedGrass, totalGrassWeight, chunkSize, chunkResolution, positions, nx) : 
            null;
        return { vegetation: this._finalizeVegetation(vegetation), grassData, restitution: restitution / totalGrassWeight, friction: friction / totalGrassWeight };
    }

    // Process world objects from a biome
    _processWorldObjects(biome, weight, objectTypes, position, slope, vegetation) {
        biome.worldObjects.forEach((objDef, type) => {
            if (!objDef.worldObjectPrefab || objDef.title?.toLowerCase().endsWith('grass')) {
                // Skip grass objects, they're handled separately
                return;
            }
            
            if (!objectTypes.has(objDef.worldObjectPrefab)) {
                objectTypes.set(objDef.worldObjectPrefab, []);
            }
            
            objectTypes.get(objDef.worldObjectPrefab).push({
                density: objDef.density,
                maxSlope: objDef.maxSlope,
                weight
            });
        });
        
        // Generate world object instances
        let index = 0;
        objectTypes.forEach((defs, worldObjectPrefab) => {
            if (!worldObjectPrefab) return;
            
            // Calculate blended properties
            const { density, maxSlope } = this._blendObjectProperties(defs);
            
            // Generate instances based on density and slope
            index++;
            this._generateWorldObjectInstances(
                worldObjectPrefab, 
                density, 
                maxSlope, 
                position, 
                slope, 
                index,
                vegetation
            );
        });
    }

    // Blend properties for world objects
    _blendObjectProperties(defs) {
        let blendedDensity = 0;
        let blendedMaxSlope = 0;
        let totalWeight = 0;
        
        defs.forEach(def => {
            blendedDensity += def.density * def.weight;
            blendedMaxSlope += def.maxSlope * def.weight;
            totalWeight += def.weight;
        });
        
        if (totalWeight === 0) {
            return { density: 0, maxSlope: 0 };
        }
        
        return {
            density: blendedDensity / totalWeight,
            maxSlope: blendedMaxSlope / totalWeight
        };
    }

    // Generate world object instances
    _generateWorldObjectInstances(worldObjectPrefab, density, maxSlope, position, slope, index, vegetation) {
        const instances = vegetation.get(worldObjectPrefab) || [];
        const collisionData = vegetation.get(worldObjectPrefab + '_collision') || [];
        
        // Random check based on density
        const randomSeed = { 
            x: position.x * index * 10000, 
            y: 0, 
            z: position.z * index * 10000 
        };
        
        if (this.getRandomFromPosition(randomSeed, 1) < density && slope <= maxSlope) {
            const instance = {
                position: { x: position.x, y: position.y - 5, z: position.z },
                rotation: this.getRandomFromPosition(position, 2) * Math.PI * 2,
                scale: 0.8 + this.getRandomFromPosition(position, 3) * 0.4
            };
            instances.push(instance);
            
            // Generate collision data
            const aabb = this._generateCollisionAABB(worldObjectPrefab, position, instance.scale);
            if (aabb) {
                collisionData.push(aabb);
            }
        }
        
        vegetation.set(worldObjectPrefab, instances);
        if (collisionData.length > 0) {
            vegetation.set(`${worldObjectPrefab}_collision`, collisionData);
        }
    }

    // Generate collision AABB for an object
    _generateCollisionAABB(worldObjectPrefab, position, scale) {
        if (worldObjectPrefab.endsWith('tree')) {
            const trunkRadius = 7.0 * scale;
            const trunkHeight = 40.0 * scale;
            return {
                id: `${worldObjectPrefab}_${Math.floor(position.x)}_${Math.floor(position.z)}`,
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
            const rockRadius = 5.0 * scale;
            const rockHeight = 10.0 * scale;
            return {
                id: `${worldObjectPrefab}_${Math.floor(position.x)}_${Math.floor(position.z)}`,
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
        
        return null;
    }

    // Process grass from a biome
    _processGrass(biome, weight, blendedGrass) {
        if (!blendedGrass) {
            blendedGrass = {
                bladeWidth: 0,
                bladeHeight: 0,
                baseColor: { r: 0, g: 0, b: 0 },
                tipColor: { r: 0, g: 0, b: 0 },
                density: 0,
                maxSlope: 0,
                weight: 0,
                transforms: []
            };
        }
        
        biome.worldObjects.forEach((objDef) => {
            if (!objDef.worldObjectPrefab && objDef.title?.toLowerCase().endsWith('grass')) {
                // Convert hex colors to RGB for blending
                const baseColorRGB = this.hexToRGB(objDef.baseColor);
                const tipColorRGB = this.hexToRGB(objDef.tipColor);
                
                // Accumulate weighted grass properties
                blendedGrass.bladeWidth += objDef.bladeWidth * weight;
                blendedGrass.bladeHeight += objDef.bladeHeight * weight;
                blendedGrass.baseColor.r += baseColorRGB.r * weight;
                blendedGrass.baseColor.g += baseColorRGB.g * weight;
                blendedGrass.baseColor.b += baseColorRGB.b * weight;
                blendedGrass.tipColor.r += tipColorRGB.r * weight;
                blendedGrass.tipColor.g += tipColorRGB.g * weight;
                blendedGrass.tipColor.b += tipColorRGB.b * weight;
                blendedGrass.density += objDef.density * weight;
                blendedGrass.maxSlope += objDef.maxSlope * weight;
            }
        });
        
        return blendedGrass;
    }

    // Finalize grass properties and generate instances
    _finalizeGrass(blendedGrass, totalGrassWeight, chunkSize, chunkResolution, positions, vertexCountPerRow) {
        if (!blendedGrass || totalGrassWeight === 0) return null;
        
        // Normalize grass properties
        blendedGrass.bladeWidth /= totalGrassWeight;
        blendedGrass.bladeHeight /= totalGrassWeight;
        blendedGrass.baseColor.r /= totalGrassWeight;
        blendedGrass.baseColor.g /= totalGrassWeight;
        blendedGrass.baseColor.b /= totalGrassWeight;
        blendedGrass.tipColor.r /= totalGrassWeight;
        blendedGrass.tipColor.g /= totalGrassWeight;
        blendedGrass.tipColor.b /= totalGrassWeight;
        blendedGrass.density /= totalGrassWeight;
        blendedGrass.maxSlope /= totalGrassWeight;
        
        // Convert back to hex if needed
        blendedGrass.baseColor = this.rgbToHex(blendedGrass.baseColor);
        blendedGrass.tipColor = this.rgbToHex(blendedGrass.tipColor);
        
        // Generate grass instances
        const grassPerChunk = Math.floor(blendedGrass.density * chunkSize * chunkResolution);
        blendedGrass.grassPerChunk = grassPerChunk;
        const step = chunkSize / chunkResolution;
        
        // Pre-allocate arrays
        blendedGrass.phases = new Float32Array(grassPerChunk);
        blendedGrass.transforms = new Array(grassPerChunk);
        
        for (let i = 0; i < grassPerChunk; i++) {
            const x = Math.random() * chunkResolution;
            const z = Math.random() * chunkResolution;
            const xIdx = Math.floor(x);
            const zIdx = Math.floor(z);
            const fx = x - xIdx;
            const fz = z - zIdx;
            
            const height = this.interpolateHeight(positions, xIdx, zIdx, fx, fz, vertexCountPerRow);
            const worldX = (x * step - chunkSize / 2);
            const worldZ = (z * step - chunkSize / 2);
            
            blendedGrass.transforms[i] = {
                position: { x: worldX, y: height, z: worldZ },
                rotation: Math.random() * Math.PI * 2,
                scale: 0.7 + Math.random() * 0.5
            };
            
            blendedGrass.phases[i] = Math.random() * Math.PI * 2;
        }
        
        return blendedGrass.transforms.length > 0 ? blendedGrass : null;
    }

    // Finalize vegetation data
    _finalizeVegetation(vegetation) {
        return Array.from(vegetation.entries()).map(([worldObject, data]) => ({ 
            worldObject, 
            data 
        }));
    }

    // Interpolate height at a position
    interpolateHeight(positions, x, z, fx, fz, vertexCountPerRow) {
        const idx1 = (z * vertexCountPerRow + x) * 3;
        const idx2 = idx1 + 3;
        const idx3 = ((z + 1) * vertexCountPerRow + x) * 3;
        const idx4 = idx3 + 3;
        
        const h1 = positions[idx1 + 1];
        const h2 = positions[idx2 + 1];
        const h3 = positions[idx3 + 1];
        const h4 = positions[idx4 + 1];
        
        // Bilinear interpolation
        const top = h1 * (1 - fx) + h2 * fx;
        const bottom = h3 * (1 - fx) + h4 * fx;
        
        return top * (1 - fz) + bottom * fz;
    }
}