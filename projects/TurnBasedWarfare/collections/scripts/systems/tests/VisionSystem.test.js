import { describe, it, expect, beforeEach } from 'vitest';
import { TestGameContext } from '../../../../../../tests/TestGameContext.js';

describe('VisionSystem', () => {
    let game;
    let visionSystem;
    let enums;

    beforeEach(() => {
        game = new TestGameContext();

        // Register mock services needed by VisionSystem
        game.register('getGridSize', () => 32);
        game.register('getTerrainSize', () => 1024);
        game.register('getHeightLevelAtGridPosition', () => 0);
        game.register('getTerrainHeightAtPositionSmooth', () => 0);
        game.register('getNearbyUnits', () => []);
        game.register('getUnitTypeDef', () => null);

        visionSystem = game.createSystem(GUTS.VisionSystem);
        enums = game.getEnums();
    });

    describe('initialization', () => {
        it('should have default unit height of 25', () => {
            expect(visionSystem.DEFAULT_UNIT_HEIGHT).toBe(25);
        });

        it('should initialize with null cached values', () => {
            expect(visionSystem._gridSize).toBe(null);
            expect(visionSystem._terrainSize).toBe(null);
        });

        it('should pre-allocate bresenham tiles array', () => {
            expect(visionSystem._bresenhamTiles.length).toBe(visionSystem._maxBresenhamLength);
        });

        it('should have max bresenham length of 100', () => {
            expect(visionSystem._maxBresenhamLength).toBe(100);
        });
    });

    describe('_getGridSize', () => {
        it('should fetch and cache grid size on first call', () => {
            const size = visionSystem._getGridSize();
            expect(size).toBe(32);
            expect(visionSystem._gridSize).toBe(32);
        });

        it('should return cached value on subsequent calls', () => {
            visionSystem._getGridSize();
            // Override the service to return different value
            game.register('getGridSize', () => 64);
            // Should still return cached value
            expect(visionSystem._getGridSize()).toBe(32);
        });
    });

    describe('_getTerrainSize', () => {
        it('should fetch and cache terrain size on first call', () => {
            const size = visionSystem._getTerrainSize();
            expect(size).toBe(1024);
            expect(visionSystem._terrainSize).toBe(1024);
        });

        it('should return cached value on subsequent calls', () => {
            visionSystem._getTerrainSize();
            // Override the service to return different value
            game.register('getTerrainSize', () => 2048);
            // Should still return cached value
            expect(visionSystem._getTerrainSize()).toBe(1024);
        });
    });

    describe('canSeePosition', () => {
        it('should return true when target is at same height level', () => {
            game.register('getHeightLevelAtGridPosition', () => 0);

            const from = { x: 0, z: 0 };
            const to = { x: 100, z: 100 };

            expect(visionSystem.canSeePosition(from, to)).toBe(true);
        });

        it('should return true when target is at lower height level', () => {
            game.register('getHeightLevelAtGridPosition', (x, z) => {
                // From position is higher
                if (x === 16 && z === 16) return 2;
                // To position is lower
                return 0;
            });

            const from = { x: 0, z: 0 };
            const to = { x: 100, z: 100 };

            expect(visionSystem.canSeePosition(from, to)).toBe(true);
        });

        it('should return false when target is at higher height level', () => {
            game.register('getHeightLevelAtGridPosition', (x, z) => {
                // From position
                if (x === 16 && z === 16) return 0;
                // To position is higher
                return 2;
            });

            const from = { x: 0, z: 0 };
            const to = { x: 100, z: 100 };

            expect(visionSystem.canSeePosition(from, to)).toBe(false);
        });
    });

    describe('hasLineOfSight', () => {
        it('should return true for very close positions', () => {
            const from = { x: 0, z: 0 };
            const to = { x: 10, z: 10 };

            expect(visionSystem.hasLineOfSight(from, to, null)).toBe(true);
        });

        it('should return false when target is at higher elevation', () => {
            game.register('getHeightLevelAtGridPosition', (x, z) => {
                // From position at center (512/32 = 16)
                if (x === 16 && z === 16) return 0;
                // To position is higher
                return 2;
            });

            const from = { x: 0, z: 0 };
            const to = { x: 200, z: 200 };

            expect(visionSystem.hasLineOfSight(from, to, null)).toBe(false);
        });

        it('should return true when positions have clear LOS at same level', () => {
            const from = { x: 0, z: 0 };
            const to = { x: 200, z: 200 };

            expect(visionSystem.hasLineOfSight(from, to, null)).toBe(true);
        });

        it('should use unit type height when provided', () => {
            const from = { x: 0, z: 0 };
            const to = { x: 200, z: 200 };
            const unitType = { height: 50 };

            expect(visionSystem.hasLineOfSight(from, to, unitType)).toBe(true);
        });

        it('should check for trees blocking LOS', () => {
            // Create a tree entity that blocks the path
            const treeId = game.createEntityWith({
                transform: { position: { x: 100, y: 0, z: 100 } },
                unitType: { id: 'tree' }
            });

            // Mock getNearbyUnits to return the tree
            game.register('getNearbyUnits', () => [treeId]);
            game.register('getUnitTypeDef', () => ({ size: 20, height: 100 }));

            const from = { x: 0, z: 0 };
            const to = { x: 200, z: 200 };

            expect(visionSystem.hasLineOfSight(from, to, null)).toBe(false);
        });

        it('should allow LOS when ray passes above trees', () => {
            // Create a tree entity
            const treeId = game.createEntityWith({
                transform: { position: { x: 100, y: 0, z: 100 } },
                unitType: { id: 'tree' }
            });

            // Mock getNearbyUnits to return the tree
            game.register('getNearbyUnits', () => [treeId]);
            // Tree is very short
            game.register('getUnitTypeDef', () => ({ size: 20, height: 5 }));

            const from = { x: 0, z: 0 };
            const to = { x: 200, z: 200 };
            // Unit with tall height can see over tree
            const unitType = { height: 100 };

            expect(visionSystem.hasLineOfSight(from, to, unitType)).toBe(true);
        });
    });

    describe('checkTileBasedLOS', () => {
        it('should return true when path has no elevation obstacles', () => {
            const from = { x: 0, z: 0 };
            const to = { x: 200, z: 200 };
            const fromEyeHeight = 25;
            const toTerrainHeight = 0;
            const fromHeightLevel = 0;

            expect(visionSystem.checkTileBasedLOS(from, to, fromEyeHeight, toTerrainHeight, fromHeightLevel)).toBe(true);
        });

        it('should return false when intermediate tile is higher', () => {
            game.register('getHeightLevelAtGridPosition', (x, z) => {
                // Middle tiles have higher elevation
                if (x > 14 && x < 20) return 2;
                return 0;
            });

            const from = { x: 0, z: 0 };
            const to = { x: 200, z: 200 };
            const fromEyeHeight = 25;
            const toTerrainHeight = 0;
            const fromHeightLevel = 0;

            expect(visionSystem.checkTileBasedLOS(from, to, fromEyeHeight, toTerrainHeight, fromHeightLevel)).toBe(false);
        });

        it('should return false when ray goes below terrain', () => {
            // Terrain has a hill in the middle
            game.register('getTerrainHeightAtPositionSmooth', (x, z) => {
                // Middle of path has high terrain
                if (x > 50 && x < 150) return 100;
                return 0;
            });

            const from = { x: 0, z: 0 };
            const to = { x: 200, z: 200 };
            const fromEyeHeight = 25;
            const toTerrainHeight = 0;
            const fromHeightLevel = 0;

            expect(visionSystem.checkTileBasedLOS(from, to, fromEyeHeight, toTerrainHeight, fromHeightLevel)).toBe(false);
        });
    });

    describe('bresenhamLine', () => {
        it('should return 1 for same start and end', () => {
            const count = visionSystem.bresenhamLine(5, 5, 5, 5);
            expect(count).toBe(1);
            expect(visionSystem._bresenhamTiles[0]).toEqual({ x: 5, z: 5 });
        });

        it('should return correct tiles for horizontal line', () => {
            const count = visionSystem.bresenhamLine(0, 5, 4, 5);
            expect(count).toBe(5);
            expect(visionSystem._bresenhamTiles[0]).toEqual({ x: 0, z: 5 });
            expect(visionSystem._bresenhamTiles[4]).toEqual({ x: 4, z: 5 });
        });

        it('should return correct tiles for vertical line', () => {
            const count = visionSystem.bresenhamLine(3, 0, 3, 4);
            expect(count).toBe(5);
            expect(visionSystem._bresenhamTiles[0]).toEqual({ x: 3, z: 0 });
            expect(visionSystem._bresenhamTiles[4]).toEqual({ x: 3, z: 4 });
        });

        it('should return correct tiles for diagonal line', () => {
            const count = visionSystem.bresenhamLine(0, 0, 3, 3);
            expect(count).toBe(4);
            expect(visionSystem._bresenhamTiles[0]).toEqual({ x: 0, z: 0 });
            expect(visionSystem._bresenhamTiles[3]).toEqual({ x: 3, z: 3 });
        });

        it('should handle negative direction', () => {
            const count = visionSystem.bresenhamLine(5, 5, 0, 0);
            expect(count).toBe(6);
            expect(visionSystem._bresenhamTiles[0]).toEqual({ x: 5, z: 5 });
            expect(visionSystem._bresenhamTiles[5]).toEqual({ x: 0, z: 0 });
        });

        it('should respect max bresenham length', () => {
            // Very long line
            const count = visionSystem.bresenhamLine(0, 0, 200, 0);
            expect(count).toBeLessThanOrEqual(visionSystem._maxBresenhamLength);
        });
    });

    describe('onSceneUnload', () => {
        it('should clear cached values', () => {
            // First cache the values
            visionSystem._getGridSize();
            visionSystem._getTerrainSize();

            expect(visionSystem._gridSize).toBe(32);
            expect(visionSystem._terrainSize).toBe(1024);

            // Unload scene
            visionSystem.onSceneUnload();

            expect(visionSystem._gridSize).toBeNull();
            expect(visionSystem._terrainSize).toBeNull();
        });
    });

    describe('static services', () => {
        it('should register hasLineOfSight service', () => {
            expect(GUTS.VisionSystem.services).toContain('hasLineOfSight');
        });

        it('should register canSeePosition service', () => {
            expect(GUTS.VisionSystem.services).toContain('canSeePosition');
        });

        it('should register getVisibleEnemiesInRange service', () => {
            expect(GUTS.VisionSystem.services).toContain('getVisibleEnemiesInRange');
        });

        it('should register findNearestVisibleEnemy service', () => {
            expect(GUTS.VisionSystem.services).toContain('findNearestVisibleEnemy');
        });

        it('should register findWeakestVisibleEnemy service', () => {
            expect(GUTS.VisionSystem.services).toContain('findWeakestVisibleEnemy');
        });
    });

    describe('_calculateTargetStealth', () => {
        beforeEach(() => {
            game.register('getTerrainTypeAtPosition', () => null);
            game.register('getTileMapTerrainType', () => null);
        });

        it('should return base stealth from combat component', () => {
            const entityId = game.createEntityWith({
                transform: { position: { x: 0, y: 0, z: 0 } },
                combat: { stealth: 40 }
            });

            expect(visionSystem._calculateTargetStealth(entityId)).toBe(40);
        });

        it('should return 0 when no combat component', () => {
            const entityId = game.createEntityWith({
                transform: { position: { x: 0, y: 0, z: 0 } }
            });

            expect(visionSystem._calculateTargetStealth(entityId)).toBe(0);
        });

        it('should add terrain stealth bonus', () => {
            game.register('getTerrainTypeAtPosition', () => 5);
            game.register('getTileMapTerrainType', () => ({ stealthBonus: 25 }));

            const entityId = game.createEntityWith({
                transform: { position: { x: 0, y: 0, z: 0 } },
                combat: { stealth: 30 }
            });

            expect(visionSystem._calculateTargetStealth(entityId)).toBe(55);
        });

        it('should add hiding bonus when isHiding is true', () => {
            const entityId = game.createEntityWith({
                transform: { position: { x: 0, y: 0, z: 0 } },
                combat: { stealth: 30 },
                playerOrder: { isHiding: true }
            });

            // 30 base + 30 hiding = 60
            expect(visionSystem._calculateTargetStealth(entityId)).toBe(60);
        });

        it('should stack terrain and hiding bonuses', () => {
            game.register('getTerrainTypeAtPosition', () => 5);
            game.register('getTileMapTerrainType', () => ({ stealthBonus: 25 }));

            const entityId = game.createEntityWith({
                transform: { position: { x: 0, y: 0, z: 0 } },
                combat: { stealth: 30 },
                playerOrder: { isHiding: true }
            });

            // 30 base + 25 terrain + 30 hiding = 85
            expect(visionSystem._calculateTargetStealth(entityId)).toBe(85);
        });
    });

    describe('getVisibleEnemiesInRange', () => {
        beforeEach(() => {
            game.register('getTerrainTypeAtPosition', () => null);
            game.register('getTileMapTerrainType', () => null);

            // Mock GameUtils
            if (!globalThis.GUTS.GameUtils) {
                globalThis.GUTS.GameUtils = {};
            }
            globalThis.GUTS.GameUtils.isInRange = () => true;
            globalThis.GUTS.GameUtils.getCollisionRadius = () => 0;
        });

        it('should return empty array when no position', () => {
            const entityId = game.createEntityWith({
                team: { team: enums.team.left }
            });

            expect(visionSystem.getVisibleEnemiesInRange(entityId, 300)).toEqual([]);
        });

        it('should return empty array when no team', () => {
            const entityId = game.createEntityWith({
                transform: { position: { x: 0, y: 0, z: 0 } }
            });

            expect(visionSystem.getVisibleEnemiesInRange(entityId, 300)).toEqual([]);
        });

        it('should filter out same team units', () => {
            const searcherId = game.createEntityWith({
                transform: { position: { x: 0, y: 0, z: 0 } },
                team: { team: enums.team.left },
                combat: { awareness: 50 }
            });

            const allyId = game.createEntityWith({
                transform: { position: { x: 50, y: 0, z: 0 } },
                team: { team: enums.team.left },
                health: { current: 100, max: 100 }
            });

            game.register('getNearbyUnits', () => [allyId]);

            expect(visionSystem.getVisibleEnemiesInRange(searcherId, 300)).toEqual([]);
        });

        it('should filter out dead units', () => {
            const searcherId = game.createEntityWith({
                transform: { position: { x: 0, y: 0, z: 0 } },
                team: { team: enums.team.left },
                combat: { awareness: 50 }
            });

            const deadEnemyId = game.createEntityWith({
                transform: { position: { x: 50, y: 0, z: 0 } },
                team: { team: enums.team.right },
                health: { current: 0, max: 100 }
            });

            game.register('getNearbyUnits', () => [deadEnemyId]);

            expect(visionSystem.getVisibleEnemiesInRange(searcherId, 300)).toEqual([]);
        });

        it('should filter out stealthed units', () => {
            const searcherId = game.createEntityWith({
                transform: { position: { x: 0, y: 0, z: 0 } },
                team: { team: enums.team.left },
                combat: { awareness: 50 }
            });

            const stealthedEnemyId = game.createEntityWith({
                transform: { position: { x: 50, y: 0, z: 0 } },
                team: { team: enums.team.right },
                health: { current: 100, max: 100 },
                combat: { stealth: 60 }
            });

            game.register('getNearbyUnits', () => [stealthedEnemyId]);

            expect(visionSystem.getVisibleEnemiesInRange(searcherId, 300)).toEqual([]);
        });

        it('should return visible enemies', () => {
            const searcherId = game.createEntityWith({
                transform: { position: { x: 0, y: 0, z: 0 } },
                team: { team: enums.team.left },
                combat: { awareness: 50 }
            });

            const visibleEnemyId = game.createEntityWith({
                transform: { position: { x: 50, y: 0, z: 0 } },
                team: { team: enums.team.right },
                health: { current: 100, max: 100 },
                combat: { stealth: 30 }
            });

            game.register('getNearbyUnits', () => [visibleEnemyId]);

            expect(visionSystem.getVisibleEnemiesInRange(searcherId, 300)).toEqual([visibleEnemyId]);
        });
    });

    describe('findNearestVisibleEnemy', () => {
        beforeEach(() => {
            game.register('getTerrainTypeAtPosition', () => null);
            game.register('getTileMapTerrainType', () => null);

            if (!globalThis.GUTS.GameUtils) {
                globalThis.GUTS.GameUtils = {};
            }
            globalThis.GUTS.GameUtils.isInRange = () => true;
            globalThis.GUTS.GameUtils.getCollisionRadius = () => 0;
        });

        it('should return null when no visible enemies', () => {
            const searcherId = game.createEntityWith({
                transform: { position: { x: 0, y: 0, z: 0 } },
                team: { team: enums.team.left },
                combat: { awareness: 50 }
            });

            game.register('getNearbyUnits', () => []);

            expect(visionSystem.findNearestVisibleEnemy(searcherId, 300)).toBeNull();
        });

        it('should return nearest enemy with distance', () => {
            const searcherId = game.createEntityWith({
                transform: { position: { x: 0, y: 0, z: 0 } },
                team: { team: enums.team.left },
                combat: { awareness: 50 }
            });

            const nearEnemyId = game.createEntityWith({
                transform: { position: { x: 50, y: 0, z: 0 } },
                team: { team: enums.team.right },
                health: { current: 100, max: 100 },
                combat: { stealth: 0 }
            });

            const farEnemyId = game.createEntityWith({
                transform: { position: { x: 100, y: 0, z: 0 } },
                team: { team: enums.team.right },
                health: { current: 100, max: 100 },
                combat: { stealth: 0 }
            });

            game.register('getNearbyUnits', () => [farEnemyId, nearEnemyId]);

            const result = visionSystem.findNearestVisibleEnemy(searcherId, 300);
            expect(result).not.toBeNull();
            expect(result.id).toBe(nearEnemyId);
            expect(result.distance).toBe(50);
        });
    });

    describe('findWeakestVisibleEnemy', () => {
        beforeEach(() => {
            game.register('getTerrainTypeAtPosition', () => null);
            game.register('getTileMapTerrainType', () => null);

            if (!globalThis.GUTS.GameUtils) {
                globalThis.GUTS.GameUtils = {};
            }
            globalThis.GUTS.GameUtils.isInRange = () => true;
            globalThis.GUTS.GameUtils.getCollisionRadius = () => 0;
        });

        it('should return null when no visible enemies', () => {
            const searcherId = game.createEntityWith({
                transform: { position: { x: 0, y: 0, z: 0 } },
                team: { team: enums.team.left },
                combat: { awareness: 50 }
            });

            game.register('getNearbyUnits', () => []);

            expect(visionSystem.findWeakestVisibleEnemy(searcherId, 300)).toBeNull();
        });

        it('should return weakest enemy by health percentage', () => {
            const searcherId = game.createEntityWith({
                transform: { position: { x: 0, y: 0, z: 0 } },
                team: { team: enums.team.left },
                combat: { awareness: 50 }
            });

            const healthyEnemyId = game.createEntityWith({
                transform: { position: { x: 50, y: 0, z: 0 } },
                team: { team: enums.team.right },
                health: { current: 100, max: 100 },
                combat: { stealth: 0 }
            });

            const woundedEnemyId = game.createEntityWith({
                transform: { position: { x: 100, y: 0, z: 0 } },
                team: { team: enums.team.right },
                health: { current: 30, max: 100 },
                combat: { stealth: 0 }
            });

            game.register('getNearbyUnits', () => [healthyEnemyId, woundedEnemyId]);

            const result = visionSystem.findWeakestVisibleEnemy(searcherId, 300);
            expect(result).not.toBeNull();
            expect(result.id).toBe(woundedEnemyId);
            expect(result.healthPercent).toBe(0.3);
        });

        it('should respect maxHealthPercent option', () => {
            const searcherId = game.createEntityWith({
                transform: { position: { x: 0, y: 0, z: 0 } },
                team: { team: enums.team.left },
                combat: { awareness: 50 }
            });

            const healthyEnemyId = game.createEntityWith({
                transform: { position: { x: 50, y: 0, z: 0 } },
                team: { team: enums.team.right },
                health: { current: 100, max: 100 },
                combat: { stealth: 0 }
            });

            game.register('getNearbyUnits', () => [healthyEnemyId]);

            // Only target enemies below 50% health
            const result = visionSystem.findWeakestVisibleEnemy(searcherId, 300, { maxHealthPercent: 0.5 });
            expect(result).toBeNull();
        });
    });
});
