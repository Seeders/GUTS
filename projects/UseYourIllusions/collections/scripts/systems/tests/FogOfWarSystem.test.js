import { describe, it, expect, beforeEach } from 'vitest';
import { TestGameContext } from '../../../../../../tests/TestGameContext.js';

describe('FogOfWarSystem', () => {
    let game;
    let fogOfWarSystem;
    let enums;

    beforeEach(() => {
        game = new TestGameContext();

        // Register mock services needed by FogOfWarSystem
        game.register('getWorldExtendedSize', () => 2000);
        game.register('getGridSize', () => 50);
        game.register('getTerrainSize', () => 2000);
        game.register('hasLineOfSight', () => true);
        game.register('registerPostProcessingPass', () => {});
        game.register('removePostProcessingPass', () => {});
        game.register('getUnitTypeDef', () => ({ visionRange: 500 }));

        fogOfWarSystem = game.createSystem(GUTS.FogOfWarSystem);
        enums = game.getEnums();
    });

    describe('initialization', () => {
        it('should set default vision radius', () => {
            expect(fogOfWarSystem.VISION_RADIUS).toBe(500);
        });

        it('should set default fog texture size', () => {
            expect(fogOfWarSystem.FOG_TEXTURE_SIZE).toBe(64);
        });

        it('should enable line of sight by default', () => {
            expect(fogOfWarSystem.LOS_ENABLED).toBe(true);
        });

        it('should set LOS rays per unit', () => {
            expect(fogOfWarSystem.LOS_RAYS_PER_UNIT).toBe(16);
        });

        it('should start with dirty FOW flag', () => {
            expect(fogOfWarSystem._fowDirty).toBe(true);
        });

        it('should initialize empty unit positions map', () => {
            expect(fogOfWarSystem._unitPositions.size).toBe(0);
        });

        it('should initialize empty LOS cache', () => {
            expect(fogOfWarSystem._losCache.size).toBe(0);
        });

        it('should have LOS cache max size limit', () => {
            expect(fogOfWarSystem._losCacheMaxSize).toBe(500);
        });

        it('should initialize position threshold', () => {
            expect(fogOfWarSystem._positionThreshold).toBe(2);
        });
    });

    describe('static services', () => {
        it('should register getExplorationTexture service', () => {
            expect(GUTS.FogOfWarSystem.services).toContain('getExplorationTexture');
        });

        it('should register getFogTexture service', () => {
            expect(GUTS.FogOfWarSystem.services).toContain('getFogTexture');
        });

        it('should register invalidateLOSCache service', () => {
            expect(GUTS.FogOfWarSystem.services).toContain('invalidateLOSCache');
        });

        it('should register isVisibleAt service', () => {
            expect(GUTS.FogOfWarSystem.services).toContain('isVisibleAt');
        });
    });

    describe('getExplorationTexture', () => {
        it('should return null before rendering is initialized', () => {
            expect(fogOfWarSystem.getExplorationTexture()).toBeNull();
        });
    });

    describe('getFogTexture', () => {
        it('should return null before rendering is initialized', () => {
            expect(fogOfWarSystem.getFogTexture()).toBeNull();
        });
    });

    describe('_getGridSize', () => {
        it('should return and cache grid size', () => {
            const gridSize = fogOfWarSystem._getGridSize();
            expect(gridSize).toBe(50);
            expect(fogOfWarSystem._cachedGridSize).toBe(50);
        });

        it('should return cached value on subsequent calls', () => {
            fogOfWarSystem._cachedGridSize = 100;
            const gridSize = fogOfWarSystem._getGridSize();
            expect(gridSize).toBe(100);
        });
    });

    describe('_getTerrainSize', () => {
        it('should return and cache terrain size', () => {
            const terrainSize = fogOfWarSystem._getTerrainSize();
            expect(terrainSize).toBe(2000);
            expect(fogOfWarSystem._cachedTerrainSize).toBe(2000);
        });

        it('should return cached value on subsequent calls', () => {
            fogOfWarSystem._cachedTerrainSize = 3000;
            const terrainSize = fogOfWarSystem._getTerrainSize();
            expect(terrainSize).toBe(3000);
        });
    });

    describe('_worldToTile', () => {
        it('should convert world center to tile position', () => {
            const tile = fogOfWarSystem._worldToTile(0, 0);
            // With terrain size 2000 and grid size 50:
            // (0 + 1000) / 50 = 20
            expect(tile.tileX).toBe(20);
            expect(tile.tileZ).toBe(20);
        });

        it('should convert world corner to tile position', () => {
            const tile = fogOfWarSystem._worldToTile(-1000, -1000);
            // (-1000 + 1000) / 50 = 0
            expect(tile.tileX).toBe(0);
            expect(tile.tileZ).toBe(0);
        });

        it('should convert positive world position to tile', () => {
            const tile = fogOfWarSystem._worldToTile(500, 250);
            // (500 + 1000) / 50 = 30
            // (250 + 1000) / 50 = 25
            expect(tile.tileX).toBe(30);
            expect(tile.tileZ).toBe(25);
        });
    });

    describe('_tileToWorld', () => {
        it('should convert tile center to world position', () => {
            const world = fogOfWarSystem._tileToWorld(20, 20);
            // (20 + 0.5) * 50 - 1000 = 25
            expect(world.x).toBe(25);
            expect(world.z).toBe(25);
        });

        it('should convert tile 0,0 to world corner', () => {
            const world = fogOfWarSystem._tileToWorld(0, 0);
            // (0 + 0.5) * 50 - 1000 = -975
            expect(world.x).toBe(-975);
            expect(world.z).toBe(-975);
        });
    });

    describe('invalidateFOW', () => {
        it('should set _fowDirty to true', () => {
            fogOfWarSystem._fowDirty = false;
            fogOfWarSystem.invalidateFOW();
            expect(fogOfWarSystem._fowDirty).toBe(true);
        });
    });

    describe('invalidateLOSCache', () => {
        beforeEach(() => {
            // Pre-populate cache
            fogOfWarSystem._losCache.set('10_10_500', new Float32Array(16));
            fogOfWarSystem._losCache.set('20_20_500', new Float32Array(16));
            fogOfWarSystem._losCache.set('30_30_500', new Float32Array(16));
            fogOfWarSystem._fowDirty = false;
        });

        it('should clear entire cache when called with no arguments', () => {
            fogOfWarSystem.invalidateLOSCache();
            expect(fogOfWarSystem._losCache.size).toBe(0);
        });

        it('should set _fowDirty to true', () => {
            fogOfWarSystem.invalidateLOSCache();
            expect(fogOfWarSystem._fowDirty).toBe(true);
        });

        it('should clear only tiles within radius when position provided', () => {
            // Tile at world position (0, 0) is tile (20, 20)
            // Clear with radius 100 (2 tiles)
            fogOfWarSystem.invalidateLOSCache(0, 0, 100);

            // Tile 20_20 should be cleared
            expect(fogOfWarSystem._losCache.has('20_20_500')).toBe(false);
            // Tile 10_10 and 30_30 are far away, should remain
            expect(fogOfWarSystem._losCache.has('10_10_500')).toBe(true);
            expect(fogOfWarSystem._losCache.has('30_30_500')).toBe(true);
        });
    });

    describe('_checkUnitMovement', () => {
        it('should return true for new units', () => {
            const entityId = game.createEntityWith({
                transform: { position: { x: 100, y: 0, z: 100 } }
            });

            const hasMoved = fogOfWarSystem._checkUnitMovement([entityId]);

            expect(hasMoved).toBe(true);
        });

        it('should return false when units have not moved', () => {
            const entityId = game.createEntityWith({
                transform: { position: { x: 100, y: 0, z: 100 } }
            });

            // First call registers positions
            fogOfWarSystem._checkUnitMovement([entityId]);

            // Second call should return false (no movement)
            const hasMoved = fogOfWarSystem._checkUnitMovement([entityId]);

            expect(hasMoved).toBe(false);
        });

        it('should return true when unit has moved beyond threshold', () => {
            const entityId = game.createEntityWith({
                transform: { position: { x: 100, y: 0, z: 100 } }
            });

            // Register initial position
            fogOfWarSystem._checkUnitMovement([entityId]);

            // Move unit beyond threshold
            const transform = game.getComponent(entityId, 'transform');
            transform.position.x = 110;  // Moved 10 units

            const hasMoved = fogOfWarSystem._checkUnitMovement([entityId]);

            expect(hasMoved).toBe(true);
        });

        it('should return false when unit has moved within threshold', () => {
            const entityId = game.createEntityWith({
                transform: { position: { x: 100, y: 0, z: 100 } }
            });

            // Register initial position
            fogOfWarSystem._checkUnitMovement([entityId]);

            // Move unit within threshold
            const transform = game.getComponent(entityId, 'transform');
            transform.position.x = 101;  // Moved 1 unit (threshold is 2)

            const hasMoved = fogOfWarSystem._checkUnitMovement([entityId]);

            expect(hasMoved).toBe(false);
        });

        it('should return true when unit count changes', () => {
            const entityId1 = game.createEntityWith({
                transform: { position: { x: 100, y: 0, z: 100 } }
            });
            const entityId2 = game.createEntityWith({
                transform: { position: { x: 200, y: 0, z: 200 } }
            });

            // Register initial positions with 2 units
            fogOfWarSystem._checkUnitMovement([entityId1, entityId2]);

            // Call with only 1 unit (removed unit)
            const hasMoved = fogOfWarSystem._checkUnitMovement([entityId1]);

            expect(hasMoved).toBe(true);
        });

        it('should update stored positions', () => {
            const entityId = game.createEntityWith({
                transform: { position: { x: 100, y: 0, z: 100 } }
            });

            fogOfWarSystem._checkUnitMovement([entityId]);

            expect(fogOfWarSystem._unitPositions.has(entityId)).toBe(true);
            const storedPos = fogOfWarSystem._unitPositions.get(entityId);
            expect(storedPos.x).toBe(100);
            expect(storedPos.z).toBe(100);
        });
    });

    describe('worldToUV', () => {
        beforeEach(() => {
            fogOfWarSystem.WORLD_SIZE = 2000;
        });

        it('should convert world center to UV center', () => {
            const uv = fogOfWarSystem.worldToUV(0, 0);
            expect(uv.x).toBe(0.5);
            expect(uv.y).toBe(0.5);
        });

        it('should convert world corner to UV corner', () => {
            const uv = fogOfWarSystem.worldToUV(-1000, 1000);
            expect(uv.x).toBe(0);
            expect(uv.y).toBe(0);
        });

        it('should convert opposite world corner to opposite UV corner', () => {
            const uv = fogOfWarSystem.worldToUV(1000, -1000);
            expect(uv.x).toBe(1);
            expect(uv.y).toBe(1);
        });

        it('should return null for positions outside world bounds', () => {
            const uv = fogOfWarSystem.worldToUV(1500, 0);
            expect(uv).toBeNull();
        });

        it('should return null for negative out-of-bounds positions', () => {
            const uv = fogOfWarSystem.worldToUV(-1500, 0);
            expect(uv).toBeNull();
        });
    });

    describe('generateLOSVisibilityShape', () => {
        it('should return visibility points array', () => {
            const points = fogOfWarSystem.generateLOSVisibilityShape(
                { x: 0, z: 0 },
                500,
                { visionRange: 500 },
                1
            );

            expect(points).toHaveLength(fogOfWarSystem.LOS_RAYS_PER_UNIT);
        });

        it('should cache LOS results by tile position', () => {
            fogOfWarSystem.generateLOSVisibilityShape(
                { x: 0, z: 0 },
                500,
                { visionRange: 500 },
                1
            );

            // Check cache has entry
            expect(fogOfWarSystem._losCache.size).toBe(1);
        });

        it('should return cached results on subsequent calls', () => {
            const points1 = fogOfWarSystem.generateLOSVisibilityShape(
                { x: 0, z: 0 },
                500,
                { visionRange: 500 },
                1
            );

            const cacheSize = fogOfWarSystem._losCache.size;

            const points2 = fogOfWarSystem.generateLOSVisibilityShape(
                { x: 1, z: 1 },  // Same tile, slightly different position
                500,
                { visionRange: 500 },
                2
            );

            // Cache size should not increase (same tile)
            expect(fogOfWarSystem._losCache.size).toBe(cacheSize);
        });

        it('should create new cache entries for different tiles', () => {
            fogOfWarSystem.generateLOSVisibilityShape(
                { x: 0, z: 0 },
                500,
                { visionRange: 500 },
                1
            );

            fogOfWarSystem.generateLOSVisibilityShape(
                { x: 500, z: 500 },  // Different tile
                500,
                { visionRange: 500 },
                2
            );

            expect(fogOfWarSystem._losCache.size).toBe(2);
        });

        it('should evict old cache entries when max size reached', () => {
            // Fill cache to max
            for (let i = 0; i < fogOfWarSystem._losCacheMaxSize + 10; i++) {
                fogOfWarSystem.generateLOSVisibilityShape(
                    { x: i * 100, z: i * 100 },
                    500,
                    { visionRange: 500 },
                    i
                );
            }

            // Cache should not exceed max size
            expect(fogOfWarSystem._losCache.size).toBeLessThanOrEqual(fogOfWarSystem._losCacheMaxSize);
        });
    });

    describe('init', () => {
        it('should store params', () => {
            const params = { testParam: 123 };
            fogOfWarSystem.init(params);
            expect(fogOfWarSystem.params).toBe(params);
        });
    });

    describe('dispose', () => {
        it('should clear mesh pools', () => {
            // Add some meshes to pools
            fogOfWarSystem.losMeshPool.push({});
            fogOfWarSystem.losGeometryPool.push({ dispose: () => {} });

            fogOfWarSystem.dispose();

            expect(fogOfWarSystem.losMeshPool).toEqual([]);
            expect(fogOfWarSystem.losGeometryPool).toEqual([]);
        });
    });

    describe('LOS settings', () => {
        it('should have LOS sample distance', () => {
            expect(fogOfWarSystem.LOS_SAMPLE_DISTANCE).toBe(12);
        });

        it('should have LOS unit blocking enabled', () => {
            expect(fogOfWarSystem.LOS_UNIT_BLOCKING_ENABLED).toBe(true);
        });

        it('should have LOS unit height', () => {
            expect(fogOfWarSystem.LOS_UNIT_HEIGHT).toBe(25);
        });

        it('should have LOS unit block radius', () => {
            expect(fogOfWarSystem.LOS_UNIT_BLOCK_RADIUS).toBe(25);
        });
    });

    describe('frame counter', () => {
        it('should start at frame 0', () => {
            expect(fogOfWarSystem.currentFrame).toBe(0);
        });

        it('should track last visibility cache frame', () => {
            expect(fogOfWarSystem.lastVisibilityCacheFrame).toBe(-1);
        });

        it('should track last exploration cache frame', () => {
            expect(fogOfWarSystem.lastExplorationCacheFrame).toBe(-1);
        });
    });

    describe('visibility buffers', () => {
        it('should have pre-allocated visibility buffer', () => {
            const expectedSize = fogOfWarSystem.FOG_TEXTURE_SIZE * fogOfWarSystem.FOG_TEXTURE_SIZE;
            expect(fogOfWarSystem.cachedVisibilityBuffer.length).toBe(expectedSize);
        });

        it('should have pre-allocated exploration buffer', () => {
            const expectedSize = fogOfWarSystem.FOG_TEXTURE_SIZE * fogOfWarSystem.FOG_TEXTURE_SIZE;
            expect(fogOfWarSystem.cachedExplorationBuffer.length).toBe(expectedSize);
        });

        it('should start with visibility cache invalid', () => {
            expect(fogOfWarSystem.visibilityCacheValid).toBe(false);
        });

        it('should start with exploration cache invalid', () => {
            expect(fogOfWarSystem.explorationCacheValid).toBe(false);
        });
    });

    describe('tempVisiblePoints', () => {
        it('should have pre-allocated points array', () => {
            expect(fogOfWarSystem.tempVisiblePoints.length).toBe(fogOfWarSystem.LOS_RAYS_PER_UNIT);
        });

        it('should have point objects with x and z', () => {
            for (const point of fogOfWarSystem.tempVisiblePoints) {
                expect(point).toHaveProperty('x');
                expect(point).toHaveProperty('z');
            }
        });
    });
});
