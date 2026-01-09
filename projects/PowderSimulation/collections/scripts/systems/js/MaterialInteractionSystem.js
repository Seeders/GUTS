/**
 * MaterialInteractionSystem - Handles material interactions
 *
 * Fire spreads to wood, water puts out fire, fire dies without fuel.
 * Water absorbs into wood -> wet wood -> living wood (which can grow).
 */
class MaterialInteractionSystem extends GUTS.BaseSystem {
    constructor(game) {
        super(game);
        this.game.materialInteractionSystem = this;

        // Fire behavior constants
        this.FIRE_SPREAD_CHANCE = 0.02;    // Chance per tick to spread to adjacent wood
        this.FIRE_BURNOUT_CHANCE = 0.05;   // Chance per tick to die without fuel
        this.FIRE_LIFETIME_MAX = 180;       // Max ticks a fire particle lives

        // Wood/water interaction constants
        this.WATER_ABSORB_CHANCE = 0.1;    // Chance water gets absorbed by wood
        this.WET_TO_LIVING_CHANCE = 0.01;  // Chance wet wood becomes living
        this.LIVING_GROW_CHANCE = 0.005;   // Chance living wood grows
        this.LIVING_MAX_HYDRATION = 100;   // Max hydration level
        this.LIVING_SHARE_THRESHOLD = 20;  // Stop sharing below this level
        this.LIVING_GROWTH_THRESHOLD = 50; // Need this much hydration to grow

        // Track fire lifetimes (eid -> ticks alive)
        this.fireLifetimes = new Map();

        // Track special voxels for efficient processing
        this.fireVoxels = new Set();
        this.wetWoodVoxels = new Set();
        this.livingWoodVoxels = new Set();

        // Track living wood hydration (key -> hydration level, higher = more water)
        this.livingWoodHydration = new Map();

        // Processing throttle
        this.tickCounter = 0;
        this.processInterval = 2;
    }

    init() {
        console.log('MaterialInteractionSystem initializing...');
    }

    update() {
        const voxelGrid = this.game.voxelGridSystem;
        const physicsSystem = this.game.particlePhysicsSystem;
        if (!voxelGrid || !physicsSystem) return;

        // Throttle voxel interactions
        this.tickCounter++;
        if (this.tickCounter >= this.processInterval) {
            this.tickCounter = 0;
            this.processVoxelInteractions(voxelGrid, physicsSystem);
        }

        // Process active particle interactions every tick
        this.processActiveParticleInteractions(voxelGrid, physicsSystem);
    }

