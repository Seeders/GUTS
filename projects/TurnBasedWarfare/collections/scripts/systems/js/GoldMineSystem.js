class GoldMineSystem extends GUTS.BaseSystem {
    static services = [
        'buildGoldMine',
        'isValidGoldMinePlacement',
        'getGoldVeinLocations',
        'findNearestGoldVein',
        'processNextMinerInQueue',
        'isMineOccupied',
        'isNextInMinerQueue',
        'addMinerToQueue',
        'getMinerQueuePosition',
        'destroyGoldMine'
    ];

    constructor(game) {
        super(game);
        this.game.goldMineSystem = this;

        // Reusable array to avoid per-call allocations
        this._sortedWorldObjectEntities = [];
    }

    init(params) {
        this.params = params || {};
    }

    /**
     * Per-frame update to manage gold vein visibility based on fog of war.
     * Veins with mines are hidden when visible to the player (mine shows instead),
     * but shown in fog areas to prevent information leaks.
     * Only runs on client - server/headless doesn't need visual fog of war logic.
     */
    update() {
        // Skip visual fog of war logic on server/headless - purely client-side rendering
        if (this.game.app?.isServer || this.game.isHeadless) {
            return;
        }

        const goldMines = this.game.getEntitiesWith('goldMine');

        for (const mineId of goldMines) {
            const goldMine = this.game.getComponent(mineId, 'goldMine');
            if (goldMine?.veinEntityId == null) continue;

            const veinTransform = this.game.getComponent(goldMine.veinEntityId, 'transform');
            if (!veinTransform?.scale) continue;

            // Check if vein position is visible to local player
            const pos = veinTransform.position;
            const isVisible = this.game.call('isVisibleAt', pos.x, pos.z);

            // Hide vein when visible (mine is shown), show when in fog
            // Default to hidden if isVisibleAt service isn't available
            const targetScale = (isVisible === true || isVisible === undefined) ? 0 : 1;

            if (veinTransform.scale.x !== targetScale) {
                veinTransform.scale.x = targetScale;
                veinTransform.scale.y = targetScale;
                veinTransform.scale.z = targetScale;
            }
        }
    }

    // Alias methods for service names that differ from method names
    isNextInMinerQueue(entityId, mineId) {
        return this.isNextInQueue(entityId, mineId);
    }

    getMinerQueuePosition(entityId, mineId) {
        return this.getQueuePosition(entityId, mineId);
    }

    /**
     * Get gold vein locations by querying ECS entities with worldObject component
     * Returns array of vein data with world positions and claimed status
     */
    getGoldVeinLocations() {
        const veinLocations = [];
        const worldObjectEntities = this.game.getEntitiesWith('worldObject', 'transform');

        // Get claimed vein positions from existing gold mines
        const claimedVeinEntityIds = new Set();
        const goldMineEntities = this.game.getEntitiesWith('goldMine');
        for (const mineId of goldMineEntities) {
            const goldMine = this.game.getComponent(mineId, 'goldMine');
            // veinEntityId is null when no vein (can't use truthy since 0 is a valid entity ID)
            if (goldMine?.veinEntityId != null) {
                claimedVeinEntityIds.add(goldMine.veinEntityId);
            }
        }

        // Sort for deterministic iteration - reuse array to avoid allocations
        this._sortedWorldObjectEntities.length = 0;
        for (let i = 0; i < worldObjectEntities.length; i++) {
            this._sortedWorldObjectEntities.push(worldObjectEntities[i]);
        }
        this._sortedWorldObjectEntities.sort((a, b) => a - b);

        for (const entityId of this._sortedWorldObjectEntities) {
            const worldObj = this.game.getComponent(entityId, 'worldObject');
            const goldVeinTypeIndex = this.enums.worldObjects?.goldVein ?? -1;
            if (worldObj?.type !== goldVeinTypeIndex) continue;

            const transform = this.game.getComponent(entityId, 'transform');
            const pos = transform?.position;
            if (!pos) continue;

            const gridPos = this.game.call('worldToPlacementGrid', pos.x, pos.z);
            const unitTypeComp = this.game.getComponent(entityId, 'unitType');
            const unitType = this.game.call('getUnitTypeDef', unitTypeComp);
            const gridWidth = (unitType?.placementGridWidth || 2) * 2;
            const gridHeight = (unitType?.placementGridHeight || 2) * 2;

            veinLocations.push({
                entityId: entityId,
                worldX: pos.x,
                worldZ: pos.z,
                gridPos: gridPos,
                gridWidth: gridWidth,
                gridHeight: gridHeight,
                claimed: claimedVeinEntityIds.has(entityId)
            });
        }

        return veinLocations;
    }

    /**
     * Find the nearest gold vein to a world position
     * @param {Object} worldPos - World position { x, z }
     * @param {boolean} unclaimedOnly - If true, only return unclaimed veins (default: true)
     * @returns {Object|null} { entityId, position } or null if none found
     */
    findNearestGoldVein(worldPos, unclaimedOnly = true) {
        const veinLocations = this.getGoldVeinLocations();

        let nearestVein = null;
        let nearestDistance = Infinity;

        for (const vein of veinLocations) {
            if (unclaimedOnly && vein.claimed) continue;

            const dx = vein.worldX - worldPos.x;
            const dz = vein.worldZ - worldPos.z;
            const distance = Math.sqrt(dx * dx + dz * dz);

            if (distance < nearestDistance) {
                nearestDistance = distance;
                nearestVein = vein;
            }
        }

        if (!nearestVein) {
            return null;
        }

        return {
            entityId: nearestVein.entityId,
            position: { x: nearestVein.worldX, z: nearestVein.worldZ }
        };
    }

    calculateGoldVeinCells(gridPos, gridWidth, gridHeight) {
        const cells = [];
        const startX = gridPos.x - Math.round(gridWidth / 2);
        const startZ = gridPos.z - Math.round(gridHeight / 2);

        for (let z = 0; z < gridHeight; z++) {
            for (let x = 0; x < gridWidth; x++) {
                cells.push({
                    x: startX + x,
                    z: startZ + z
                });
            }
        }

        return cells;
    }

    /**
     * Check if a gold mine can be placed at the given position
     * Validates against ECS gold vein entities
     */
    isValidGoldMinePlacement(gridPos, buildingGridWidth, buildingGridHeight) {
        const buildingCells = this.calculateGoldVeinCells(gridPos, buildingGridWidth, buildingGridHeight);
        const veinLocations = this.getGoldVeinLocations();

        for (const vein of veinLocations) {
            if (vein.claimed) continue;

            const veinCells = this.calculateGoldVeinCells(vein.gridPos, vein.gridWidth, vein.gridHeight);
            if (this.cellsMatch(buildingCells, veinCells)) {
                return { valid: true, vein: vein };
            }
        }

        return { valid: false };
    }

    cellsMatch(cells1, cells2) {
        if (cells1.length !== cells2.length) {
            return false;
        }

        const cellSet = new Set(cells2.map(c => `${c.x},${c.z}`));

        for (const cell of cells1) {
            const key = `${cell.x},${cell.z}`;
            const hasCell = cellSet.has(key);
            if (!hasCell) {
                return false;
            }
        }

        return true;
    }

    buildGoldMine(entityId, team, gridPos, buildingGridWidth, buildingGridHeight, knownVeinEntityId = null) {
        let veinEntityId = knownVeinEntityId;
        let veinCells;

        if (knownVeinEntityId) {
            // Vein entity ID provided directly - skip validation (trusted caller)
            veinCells = this.calculateGoldVeinCells(gridPos, buildingGridWidth, buildingGridHeight);
        } else {
            // Validate placement against gold vein entities
            const validation = this.isValidGoldMinePlacement(gridPos, buildingGridWidth, buildingGridHeight);
            if (!validation.valid) {
                console.warn('[GoldMineSystem] Invalid placement - no matching unclaimed vein');
                return { success: false, error: 'Must be placed on a gold vein' };
            }

            const vein = validation.vein;
            veinEntityId = vein.entityId;
            veinCells = this.calculateGoldVeinCells(vein.gridPos, vein.gridWidth, vein.gridHeight);
        }

        // Add goldMine component to the entity with reference to the vein entity
        // Note: minerQueue is a $fixedArray in the schema, so we don't pass it here
        // The TypedArray system will initialize it from the schema defaults (-1 for all slots)
        this.game.addComponent(entityId, "goldMine", {
            veinEntityId: veinEntityId,
            currentMiner: null
            // minerQueue is initialized by the schema's $fixedArray definition
        });

        // Match the gold mine rotation to the gold vein rotation
        if (veinEntityId != null) {
            const veinTransform = this.game.getComponent(veinEntityId, 'transform');
            if (veinTransform) {
                // Copy rotation from vein to mine
                if (veinTransform.rotation) {
                    const mineTransform = this.game.getComponent(entityId, 'transform');
                    if (mineTransform?.rotation) {
                        mineTransform.rotation.x = veinTransform.rotation.x;
                        mineTransform.rotation.y = veinTransform.rotation.y;
                        mineTransform.rotation.z = veinTransform.rotation.z;
                    }
                }
                // Note: Vein visibility is managed per-frame in update() based on fog of war
            }
        }

        return { success: true };
    }

    destroyGoldMine(entityId) {
        const goldMine = this.game.getComponent(entityId, "goldMine");
        if (!goldMine) {
            return { success: false, error: 'No gold mine component found' };
        }

        // Restore vein visibility - it won't be managed by update() anymore after mine is destroyed
        const veinEntityId = goldMine.veinEntityId;
        if (veinEntityId != null) {
            const veinTransform = this.game.getComponent(veinEntityId, 'transform');
            if (veinTransform?.scale) {
                veinTransform.scale.x = 1;
                veinTransform.scale.y = 1;
                veinTransform.scale.z = 1;
            }
        }

        // Clear any miners targeting this mine
        const miners = this.game.getEntitiesWith("miningState");

        for (const minerEntityId of miners) {
            const miningState = this.game.getComponent(minerEntityId, "miningState");
            if (miningState && miningState.targetMineEntityId === entityId) {
                miningState.targetMineEntityId = null;
                miningState.targetMinePosition = null;
                miningState.waitingPosition = null;
                miningState.state = this.enums.miningState.idle;
            }
        }

        // Remove the goldMine component from the entity
        // The vein is automatically "unclaimed" since we query goldMine components dynamically
        this.game.removeComponent(entityId, "goldMine");

        return { success: true };
    }

    // Check if a mine is currently occupied by looking at component states
    isMineOccupied(mineEntityId) {
        const goldMine = this.game.getComponent(mineEntityId, "goldMine");
        // currentMiner is null when empty (can't use truthy since 0 is a valid entity ID)
        const occupied = goldMine && goldMine.currentMiner !== null;
        return occupied;
    }

    // Get the current miner at a mine by checking component states
    getCurrentMiner(mineEntityId) {
        const miners = this.game.getEntitiesWith("miningState");

        for (const minerEntityId of miners) {
            const miningState = this.game.getComponent(minerEntityId, "miningState");
            if (miningState &&
                miningState.targetMineEntityId === mineEntityId &&
                miningState.state === this.enums.miningState.mining) {
                return minerEntityId;
            }
        }
        
        return null;
    }

    // Fixed array size for minerQueue
    static MINER_QUEUE_SIZE = 8;

    // Get queue position for a specific miner (-1 if not found)
    getQueuePosition(mineEntityId, minerEntityId) {
        const goldMine = this.game.getComponent(mineEntityId, "goldMine");
        if (!goldMine) return -1;
        for (let i = 0; i < GoldMineSystem.MINER_QUEUE_SIZE; i++) {
            if (goldMine.minerQueue[i] === minerEntityId) {
                return i;
            }
        }
        return -1;
    }

    // Remove a miner from all mine queues when they receive new orders
    onIssuedPlayerOrders(entityId) {
        const goldMines = this.game.getEntitiesWith('goldMine');
        goldMines.forEach((mineId) => {
            const goldMine = this.game.getComponent(mineId, 'goldMine');
            if (!goldMine) return;

            // If this miner was the current miner, clear them and process next in queue
            if (goldMine.currentMiner === entityId) {
                this.processNextMinerInQueue(mineId);
            } else {
                // Otherwise just remove from queue if they were waiting
                this.removeMinerFromQueue(mineId, entityId);
            }
        });
    }

    // Remove a specific miner from a mine's queue
    removeMinerFromQueue(mineEntityId, minerEntityId) {
        const goldMine = this.game.getComponent(mineEntityId, "goldMine");
        if (!goldMine) return;

        // Find and remove the miner, shifting remaining entries left
        let foundIndex = -1;
        for (let i = 0; i < GoldMineSystem.MINER_QUEUE_SIZE; i++) {
            if (goldMine.minerQueue[i] === minerEntityId) {
                foundIndex = i;
                break;
            }
        }

        if (foundIndex !== -1) {
            // Shift all entries after foundIndex left by one
            for (let i = foundIndex; i < GoldMineSystem.MINER_QUEUE_SIZE - 1; i++) {
                goldMine.minerQueue[i] = goldMine.minerQueue[i + 1];
            }
            // Clear the last slot
            goldMine.minerQueue[GoldMineSystem.MINER_QUEUE_SIZE - 1] = null;
        }
    }

    // Add a miner to the end of the queue
    addMinerToQueue(mineEntityId, minerEntityId) {
        const goldMine = this.game.getComponent(mineEntityId, "goldMine");
        if (!goldMine) {
            return false;
        }

        // Find first empty slot (null means empty)
        for (let i = 0; i < GoldMineSystem.MINER_QUEUE_SIZE; i++) {
            if (goldMine.minerQueue[i] === null) {
                goldMine.minerQueue[i] = minerEntityId;
                return true;
            }
        }
        return false; // Queue full
    }

    // Check if a miner is next in queue (first valid entry)
    isNextInQueue(mineEntityId, minerEntityId) {
        const goldMine = this.game.getComponent(mineEntityId, "goldMine");
        if (!goldMine) {
            return false;
        }
        const isNext = goldMine.minerQueue[0] === minerEntityId;
        return isNext;
    }

    // Get count of miners in queue
    getQueueCount(mineEntityId) {
        const goldMine = this.game.getComponent(mineEntityId, "goldMine");
        if (!goldMine) return 0;
        let count = 0;
        for (let i = 0; i < GoldMineSystem.MINER_QUEUE_SIZE; i++) {
            if (goldMine.minerQueue[i] !== null) count++;
        }
        return count;
    }

    // Process next miner in queue when mine becomes available
    processNextMinerInQueue(mineEntityId) {
        const goldMine = this.game.getComponent(mineEntityId, "goldMine");
        if (!goldMine) {
            return;
        }

        const prevMiner = goldMine.currentMiner;
        goldMine.currentMiner = null;

        // Check if queue is empty (null means empty slot)
        const nextMiner = goldMine.minerQueue[0];
       
        if (nextMiner === null) {
            return;
        }

        // Shift all entries left
        for (let i = 0; i < GoldMineSystem.MINER_QUEUE_SIZE - 1; i++) {
            goldMine.minerQueue[i] = goldMine.minerQueue[i + 1];
        }
        goldMine.minerQueue[GoldMineSystem.MINER_QUEUE_SIZE - 1] = null;

        goldMine.currentMiner = nextMiner;
     }

    onBattleEnd() {
        const entities = this.game.getEntitiesWith("miningState");
        entities.forEach(entityId => {
            const miningState = this.game.getComponent(entityId, "miningState");
            if (miningState) {
                miningState.miningStartTime = 0;
                miningState.depositStartTime = 0;
            }
        });
    }

    onDestroyBuilding(entityId){
        const unitTypeComp = this.game.getComponent(entityId, "unitType");
        const unitType = this.game.call('getUnitTypeDef', unitTypeComp);
        if (unitType?.id === 'goldMine') {
            this.game.call('destroyGoldMine', entityId);
        }
    }

    reset() {
        // Gold mine state is stored in ECS goldMine components
        // No manual reset needed - destroying the entity cleans up the component
    }
}
