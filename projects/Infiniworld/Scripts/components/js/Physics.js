class Physics extends engine.Component {
    init() {
        const workerCode = this.getWorkerCode();
        const blob = new Blob([workerCode], { type: 'application/javascript' });
        this.workerBlobURL = URL.createObjectURL(blob);
        this.worker = new Worker(this.workerBlobURL);
        this.worker.onmessage = this.handleWorkerMessage.bind(this);
        this.entities = new Map();
        this.physicsDataBuffer = [];
        this.collisionDataBuffer = [];
        this.lastUpdate = 0;
        this.updateInterval = 1 / 60; // 60 Hz
        this.deltaTime = 0;
    }

    registerEntity(entity) {
        if (!entity.id || !entity.position) return;
        const collider = entity.getComponent('collider');
        const aabb = collider ? collider.getAABB(entity.position) : entity.getAABB();
        this.entities.set(entity.id, {
            entity,
            position: { ...entity.position },
            velocity: { ...entity.velocity },
            aabb,
            collider: collider ? {
                type: collider.type,
                size: collider.size,
                offset: { ...collider.offset }
            } : null,
            mass: collider ? collider.mass : entity.mass,
            restitution: collider ? collider.restitution : entity.restitution,
            grounded: false
        });
    }

    unregisterEntity(entityId) {
        this.entities.delete(entityId);
    }

    startPhysicsUpdate(deltaTime) {
        const currentTime = Date.now() / 1000;
        if (currentTime - this.lastUpdate < this.updateInterval) return false;
        this.lastUpdate = currentTime;
        this.deltaTime = deltaTime || 1 / 60;
        this.physicsDataBuffer = [];
        this.collisionDataBuffer = [];
        return true;
    }

    collectPhysicsData(entity, infiniWorld) {
        const data = this.entities.get(entity.id);
        if (!data) return;

        this.physicsDataBuffer.push({
            id: entity.id,
            position: { ...entity.position },
            velocity: { ...entity.velocity },
            aabb: { ...data.aabb },
            collider: data.collider,
            mass: data.mass,
            restitution: data.restitution
        });

        const entityAABB = data.aabb;
        const collisions = infiniWorld.checkTreeCollisions(entityAABB);
        this.collisionDataBuffer.push({ entityId: entity.id, collisions });
    }

    sendToWorker(infiniWorld) {
        if (this.physicsDataBuffer.length === 0) return;

        // Extract biome configuration to send to worker
        const biomeConfig = {};
        if (infiniWorld && infiniWorld.biomes) {
            // Deep copy the biome configuration
            for (const biomeName in infiniWorld.biomes) {
                biomeConfig[biomeName] = JSON.parse(JSON.stringify(infiniWorld.biomes[biomeName]));
            }
        }

        this.worker.postMessage({
            entities: this.physicsDataBuffer,
            collisionData: this.collisionDataBuffer,
            deltaTime: this.deltaTime,
            gravity: -9.86,
            biomeConfig: biomeConfig
        });
    }

    handleWorkerMessage(e) {
        const { entities } = e.data;
        entities.forEach((updated) => {
            const data = this.entities.get(updated.id);
            if (!data) return;
            data.entity.position.x = updated.position.x;
            data.entity.position.y = updated.position.y;
            data.entity.position.z = updated.position.z;
            data.entity.velocity.x = updated.velocity.x;
            data.entity.velocity.y = updated.velocity.y;
            data.entity.velocity.z = updated.velocity.z;            
            data.position = { ...updated.position };
            data.velocity = { ...updated.velocity };
            data.grounded = updated.grounded;
            data.entity.grounded = updated.grounded;
            // Update AABB if position changed
            data.aabb = data.entity.getAABB(data.position);
            if(updated.collidedWithEntity){
                data.entity.OnCollision(this.entities.get(updated.collidedWith));   
            }
            if(updated.collidedWithStatic){
                data.entity.OnStaticCollision();
            }
        });
    }

    onDestroy() {
        if (this.worker) {
            this.worker.terminate();
            URL.revokeObjectURL(this.workerBlobURL);
            this.worker = null;
            this.workerBlobURL = null;
        }
        this.entities.clear();
    }

    getWorkerCode() {
        return `
            ${this.game.config.libraries["SimplexNoise"].script}

            // ---------- Terrain Generation ----------
            class TerrainGenerator {
                constructor(biomeConfig) {
                    this.noise = new SimplexNoise();
                    this.biomes = biomeConfig || {};
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

                getTerrainHeight(x, z) {
                    const weights = this.getBiomeWeights(x, z);
                    let totalHeight = 0;

                    for (const biomeName in weights) {
                        const weight = weights[biomeName];
                        if (weight === 0) continue;

                        const biome = this.biomes[biomeName];
                        if (!biome) continue;

                        let height = 0;

                        // Elevation noise
                        if (biome.noiseSettings && biome.noiseSettings.elevation) {
                            height += this.fractalNoise(x, z, biome.noiseSettings.elevation);
                        }

                        // Detail noise
                        if (biome.noiseSettings && biome.noiseSettings.detail) {
                            height += this.fractalNoise(x * 2, z * 2, biome.noiseSettings.detail);
                        }

                        // Ridge noise for mountains only
                        if (biomeName === 'mountain' && biome.noiseSettings && biome.noiseSettings.ridge) {
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
            }

            // ---------- Physics Collision Helpers ----------
            function aabbIntersects(aabb1, aabb2) {
                return (
                    aabb1.min.x <= aabb2.max.x &&
                    aabb1.max.x >= aabb2.min.x &&
                    aabb1.min.y <= aabb2.max.y &&
                    aabb1.max.y >= aabb2.min.y &&
                    aabb1.min.z <= aabb2.max.z &&
                    aabb1.max.z >= aabb2.min.z
                );
            }

            function sphereSphereCollision(e1, e2, deltaTime) {
                const r1 = e1.collider.size;
                const r2 = e2.collider.size;
                const p1 = { x: e1.position.x + e1.collider.offset.x, y: e1.position.y + e1.collider.offset.y, z: e1.position.z + e1.collider.offset.z };
                const p2 = { x: e2.position.x + e2.collider.offset.x, y: e2.position.y + e2.collider.offset.y, z: e2.position.z + e2.collider.offset.z };
                const dx = p2.x - p1.x;
                const dy = p2.y - p1.y;
                const dz = p2.z - p1.z;
                const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
                const minDistance = r1 + r2;

                if (distance < minDistance && distance > 0) {
                    const normal = { x: dx / distance, y: dy / distance, z: dz / distance };
                    const penetration = minDistance - distance;
                    const relativeVelocity = {
                        x: e1.velocity.x - e2.velocity.x,
                        y: e1.velocity.y - e2.velocity.y,
                        z: e1.velocity.z - e2.velocity.z
                    };
                    const velocityAlongNormal = relativeVelocity.x * normal.x + relativeVelocity.y * normal.y + relativeVelocity.z * normal.z;

                    if (velocityAlongNormal > 0) return null; // Moving apart

                    const restitution = Math.min(e1.restitution, e2.restitution);
                    const impulseScalar = -(1 + restitution) * velocityAlongNormal / (1 / e1.mass + 1 / e2.mass);
                    return {
                        normal,
                        penetration,
                        impulse: {
                            x: impulseScalar * normal.x,
                            y: impulseScalar * normal.y,
                            z: impulseScalar * normal.z
                        }
                    };
                }
                return null;
            }

            function boxBoxCollision(e1, e2, deltaTime) {
                const aabb1 = e1.aabb;
                const aabb2 = e2.aabb;
                if (!aabbIntersects(aabb1, aabb2)) return null;

                const overlaps = [
                    { axis: 'x', overlap: Math.min(aabb1.max.x - aabb2.min.x, aabb2.max.x - aabb1.min.x) },
                    { axis: 'y', overlap: Math.min(aabb1.max.y - aabb2.min.y, aabb2.max.y - aabb1.min.y) },
                    { axis: 'z', overlap: Math.min(aabb1.max.z - aabb2.min.z, aabb2.max.z - aabb1.min.z) }
                ];
                const minOverlap = overlaps.reduce((min, curr) => curr.overlap < min.overlap ? curr : min, overlaps[0]);

                const normal = { x: 0, y: 0, z: 0 };
                const sign = aabb1.min[minOverlap.axis] < aabb2.min[minOverlap.axis] ? -1 : 1;
                normal[minOverlap.axis] = sign;

                const relativeVelocity = {
                    x: e1.velocity.x - e2.velocity.x,
                    y: e1.velocity.y - e2.velocity.y,
                    z: e1.velocity.z - e2.velocity.z
                };
                const velocityAlongNormal = relativeVelocity.x * normal.x + relativeVelocity.y * normal.y + relativeVelocity.z * normal.z;

                if (velocityAlongNormal > 0) return null; // Moving apart

                const restitution = Math.min(e1.restitution, e2.restitution);
                const impulseScalar = -(1 + restitution) * velocityAlongNormal / (1 / e1.mass + 1 / e2.mass);
                return {
                    normal,
                    penetration: minOverlap.overlap,
                    impulse: {
                        x: impulseScalar * normal.x,
                        y: impulseScalar * normal.y,
                        z: impulseScalar * normal.z
                    }
                };
            }

            function resolveTerrainCollision(entity, terrainHeight, deltaTime) {
                const aabbHeight = entity.aabb.min.y;
                if (entity.position.y <= terrainHeight) {
                    entity.position.y = terrainHeight;
                    entity.velocity.y = 0;
                    entity.grounded = true;
                } else {
                    entity.grounded = false;
                }
            }

            function resolveStaticCollision(entity, aabb, deltaTime) {
                const playerAABB = entity.aabb;
                if (!aabbIntersects(playerAABB, aabb)) return;

                const overlaps = [
                    { axis: 'x', overlap: Math.min(playerAABB.max.x - aabb.min.x, aabb.max.x - playerAABB.min.x) },
                    { axis: 'y', overlap: Math.min(playerAABB.max.y - aabb.min.y, aabb.max.y - playerAABB.min.y) },
                    { axis: 'z', overlap: Math.min(playerAABB.max.z - aabb.min.z, aabb.max.z - playerAABB.min.z) }
                ];
                const minOverlap = overlaps.reduce((min, curr) => curr.overlap < min.overlap ? curr : min, overlaps[0]);

                const sign = playerAABB.min[minOverlap.axis] < aabb.min[minOverlap.axis] ? -1 : 1;
                entity.position[minOverlap.axis] += sign * minOverlap.overlap;
                entity.velocity[minOverlap.axis] = 0;
                entity.collidedWithStatic = true;
            }

            let terrainGenerator = null;

            self.onmessage = function(e) {
                const { entities, collisionData, deltaTime, gravity, biomeConfig } = e.data;
                
                // Initialize or update terrain generator
                if (!terrainGenerator && biomeConfig) {
                    terrainGenerator = new TerrainGenerator(biomeConfig);
                } else if (biomeConfig) {
                    terrainGenerator.biomes = biomeConfig;
                }

                // Apply gravity and update positions
                entities.forEach(entity => {
                    entity.velocity.y += gravity * 10 * deltaTime;
                    entity.position.x += entity.velocity.x * deltaTime;
                    entity.position.y += entity.velocity.y * deltaTime;
                    entity.position.z += entity.velocity.z * deltaTime;

                    // Update AABB
                    if (entity.collider) {
                        const pos = {
                            x: entity.position.x + entity.collider.offset.x,
                            y: entity.position.y + entity.collider.offset.y,
                            z: entity.position.z + entity.collider.offset.z
                        };
                        if (entity.collider.type === 'sphere') {
                            const r = entity.collider.size;
                            entity.aabb = {
                                min: { x: pos.x - r, y: pos.y - r, z: pos.z - r },
                                max: { x: pos.x + r, y: pos.y + r, z: pos.z + r }
                            };
                        } else if (entity.collider.type === 'box') {
                            const s = entity.collider.size;
                            entity.aabb = {
                                min: { x: pos.x - s.x / 2, y: pos.y - s.y / 2, z: pos.z - s.z / 2 },
                                max: { x: pos.x + s.x / 2, y: pos.y + s.y / 2, z: pos.z + s.z / 2 }
                            };
                        }
                    }
                });

                // Entity-entity collisions
                const collisionPairs = [];
                for (let i = 0; i < entities.length; i++) {
                    for (let j = i + 1; j < entities.length; j++) {
                        const e1 = entities[i];
                        const e2 = entities[j];
                        if (!e1.collider || !e2.collider) continue;

                        let collision = null;
                        if (e1.collider.type === 'sphere' && e2.collider.type === 'sphere') {
                            collision = sphereSphereCollision(e1, e2, deltaTime);
                        } else {
                            collision = boxBoxCollision(e1, e2, deltaTime);
                        }

                        if (collision) {
                            collisionPairs.push({ e1, e2, ...collision });
                        }
                    }
                }

                // Apply impulses for entity-entity collisions
                collisionPairs.forEach(({ e1, e2, impulse }) => {
                    if (e1.mass > 0) {
                        e1.velocity.x += impulse.x / e1.mass;
                        e1.velocity.y += impulse.y / e1.mass;
                        e1.velocity.z += impulse.z / e1.mass;
                    }
                    if (e2.mass > 0) {
                        e2.velocity.x -= impulse.x / e2.mass;
                        e2.velocity.y -= impulse.y / e2.mass;
                        e2.velocity.z -= impulse.z / e2.mass;
                    }
                    e1.collidedWithEntity = true;
                    e2.collidedWithEntity = true;
                    e1.collidedWith = e2.id;
                    e2.collidedWith = e1.id;
                });

                // Resolve penetrations (move entities apart)
                collisionPairs.forEach(({ e1, e2, normal, penetration }) => {
                    const totalMass = e1.mass + e2.mass;
                    if (totalMass === 0) return;
                    const move1 = e1.mass > 0 ? penetration * (e2.mass / totalMass) : 0;
                    const move2 = e2.mass > 0 ? penetration * (e1.mass / totalMass) : 0;
                    if (e1.mass > 0) {
                        e1.position.x -= normal.x * move1;
                        e1.position.y -= normal.y * move1;
                        e1.position.z -= normal.z * move1;
                    }
                    if (e2.mass > 0) {
                        e2.position.x += normal.x * move2;
                        e2.position.y += normal.y * move2;
                        e2.position.z += normal.z * move2;
                    }
                });

                // Terrain and static collisions
                entities.forEach(entity => {
                    // Handle terrain collision using the terrain generator
                    if (terrainGenerator) {
                        const terrainHeight = terrainGenerator.getTerrainHeight(entity.position.x, entity.position.z);
                        resolveTerrainCollision(entity, terrainHeight, deltaTime);
                    }

                    // Handle static object collisions
                    const entityCollisions = collisionData.find(c => c.entityId === entity.id);
                    if (entityCollisions) {
                        entityCollisions.collisions.forEach(aabb => {
                            resolveStaticCollision(entity, aabb, deltaTime);
                        });
                    }
                });

                self.postMessage({ entities });
            };
        `;
    }
}