    processVoxelInteractions(voxelGrid, physicsSystem) {
        const FIRE = voxelGrid.MATERIAL.FIRE;
        const WOOD = voxelGrid.MATERIAL.WOOD;
        const WATER = voxelGrid.MATERIAL.WATER;
        const AIR = voxelGrid.MATERIAL.AIR;
        const STEAM = voxelGrid.MATERIAL.STEAM;
        const WET_WOOD = voxelGrid.MATERIAL.WET_WOOD;
        const LIVING_WOOD = voxelGrid.MATERIAL.LIVING_WOOD;

        const toConvert = [];

        // Process water voxels for wood absorption
        for (const key of voxelGrid.waterVoxels) {
            const [x, y, z] = key.split(',').map(Number);

            // Check for adjacent wood - water gets absorbed
            const adjacentWood = this.getAdjacentCellsWithMaterial(voxelGrid, x, y, z, WOOD);
            for (const pos of adjacentWood) {
                if (Math.random() < this.WATER_ABSORB_CHANCE) {
                    toConvert.push({ x: pos.x, y: pos.y, z: pos.z, from: WOOD, to: WET_WOOD });
                    toConvert.push({ x, y, z, from: WATER, to: AIR }); // Water consumed
                    break;
                }
            }

            // Check for adjacent fire - extinguish it
            const adjacentFire = this.getAdjacentCellsWithMaterial(voxelGrid, x, y, z, FIRE);
            for (const pos of adjacentFire) {
                toConvert.push({ x: pos.x, y: pos.y, z: pos.z, from: FIRE, to: STEAM });
            }
        }

        // Process wet wood -> living wood conversion
        for (const key of this.wetWoodVoxels) {
            const [x, y, z] = key.split(',').map(Number);
            if (voxelGrid.get(x, y, z) !== WET_WOOD) {
                this.wetWoodVoxels.delete(key);
                continue;
            }

            // Wet wood has chance to become living wood
            if (Math.random() < this.WET_TO_LIVING_CHANCE) {
                toConvert.push({ x, y, z, from: WET_WOOD, to: LIVING_WOOD });
            }
        }

        // Process living wood growth, spreading, and dying
        // First pass: collect hydration from water sources and decay
        const hydrationUpdates = new Map();

        for (const key of this.livingWoodVoxels) {
            const [x, y, z] = key.split(',').map(Number);
            if (voxelGrid.get(x, y, z) !== LIVING_WOOD) {
                this.livingWoodVoxels.delete(key);
                this.livingWoodHydration.delete(key);
                continue;
            }

            let hydration = this.livingWoodHydration.get(key) || 0;

            // Direct water contact fills hydration
            if (this.hasAdjacentMaterial(voxelGrid, x, y, z, WATER)) {
                hydration = this.LIVING_MAX_HYDRATION;
            }
            // Wet wood contact adds some hydration
            else if (this.hasAdjacentMaterial(voxelGrid, x, y, z, WET_WOOD)) {
                hydration = Math.min(this.LIVING_MAX_HYDRATION, hydration + 20);
            }

            // Natural decay - living wood uses water over time
            hydration = Math.max(0, hydration - 1);

            hydrationUpdates.set(key, hydration);
        }

        // Second pass: share hydration with neighbors (finite sharing)
        for (const key of this.livingWoodVoxels) {
            const [x, y, z] = key.split(',').map(Number);
            let hydration = hydrationUpdates.get(key) || 0;

            // Only share if above threshold
            if (hydration > this.LIVING_SHARE_THRESHOLD) {
                const adjacentLivingWood = this.getAdjacentCellsWithMaterial(voxelGrid, x, y, z, LIVING_WOOD);

                for (const pos of adjacentLivingWood) {
                    const neighborKey = `${pos.x},${pos.y},${pos.z}`;
                    const neighborHydration = hydrationUpdates.get(neighborKey) || 0;

                    // Share if neighbor has less hydration
                    if (neighborHydration < hydration - 10) {
                        // Transfer half the difference, capped
                        const transfer = Math.min(10, (hydration - neighborHydration) / 2);
                        hydration -= transfer;
                        hydrationUpdates.set(neighborKey, neighborHydration + transfer);

                        // Stop sharing if we drop below threshold
                        if (hydration <= this.LIVING_SHARE_THRESHOLD) break;
                    }
                }
            }

            hydrationUpdates.set(key, hydration);
        }

        // Third pass: apply updates, growth, and death
        for (const key of this.livingWoodVoxels) {
            const [x, y, z] = key.split(',').map(Number);
            if (voxelGrid.get(x, y, z) !== LIVING_WOOD) continue;

            const hydration = hydrationUpdates.get(key) || 0;
            this.livingWoodHydration.set(key, hydration);

            // Living wood dies if completely dehydrated
            if (hydration <= 0) {
                toConvert.push({ x, y, z, from: LIVING_WOOD, to: WOOD });
                continue;
            }

            // Hydrated living wood spreads life to neighbors
            if (hydration > this.LIVING_SHARE_THRESHOLD) {
                // Convert adjacent wet wood to living wood
                const adjacentWetWood = this.getAdjacentCellsWithMaterial(voxelGrid, x, y, z, WET_WOOD);
                for (const pos of adjacentWetWood) {
                    if (Math.random() < this.LIVING_GROW_CHANCE * 3) {
                        toConvert.push({ x: pos.x, y: pos.y, z: pos.z, from: WET_WOOD, to: LIVING_WOOD });
                    }
                }

                // Convert adjacent dry wood to wet wood
                const adjacentWood = this.getAdjacentCellsWithMaterial(voxelGrid, x, y, z, WOOD);
                for (const pos of adjacentWood) {
                    if (Math.random() < this.LIVING_GROW_CHANCE * 2) {
                        toConvert.push({ x: pos.x, y: pos.y, z: pos.z, from: WOOD, to: WET_WOOD });
                    }
                }
            }

            // Grow into air (only if well hydrated)
            if (hydration >= this.LIVING_GROWTH_THRESHOLD && Math.random() < this.LIVING_GROW_CHANCE) {
                // Prefer growing upward, but can also grow sideways
                if (voxelGrid.get(x, y + 1, z) === AIR) {
                    toConvert.push({ x, y: y + 1, z, from: AIR, to: LIVING_WOOD });
                } else if (Math.random() < 0.3) {
                    // 30% chance to try sideways growth instead
                    const sideDirs = [
                        { dx: -1, dz: 0 },
                        { dx: 1, dz: 0 },
                        { dx: 0, dz: -1 },
                        { dx: 0, dz: 1 }
                    ];
                    const dir = sideDirs[Math.floor(Math.random() * sideDirs.length)];
                    if (voxelGrid.get(x + dir.dx, y, z + dir.dz) === AIR) {
                        toConvert.push({ x: x + dir.dx, y, z: z + dir.dz, from: AIR, to: LIVING_WOOD });
                    }
                }
            }
        }

        // Process fire interactions (using nonAirVoxels to find fire since we don't track it separately)
        const fireToProcess = [];
        for (const [key, mat] of voxelGrid.nonAirVoxels) {
            if (mat === FIRE) {
                fireToProcess.push(key);
            }
        }

        for (const key of fireToProcess) {
            const [x, y, z] = key.split(',').map(Number);

            // Check for adjacent water - fire gets extinguished
            if (this.hasAdjacentMaterial(voxelGrid, x, y, z, WATER)) {
                toConvert.push({ x, y, z, from: FIRE, to: STEAM });
                continue;
            }

            // Check for adjacent wood types - spread fire
            const adjacentWood = this.getAdjacentCellsWithMaterials(voxelGrid, x, y, z, [WOOD, WET_WOOD, LIVING_WOOD]);
            for (const pos of adjacentWood) {
                if (Math.random() < this.FIRE_SPREAD_CHANCE) {
                    toConvert.push({ x: pos.x, y: pos.y, z: pos.z, from: voxelGrid.get(pos.x, pos.y, pos.z), to: FIRE });
                }
            }

            // Fire without adjacent fuel has chance to die
            const hasAdjacentFuel = adjacentWood.length > 0;
            if (!hasAdjacentFuel && Math.random() < this.FIRE_BURNOUT_CHANCE) {
                toConvert.push({ x, y, z, from: FIRE, to: AIR });
            }
        }

        // Apply conversions
        for (const conv of toConvert) {
            if (voxelGrid.get(conv.x, conv.y, conv.z) === conv.from) {
                voxelGrid.set(conv.x, conv.y, conv.z, conv.to);

                // Track new wet wood and living wood
                const key = `${conv.x},${conv.y},${conv.z}`;
                if (conv.to === WET_WOOD) {
                    this.wetWoodVoxels.add(key);
                } else if (conv.to === LIVING_WOOD) {
                    this.livingWoodVoxels.add(key);
                    this.wetWoodVoxels.delete(key);
                    this.livingWoodHydration.set(key, this.LIVING_MAX_HYDRATION / 2); // Start with half hydration
                } else if (conv.from === LIVING_WOOD) {
                    // Clean up when living wood dies
                    this.livingWoodVoxels.delete(key);
                    this.livingWoodHydration.delete(key);
                }

                // If creating steam, spawn as active particle that rises
                if (conv.to === STEAM) {
                    const worldPos = voxelGrid.gridToWorld(conv.x, conv.y, conv.z);
                    physicsSystem.spawnParticle(
                        worldPos.x, worldPos.y, worldPos.z,
                        STEAM,
                        (Math.random() - 0.5) * 2,
                        Math.random() * 5 + 5,
                        (Math.random() - 0.5) * 2
                    );
                    voxelGrid.set(conv.x, conv.y, conv.z, AIR);
                }
            }
        }
    }

