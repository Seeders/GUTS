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
            if (goldMine?.veinEntityId) {
                claimedVeinEntityIds.add(goldMine.veinEntityId);
            }
        }

        // Sort for deterministic iteration
        const sortedEntities = Array.from(worldObjectEntities).sort((a, b) => a - b);

        for (const entityId of sortedEntities) {
            const worldObj = this.game.getComponent(entityId, 'worldObject');
            if (worldObj?.type !== 'goldVein') continue;

            const transform = this.game.getComponent(entityId, 'transform');
            const pos = transform?.position;
            if (!pos) continue;

            const gridPos = this.game.call('worldToPlacementGrid', pos.x, pos.z);
            const unitType = this.game.getComponent(entityId, 'unitType');
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
        this.game.addComponent(entityId, "goldMine", {
            veinEntityId: veinEntityId,
            currentMiner: null,
            minerQueue: [],
            cells: veinCells
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
                miningState.state = 'idle';
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
        if (goldMine && goldMine.currentMiner) {
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
                miningState.state === 'mining') {
                return minerEntityId;
            }
        }
        
        return null;
    }

    // Get all miners in queue (waiting_at_mine state) for a specific mine
    getMinersInQueue(mineEntityId) {
        const goldMine = this.game.getComponent(mineEntityId, "goldMine");              
        return goldMine.minerQueue;
    }

    // Get queue position for a specific miner
    getQueuePosition(mineEntityId, minerEntityId) {
        const queue = this.getMinersInQueue(mineEntityId);
        return queue.indexOf(minerEntityId);
    }

    onIssuedPlayerOrders(entityId){
        const goldMines = this.game.getEntitiesWith('goldMine');
        goldMines.forEach((mineId) => {
            const goldMine = this.game.getComponent(mineId, 'goldMine');
            const index = goldMine.minerQueue.indexOf(entityId);
            if(index != -1) {
                goldMine.minerQueue.splice(index, 1);
            }
        });
    }

    addMinerToQueue(mineEntityId, minerEntityId){
        const goldMine = this.game.getComponent(mineEntityId, "goldMine");
        goldMine.minerQueue.push(minerEntityId);
    }

    // Check if a miner is next in queue
    isNextInQueue(mineEntityId, minerEntityId) {
        const queue = this.getMinersInQueue(mineEntityId);
        return queue.length > 0 && queue[0] === minerEntityId;
    }

    // Process next miner in queue when mine becomes available
    processNextMinerInQueue(mineEntityId) {
        const goldMine = this.game.getComponent(mineEntityId, "goldMine");
        goldMine.currentMiner = null;
        if (goldMine.minerQueue.length === 0) {
            return;
        }

        let nextMiner = goldMine.minerQueue.shift();
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
        const unitType = this.game.getComponent(entityId, "unitType");
        if (unitType.id === 'goldMine') {
            this.game.goldMineSystem.destroyGoldMine(entityId);
        }
    }

    reset() {
        // Gold mine state is stored in ECS goldMine components
        // No manual reset needed - destroying the entity cleans up the component
    }
}