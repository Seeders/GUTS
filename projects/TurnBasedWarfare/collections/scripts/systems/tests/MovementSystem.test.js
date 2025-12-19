import { describe, it, expect, beforeEach } from 'vitest';
import { TestGameContext } from '../../../../../../tests/TestGameContext.js';

describe('MovementSystem', () => {
    let game;
    let movementSystem;
    let enums;

    beforeEach(() => {
        game = new TestGameContext();

        // Register mock services needed by MovementSystem
        game.register('getNearbyUnits', () => []);
        game.register('getBehaviorMeta', () => null);
        game.register('getBehaviorShared', () => null);
        game.register('getBehaviorNodeId', () => null);
        game.register('getTerrainHeightAtPosition', () => 0);
        game.register('getEntityPath', () => null);
        game.register('setEntityPath', () => {});
        game.register('clearEntityPath', () => {});
        game.register('requestPath', () => null);
        game.register('getGridSize', () => 64);

        movementSystem = game.createSystem(GUTS.MovementSystem);
        enums = game.getEnums();
    });

    describe('getUnitRadius', () => {
        it('should return collision radius if defined', () => {
            const collision = { radius: 50 };
            const radius = movementSystem.getUnitRadius(collision);
            expect(radius).toBe(50);
        });

        it('should return default radius if collision radius is smaller', () => {
            const collision = { radius: 10 };
            const radius = movementSystem.getUnitRadius(collision);
            expect(radius).toBe(movementSystem.DEFAULT_UNIT_RADIUS);
        });

        it('should return default radius if collision is null', () => {
            const radius = movementSystem.getUnitRadius(null);
            expect(radius).toBe(movementSystem.DEFAULT_UNIT_RADIUS);
        });

        it('should return default radius if collision has no radius property', () => {
            const collision = {};
            const radius = movementSystem.getUnitRadius(collision);
            expect(radius).toBe(movementSystem.DEFAULT_UNIT_RADIUS);
        });
    });

    describe('lerp', () => {
        it('should interpolate between two values', () => {
            expect(movementSystem.lerp(0, 100, 0.5)).toBe(50);
            expect(movementSystem.lerp(0, 100, 0)).toBe(0);
            expect(movementSystem.lerp(0, 100, 1)).toBe(100);
            expect(movementSystem.lerp(10, 20, 0.3)).toBeCloseTo(13);
        });
    });

    describe('handleGroundInteraction', () => {
        it('should clamp position to ground level when below', () => {
            const pos = { x: 0, y: -10, z: 0 };
            const vel = { vx: 0, vy: -5, vz: 0 };

            // Mock terrain height to return null (no terrain)
            game.register('getTerrainHeightAtPosition', () => null);

            movementSystem.handleGroundInteraction(pos, vel);

            expect(pos.y).toBe(movementSystem.GROUND_LEVEL);
            expect(vel.vy).toBeGreaterThanOrEqual(0);
        });

        it('should snap to terrain height when terrain exists', () => {
            const pos = { x: 0, y: 0, z: 0 };
            const vel = { vx: 0, vy: -5, vz: 0 };

            game.register('getTerrainHeightAtPosition', () => 10);

            movementSystem.handleGroundInteraction(pos, vel);

            expect(pos.y).toBe(10);
        });

        it('should stop downward velocity when on terrain', () => {
            const pos = { x: 0, y: 10, z: 0 };
            const vel = { vx: 0, vy: -50, vz: 0 };

            game.register('getTerrainHeightAtPosition', () => 10);

            movementSystem.handleGroundInteraction(pos, vel);

            expect(vel.vy).toBeGreaterThanOrEqual(0);
        });
    });

    describe('isInAttackRange', () => {
        it('should return false for invalid target', () => {
            const attacker = game.createEntityWith({
                combat: { range: 100 }
            });

            expect(movementSystem.isInAttackRange(null, attacker)).toBe(false);
            expect(movementSystem.isInAttackRange(undefined, attacker)).toBe(false);
            expect(movementSystem.isInAttackRange(-1, attacker)).toBe(false);
        });

        it('should return false if entity has no combat component', () => {
            const attacker = game.createEntity();
            const target = game.createEntityWith({
                transform: { position: { x: 0, y: 0, z: 0 } }
            });

            expect(movementSystem.isInAttackRange(target, attacker)).toBe(false);
        });
    });

    describe('updateMovementHistory', () => {
        it('should create movementState component if not present', () => {
            const entity = game.createEntityWith({
                velocity: { vx: 10, vy: 0, vz: 5 }
            });

            const vel = game.getComponent(entity, 'velocity');
            movementSystem.updateMovementHistory(entity, vel);

            const movementState = game.getComponent(entity, 'movementState');
            expect(movementState).toBeDefined();
        });

        it('should track velocity history in ring buffer', () => {
            const entity = game.createEntityWith({
                velocity: { vx: 10, vy: 0, vz: 5 }
            });

            const vel = game.getComponent(entity, 'velocity');

            // First call creates the component
            movementSystem.updateMovementHistory(entity, vel);
            const movementState = game.getComponent(entity, 'movementState');

            // The velocityHistory should be updating
            expect(movementState.velocityHistoryCount).toBeGreaterThanOrEqual(0);
        });
    });

    describe('isUnitOscillating', () => {
        it('should return false when no movement state', () => {
            const entity = game.createEntity();
            expect(movementSystem.isUnitOscillating(entity)).toBe(false);
        });

        it('should return false when not enough history', () => {
            const entity = game.createEntityWith({
                velocity: { vx: 10, vy: 0, vz: 5 },
                movementState: {
                    velocityHistoryCount: 2
                }
            });

            expect(movementSystem.isUnitOscillating(entity)).toBe(false);
        });
    });

    describe('calculateSeparationForceOptimized', () => {
        it('should return zero force when entity is anchored', () => {
            const entity = game.createEntityWith({
                transform: { position: { x: 0, y: 0, z: 0 } },
                velocity: { vx: 0, vy: 0, vz: 0, anchored: true },
                collision: { radius: 30 }
            });

            const data = {
                pos: { x: 0, y: 0, z: 0 },
                unitRadius: 30,
                isAnchored: true,
                separationForce: { x: 0, y: 0, z: 0 }
            };

            movementSystem.calculateSeparationForceOptimized(entity, data);

            expect(data.separationForce.x).toBe(0);
            expect(data.separationForce.z).toBe(0);
        });

        it('should calculate separation force from nearby units', () => {
            const entity1 = game.createEntityWith({
                transform: { position: { x: 0, y: 0, z: 0 } },
                velocity: { vx: 0, vy: 0, vz: 0 },
                collision: { radius: 30 }
            });

            const entity2 = game.createEntityWith({
                transform: { position: { x: 20, y: 0, z: 0 } },
                velocity: { vx: 0, vy: 0, vz: 0 },
                collision: { radius: 30 }
            });

            // Mock getNearbyUnits to return entity2
            game.register('getNearbyUnits', () => [entity2]);

            const data = {
                pos: { x: 0, y: 0, z: 0 },
                unitRadius: 30,
                isAnchored: false,
                separationForce: { x: 0, y: 0, z: 0 }
            };

            movementSystem.calculateSeparationForceOptimized(entity1, data);

            // Separation force should push entity1 away from entity2 (negative x)
            expect(data.separationForce.x).toBeLessThan(0);
        });
    });

    describe('calculateAvoidanceVector', () => {
        it('should return zero when no obstacle', () => {
            const result = movementSystem.calculateAvoidanceVector(
                { x: 0, y: 0, z: 0 },
                { x: 1, z: 0 },
                { hasObstacle: false },
                null,
                30
            );

            expect(result.x).toBe(0);
            expect(result.z).toBe(0);
        });

        it('should return avoidance force when obstacle exists', () => {
            const obstacleInfo = {
                hasObstacle: true,
                obstacle: {
                    pos: { x: 50, y: 0, z: 0 },
                    radius: 30,
                    distance: 40
                }
            };

            const result = movementSystem.calculateAvoidanceVector(
                { x: 0, y: 0, z: 0 },
                { x: 1, z: 0 },
                obstacleInfo,
                null,
                30
            );

            // Should have some avoidance force
            expect(Math.abs(result.x) + Math.abs(result.z)).toBeGreaterThan(0);
        });
    });

    describe('constants', () => {
        it('should have reasonable default values', () => {
            expect(movementSystem.DEFAULT_UNIT_RADIUS).toBeGreaterThan(0);
            expect(movementSystem.GRAVITY).toBeGreaterThan(0);
            expect(movementSystem.SEPARATION_FORCE).toBeGreaterThan(0);
            expect(movementSystem.VELOCITY_SMOOTHING).toBeGreaterThan(0);
            expect(movementSystem.VELOCITY_SMOOTHING).toBeLessThanOrEqual(1);
        });
    });
});
