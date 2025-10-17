class GoldMineSystem extends engine.BaseSystem {
    constructor(game) {
        super(game);
        this.game.goldMineSystem = this;
        this.goldVeinLocations = [];
        this.claimedGoldMines = new Map();
        
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

        console.log('[GoldMineSystem] Found', goldVeinInstancedMeshes.length, 'gold vein instanced meshes');

        let globalIndex = 0;
        for (const vein of this.goldVeinLocations) {
            vein.instanceIndex = globalIndex;
            vein.instancedMeshes = goldVeinInstancedMeshes;
            globalIndex++;
        }
    }

    buildGoldMine(team, gridPos, buildingGridWidth, buildingGridHeight) {
        console.log('[GoldMineSystem] Attempting to build gold mine for player:', team, 'at grid:', gridPos);
        
        const validation = this.isValidGoldMinePlacement(gridPos, buildingGridWidth, buildingGridHeight);
        if (!validation.valid) {
            console.warn('[GoldMineSystem] Invalid placement - no matching unclaimed vein');
            return { success: false, error: 'Must be placed on a gold vein' };
        }

        const vein = validation.vein;
        console.log('[GoldMineSystem] Claiming vein at position:', vein.x, vein.y);
        
        vein.claimed = true;
        vein.claimedBy = team;

        let mineModel = null;
        if (!this.game.isServer) {
            console.log('[GoldMineSystem] CLIENT: Replacing vein with mine model');
            mineModel = this.replaceVeinWithMine(vein);
        } else {
            console.log('[GoldMineSystem] SERVER: Tracking mine claim (no rendering)');
        }

        this.claimedGoldMines.set(team, {
            position: { x: vein.x, z: vein.y },
            worldPosition: { x: vein.worldX, z: vein.worldZ },
            gridPos: vein.gridPos,
            cells: vein.cells,
            veinIndex: vein.originalIndex,
            veinData: vein,
            model: mineModel
        });

        console.log('[GoldMineSystem] Gold mine built successfully. Total mines:', this.claimedGoldMines.size);
        return { success: true };
    }

    destroyGoldMine(team) {
        console.log('[GoldMineSystem] Attempting to destroy gold mine for player:', team);
        
        const goldMine = this.claimedGoldMines.get(team);
        if (!goldMine) {
            console.warn('[GoldMineSystem] No gold mine found for player');
            return { success: false, error: 'No gold mine to destroy' };
        }

        if (!this.game.isServer) {
            console.log('[GoldMineSystem] CLIENT: Restoring vein');
            this.restoreVein(goldMine.veinData);
        } else {
            console.log('[GoldMineSystem] SERVER: Releasing mine claim');
            goldMine.veinData.claimed = false;
            goldMine.veinData.claimedBy = null;
        }
        
        this.claimedGoldMines.delete(team);

        console.log('[GoldMineSystem] Gold mine destroyed. Remaining mines:', this.claimedGoldMines.size);
        return { success: true };
    }

    replaceVeinWithMine(vein) {
        if (vein.instancedMeshes && vein.instanceIndex !== null) {
            console.log('[GoldMineSystem] Hiding vein instance at index:', vein.instanceIndex);
            vein.instancedMeshes.forEach(mesh => {
                const matrix = new THREE.Matrix4();
                const position = new THREE.Vector3(0, -10000, 0);
                matrix.makeTranslation(position.x, position.y, position.z);
                matrix.scale(new THREE.Vector3(0.001, 0.001, 0.001));
                mesh.setMatrixAt(vein.instanceIndex, matrix);
                mesh.instanceMatrix.needsUpdate = true;
            });
        } else {
            console.warn('[GoldMineSystem] No instanced meshes found for vein');
        }

    }

    restoreVein(vein) {
        if (vein.instancedMeshes && vein.instanceIndex !== null) {
            const extensionSize = this.game.terrainSystem?.extensionSize || 0;
            const extendedSize = this.game.terrainSystem?.extendedSize || 0;
            const heightMapSettings = this.game.worldSystem?.heightMapSettings;
            
            let height = 0;
            if (heightMapSettings?.enabled) {
                height = heightMapSettings.heightStep * this.game.terrainSystem.tileMap.extensionTerrainType;
            }

            const worldX = (vein.x + extensionSize) - extendedSize / 2;
            const worldZ = (vein.y + extensionSize) - extendedSize / 2;

            const dummy = new THREE.Object3D();
            dummy.position.set(worldX, height, worldZ);
            dummy.rotation.y = Math.random() * Math.PI * 2;
            dummy.scale.set(50, 50, 50);
            dummy.updateMatrix();

            vein.instancedMeshes.forEach(mesh => {
                const matrix = new THREE.Matrix4();
                matrix.copy(dummy.matrix);
                if (mesh.userData.relativeMatrix) {
                    matrix.multiply(mesh.userData.relativeMatrix);
                }
                mesh.setMatrixAt(vein.instanceIndex, matrix);
                mesh.instanceMatrix.needsUpdate = true;
            });
            
            console.log('[GoldMineSystem] Vein instance restored');
        }

        vein.claimed = false;
        vein.claimedBy = null;
    }

    getGoldMinePosition(team) {
        const goldMine = this.claimedGoldMines.get(team);
        if (!goldMine) return null;
        return goldMine.worldPosition;
    }

    hasGoldMine(team) {
        return this.claimedGoldMines.has(team);
    }

    reset() {
        console.log('[GoldMineSystem] Resetting system');
        
        if (!this.game.isServer) {
            for (const [playerId, goldMine] of this.claimedGoldMines) {
                this.restoreVein(goldMine.veinData, goldMine.model);
            }
        } else {
            for (const [playerId, goldMine] of this.claimedGoldMines) {
                goldMine.veinData.claimed = false;
                goldMine.veinData.claimedBy = null;
            }
        }
        
        this.claimedGoldMines.clear();
        console.log('[GoldMineSystem] Reset complete');
    }
}