import { describe, it, expect, beforeEach } from 'vitest';
import { TestGameContext } from '../../../../../../tests/TestGameContext.js';

describe('ProjectileSystem', () => {
    let game;
    let projectileSystem;
    let enums;

    beforeEach(() => {
        game = new TestGameContext();

        // Register mock services needed by ProjectileSystem
        game.register('getComponents', () => ({}));
        game.register('createParticleEffect', () => {});
        game.register('getTerrainHeightAtPosition', () => 0);
        game.register('getNearbyUnits', () => []);
        game.register('applyDamage', () => ({ damage: 10, killed: false }));
        game.register('applySplashDamage', () => {});
        game.register('destroyEntityImmediately', () => {});
        game.register('getUnitTypeDef', () => null);
        game.register('addLifetime', () => {});

        projectileSystem = game.createSystem(GUTS.ProjectileSystem);
        enums = game.getEnums();
    });

    describe('roundForDeterminism', () => {
        it('should round to 6 decimal places by default', () => {
            expect(projectileSystem.roundForDeterminism(1.123456789)).toBe(1.123457);
            expect(projectileSystem.roundForDeterminism(0.0000001)).toBe(0);
            expect(projectileSystem.roundForDeterminism(123.456789012)).toBe(123.456789);
        });

        it('should round to custom precision', () => {
            expect(projectileSystem.roundForDeterminism(1.123456789, 2)).toBe(1.12);
            expect(projectileSystem.roundForDeterminism(1.999, 1)).toBe(2);
            expect(projectileSystem.roundForDeterminism(0.555, 2)).toBe(0.56);
        });

        it('should handle negative numbers', () => {
            expect(projectileSystem.roundForDeterminism(-1.123456789)).toBe(-1.123457);
            // Note: JavaScript returns -0 for very small negative numbers rounded to 0
            expect(projectileSystem.roundForDeterminism(-0.0000001)).toBeCloseTo(0);
        });

        it('should handle zero', () => {
            expect(projectileSystem.roundForDeterminism(0)).toBe(0);
        });
    });

    describe('getUnitRadius', () => {
        it('should return unit size if defined', () => {
            const unitType = { size: 50 };
            expect(projectileSystem.getUnitRadius(unitType)).toBe(50);
        });

        it('should return default radius if size is smaller', () => {
            const unitType = { size: 5 };
            // Default radius is 15
            expect(projectileSystem.getUnitRadius(unitType)).toBe(15);
        });

        it('should return default radius if unitType is null', () => {
            expect(projectileSystem.getUnitRadius(null)).toBe(15);
        });

        it('should return default radius if unitType has no size', () => {
            const unitType = { hp: 100 };
            expect(projectileSystem.getUnitRadius(unitType)).toBe(15);
        });
    });

    describe('determineProjectileElement', () => {
        it('should use projectile data element if provided', () => {
            const sourceId = game.createEntityWith({
                combat: { element: enums.element.fire }
            });

            const element = projectileSystem.determineProjectileElement(sourceId, {
                element: enums.element.cold
            });

            expect(element).toBe(enums.element.cold);
        });

        it('should fall back to combat element if no projectile element', () => {
            const sourceId = game.createEntityWith({
                combat: { element: enums.element.fire }
            });

            const element = projectileSystem.determineProjectileElement(sourceId, {});

            expect(element).toBe(enums.element.fire);
        });

        it('should default to physical if no element specified', () => {
            const sourceId = game.createEntityWith({
                combat: { damage: 10 }
            });

            const element = projectileSystem.determineProjectileElement(sourceId, {});

            expect(element).toBe(enums.element.physical);
        });
    });

    describe('calculateTrajectory', () => {
        it('should return zero velocity for same position', () => {
            const sourcePos = { x: 0, y: 0, z: 0 };
            const targetPos = { x: 0, y: 0, z: 0 };

            const result = projectileSystem.calculateTrajectory(sourcePos, targetPos, {
                speed: 200,
                ballistic: false
            });

            expect(result.vx).toBe(0);
            expect(result.vy).toBe(0);
            expect(result.vz).toBe(0);
            expect(result.timeToTarget).toBe(0);
        });

        it('should calculate direct trajectory for non-ballistic projectiles', () => {
            const sourcePos = { x: 0, y: 0, z: 0 };
            const targetPos = { x: 100, y: 0, z: 0 };

            const result = projectileSystem.calculateTrajectory(sourcePos, targetPos, {
                speed: 200,
                ballistic: false
            });

            // Should be moving in positive x direction
            expect(result.vx).toBeCloseTo(200, 1);
            expect(result.vy).toBeCloseTo(0, 1);
            expect(result.vz).toBeCloseTo(0, 1);
            expect(result.timeToTarget).toBeCloseTo(0.5, 1);
        });

        it('should handle height difference for non-ballistic projectiles', () => {
            const sourcePos = { x: 0, y: 0, z: 0 };
            const targetPos = { x: 100, y: 100, z: 0 };

            const result = projectileSystem.calculateTrajectory(sourcePos, targetPos, {
                speed: 200,
                ballistic: false
            });

            // Should have positive velocity in both x and y
            expect(result.vx).toBeGreaterThan(0);
            expect(result.vy).toBeGreaterThan(0);
        });

        it('should calculate ballistic trajectory', () => {
            // Set GRAVITY if not set (needed for ballistic calculations)
            if (!projectileSystem.GRAVITY) {
                projectileSystem.GRAVITY = 9.8 * 50; // Same as MovementSystem
            }

            // Create source with combat component for range
            const sourceId = game.createEntityWith({
                combat: { range: 300 }
            });

            const sourcePos = { x: 0, y: 0, z: 0 };
            const targetPos = { x: 200, y: 0, z: 0 };

            const result = projectileSystem.calculateTrajectory(sourcePos, targetPos, {
                speed: 200,
                ballistic: true,
                sourceId: sourceId
            });

            // Ballistic should have upward initial velocity
            expect(result.vy).toBeGreaterThan(0);
            expect(result.launchAngle).toBeGreaterThan(0);
            expect(result.timeToTarget).toBeGreaterThan(0);
        });
    });

    describe('fireProjectile', () => {
        it('should return null if source has no position', () => {
            const sourceId = game.createEntity();
            const targetId = game.createEntityWith({
                transform: { position: { x: 100, y: 0, z: 0 } }
            });

            const result = projectileSystem.fireProjectile(sourceId, targetId, {});

            expect(result).toBeNull();
        });

        it('should return null if source has no combat component', () => {
            const sourceId = game.createEntityWith({
                transform: { position: { x: 0, y: 0, z: 0 } }
            });
            const targetId = game.createEntityWith({
                transform: { position: { x: 100, y: 0, z: 0 } }
            });

            const result = projectileSystem.fireProjectile(sourceId, targetId, {});

            expect(result).toBeNull();
        });

        it('should return null if target has no position', () => {
            const sourceId = game.createEntityWith({
                transform: { position: { x: 0, y: 0, z: 0 } },
                combat: { damage: 10, range: 100 }
            });
            const targetId = game.createEntity();

            const result = projectileSystem.fireProjectile(sourceId, targetId, {});

            expect(result).toBeNull();
        });

        it('should create projectile entity with correct components', () => {
            const sourceId = game.createEntityWith({
                transform: { position: { x: 0, y: 0, z: 0 } },
                combat: { damage: 25, range: 200 },
                team: { team: enums.team.left }
            });
            const targetId = game.createEntityWith({
                transform: { position: { x: 100, y: 0, z: 0 } }
            });

            const projectileId = projectileSystem.fireProjectile(sourceId, targetId, {
                speed: 300,
                damage: 30
            });

            expect(projectileId).not.toBeNull();

            const transform = game.getComponent(projectileId, 'transform');
            expect(transform).toBeDefined();
            expect(transform.position.x).toBe(0);
            expect(transform.position.z).toBe(0);

            const velocity = game.getComponent(projectileId, 'velocity');
            expect(velocity).toBeDefined();
            expect(velocity.maxSpeed).toBe(300);

            const projectile = game.getComponent(projectileId, 'projectile');
            expect(projectile).toBeDefined();
            expect(projectile.damage).toBe(30);
            expect(projectile.source).toBe(sourceId);
            expect(projectile.target).toBe(targetId);

            const team = game.getComponent(projectileId, 'team');
            expect(team.team).toBe(enums.team.left);
        });

        it('should create ballistic projectile with gravity', () => {
            const sourceId = game.createEntityWith({
                transform: { position: { x: 0, y: 0, z: 0 } },
                combat: { damage: 25, range: 200 },
                team: { team: enums.team.left }
            });
            const targetId = game.createEntityWith({
                transform: { position: { x: 100, y: 0, z: 0 } }
            });

            const projectileId = projectileSystem.fireProjectile(sourceId, targetId, {
                speed: 300,
                ballistic: true
            });

            const velocity = game.getComponent(projectileId, 'velocity');
            expect(velocity.affectedByGravity).toBe(true);

            const projectile = game.getComponent(projectileId, 'projectile');
            expect(projectile.isBallistic).toBe(true);
        });

        it('should add homing component if specified', () => {
            const sourceId = game.createEntityWith({
                transform: { position: { x: 0, y: 0, z: 0 } },
                combat: { damage: 25, range: 200 },
                team: { team: enums.team.left }
            });
            const targetId = game.createEntityWith({
                transform: { position: { x: 100, y: 0, z: 50 } }
            });

            const projectileId = projectileSystem.fireProjectile(sourceId, targetId, {
                speed: 300,
                homing: true,
                homingStrength: 0.5
            });

            const homing = game.getComponent(projectileId, 'homingTarget');
            expect(homing).toBeDefined();
            expect(homing.targetId).toBe(targetId);
            expect(homing.homingStrength).toBe(0.5);
            expect(homing.lastKnownPosition.x).toBe(100);
            expect(homing.lastKnownPosition.z).toBe(50);
        });
    });

    describe('projectile trails', () => {
        it('should delete projectile trail on cleanup', () => {
            const entityId = 123;
            projectileSystem.projectileTrails.set(entityId, [
                { x: 0, y: 0, z: 0 },
                { x: 10, y: 0, z: 10 }
            ]);

            projectileSystem.deleteProjectileTrail(entityId);

            expect(projectileSystem.projectileTrails.has(entityId)).toBe(false);
        });

        it('should return empty array for non-existent trail', () => {
            const trail = projectileSystem.getProjectileTrail(999);
            expect(trail).toEqual([]);
        });

        it('should return trail data for existing projectile', () => {
            const entityId = 456;
            const trailData = [
                { x: 0, y: 0, z: 0 },
                { x: 10, y: 5, z: 10 }
            ];
            projectileSystem.projectileTrails.set(entityId, trailData);

            const trail = projectileSystem.getProjectileTrail(entityId);
            expect(trail).toEqual(trailData);
        });
    });

    describe('getElementalEffectColor', () => {
        it('should return correct colors for elements on client', () => {
            // Ensure isServer is false to get client colors
            game.isServer = false;

            expect(projectileSystem.getElementalEffectColor(enums.element.fire)).toBe('#ffaa00');
            expect(projectileSystem.getElementalEffectColor(enums.element.cold)).toBe('#44aaff');
            expect(projectileSystem.getElementalEffectColor(enums.element.lightning)).toBe('#ffff44');
            expect(projectileSystem.getElementalEffectColor(enums.element.poison)).toBe('#44ff44');
            expect(projectileSystem.getElementalEffectColor(enums.element.holy)).toBe('#ffddaa');
            expect(projectileSystem.getElementalEffectColor(enums.element.physical)).toBe('#ff2200');
        });

        it('should default to physical color for unknown element', () => {
            game.isServer = false;
            expect(projectileSystem.getElementalEffectColor(999)).toBe('#ff2200');
        });

        it('should return blood-red on server', () => {
            game.isServer = true;
            expect(projectileSystem.getElementalEffectColor(enums.element.fire)).toBe('#ff2200');
        });
    });

    describe('entityDestroyed', () => {
        it('should clean up trails when entity is destroyed', () => {
            const entityId = 789;
            projectileSystem.projectileTrails.set(entityId, [{ x: 0, y: 0, z: 0 }]);

            projectileSystem.entityDestroyed(entityId);

            expect(projectileSystem.projectileTrails.has(entityId)).toBe(false);
        });
    });

    describe('onSceneUnload', () => {
        it('should clear all trails and callbacks', () => {
            projectileSystem.projectileTrails.set(1, []);
            projectileSystem.projectileTrails.set(2, []);
            projectileSystem.projectileCallbacks.set(1, { onHit: () => {} });

            projectileSystem.onSceneUnload();

            expect(projectileSystem.projectileTrails.size).toBe(0);
            expect(projectileSystem.projectileCallbacks.size).toBe(0);
        });
    });

    describe('constants', () => {
        it('should have reasonable default values', () => {
            expect(projectileSystem.HIT_DETECTION_RADIUS).toBeGreaterThan(0);
            expect(projectileSystem.PROJECTILE_LIFETIME).toBeGreaterThan(0);
            expect(projectileSystem.DEFAULT_LAUNCH_ANGLE).toBeGreaterThan(0);
            expect(projectileSystem.DEFAULT_LAUNCH_ANGLE).toBeLessThan(Math.PI / 2);
        });
    });
});
