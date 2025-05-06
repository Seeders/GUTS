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

  getBiomeWeights(wx, wz) {
    const biomeNoise = this.noise.noise2D(wx * 0.00001, wz * 0.00001);
    const biomeValue = (biomeNoise + 1) / 2;
    const weights = {};

    Object.keys(this.biomes).forEach((biomeName) => {
      const biome = this.biomes[biomeName];
      const [min, max] = biome.range;
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
      if (biome.noiseSettings.ridge) {
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

  // Deterministic random function based on position
  getRandomFromPosition(x, z, seed = 0) {
    const a = 12345.6789 * (x + 1);
    const b = 9876.54321 * (z + 1);
    const c = 567.89 * seed;
    const val = Math.sin(a + b + c) * 43758.5453;
    return val - Math.floor(val);
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

    // Color generation
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

    // Optimized deterministic vegetation generation
    const vegetation = new Map();
    
    // Use biomeMap data from terrain generation instead of recalculating
    // Sample a subset of points for vegetation placement to improve performance
    const samplingRate = 1; // Only check every Nth point for vegetation
    
    for (let i = 0; i < geometryData.biomeMap.length; i += samplingRate) {
      const { weights, position, slope } = geometryData.biomeMap[i];
      
      // Get a deterministic seed based on world position
      const wx = position.x;
      const wz = position.z;
      
      // Process each vegetation type
      const objectTypes = new Map();
      for (const biomeName in weights) {
        const weight = weights[biomeName];
        if (weight === 0) continue;
        
        const biome = this.biomes[biomeName];
        biome.worldObjects.forEach(objDef => {
          if (!objectTypes.has(objDef.worldObject)) {
            objectTypes.set(objDef.worldObject, []);
          }
          objectTypes.get(objDef.worldObject).push({
            density: objDef.density,
            maxSlope: objDef.maxSlope,
            weight: weight
          });
        });
      }
      
      objectTypes.forEach((defs, worldObject) => {
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

        // Use deterministic "random" based on position
        const densityRandom = this.getRandomFromPosition(wx, wz, 0);
        
        if (densityRandom < blendedDensity && slope <= blendedMaxSlope) {
          const rotationRandom = this.getRandomFromPosition(wx, wz, 1);
          const scaleRandom = this.getRandomFromPosition(wx, wz, 2);
          
          const instances = vegetation.get(worldObject) || [];
          const collisionData = vegetation.get(worldObject + '_collision') || [];
          
          const instance = {
            position: { x: wx, y: position.y - 5, z: wz },
            rotation: rotationRandom * Math.PI * 2,
            scale: 0.8 + scaleRandom * 0.4
          };
          instances.push(instance);

          // Create collision data for the instance
          let aabb;
          if (worldObject === 'tree') {
            const trunkRadius = 5.0 * instance.scale;
            const trunkHeight = 20.0 * instance.scale;
            aabb = {
              min: {
                x: wx - trunkRadius,
                y: position.y,
                z: wz - trunkRadius
              },
              max: {
                x: wx + trunkRadius,
                y: position.y + trunkHeight,
                z: wz + trunkRadius
              }
            };
          } else if (worldObject === 'rock') {
            const rockRadius = 1.0 * instance.scale;
            const rockHeight = 1.0 * instance.scale;
            aabb = {
              min: {
                x: wx - rockRadius,
                y: position.y,
                z: wz - rockRadius
              },
              max: {
                x: wx + rockRadius,
                y: position.y + rockHeight,
                z: wz + rockRadius
              }
            };
          }

          if (aabb) {
            collisionData.push(aabb);
          }
          
          vegetation.set(worldObject, instances);
          if (collisionData.length > 0) {
            vegetation.set(worldObject + '_collision', collisionData);
          }
        }
      });
    }

    return {
      cx,
      cz,
      positions: geometryData.positions,
      indices,
      colors: geometryData.colors,
      normals: geometryData.normals,
      vegetation: Array.from(vegetation.entries()).map(([worldObject, data]) => ({ worldObject, data }))
    };
  }
}