    processActiveParticleInteractions(voxelGrid, physicsSystem) {
        const particleRange = this.game.getEntityRange('particleTag');
        if (!particleRange || particleRange.count === 0) return;

        const posX = this.game.getFieldArray('position', 'x');
        const posY = this.game.getFieldArray('position', 'y');
        const posZ = this.game.getFieldArray('position', 'z');
        const material = this.game.getFieldArray('material', 'type');

        if (!posX || !material) return;

        const FIRE = voxelGrid.MATERIAL.FIRE;
        const WOOD = voxelGrid.MATERIAL.WOOD;
        const WATER = voxelGrid.MATERIAL.WATER;
        const AIR = voxelGrid.MATERIAL.AIR;
        const STEAM = voxelGrid.MATERIAL.STEAM;
        const WET_WOOD = voxelGrid.MATERIAL.WET_WOOD;
        const LIVING_WOOD = voxelGrid.MATERIAL.LIVING_WOOD;

        const toDestroy = [];
        const toConvert = [];

        for (let eid = particleRange.start; eid < particleRange.end; eid++) {
            const mat = material[eid];
            if (mat === 0) continue;

            const px = posX[eid];
            const py = posY[eid];
            const pz = posZ[eid];
            const gridPos = voxelGrid.worldToGrid(px, py, pz);

            if (mat === FIRE) {
                // Track fire lifetime
                let lifetime = this.fireLifetimes.get(eid) || 0;
                lifetime++;
                this.fireLifetimes.set(eid, lifetime);

                // Check if fire touches water (voxel)
                if (this.hasAdjacentMaterial(voxelGrid, gridPos.x, gridPos.y, gridPos.z, WATER)) {
                    toConvert.push({ eid, to: STEAM });
                    continue;
                }

                // Check for adjacent wood voxels (any type) - spread fire
                const adjacentWood = this.getAdjacentCellsWithMaterials(voxelGrid, gridPos.x, gridPos.y, gridPos.z, [WOOD, WET_WOOD, LIVING_WOOD]);
                for (const pos of adjacentWood) {
                    if (Math.random() < this.FIRE_SPREAD_CHANCE * 2) {
                        voxelGrid.set(pos.x, pos.y, pos.z, FIRE);
                    }
                }

                // Fire dies after max lifetime or randomly without fuel
                const hasFuel = adjacentWood.length > 0 ||
                    this.hasAdjacentMaterial(voxelGrid, gridPos.x, gridPos.y, gridPos.z, FIRE);

                if (lifetime > this.FIRE_LIFETIME_MAX ||
                    (!hasFuel && Math.random() < this.FIRE_BURNOUT_CHANCE * 2)) {
                    toDestroy.push(eid);
                    this.fireLifetimes.delete(eid);
                }
            }

            if (mat === WATER) {
                // Water touching fire voxels extinguishes them
                const adjacentFire = this.getAdjacentCellsWithMaterial(voxelGrid, gridPos.x, gridPos.y, gridPos.z, FIRE);
                for (const pos of adjacentFire) {
                    voxelGrid.set(pos.x, pos.y, pos.z, AIR);
                    const worldPos = voxelGrid.gridToWorld(pos.x, pos.y, pos.z);
                    physicsSystem.spawnParticle(
                        worldPos.x, worldPos.y, worldPos.z,
                        STEAM,
                        (Math.random() - 0.5) * 3,
                        Math.random() * 8 + 5,
                        (Math.random() - 0.5) * 3
                    );
                }

                // Water touching wood gets absorbed
                const adjacentWood = this.getAdjacentCellsWithMaterial(voxelGrid, gridPos.x, gridPos.y, gridPos.z, WOOD);
                for (const pos of adjacentWood) {
                    if (Math.random() < this.WATER_ABSORB_CHANCE * 2) {
                        voxelGrid.set(pos.x, pos.y, pos.z, WET_WOOD);
                        this.wetWoodVoxels.add(`${pos.x},${pos.y},${pos.z}`);
                        toDestroy.push(eid); // Water particle consumed
                        break;
                    }
                }
            }

            if (mat === STEAM) {
                // Steam dissipates over time
                let lifetime = this.fireLifetimes.get(eid) || 0;
                lifetime++;
                this.fireLifetimes.set(eid, lifetime);

                if (lifetime > 60 || (py > voxelGrid.sizeY * 0.8 && Math.random() < 0.1)) {
                    toDestroy.push(eid);
                    this.fireLifetimes.delete(eid);
                }
            }
        }

        // Apply conversions
        for (const conv of toConvert) {
            material[conv.eid] = conv.to;
        }

        // Destroy particles
        for (const eid of toDestroy) {
            this.game.destroyEntity(eid);
        }
    }

