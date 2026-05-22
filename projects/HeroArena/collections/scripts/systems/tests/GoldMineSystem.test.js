import { describe, it, expect, beforeEach } from 'vitest';
import { TestGameContext } from '../../../../../../tests/TestGameContext.js';

describe('GoldMineSystem', () => {
    let game;
    let goldMineSystem;
    let enums;

    beforeEach(() => {
        game = new TestGameContext();

        // Register mock services needed by GoldMineSystem
        game.register('worldToPlacementGrid', (x, z) => ({ x: Math.floor(x / 50), z: Math.floor(z / 50) }));
        game.register('getUnitTypeDef', () => ({ placementGridWidth: 2, placementGridHeight: 2 }));
        game.register('isVisibleAt', () => true);

        goldMineSystem = game.createSystem(GUTS.GoldMineSystem);
        enums = game.getEnums();
    });

    describe('initialization', () => {
        it('should register system on game', () => {
            expect(game.goldMineSystem).toBe(goldMineSystem);
        });

        it('should have static MINER_QUEUE_SIZE', () => {
            expect(GUTS.GoldMineSystem.MINER_QUEUE_SIZE).toBe(8);
        });
    });

    describe('static services', () => {
        it('should register buildGoldMine service', () => {
            expect(GUTS.GoldMineSystem.services).toContain('buildGoldMine');
        });

        it('should register isValidGoldMinePlacement service', () => {
            expect(GUTS.GoldMineSystem.services).toContain('isValidGoldMinePlacement');
        });

        it('should register getGoldVeinLocations service', () => {
            expect(GUTS.GoldMineSystem.services).toContain('getGoldVeinLocations');
        });

        it('should register findNearestGoldVein service', () => {
            expect(GUTS.GoldMineSystem.services).toContain('findNearestGoldVein');
        });

        it('should register processNextMinerInQueue service', () => {
            expect(GUTS.GoldMineSystem.services).toContain('processNextMinerInQueue');
        });

        it('should register isMineOccupied service', () => {
            expect(GUTS.GoldMineSystem.services).toContain('isMineOccupied');
        });

        it('should register addMinerToQueue service', () => {
            expect(GUTS.GoldMineSystem.services).toContain('addMinerToQueue');
        });

        it('should register destroyGoldMine service', () => {
            expect(GUTS.GoldMineSystem.services).toContain('destroyGoldMine');
        });
    });

    describe('calculateGoldVeinCells', () => {
        it('should calculate cells for 2x2 grid', () => {
            const cells = goldMineSystem.calculateGoldVeinCells({ x: 5, z: 5 }, 2, 2);

            expect(cells.length).toBe(4);
        });

        it('should calculate cells for 4x4 grid', () => {
            const cells = goldMineSystem.calculateGoldVeinCells({ x: 5, z: 5 }, 4, 4);

            expect(cells.length).toBe(16);
        });

        it('should center cells around grid position', () => {
            const cells = goldMineSystem.calculateGoldVeinCells({ x: 10, z: 10 }, 2, 2);

            // With width=2, startX = 10 - round(2/2) = 10 - 1 = 9
            // Cells: (9,9), (10,9), (9,10), (10,10)
            const cellKeys = cells.map(c => `${c.x},${c.z}`);
            expect(cellKeys).toContain('9,9');
            expect(cellKeys).toContain('10,9');
            expect(cellKeys).toContain('9,10');
            expect(cellKeys).toContain('10,10');
        });
    });

    describe('cellsMatch', () => {
        it('should return true for matching cells', () => {
            const cells1 = [{ x: 0, z: 0 }, { x: 1, z: 0 }, { x: 0, z: 1 }, { x: 1, z: 1 }];
            const cells2 = [{ x: 0, z: 0 }, { x: 1, z: 0 }, { x: 0, z: 1 }, { x: 1, z: 1 }];

            expect(goldMineSystem.cellsMatch(cells1, cells2)).toBe(true);
        });

        it('should return true for matching cells in different order', () => {
            const cells1 = [{ x: 0, z: 0 }, { x: 1, z: 1 }];
            const cells2 = [{ x: 1, z: 1 }, { x: 0, z: 0 }];

            expect(goldMineSystem.cellsMatch(cells1, cells2)).toBe(true);
        });

        it('should return false for different cell count', () => {
            const cells1 = [{ x: 0, z: 0 }];
            const cells2 = [{ x: 0, z: 0 }, { x: 1, z: 1 }];

            expect(goldMineSystem.cellsMatch(cells1, cells2)).toBe(false);
        });

        it('should return false for non-matching cells', () => {
            const cells1 = [{ x: 0, z: 0 }, { x: 1, z: 1 }];
            const cells2 = [{ x: 0, z: 0 }, { x: 2, z: 2 }];

            expect(goldMineSystem.cellsMatch(cells1, cells2)).toBe(false);
        });
    });

    describe('getGoldVeinLocations', () => {
        it('should return empty array when no veins exist', () => {
            const locations = goldMineSystem.getGoldVeinLocations();
            expect(locations).toEqual([]);
        });
    });

    describe('findNearestGoldVein', () => {
        it('should return null when no veins exist', () => {
            const result = goldMineSystem.findNearestGoldVein({ x: 0, z: 0 });
            expect(result).toBeNull();
        });
    });

    describe('isValidGoldMinePlacement', () => {
        it('should return invalid when no veins exist', () => {
            const result = goldMineSystem.isValidGoldMinePlacement({ x: 0, z: 0 }, 2, 2);
            expect(result.valid).toBe(false);
        });
    });

    describe('buildGoldMine', () => {
        it('should fail without matching vein', () => {
            const entityId = game.createEntity();
            const result = goldMineSystem.buildGoldMine(entityId, 0, { x: 0, z: 0 }, 2, 2);

            expect(result.success).toBe(false);
            expect(result.error).toContain('gold vein');
        });

        it('should succeed with known vein entity ID', () => {
            const mineId = game.createEntityWith({
                transform: { position: { x: 100, y: 0, z: 100 }, rotation: { x: 0, y: 0, z: 0 } }
            });
            const veinId = game.createEntityWith({
                transform: {
                    position: { x: 100, y: 0, z: 100 },
                    rotation: { x: 0, y: 0.5, z: 0 },
                    scale: { x: 1, y: 1, z: 1 }
                }
            });

            const result = goldMineSystem.buildGoldMine(mineId, 0, { x: 2, z: 2 }, 2, 2, veinId);

            expect(result.success).toBe(true);

            const goldMine = game.getComponent(mineId, 'goldMine');
            expect(goldMine).toBeDefined();
            expect(goldMine.veinEntityId).toBe(veinId);
        });

        it('should copy rotation from vein to mine', () => {
            const mineId = game.createEntityWith({
                transform: { position: { x: 100, y: 0, z: 100 }, rotation: { x: 0, y: 0, z: 0 } }
            });
            const veinId = game.createEntityWith({
                transform: {
                    position: { x: 100, y: 0, z: 100 },
                    rotation: { x: 0.1, y: 0.5, z: 0.2 },
                    scale: { x: 1, y: 1, z: 1 }
                }
            });

            goldMineSystem.buildGoldMine(mineId, 0, { x: 2, z: 2 }, 2, 2, veinId);

            const mineTransform = game.getComponent(mineId, 'transform');
            expect(mineTransform.rotation.y).toBe(0.5);
        });
    });

    describe('destroyGoldMine', () => {
        it('should fail for entity without goldMine component', () => {
            const entityId = game.createEntity();
            const result = goldMineSystem.destroyGoldMine(entityId);

            expect(result.success).toBe(false);
            expect(result.error).toContain('No gold mine');
        });

        it('should restore vein visibility', () => {
            const mineId = game.createEntityWith({
                transform: { position: { x: 100, y: 0, z: 100 } }
            });
            const veinId = game.createEntityWith({
                transform: {
                    position: { x: 100, y: 0, z: 100 },
                    scale: { x: 0, y: 0, z: 0 }
                }
            });

            goldMineSystem.buildGoldMine(mineId, 0, { x: 2, z: 2 }, 2, 2, veinId);
            goldMineSystem.destroyGoldMine(mineId);

            const veinTransform = game.getComponent(veinId, 'transform');
            expect(veinTransform.scale.x).toBe(1);
            expect(veinTransform.scale.y).toBe(1);
            expect(veinTransform.scale.z).toBe(1);
        });

        it('should remove goldMine component', () => {
            const mineId = game.createEntityWith({
                transform: { position: { x: 100, y: 0, z: 100 } }
            });
            const veinId = game.createEntity();

            goldMineSystem.buildGoldMine(mineId, 0, { x: 2, z: 2 }, 2, 2, veinId);
            goldMineSystem.destroyGoldMine(mineId);

            expect(game.getComponent(mineId, 'goldMine')).toBeUndefined();
        });

        it('should clear miner states targeting this mine', () => {
            const mineId = game.createEntityWith({
                transform: { position: { x: 100, y: 0, z: 100 } }
            });
            const veinId = game.createEntity();
            const minerId = game.createEntityWith({
                miningState: {
                    targetMineEntityId: mineId,
                    targetMinePosition: { x: 100, z: 100 },
                    state: enums.miningState?.mining || 1
                }
            });

            goldMineSystem.buildGoldMine(mineId, 0, { x: 2, z: 2 }, 2, 2, veinId);
            goldMineSystem.destroyGoldMine(mineId);

            const miningState = game.getComponent(minerId, 'miningState');
            // targetMineEntityId is cleared (null or undefined)
            expect(miningState.targetMineEntityId == null).toBe(true);
        });
    });

    describe('isMineOccupied', () => {
        it('should return falsy for non-existent mine', () => {
            expect(goldMineSystem.isMineOccupied(999)).toBeFalsy();
        });

        it('should return false for empty mine', () => {
            const mineId = game.createEntityWith({
                goldMine: { currentMiner: null, veinEntityId: 1 }
            });

            expect(goldMineSystem.isMineOccupied(mineId)).toBe(false);
        });

        it('should return true for occupied mine', () => {
            const mineId = game.createEntityWith({
                goldMine: { currentMiner: 123, veinEntityId: 1 }
            });

            expect(goldMineSystem.isMineOccupied(mineId)).toBe(true);
        });

        it('should handle miner ID of 0 correctly', () => {
            const mineId = game.createEntityWith({
                goldMine: { currentMiner: 0, veinEntityId: 1 }
            });

            expect(goldMineSystem.isMineOccupied(mineId)).toBe(true);
        });
    });

    describe('addMinerToQueue', () => {
        it('should return false for non-existent mine', () => {
            expect(goldMineSystem.addMinerToQueue(999, 1)).toBe(false);
        });

        // Note: Queue tests require proper typed array initialization from schema
        // which happens when buildGoldMine creates the component
    });

    describe('getQueuePosition', () => {
        it('should return -1 for non-existent mine', () => {
            expect(goldMineSystem.getQueuePosition(999, 1)).toBe(-1);
        });
    });

    describe('isNextInQueue', () => {
        it('should return false for non-existent mine', () => {
            expect(goldMineSystem.isNextInQueue(999, 1)).toBe(false);
        });
    });

    describe('removeMinerFromQueue', () => {
        it('should do nothing for non-existent mine', () => {
            expect(() => goldMineSystem.removeMinerFromQueue(999, 1)).not.toThrow();
        });
    });

    describe('processNextMinerInQueue', () => {
        it('should do nothing for non-existent mine', () => {
            expect(() => goldMineSystem.processNextMinerInQueue(999)).not.toThrow();
        });
    });

    describe('getQueueCount', () => {
        it('should return 0 for non-existent mine', () => {
            expect(goldMineSystem.getQueueCount(999)).toBe(0);
        });
    });

    describe('service aliases', () => {
        it('isNextInMinerQueue should be defined', () => {
            expect(typeof goldMineSystem.isNextInMinerQueue).toBe('function');
        });

        it('getMinerQueuePosition should be defined', () => {
            expect(typeof goldMineSystem.getMinerQueuePosition).toBe('function');
        });
    });

    describe('onBattleEnd', () => {
        it('should reset mining state times', () => {
            const minerId = game.createEntityWith({
                miningState: {
                    miningStartTime: 100,
                    depositStartTime: 50
                }
            });

            goldMineSystem.onBattleEnd();

            const miningState = game.getComponent(minerId, 'miningState');
            expect(miningState.miningStartTime).toBe(0);
            expect(miningState.depositStartTime).toBe(0);
        });
    });

    describe('reset', () => {
        it('should not throw', () => {
            expect(() => goldMineSystem.reset()).not.toThrow();
        });
    });
});
