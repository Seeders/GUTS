import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TestGameContext } from '../../../../../../tests/TestGameContext.js';

describe('FlowFieldSystem', () => {
    let game;
    let flowFieldSystem;
    let pathfindingSystem;

    beforeEach(() => {
        game = new TestGameContext();

        // Register mock services needed by PathfindingSystem
        game.register('getGridSize', () => 64);
        game.register('getTerrainSize', () => 512);
        game.register('getPlacementGridSize', () => 32);
        game.register('getLevel', () => 'testLevel');
        game.register('isTerrainInitialized', () => true);
        game.register('getTerrainTypeAtPosition', () => 0);
        game.register('getTerrainHeightAtPosition', () => 0);
        game.register('getTileMap', () => ({ heightMap: [] }));
        game.register('placementGridToWorld', (x, z) => ({ x: x * 32 - 256, z: z * 32 - 256 }));
        game.register('getHeightLevelAtGridPosition', () => 0);

        // Create pathfinding system first (FlowFieldSystem depends on it)
        pathfindingSystem = game.createSystem(GUTS.PathfindingSystem);

        // Manually initialize pathfinding system with a test navmesh
        pathfindingSystem.navGridSize = 32;
        pathfindingSystem.navGridWidth = 16;
        pathfindingSystem.navGridHeight = 16;
        pathfindingSystem.navMesh = new Uint8Array(16 * 16);
        pathfindingSystem.navMesh.fill(0); // All walkable
        pathfindingSystem.terrainTypeIds = ['grass'];
        pathfindingSystem.terrainTypesCollection = { grass: { walkable: true } };
        pathfindingSystem.initialized = true;

        // Create flow field system
        flowFieldSystem = game.createSystem(GUTS.FlowFieldSystem);
        flowFieldSystem.pathfindingSystem = pathfindingSystem;
        flowFieldSystem.initialized = true;
    });

    describe('initialization', () => {
        it('should start with empty flow fields', () => {
            expect(flowFieldSystem.flowFields.size).toBe(0);
        });

        it('should have default configuration values', () => {
            expect(flowFieldSystem.MAX_FLOW_FIELDS).toBe(50);
            expect(flowFieldSystem.FLOW_FIELD_EXPIRY).toBe(10000);
            expect(flowFieldSystem.DESTINATION_QUANTIZATION).toBe(64);
            expect(flowFieldSystem.MIN_GROUP_SIZE).toBe(5);
        });

        it('should have empty entity flow fields map', () => {
            expect(flowFieldSystem.entityFlowFields.size).toBe(0);
        });
    });

    describe('getDestinationKey', () => {
        it('should quantize nearby destinations to same key', () => {
            const key1 = flowFieldSystem.getDestinationKey(100, 100);
            const key2 = flowFieldSystem.getDestinationKey(110, 110);
            expect(key1).toBe(key2);
        });

        it('should give different keys for distant destinations', () => {
            const key1 = flowFieldSystem.getDestinationKey(0, 0);
            const key2 = flowFieldSystem.getDestinationKey(200, 200);
            expect(key1).not.toBe(key2);
        });

        it('should handle negative coordinates', () => {
            // Negative coordinates should still work - they quantize to negative grid cells
            // -100 and -50 both quantize to same cell with 64-unit quantization
            const key1 = flowFieldSystem.getDestinationKey(-100, -100);
            const key2 = flowFieldSystem.getDestinationKey(-80, -80);
            // Both should be in the same quantized cell (-2, -2) -> same key
            expect(key1).toBe(key2);
        });
    });

    describe('hasFlowField', () => {
        it('should return false when no flow field exists', () => {
            expect(flowFieldSystem.hasFlowField(100, 100)).toBe(false);
        });

        it('should return true when flow field exists', () => {
            const field = flowFieldSystem.getOrCreateFlowField(0, 0);
            expect(flowFieldSystem.hasFlowField(0, 0)).toBe(true);
        });
    });

    describe('getOrCreateFlowField', () => {
        it('should create a new flow field for valid destination', () => {
            const field = flowFieldSystem.getOrCreateFlowField(0, 0);

            expect(field).not.toBeNull();
            expect(field.width).toBe(16);
            expect(field.height).toBe(16);
            expect(field.directions).toBeInstanceOf(Uint8Array);
            expect(field.costs).toBeInstanceOf(Uint16Array);
        });

        it('should cache flow fields', () => {
            const field1 = flowFieldSystem.getOrCreateFlowField(0, 0);
            const field2 = flowFieldSystem.getOrCreateFlowField(0, 0);

            expect(field1).toBe(field2);
            expect(flowFieldSystem.flowFields.size).toBe(1);
        });

        it('should return same flow field for quantized destinations', () => {
            const field1 = flowFieldSystem.getOrCreateFlowField(10, 10);
            const field2 = flowFieldSystem.getOrCreateFlowField(20, 20);

            expect(field1).toBe(field2);
        });

        it('should create different flow fields for distant destinations', () => {
            const field1 = flowFieldSystem.getOrCreateFlowField(0, 0);
            const field2 = flowFieldSystem.getOrCreateFlowField(200, 200);

            expect(field1).not.toBe(field2);
            expect(flowFieldSystem.flowFields.size).toBe(2);
        });

        it('should store goal position in flow field', () => {
            const field = flowFieldSystem.getOrCreateFlowField(100, 150);

            expect(field.goalX).toBe(100);
            expect(field.goalZ).toBe(150);
        });

        it('should return null when not initialized', () => {
            flowFieldSystem.initialized = false;
            const field = flowFieldSystem.getOrCreateFlowField(0, 0);
            expect(field).toBeNull();
        });

        it('should return null when navMesh not available', () => {
            pathfindingSystem.navMesh = null;
            const field = flowFieldSystem.getOrCreateFlowField(0, 0);
            expect(field).toBeNull();
        });
    });

    describe('generateFlowField', () => {
        it('should generate valid integration field (costs)', () => {
            const field = flowFieldSystem.getOrCreateFlowField(0, 0);

            // Goal should have cost 0
            const goalGrid = pathfindingSystem.worldToNavGrid(0, 0);
            const goalCost = field.costs[goalGrid.z * field.width + goalGrid.x];
            expect(goalCost).toBe(0);
        });

        it('should have increasing costs away from goal', () => {
            const field = flowFieldSystem.getOrCreateFlowField(0, 0);
            const goalGrid = pathfindingSystem.worldToNavGrid(0, 0);

            // Adjacent cells should have cost 10 (cardinal) or 14 (diagonal)
            const adjacentCost = field.costs[(goalGrid.z + 1) * field.width + goalGrid.x];
            expect(adjacentCost).toBe(10);
        });

        it('should mark impassable cells as unreachable', () => {
            // Mark center cells as impassable
            pathfindingSystem.navMesh[8 * 16 + 8] = 255;
            pathfindingSystem.navMesh[8 * 16 + 9] = 255;
            pathfindingSystem.navMesh[9 * 16 + 8] = 255;
            pathfindingSystem.navMesh[9 * 16 + 9] = 255;

            const field = flowFieldSystem.getOrCreateFlowField(0, 0);

            // Impassable cells should have max cost
            expect(field.costs[8 * 16 + 8]).toBe(65535);
            expect(field.directions[8 * 16 + 8]).toBe(255);
        });

        it('should handle unwalkable terrain types', () => {
            pathfindingSystem.terrainTypeIds = ['grass', 'water'];
            pathfindingSystem.terrainTypesCollection = {
                grass: { walkable: true },
                water: { walkable: false }
            };
            pathfindingSystem.navMesh[8 * 16 + 8] = 1; // Water

            const field = flowFieldSystem.getOrCreateFlowField(0, 0);

            expect(field.costs[8 * 16 + 8]).toBe(65535);
        });
    });

    describe('getFlowDirection', () => {
        it('should return direction toward goal', () => {
            const field = flowFieldSystem.getOrCreateFlowField(0, 0);

            // Get direction from a position to the right of goal
            const worldPos = pathfindingSystem.navGridToWorld(10, 8);
            const direction = flowFieldSystem.getFlowDirection(worldPos.x, worldPos.z, field);

            expect(direction).not.toBeNull();
            // Should point left (negative x) toward goal at center
            expect(direction.x).toBeLessThan(0);
        });

        it('should return null for impassable cells', () => {
            pathfindingSystem.navMesh[8 * 16 + 8] = 255;
            const field = flowFieldSystem.getOrCreateFlowField(0, 0);

            const worldPos = pathfindingSystem.navGridToWorld(8, 8);
            const direction = flowFieldSystem.getFlowDirection(worldPos.x, worldPos.z, field);

            expect(direction).toBeNull();
        });

        it('should return zero direction at goal', () => {
            const field = flowFieldSystem.getOrCreateFlowField(0, 0);
            const direction = flowFieldSystem.getFlowDirection(0, 0, field);

            expect(direction.x).toBe(0);
            expect(direction.z).toBe(0);
        });

        it('should return null for out of bounds', () => {
            const field = flowFieldSystem.getOrCreateFlowField(0, 0);
            const direction = flowFieldSystem.getFlowDirection(-10000, -10000, field);

            expect(direction).toBeNull();
        });

        it('should normalize diagonal directions', () => {
            const field = flowFieldSystem.getOrCreateFlowField(0, 0);

            // Find a cell that should have diagonal movement
            const worldPos = pathfindingSystem.navGridToWorld(12, 12);
            const direction = flowFieldSystem.getFlowDirection(worldPos.x, worldPos.z, field);

            if (direction && direction.x !== 0 && direction.z !== 0) {
                // Diagonal should be normalized (magnitude ~= 1)
                const magnitude = Math.sqrt(direction.x * direction.x + direction.z * direction.z);
                expect(magnitude).toBeCloseTo(1, 5);
            }
        });

        it('should accept flow field key instead of object', () => {
            const field = flowFieldSystem.getOrCreateFlowField(0, 0);
            const key = field.key;

            const direction = flowFieldSystem.getFlowDirection(50, 50, key);
            expect(direction).not.toBeNull();
        });
    });

    describe('isAtGoal', () => {
        it('should return true at goal position', () => {
            const field = flowFieldSystem.getOrCreateFlowField(0, 0);
            expect(flowFieldSystem.isAtGoal(0, 0, field)).toBe(true);
        });

        it('should return true within one cell of goal', () => {
            const field = flowFieldSystem.getOrCreateFlowField(0, 0);
            expect(flowFieldSystem.isAtGoal(20, 20, field)).toBe(true);
        });

        it('should return false far from goal', () => {
            const field = flowFieldSystem.getOrCreateFlowField(0, 0);
            expect(flowFieldSystem.isAtGoal(200, 200, field)).toBe(false);
        });

        it('should return false for null flow field', () => {
            expect(flowFieldSystem.isAtGoal(0, 0, null)).toBe(false);
        });
    });

    describe('getCostToGoal', () => {
        it('should return 0 at goal', () => {
            const field = flowFieldSystem.getOrCreateFlowField(0, 0);
            const cost = flowFieldSystem.getCostToGoal(0, 0, field);
            expect(cost).toBe(0);
        });

        it('should return higher cost further from goal', () => {
            const field = flowFieldSystem.getOrCreateFlowField(0, 0);

            const nearCost = flowFieldSystem.getCostToGoal(32, 0, field);
            const farCost = flowFieldSystem.getCostToGoal(64, 0, field);

            expect(farCost).toBeGreaterThan(nearCost);
        });

        it('should return Infinity for unreachable cells', () => {
            // Create an isolated cell by surrounding it completely with impassable terrain
            // Center cell at (8,8) surrounded by walls
            for (let dz = -1; dz <= 1; dz++) {
                for (let dx = -1; dx <= 1; dx++) {
                    if (dx === 0 && dz === 0) continue; // Skip center
                    pathfindingSystem.navMesh[(8 + dz) * 16 + (8 + dx)] = 255;
                }
            }
            // Center is walkable but isolated
            pathfindingSystem.navMesh[8 * 16 + 8] = 0;

            // Create flow field with goal at corner (which is not isolated)
            const field = flowFieldSystem.getOrCreateFlowField(-200, -200);

            // Center should be unreachable from corner goal because it's surrounded
            const centerWorld = pathfindingSystem.navGridToWorld(8, 8);
            const cost = flowFieldSystem.getCostToGoal(centerWorld.x, centerWorld.z, field);
            expect(cost).toBe(Infinity);
        });
    });

    describe('entity flow field assignment', () => {
        it('should assign entity to flow field', () => {
            const field = flowFieldSystem.getOrCreateFlowField(0, 0);
            flowFieldSystem.assignEntityToFlowField(123, field.key);

            expect(flowFieldSystem.entityFlowFields.get(123)).toBe(field.key);
        });

        it('should get flow direction for assigned entity', () => {
            const field = flowFieldSystem.getOrCreateFlowField(0, 0);
            flowFieldSystem.assignEntityToFlowField(123, field.key);

            const direction = flowFieldSystem.getEntityFlowDirection(123, 50, 50);
            expect(direction).not.toBeNull();
        });

        it('should return null for unassigned entity', () => {
            const direction = flowFieldSystem.getEntityFlowDirection(999, 50, 50);
            expect(direction).toBeNull();
        });

        it('should clear entity assignment', () => {
            const field = flowFieldSystem.getOrCreateFlowField(0, 0);
            flowFieldSystem.assignEntityToFlowField(123, field.key);
            flowFieldSystem.clearEntityFlowField(123);

            expect(flowFieldSystem.entityFlowFields.has(123)).toBe(false);
        });
    });

    describe('cache management', () => {
        it('should evict oldest flow field when at capacity', () => {
            flowFieldSystem.MAX_FLOW_FIELDS = 3;
            // Use DESTINATION_QUANTIZATION * 2 spacing to ensure different keys
            const spacing = flowFieldSystem.DESTINATION_QUANTIZATION * 2;

            // Create 3 flow fields with distinct destinations
            const field1 = flowFieldSystem.getOrCreateFlowField(0, 0);
            const key1 = field1.key;
            game.state.now += 100;
            const field2 = flowFieldSystem.getOrCreateFlowField(spacing, 0);
            game.state.now += 100;
            const field3 = flowFieldSystem.getOrCreateFlowField(spacing * 2, 0);

            expect(flowFieldSystem.flowFields.size).toBe(3);

            // Create 4th - should evict field1 (oldest)
            game.state.now += 100;
            const field4 = flowFieldSystem.getOrCreateFlowField(spacing * 3, 0);

            expect(flowFieldSystem.flowFields.size).toBe(3);
            expect(flowFieldSystem.flowFields.has(key1)).toBe(false);
        });

        it('should update lastAccessed on cache hit', () => {
            const field = flowFieldSystem.getOrCreateFlowField(0, 0);
            const initialAccess = field.lastAccessed;

            game.state.now += 1000;
            flowFieldSystem.getOrCreateFlowField(0, 0);

            expect(field.lastAccessed).toBe(game.state.now);
            expect(field.lastAccessed).toBeGreaterThan(initialAccess);
        });

        it('should expire old flow fields in update', () => {
            const field = flowFieldSystem.getOrCreateFlowField(0, 0);

            // Advance time past expiry
            game.state.now += flowFieldSystem.FLOW_FIELD_EXPIRY + 1000;
            game.state.frameCount = 60; // Trigger cleanup

            flowFieldSystem.update();

            expect(flowFieldSystem.flowFields.has(field.key)).toBe(false);
        });

        it('should clean up entity assignments when flow field expires', () => {
            const field = flowFieldSystem.getOrCreateFlowField(0, 0);
            flowFieldSystem.assignEntityToFlowField(123, field.key);

            game.state.now += flowFieldSystem.FLOW_FIELD_EXPIRY + 1000;
            game.state.frameCount = 60;
            flowFieldSystem.update();

            expect(flowFieldSystem.entityFlowFields.has(123)).toBe(false);
        });
    });

    describe('clearFlowFields', () => {
        it('should clear all flow fields', () => {
            flowFieldSystem.getOrCreateFlowField(0, 0);
            flowFieldSystem.getOrCreateFlowField(200, 200);

            flowFieldSystem.clearFlowFields();

            expect(flowFieldSystem.flowFields.size).toBe(0);
        });

        it('should clear all entity assignments', () => {
            const field = flowFieldSystem.getOrCreateFlowField(0, 0);
            flowFieldSystem.assignEntityToFlowField(123, field.key);
            flowFieldSystem.assignEntityToFlowField(456, field.key);

            flowFieldSystem.clearFlowFields();

            expect(flowFieldSystem.entityFlowFields.size).toBe(0);
        });
    });

    describe('removeFlowField', () => {
        it('should remove specific flow field', () => {
            const field1 = flowFieldSystem.getOrCreateFlowField(0, 0);
            const field2 = flowFieldSystem.getOrCreateFlowField(200, 200);

            flowFieldSystem.removeFlowField(field1.key);

            expect(flowFieldSystem.flowFields.has(field1.key)).toBe(false);
            expect(flowFieldSystem.flowFields.has(field2.key)).toBe(true);
        });
    });

    describe('entityDestroyed', () => {
        it('should clean up entity flow field assignment', () => {
            const field = flowFieldSystem.getOrCreateFlowField(0, 0);
            flowFieldSystem.assignEntityToFlowField(123, field.key);

            flowFieldSystem.entityDestroyed(123);

            expect(flowFieldSystem.entityFlowFields.has(123)).toBe(false);
        });
    });

    describe('onSceneUnload', () => {
        it('should clear all state', () => {
            flowFieldSystem.getOrCreateFlowField(0, 0);
            flowFieldSystem.assignEntityToFlowField(123, 1);

            flowFieldSystem.onSceneUnload();

            expect(flowFieldSystem.flowFields.size).toBe(0);
            expect(flowFieldSystem.entityFlowFields.size).toBe(0);
            expect(flowFieldSystem.initialized).toBe(false);
            expect(flowFieldSystem.pathfindingSystem).toBeNull();
        });
    });

    describe('findNearestWalkableCell', () => {
        it('should find walkable cell near unwalkable position', () => {
            // Mark center as unwalkable
            pathfindingSystem.navMesh[8 * 16 + 8] = 255;

            const nearest = flowFieldSystem.findNearestWalkableCell(8, 8);

            expect(nearest).not.toBeNull();
            expect(nearest.x).not.toBe(8);
            // Should be adjacent to center
            expect(Math.abs(nearest.x - 8) + Math.abs(nearest.z - 8)).toBeLessThanOrEqual(2);
        });

        it('should return null if no walkable cell in range', () => {
            // Mark all cells as unwalkable
            pathfindingSystem.navMesh.fill(255);

            const nearest = flowFieldSystem.findNearestWalkableCell(8, 8);

            expect(nearest).toBeNull();
        });
    });

    describe('static services', () => {
        it('should register all expected services', () => {
            const services = GUTS.FlowFieldSystem.services;
            expect(services).toContain('getFlowDirection');
            expect(services).toContain('getOrCreateFlowField');
            expect(services).toContain('hasFlowField');
            expect(services).toContain('clearFlowFields');
            expect(services).toContain('getFlowFieldForDestination');
            expect(services).toContain('removeFlowField');
        });
    });

    describe('obstacle avoidance', () => {
        it('should route around obstacles', () => {
            // Create a wall blocking direct path
            for (let z = 4; z < 12; z++) {
                pathfindingSystem.navMesh[z * 16 + 8] = 255;
            }

            const field = flowFieldSystem.getOrCreateFlowField(-200, 0); // Goal on left side

            // Get direction from right side of wall
            const rightOfWall = pathfindingSystem.navGridToWorld(10, 8);
            const direction = flowFieldSystem.getFlowDirection(rightOfWall.x, rightOfWall.z, field);

            // Should not point directly left (would hit wall)
            // Should have some z component to go around
            expect(direction).not.toBeNull();
            // The unit should go up or down to get around the wall
            expect(Math.abs(direction.z)).toBeGreaterThan(0);
        });
    });
});
