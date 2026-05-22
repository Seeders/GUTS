import { describe, it, expect, beforeEach } from 'vitest';
import { TestGameContext } from '../../../../../../tests/TestGameContext.js';

describe('LifetimeSystem', () => {
    let game;
    let lifetimeSystem;
    let enums;

    beforeEach(() => {
        game = new TestGameContext();

        // Register mock services needed by LifetimeSystem
        game.register('createParticleEffect', () => {});
        game.register('deleteProjectileTrail', () => {});
        game.register('clearBehaviorState', () => {});
        game.register('clearEntityPath', () => {});
        game.register('playScreenShake', () => {});
        game.register('playScreenFlash', () => {});

        lifetimeSystem = game.createSystem(GUTS.LifetimeSystem);
        enums = game.getEnums();
    });

    describe('addLifetime', () => {
        it('should add lifetime component to entity', () => {
            game.state.now = 10.0;
            const entityId = game.createEntity();

            lifetimeSystem.addLifetime(entityId, 5.0);

            const lifetime = game.getComponent(entityId, 'lifetime');
            expect(lifetime).toBeDefined();
            expect(lifetime.duration).toBe(5.0);
            expect(lifetime.startTime).toBe(10.0);
        });

        it('should accept options parameter', () => {
            const entityId = game.createEntity();

            // Test that addLifetime accepts options without error
            expect(() => {
                lifetimeSystem.addLifetime(entityId, 5.0, { fadeOutDuration: 1.0, destructionEffect: { type: 'magic' } });
            }).not.toThrow();

            const lifetime = game.getComponent(entityId, 'lifetime');
            expect(lifetime).toBeDefined();
            expect(lifetime.duration).toBe(5.0);
        });

        it('should register destruction callback', () => {
            const entityId = game.createEntity();
            const callback = () => {};

            lifetimeSystem.addLifetime(entityId, 5.0, { onDestroy: callback });

            expect(lifetimeSystem.destructionCallbacks.has(entityId)).toBe(true);
        });

        it('should return entity ID', () => {
            const entityId = game.createEntity();
            const result = lifetimeSystem.addLifetime(entityId, 5.0);
            expect(result).toBe(entityId);
        });
    });

    describe('extendLifetime', () => {
        it('should extend duration of existing lifetime', () => {
            const entityId = game.createEntity();
            lifetimeSystem.addLifetime(entityId, 5.0);

            const result = lifetimeSystem.extendLifetime(entityId, 3.0);

            expect(result).toBe(true);
            const lifetime = game.getComponent(entityId, 'lifetime');
            expect(lifetime.duration).toBe(8.0);
        });

        it('should return false if no lifetime component', () => {
            const entityId = game.createEntity();
            const result = lifetimeSystem.extendLifetime(entityId, 3.0);
            expect(result).toBe(false);
        });
    });

    describe('reduceLifetime', () => {
        it('should reduce duration of existing lifetime', () => {
            const entityId = game.createEntity();
            lifetimeSystem.addLifetime(entityId, 5.0);

            const result = lifetimeSystem.reduceLifetime(entityId, 2.0);

            expect(result).toBe(true);
            const lifetime = game.getComponent(entityId, 'lifetime');
            expect(lifetime.duration).toBe(3.0);
        });

        it('should not reduce below zero', () => {
            const entityId = game.createEntity();
            lifetimeSystem.addLifetime(entityId, 5.0);

            lifetimeSystem.reduceLifetime(entityId, 10.0);

            const lifetime = game.getComponent(entityId, 'lifetime');
            expect(lifetime.duration).toBe(0);
        });

        it('should return false if no lifetime component', () => {
            const entityId = game.createEntity();
            const result = lifetimeSystem.reduceLifetime(entityId, 2.0);
            expect(result).toBe(false);
        });
    });

    describe('getRemainingLifetime', () => {
        it('should return remaining time', () => {
            game.state.now = 10.0;
            const entityId = game.createEntity();
            lifetimeSystem.addLifetime(entityId, 5.0);

            game.state.now = 12.0;
            const remaining = lifetimeSystem.getRemainingLifetime(entityId);

            expect(remaining).toBe(3.0);
        });

        it('should return 0 if expired', () => {
            game.state.now = 10.0;
            const entityId = game.createEntity();
            lifetimeSystem.addLifetime(entityId, 5.0);

            game.state.now = 20.0;
            const remaining = lifetimeSystem.getRemainingLifetime(entityId);

            expect(remaining).toBe(0);
        });

        it('should return -1 if no lifetime component', () => {
            const entityId = game.createEntity();
            const remaining = lifetimeSystem.getRemainingLifetime(entityId);
            expect(remaining).toBe(-1);
        });
    });

    describe('willExpireSoon', () => {
        it('should return true if entity will expire within threshold', () => {
            game.state.now = 10.0;
            const entityId = game.createEntity();
            lifetimeSystem.addLifetime(entityId, 5.0);

            game.state.now = 13.0; // 2 seconds remaining
            const result = lifetimeSystem.willExpireSoon(entityId, 3.0);

            expect(result).toBe(true);
        });

        it('should return false if entity has plenty of time', () => {
            game.state.now = 10.0;
            const entityId = game.createEntity();
            lifetimeSystem.addLifetime(entityId, 10.0);

            game.state.now = 11.0; // 9 seconds remaining
            const result = lifetimeSystem.willExpireSoon(entityId, 3.0);

            expect(result).toBe(false);
        });

        it('should return false if no lifetime component', () => {
            const entityId = game.createEntity();
            const result = lifetimeSystem.willExpireSoon(entityId, 5.0);
            expect(result).toBe(false);
        });
    });

    describe('makeEntityPermanent', () => {
        it('should remove lifetime component', () => {
            const entityId = game.createEntity();
            lifetimeSystem.addLifetime(entityId, 5.0);

            const result = lifetimeSystem.makeEntityPermanent(entityId);

            expect(result).toBe(true);
            expect(game.getComponent(entityId, 'lifetime')).toBeUndefined();
        });

        it('should remove destruction callback', () => {
            const entityId = game.createEntity();
            lifetimeSystem.addLifetime(entityId, 5.0, { onDestroy: () => {} });

            lifetimeSystem.makeEntityPermanent(entityId);

            expect(lifetimeSystem.destructionCallbacks.has(entityId)).toBe(false);
        });

        it('should return false if no lifetime component', () => {
            const entityId = game.createEntity();
            const result = lifetimeSystem.makeEntityPermanent(entityId);
            expect(result).toBe(false);
        });
    });

    describe('destroyEntityImmediately', () => {
        it('should return false if no lifetime component', () => {
            const entityId = game.createEntity();
            const result = lifetimeSystem.destroyEntityImmediately(entityId);
            expect(result).toBe(false);
        });

        it('should destroy entity without effects when triggerEffects is false', () => {
            const entityId = game.createEntity();
            lifetimeSystem.addLifetime(entityId, 5.0);

            const result = lifetimeSystem.destroyEntityImmediately(entityId, false);

            expect(result).toBe(true);
            expect(lifetimeSystem.stats.entitiesDestroyed).toBe(1);
        });
    });

    describe('registerDestructionCallback', () => {
        it('should register callback for entity', () => {
            const entityId = game.createEntity();
            const callback = () => {};

            lifetimeSystem.registerDestructionCallback(entityId, callback);

            expect(lifetimeSystem.destructionCallbacks.has(entityId)).toBe(true);
        });

        it('should not register non-function callback', () => {
            const entityId = game.createEntity();

            lifetimeSystem.registerDestructionCallback(entityId, 'not a function');

            expect(lifetimeSystem.destructionCallbacks.has(entityId)).toBe(false);
        });
    });

    describe('getAllLifetimeEntities', () => {
        it('should return empty array when no lifetime entities', () => {
            const result = lifetimeSystem.getAllLifetimeEntities();
            expect(result).toEqual([]);
        });
    });

    describe('getExpiringEntities', () => {
        it('should return empty array when no entities', () => {
            const result = lifetimeSystem.getExpiringEntities(5.0);
            expect(result).toEqual([]);
        });
    });

    describe('statistics', () => {
        it('should initialize with zero stats', () => {
            const stats = lifetimeSystem.getStatistics();
            expect(stats.entitiesDestroyed).toBe(0);
            expect(stats.entitiesExpired).toBe(0);
            expect(stats.entitiesFaded).toBe(0);
        });

        it('should reset statistics', () => {
            lifetimeSystem.stats.entitiesDestroyed = 10;
            lifetimeSystem.stats.entitiesExpired = 5;

            lifetimeSystem.resetStatistics();

            const stats = lifetimeSystem.getStatistics();
            expect(stats.entitiesDestroyed).toBe(0);
            expect(stats.entitiesExpired).toBe(0);
        });
    });

    describe('configuration', () => {
        it('should have valid check interval', () => {
            expect(lifetimeSystem.CHECK_INTERVAL).toBeGreaterThan(0);
        });
    });

    describe('destroy', () => {
        it('should clear all tracking maps', () => {
            const entityId = game.createEntity();
            lifetimeSystem.destructionCallbacks.set(entityId, () => {});
            lifetimeSystem.fadeOutEntities.set(entityId, {});
            lifetimeSystem.stats.entitiesDestroyed = 10;

            lifetimeSystem.destroy();

            expect(lifetimeSystem.destructionCallbacks.size).toBe(0);
            expect(lifetimeSystem.fadeOutEntities.size).toBe(0);
            expect(lifetimeSystem.stats.entitiesDestroyed).toBe(0);
        });
    });
});
