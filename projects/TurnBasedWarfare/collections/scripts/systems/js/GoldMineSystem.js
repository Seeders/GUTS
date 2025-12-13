class GoldMineSystem extends GUTS.BaseSystem {
    constructor(game) {
        super(game);
        this.game.goldMineSystem = this;
    }

    init(params) {
        this.params = params || {};

        this.game.register('buildGoldMine', this.buildGoldMine.bind(this));
        this.game.register('isValidGoldMinePlacement', this.isValidGoldMinePlacement.bind(this));
        this.game.register('getGoldVeinLocations', this.getGoldVeinLocations.bind(this));
        this.game.register('processNextMinerInQueue', this.processNextMinerInQueue.bind(this));
        this.game.register('isMineOccupied', this.isMineOccupied.bind(this));
        this.game.register('isNextInMinerQueue', this.isNextInQueue.bind(this));
        this.game.register('addMinerToQueue', this.addMinerToQueue.bind(this));
        this.game.register('getMinerQueuePosition', this.getQueuePosition.bind(this));
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
            // veinEntityId is -1 when no vein, >= 0 when valid
            if (goldMine?.veinEntityId >= 0) {
                claimedVeinEntityIds.add(goldMine.veinEntityId);
            }
        }

        // Sort for deterministic iteration
        const sortedEntities = Array.from(worldObjectEntities).sort((a, b) => a - b);

        for (const entityId of sortedEntities) {
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
            currentMiner: -1
            // minerQueue is initialized by the schema's $fixedArray definition
        });

        return { success: true };
    }

    destroyGoldMine(entityId) {
        const goldMine = this.game.getComponent(entityId, "goldMine");
        if (!goldMine) {
            return { success: false, error: 'No gold mine component found' };
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
        // currentMiner is -1 when empty, >= 0 when occupied
        if (goldMine && goldMine.currentMiner >= 0) {
            return true;
        }
        return false;
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
            this.removeMinerFromQueue(mineId, entityId);
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
            goldMine.minerQueue[GoldMineSystem.MINER_QUEUE_SIZE - 1] = -1;
        }
    }

    // Add a miner to the end of the queue
    addMinerToQueue(mineEntityId, minerEntityId) {
        const goldMine = this.game.getComponent(mineEntityId, "goldMine");
        if (!goldMine) return false;

        // Find first empty slot (-1 means empty)
        for (let i = 0; i < GoldMineSystem.MINER_QUEUE_SIZE; i++) {
            if (goldMine.minerQueue[i] === -1) {
                goldMine.minerQueue[i] = minerEntityId;
                return true;
            }
        }
        return false; // Queue full
    }

    // Check if a miner is next in queue (first valid entry)
    isNextInQueue(mineEntityId, minerEntityId) {
        const goldMine = this.game.getComponent(mineEntityId, "goldMine");
        if (!goldMine) return false;
        return goldMine.minerQueue[0] === minerEntityId;
    }

    // Get count of miners in queue
    getQueueCount(mineEntityId) {
        const goldMine = this.game.getComponent(mineEntityId, "goldMine");
        if (!goldMine) return 0;
        let count = 0;
        for (let i = 0; i < GoldMineSystem.MINER_QUEUE_SIZE; i++) {
            if (goldMine.minerQueue[i] !== -1) count++;
        }
        return count;
    }

    // Process next miner in queue when mine becomes available
    processNextMinerInQueue(mineEntityId) {
        const goldMine = this.game.getComponent(mineEntityId, "goldMine");
        if (!goldMine) return;
        goldMine.currentMiner = -1;

        // Check if queue is empty
        if (goldMine.minerQueue[0] === -1) {
            return;
        }

        // Get next miner (shift operation)
        const nextMiner = goldMine.minerQueue[0];

        // Shift all entries left
        for (let i = 0; i < GoldMineSystem.MINER_QUEUE_SIZE - 1; i++) {
            goldMine.minerQueue[i] = goldMine.minerQueue[i + 1];
        }
        goldMine.minerQueue[GoldMineSystem.MINER_QUEUE_SIZE - 1] = -1;

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
            this.game.goldMineSystem.destroyGoldMine(entityId);
        }
    }

    reset() {
        // Gold mine state is stored in ECS goldMine components
        // No manual reset needed - destroying the entity cleans up the component
    }
}
