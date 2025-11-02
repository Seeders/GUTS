class GoldMineSystem extends engine.BaseSystem {
    constructor(game) {
        super(game);
        this.game.goldMineSystem = this;
        this.goldVeinLocations = [];
        this.claimedGoldMines = new Map();
        
        this.mineOccupancy = new Map();
        this.mineQueues = new Map();
        
        console.log('[GoldMineSystem] Initialized', this.game.isServer ? '(SERVER)' : '(CLIENT)');
    }

    init(params) {
        this.params = params || {};
        this.findGoldVeinLocations();
        console.log('[GoldMineSystem] Init complete. Found', this.goldVeinLocations.length, 'gold veins');
    }

    findGoldVeinLocations() {
        const tileMap = this.game.terrainSystem?.tileMap;
        if (!tileMap?.environmentObjects) {
            console.warn('[GoldMineSystem] No environment objects found');
            return;
        }

        const extensionSize = this.game.terrainSystem?.extensionSize || 0;
        const extendedSize = this.game.terrainSystem?.extendedSize || 0;

        this.goldVeinLocations = tileMap.environmentObjects
            .filter(obj => obj.type === 'goldVein')
            .map(obj => {
                const worldX = (obj.x + extensionSize) - extendedSize / 2;
                const worldZ = (obj.y + extensionSize) - extendedSize / 2;
                
                const gridPos = this.game.gridSystem.worldToGrid(worldX, worldZ);
                
                const gridWidth = obj.placementGridWidth || 2;
                const gridHeight = obj.placementGridHeight || 2;
                
                const cells = this.calculateGoldVeinCells(gridPos, gridWidth, gridHeight);

                return {
                    x: obj.x,
                    y: obj.y,
                    worldX: worldX,
                    worldZ: worldZ,
                    gridPos: gridPos,
                    gridWidth: gridWidth,
                    gridHeight: gridHeight,
                    cells: cells,
                    claimed: false,
                    claimedBy: null,
                    instanceIndex: null,
                    originalIndex: tileMap.environmentObjects.indexOf(obj)
                };
            });

        console.log('[GoldMineSystem] Found gold veins:', this.goldVeinLocations);

        if (!this.game.isServer) {
            this.mapGoldVeinInstances();
        }
    }

    calculateGoldVeinCells(gridPos, gridWidth, gridHeight) {
        const cells = [];
        const startX = gridPos.x - Math.floor(gridWidth / 2);
        const startZ = gridPos.z - Math.floor(gridHeight / 2);

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
        
        for (const vein of this.goldVeinLocations) {
            if (vein.claimed) continue;
            
            if (this.cellsMatch(buildingCells, vein.cells)) {
                return { valid: true, vein: vein };
            }
        }

        return { valid: false };
    }

    cellsMatch(cells1, cells2) {
        if (cells1.length !== cells2.length) return false;

        const cellSet = new Set(cells2.map(c => `${c.x},${c.z}`));
        
        for (const cell of cells1) {
            if (!cellSet.has(`${cell.x},${cell.z}`)) {
                return false;
            }
        }

        return true;
    }

    mapGoldVeinInstances() {
        if (!this.game.worldSystem?.scene) {
            console.warn('[GoldMineSystem] No scene available for mapping instances');
            return;
        }

        const goldVeinInstancedMeshes = [];
        this.game.worldSystem.scene.traverse(child => {
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

        let mineModel = null;
        if (!this.game.isServer) {
            mineModel = this.replaceVeinWithMine(vein);
        }

        this.claimedGoldMines.set(entityId, {
            entityId: entityId,
            position: { x: vein.x, z: vein.y },
            worldPosition: { x: vein.worldX, z: vein.worldZ },
            gridPos: vein.gridPos,
            cells: vein.cells,
            veinIndex: vein.originalIndex,
            veinData: vein,
            team: team,
            model: mineModel
        });

        return { success: true };
    }

    destroyGoldMine(entityId) {
        const goldMine = this.claimedGoldMines.get(entityId);
        if (!goldMine) {
            return { success: false, error: 'No gold mine to destroy' };
        }

        this.releaseMine(entityId);
        const queue = this.mineQueues.get(entityId);
        if (queue) {
            this.mineQueues.delete(entityId);
        }

        if (!this.game.isServer) {
            console.log('[GoldMineSystem] CLIENT: Restoring vein');
            this.restoreVein(goldMine.veinData);
        } else {
            console.log('[GoldMineSystem] SERVER: Releasing mine claim');
            goldMine.veinData.claimed = false;
            goldMine.veinData.claimedBy = null;
        }
        
        this.claimedGoldMines.delete(entityId);

        console.log('[GoldMineSystem] Gold mine destroyed. Remaining mines:', this.claimedGoldMines.size);
        return { success: true };
    }

    isMineOccupied(mineEntityId) {
        return this.mineOccupancy.has(mineEntityId);
    }

    getCurrentMiner(mineEntityId) {
        return this.mineOccupancy.get(mineEntityId);
    }

    claimMine(mineEntityId, minerEntityId) {
        this.mineOccupancy.set(mineEntityId, minerEntityId);
    }

    releaseMine(mineEntityId, minerEntityId = null) {
        if (minerEntityId) {
            const currentOccupant = this.mineOccupancy.get(mineEntityId);
    
            this.mineOccupancy.delete(mineEntityId);
            this.processNextInQueue(mineEntityId);
    
        } else {
            this.mineOccupancy.delete(mineEntityId);
        }
    }

    processNextInQueue(mineEntityId) {
   
        const queue = this.mineQueues.get(mineEntityId);
        if (!queue || queue.length === 0) {
            return;
        }
        const nextMinerId = queue[0];
        
        queue.shift();
        if (queue.length === 0) {
            this.mineQueues.delete(mineEntityId);
        }
        
        this.mineOccupancy.set(mineEntityId, nextMinerId);
        
        const ComponentTypes = this.game.componentManager.getComponentTypes();
        const miningState = this.game.getComponent(nextMinerId, ComponentTypes.MINING_STATE);
        
        if (miningState && (miningState.state === 'waiting_at_mine' || miningState.state === 'walking_to_mine')) {
            const aiState = this.game.getComponent(nextMinerId, ComponentTypes.AI_STATE);
            const pos = this.game.getComponent(nextMinerId, ComponentTypes.POSITION);
            const vel = this.game.getComponent(nextMinerId, ComponentTypes.VELOCITY);
            
            if (pos && vel && miningState.targetMinePosition) {
                miningState.waitingPosition = null;
                
                pos.x = miningState.targetMinePosition.x;
                pos.z = miningState.targetMinePosition.z;
                vel.vx = 0;
                vel.vz = 0;
                
                miningState.state = 'mining';
                miningState.miningStartTime = this.game.state.now;
                
                if (aiState) {
                    aiState.state = 'idle';
                    aiState.targetPosition = null;
                }
            }
        }
    }

    addToQueue(mineEntityId, minerEntityId) {
        if (!this.mineQueues.has(mineEntityId)) {
            this.mineQueues.set(mineEntityId, []);
        }
        const queue = this.mineQueues.get(mineEntityId);
        
        if (!queue.includes(minerEntityId)) {
            queue.push(minerEntityId);
        }
    }

    removeFromQueue(mineEntityId, minerEntityId) {
        const queue = this.mineQueues.get(mineEntityId);
        if (queue) {
            const index = queue.indexOf(minerEntityId);
            if (index > -1) {
                queue.splice(index, 1);
            }
            if (queue.length === 0) {
                this.mineQueues.delete(mineEntityId);
            }
        }
    }

    isNextInQueue(mineEntityId, minerEntityId) {
        const queue = this.mineQueues.get(mineEntityId);
        return queue && queue.length > 0 && queue[0] === minerEntityId;
    }

    getQueuePosition(mineEntityId, minerEntityId) {
        const queue = this.mineQueues.get(mineEntityId);
        if (!queue) return -1;
        return queue.indexOf(minerEntityId);
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
        const ComponentTypes = this.game.componentManager.getComponentTypes();
        const entities = this.game.getEntitiesWith(ComponentTypes.MINING_STATE);
        
        entities.forEach(entityId => {
            const miningState = this.game.getComponent(entityId, ComponentTypes.MINING_STATE);
            if (miningState) {
                miningState.miningStartTime = 0;
                miningState.depositStartTime = 0;
            }
        });
    }

    reset() {
        
        if (!this.game.isServer) {
            for (const [entityId, goldMine] of this.claimedGoldMines) {
                this.restoreVein(goldMine.veinData, goldMine.model);
            }
        } else {
            for (const [entityId, goldMine] of this.claimedGoldMines) {
                goldMine.veinData.claimed = false;
                goldMine.veinData.claimedBy = null;
            }
        }
        
        this.claimedGoldMines.clear();
        this.mineOccupancy.clear();
        this.mineQueues.clear();
        
    }
}