    hasAdjacentMaterial(voxelGrid, x, y, z, materialType) {
        const dirs = [
            [-1, 0, 0], [1, 0, 0],
            [0, -1, 0], [0, 1, 0],
            [0, 0, -1], [0, 0, 1]
        ];

        for (const [dx, dy, dz] of dirs) {
            if (voxelGrid.get(x + dx, y + dy, z + dz) === materialType) {
                return true;
            }
        }
        return false;
    }

    getAdjacentCellsWithMaterial(voxelGrid, x, y, z, materialType) {
        const result = [];
        const dirs = [
            [-1, 0, 0], [1, 0, 0],
            [0, -1, 0], [0, 1, 0],
            [0, 0, -1], [0, 0, 1]
        ];

        for (const [dx, dy, dz] of dirs) {
            const nx = x + dx;
            const ny = y + dy;
            const nz = z + dz;
            if (voxelGrid.get(nx, ny, nz) === materialType) {
                result.push({ x: nx, y: ny, z: nz });
            }
        }
        return result;
    }

    getAdjacentCellsWithMaterials(voxelGrid, x, y, z, materialTypes) {
        const result = [];
        const dirs = [
            [-1, 0, 0], [1, 0, 0],
            [0, -1, 0], [0, 1, 0],
            [0, 0, -1], [0, 0, 1]
        ];

        for (const [dx, dy, dz] of dirs) {
            const nx = x + dx;
            const ny = y + dy;
            const nz = z + dz;
            const mat = voxelGrid.get(nx, ny, nz);
            if (materialTypes.includes(mat)) {
                result.push({ x: nx, y: ny, z: nz });
            }
        }
        return result;
    }
}
