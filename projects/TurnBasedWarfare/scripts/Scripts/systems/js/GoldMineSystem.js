class GoldMineSystem extends GUTS.BaseSystem {
    constructor(game) {
        super(game);
        this.game.goldMineSystem = this;
        this.goldVeinLocations = [];

        console.log('[GoldMineSystem] Initialized', this.game.isServer ? '(SERVER)' : '(CLIENT)');
    }

    init(params) {
        this.params = params || {};

        this.game.gameManager.register('buildGoldMine', this.buildGoldMine.bind(this));
        this.game.gameManager.register('isValidGoldMinePlacement', this.isValidGoldMinePlacement.bind(this));
        this.game.gameManager.register('getGoldVeinLocations', () => this.goldVeinLocations);

        this.findGoldVeinLocations();
        console.log('[GoldMineSystem] Init complete. Found', this.goldVeinLocations.length, 'gold veins');
    }

    findGoldVeinLocations() {
        const tileMap = this.game.gameManager.call('getTileMap');
        if (!tileMap?.worldObjects) {
            console.warn('[GoldMineSystem] No world objects found');
            return;
        }

        const extensionSize = this.game.gameManager.call('getTerrainExtensionSize');
        const extendedSize = this.game.gameManager.call('getTerrainExtendedSize');

        this.goldVeinLocations = tileMap.worldObjects
            .filter(obj => obj.type === 'goldVein')
            .map(obj => {
                const worldX = (obj.x + extensionSize) - extendedSize / 2;
                const worldZ = (obj.y + extensionSize) - extendedSize / 2;
                const gridPos = this.game.gameManager.call('convertWorldToGridPosition', worldX, worldZ);
                // Gold veins use placementGridWidth which is already in placement grid units
                // But we need to match how buildings calculate their cells (footprintWidth * 2)
                // Since gold veins have placementGridWidth=2, and buildings have footprintWidth=2,
                // we need to convert: footprintWidth * 2 = 2 * 2 = 4 placement grid cells
                const veinPlacementGridWidth = obj.placementGridWidth || 2;
                const veinPlacementGridHeight = obj.placementGridHeight || 2;
                // Convert to match building footprint calculation
                const gridWidth = veinPlacementGridWidth * 2;
                const gridHeight = veinPlacementGridHeight * 2;

                const cells = this.calculateGoldVeinCells(gridPos, gridWidth, gridHeight);

                return {
                    x: obj.x,
                    y: obj.y,
                    worldX: worldX,
                    worldZ: worldZ,
                    gridPos: gridPos,
                    gridWidth: gridWidth,  // 4 (placement grid cells)
                    gridHeight: gridHeight,  // 4 (placement grid cells)
                    cells: cells,
                    claimed: false,
                    claimedBy: null,
                    instanceIndex: null,
                    originalIndex: tileMap.worldObjects.indexOf(obj)
                };
            });

        console.log('[GoldMineSystem] Found gold veins:', this.goldVeinLocations);

        if (!this.game.isServer) {
            this.mapGoldVeinInstances();
        }
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

    isValidGoldMinePlacement(gridPos, buildingGridWidth, buildingGridHeight) {
        const buildingCells = this.calculateGoldVeinCells(gridPos, buildingGridWidth, buildingGridHeight);
        console.log('[GOLD MINE SYSTEM] isValidGoldPlacement', gridPos, buildingGridWidth, buildingGridHeight);
        console.log('[GOLD MINE SYSTEM] Building cells:', buildingCells);
        console.log('[GOLD MINE SYSTEM] Total veins:', this.goldVeinLocations.length);
        for (const vein of this.goldVeinLocations) {
            console.log('[GOLD MINE SYSTEM] Checking vein at gridPos:', vein.gridPos, 'cells:', vein.cells);
            if (vein.claimed) {
                console.log('[GOLD MINE SYSTEM] Vein already claimed, skipping');
                continue;
            }

            if (this.cellsMatch(buildingCells, vein.cells)) {
                console.log('[GOLD MINE SYSTEM] Match found!');
                return { valid: true, vein: vein };
            }
        }

        console.log('[GOLD MINE SYSTEM] No matching vein found');
        return { valid: false };
    }

    cellsMatch(cells1, cells2) {
        console.log('[GOLD MINE SYSTEM] cellsMatch');
        console.log('[GOLD MINE SYSTEM] Building cells (cells1):', cells1);
        console.log('[GOLD MINE SYSTEM] Vein cells (cells2):', cells2);
        if (cells1.length !== cells2.length) {
            console.log('[GOLD MINE SYSTEM] Length mismatch:', cells1.length, 'vs', cells2.length);
            return false;
        }

        const cellSet = new Set(cells2.map(c => `${c.x},${c.z}`));
        console.log('[GOLD MINE SYSTEM] Vein cell keys:', Array.from(cellSet));

        for (const cell of cells1) {
            const key = `${cell.x},${cell.z}`;
            const hasCell = cellSet.has(key);
            console.log('[GOLD MINE SYSTEM]', cell, 'key:', key, 'found:', hasCell);
            if (!hasCell) {
                return false;
            }
        }

        return true;
    }

    mapGoldVeinInstances() {
        if (!this.game.gameManager.call('getWorldScene')) {
            console.warn('[GoldMineSystem] No scene available for mapping instances');
            return;
        }

        const goldVeinInstancedMeshes = [];
        this.game.gameManager.call('getWorldScene').traverse(child => {
            if (child instanceof THREE.InstancedMesh && child.userData.objectType === 'goldVein') {
                goldVeinInstancedMeshes.push(child);
            }
        });

        let globalIndex = 0;
        for (const vein of this.goldVeinLocations) {
            vein.instanceIndex = globalIndex;
            vein.instancedMeshes = goldVeinInstancedMeshes;
            globalIndex++;
        }
    }

    buildGoldMine(entityId, team, gridPos, buildingGridWidth, buildingGridHeight) {
        const validation = this.isValidGoldMinePlacement(gridPos, buildingGridWidth, buildingGridHeight);
        if (!validation.valid) {
            console.warn('[GoldMineSystem] Invalid placement - no matching unclaimed vein');
            return { success: false, error: 'Must be placed on a gold vein' };
        }

        const vein = validation.vein;

        vein.claimed = true;
        vein.claimedBy = team;

        if (!this.game.isServer) {
            this.replaceVeinWithMine(vein);
        }

        // Add goldMine component to the entity
        this.game.addComponent(entityId, "goldMine", {
            veinIndex: vein.originalIndex,
            currentOccupant: null,
            cells: vein.cells
        });

        return { success: true };
    }

    destroyGoldMine(entityId) {
        const goldMine = this.game.getComponent(entityId, "goldMine");
        if (!goldMine) {
            return { success: false, error: 'No gold mine component found' };
        }

        // Get the vein data
        const vein = this.goldVeinLocations[goldMine.veinIndex];
        if (!vein) {
            console.warn('[GoldMineSystem] Could not find vein data for veinIndex:', goldMine.veinIndex);
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

        if (vein) {
            if (!this.game.isServer) {
                console.log('[GoldMineSystem] CLIENT: Restoring vein');
                this.restoreVein(vein);
            } else {
                console.log('[GoldMineSystem] SERVER: Releasing mine claim');
                vein.claimed = false;
                vein.claimedBy = null;
            }
        }

        // Remove the goldMine component from the entity
        this.game.removeComponent(entityId, "goldMine");

        const remainingMines = this.game.getEntitiesWith("goldMine").length;
        console.log('[GoldMineSystem] Gold mine destroyed. Remaining mines:', remainingMines);
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

    addMinerToQueue(mineEntityId, minerEntityId){
        console.log('addMinerToQueue', mineEntityId, minerEntityId);
        const goldMine = this.game.getComponent(mineEntityId, "goldMine");
        goldMine.minerQueue.push(minerEntityId);
    }

    // Check if a miner is next in queue
    isNextInQueue(mineEntityId, minerEntityId) {
        const queue = this.getMinersInQueue(mineEntityId);
        return queue.length > 0 && queue[0] === minerEntityId;
    }

    // Process next miner in queue when mine becomes available
    processNextInQueue(mineEntityId) {
        const goldMine = this.game.getComponent(mineEntityId, "goldMine");
        goldMine.currentMiner = null;
        if (goldMine.minerQueue.length === 0) {
            return;
        }

        let nextMiner = goldMine.minerQueue.shift();
        goldMine.currentMiner = nextMiner;


    }

    replaceVeinWithMine(vein) {
        return;
        // if (vein.instancedMeshes && vein.instanceIndex !== null) {
        //     vein.instancedMeshes.forEach(mesh => {
        //         const matrix = new THREE.Matrix4();
        //         const position = new THREE.Vector3(0, -10000, 0);
        //         matrix.makeTranslation(position.x, position.y, position.z);
        //         matrix.scale(new THREE.Vector3(0.001, 0.001, 0.001));
        //         mesh.setMatrixAt(vein.instanceIndex, matrix);
        //         mesh.instanceMatrix.needsUpdate = true;
        //     });
        // } 
    }

    restoreVein(vein) {
        // if (vein.instancedMeshes && vein.instanceIndex !== null) {
        //     const extensionSize = this.game.terrainSystem?.extensionSize || 0;
        //     const extendedSize = this.game.terrainSystem?.extendedSize || 0;
        //     const heightMapSettings = this.game.worldSystem?.heightMapSettings;
            
        //     let height = 0;
        //     if (heightMapSettings?.enabled) {
        //         height = heightMapSettings.heightStep * this.game.terrainSystem.tileMap.extensionTerrainType;
        //     }

        //     const worldX = (vein.x + extensionSize) - extendedSize / 2;
        //     const worldZ = (vein.y + extensionSize) - extendedSize / 2;

        //     const dummy = new THREE.Object3D();
        //     dummy.position.set(worldX, height, worldZ);
        //     dummy.rotation.y = Math.random() * Math.PI * 2;
        //     dummy.scale.set(50, 50, 50);
        //     dummy.updateMatrix();

        //     vein.instancedMeshes.forEach(mesh => {
        //         const matrix = new THREE.Matrix4();
        //         matrix.copy(dummy.matrix);
        //         if (mesh.userData.relativeMatrix) {
        //             matrix.multiply(mesh.userData.relativeMatrix);
        //         }
        //         mesh.setMatrixAt(vein.instanceIndex, matrix);
        //         mesh.instanceMatrix.needsUpdate = true;
        //     });            
        // }

        vein.claimed = false;
        vein.claimedBy = null;
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
        const goldMines = this.game.getEntitiesWith("goldMine");

        for (const entityId of goldMines) {
            const goldMine = this.game.getComponent(entityId, "goldMine");
            if (!goldMine) continue;

            const vein = this.goldVeinLocations[goldMine.veinIndex];
            if (vein) {
                if (!this.game.isServer) {
                    this.restoreVein(vein);
                } else {
                    vein.claimed = false;
                    vein.claimedBy = null;
                }
            }
        }
    }
}