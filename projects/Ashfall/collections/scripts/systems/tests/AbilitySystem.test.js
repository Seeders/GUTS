import { describe, it, expect, beforeEach } from 'vitest';
import { TestGameContext } from '../../../../../../tests/TestGameContext.js';

describe('AbilitySystem', () => {
    let game;
    let abilitySystem;
    let enums;

    beforeEach(() => {
        game = new TestGameContext();

        // Register additional mock services needed by AbilitySystem
        game.register('calculateAnimationSpeed', () => 1.0);
        game.register('triggerSinglePlayAnimation', () => {});
        game.register('getNearbyUnits', () => []);

        // Mock scheduling system that abilities use
        game.schedulingSystem = {
            scheduleAction: (callback, delay, entityId) => {
                // Execute immediately for tests (or we could store and process later)
            }
        };

        abilitySystem = game.createSystem(GUTS.AbilitySystem);
        enums = game.getEnums();
    });

    describe('addAbilitiesToUnit', () => {
        it('should add abilities to an entity', () => {
            const entity = game.createEntity();

            // Use the real addAbilitiesToUnit with actual ability classes
            abilitySystem.addAbilitiesToUnit(entity, ['HealAbility', 'SmiteAbility']);

            const abilities = abilitySystem.getEntityAbilities(entity);
            expect(abilities.length).toBe(2);
            // Ability IDs come from collection data which uses class name as id
            expect(abilities[0].id).toBe('HealAbility');
            expect(abilities[1].id).toBe('SmiteAbility');
        });

        it('should return empty array for entity without abilities', () => {
            const entity = game.createEntity();
            const abilities = abilitySystem.getEntityAbilities(entity);
            expect(abilities).toEqual([]);
        });

        it('should handle single ability ID as string', () => {
            const entity = game.createEntity();
            abilitySystem.addAbilitiesToUnit(entity, 'BloodlustAbility');

            const abilities = abilitySystem.getEntityAbilities(entity);
            expect(abilities.length).toBe(1);
            expect(abilities[0].id).toBe('BloodlustAbility');
        });
    });

    describe('useAbility', () => {
        it('should queue ability for execution', () => {
            const entity = game.createEntityWith({
                deathState: { state: enums.deathState.alive },
                transform: { position: { x: 0, y: 0, z: 0 } },
                team: { team: enums.team.left }
            });

            // BloodlustAbility is a self-targeting ability with simple canExecute
            abilitySystem.addAbilitiesToUnit(entity, ['BloodlustAbility']);

            game.state.now = 0;
            const result = abilitySystem.useAbility(entity, 'BloodlustAbility');

            expect(result).toBe(true);
            const queue = game.getComponent(entity, 'abilityQueue');
            expect(queue).toBeDefined();
            expect(queue.abilityId).toBe(enums.abilities['BloodlustAbility']);
        });

        it('should not allow dead entities to use abilities', () => {
            const entity = game.createEntityWith({
                deathState: { state: enums.deathState.dying }
            });

            abilitySystem.addAbilitiesToUnit(entity, ['BloodlustAbility']);

            const result = abilitySystem.useAbility(entity, 'BloodlustAbility');
            expect(result).toBe(false);
        });

        it('should not queue ability if one is already queued', () => {
            const entity = game.createEntityWith({
                deathState: { state: enums.deathState.alive },
                abilityQueue: { abilityId: 1, targetData: null, executeTime: 5.0 }
            });

            abilitySystem.addAbilitiesToUnit(entity, ['BloodlustAbility']);

            const result = abilitySystem.useAbility(entity, 'BloodlustAbility');
            expect(result).toBe(false);
        });

        it('should return false for non-existent ability', () => {
            const entity = game.createEntityWith({
                deathState: { state: enums.deathState.alive }
            });

            abilitySystem.addAbilitiesToUnit(entity, ['BloodlustAbility']);
            const result = abilitySystem.useAbility(entity, 'nonExistentAbility');
            expect(result).toBe(false);
        });
    });

    describe('cooldown management', () => {
        it('should set cooldown when ability is used', () => {
            const entity = game.createEntityWith({
                deathState: { state: enums.deathState.alive },
                transform: { position: { x: 0, y: 0, z: 0 } }
            });

            abilitySystem.addAbilitiesToUnit(entity, ['BloodlustAbility']);
            const ability = abilitySystem.getEntityAbilities(entity)[0];

            game.state.now = 0;
            abilitySystem.useAbility(entity, 'BloodlustAbility');

            // Cooldown includes cast time + cooldown
            const remaining = abilitySystem.getRemainingCooldown(entity, 'BloodlustAbility');
            expect(remaining).toBe(ability.castTime + ability.cooldown);
        });

        it('should prevent ability use while on cooldown', () => {
            const entity = game.createEntityWith({
                deathState: { state: enums.deathState.alive },
                transform: { position: { x: 0, y: 0, z: 0 } }
            });

            abilitySystem.addAbilitiesToUnit(entity, ['BloodlustAbility']);
            const ability = abilitySystem.getEntityAbilities(entity)[0];

            game.state.now = 0;
            abilitySystem.useAbility(entity, 'BloodlustAbility');

            // Remove the queue so we can try again
            game.removeComponent(entity, 'abilityQueue');

            // Try to use again while still on cooldown (half the cooldown time)
            game.state.now = (ability.castTime + ability.cooldown) / 2;
            const result = abilitySystem.useAbility(entity, 'BloodlustAbility');
            expect(result).toBe(false);
        });

        it('should allow ability use after cooldown expires', () => {
            const entity = game.createEntityWith({
                deathState: { state: enums.deathState.alive },
                transform: { position: { x: 0, y: 0, z: 0 } }
            });

            abilitySystem.addAbilitiesToUnit(entity, ['BloodlustAbility']);
            const ability = abilitySystem.getEntityAbilities(entity)[0];

            game.state.now = 0;
            abilitySystem.useAbility(entity, 'BloodlustAbility');

            // Remove the queue and advance past cooldown
            game.removeComponent(entity, 'abilityQueue');
            game.state.now = ability.castTime + ability.cooldown + 1;

            const result = abilitySystem.useAbility(entity, 'BloodlustAbility');
            expect(result).toBe(true);
        });

        it('should return 0 remaining cooldown for abilities not on cooldown', () => {
            const entity = game.createEntity();
            const remaining = abilitySystem.getRemainingCooldown(entity, 'BloodlustAbility');
            expect(remaining).toBe(0);
        });

        it('should track last ability used time', () => {
            const entity = game.createEntityWith({
                deathState: { state: enums.deathState.alive },
                transform: { position: { x: 0, y: 0, z: 0 } }
            });

            abilitySystem.addAbilitiesToUnit(entity, ['BloodlustAbility']);

            game.state.now = 10.0;
            abilitySystem.useAbility(entity, 'BloodlustAbility');

            const cooldowns = game.getComponent(entity, 'abilityCooldowns');
            expect(cooldowns.lastAbilityTime).toBe(10.0);
        });
    });

    describe('scheduleAbilityAction', () => {
        it('should schedule action for later execution', () => {
            let executed = false;
            const action = () => { executed = true; };

            game.state.now = 0;
            abilitySystem.scheduleAbilityAction(action, 2.0);

            expect(executed).toBe(false);
            expect(abilitySystem.abilityActions.size).toBe(1);
        });

        it('should execute action when time is reached', () => {
            let executed = false;
            const action = () => { executed = true; };

            game.state.now = 0;
            abilitySystem.scheduleAbilityAction(action, 2.0);

            game.state.now = 2.5;
            abilitySystem.processAbilityActions();

            expect(executed).toBe(true);
            expect(abilitySystem.abilityActions.size).toBe(0);
        });

        it('should not execute action before time is reached', () => {
            let executed = false;
            const action = () => { executed = true; };

            game.state.now = 0;
            abilitySystem.scheduleAbilityAction(action, 2.0);

            game.state.now = 1.5;
            abilitySystem.processAbilityActions();

            expect(executed).toBe(false);
            expect(abilitySystem.abilityActions.size).toBe(1);
        });

        it('should handle multiple scheduled actions', () => {
            let count = 0;

            game.state.now = 0;
            abilitySystem.scheduleAbilityAction(() => count++, 1.0);
            abilitySystem.scheduleAbilityAction(() => count++, 2.0);
            abilitySystem.scheduleAbilityAction(() => count++, 3.0);

            game.state.now = 2.5;
            abilitySystem.processAbilityActions();

            expect(count).toBe(2); // First two should have executed
            expect(abilitySystem.abilityActions.size).toBe(1);
        });
    });

    describe('removeEntityAbilities', () => {
        it('should remove all abilities from entity', () => {
            const entity = game.createEntityWith({
                deathState: { state: enums.deathState.alive },
                transform: { position: { x: 0, y: 0, z: 0 } }
            });

            abilitySystem.addAbilitiesToUnit(entity, ['BloodlustAbility', 'HealAbility']);

            // Use ability to create cooldown and queue components
            abilitySystem.useAbility(entity, 'BloodlustAbility');

            abilitySystem.removeEntityAbilities(entity);

            expect(abilitySystem.getEntityAbilities(entity)).toEqual([]);
            expect(game.getComponent(entity, 'abilityQueue')).toBeUndefined();
            expect(game.getComponent(entity, 'abilityCooldowns')).toBeUndefined();
        });
    });

    describe('getAbilityCooldowns', () => {
        it('should return cooldown info for all entity abilities', () => {
            const entity = game.createEntityWith({
                deathState: { state: enums.deathState.alive },
                transform: { position: { x: 0, y: 0, z: 0 } }
            });

            abilitySystem.addAbilitiesToUnit(entity, ['BloodlustAbility', 'BattleCryAbility']);

            game.state.now = 0;
            abilitySystem.useAbility(entity, 'BloodlustAbility');

            const cooldowns = abilitySystem.getAbilityCooldowns(entity);
            expect(cooldowns.length).toBe(2);

            const bloodlustCooldown = cooldowns.find(c => c.id === 'BloodlustAbility');
            const battlecryCooldown = cooldowns.find(c => c.id === 'BattleCryAbility');

            expect(bloodlustCooldown.remainingCooldown).toBeGreaterThan(0);
            expect(battlecryCooldown.remainingCooldown).toBe(0);
        });
    });

    describe('onBattleEnd', () => {
        it('should clear all ability queues and cooldowns', () => {
            const entity1 = game.createEntityWith({
                deathState: { state: enums.deathState.alive },
                transform: { position: { x: 0, y: 0, z: 0 } }
            });
            const entity2 = game.createEntityWith({
                deathState: { state: enums.deathState.alive },
                transform: { position: { x: 10, y: 0, z: 0 } }
            });

            abilitySystem.addAbilitiesToUnit(entity1, ['BloodlustAbility']);
            abilitySystem.addAbilitiesToUnit(entity2, ['BattleCryAbility']);

            // Use abilities to create queue and cooldown components
            abilitySystem.useAbility(entity1, 'BloodlustAbility');
            game.removeComponent(entity1, 'abilityQueue'); // Remove to test queue separately
            game.addComponent(entity1, 'abilityQueue', { abilityId: 1, targetData: null, executeTime: 5.0 });
            game.addComponent(entity2, 'abilityQueue', { abilityId: 2, targetData: null, executeTime: 3.0 });

            // Schedule some actions
            abilitySystem.scheduleAbilityAction(() => {}, 5.0);
            abilitySystem.scheduleAbilityAction(() => {}, 10.0);

            abilitySystem.onBattleEnd();

            expect(game.getComponent(entity1, 'abilityQueue')).toBeUndefined();
            expect(game.getComponent(entity2, 'abilityQueue')).toBeUndefined();
            expect(game.getComponent(entity1, 'abilityCooldowns')).toBeUndefined();
            expect(game.getComponent(entity2, 'abilityCooldowns')).toBeUndefined();
            expect(abilitySystem.abilityActions.size).toBe(0);
        });
    });

    describe('considerAbilityUsage (AI)', () => {
        it('should not consider abilities for dying entities', () => {
            const entity = game.createEntityWith({
                deathState: { state: enums.deathState.dying }
            });

            abilitySystem.addAbilitiesToUnit(entity, ['BloodlustAbility']);
            const abilities = abilitySystem.getEntityAbilities(entity);

            abilitySystem.considerAbilityUsage(entity, abilities);

            const queue = game.getComponent(entity, 'abilityQueue');
            expect(queue).toBeUndefined();
        });

        it('should not queue new ability if one is already queued', () => {
            const entity = game.createEntityWith({
                deathState: { state: enums.deathState.alive },
                abilityQueue: { abilityId: 1, targetData: null, executeTime: 5.0 }
            });

            abilitySystem.addAbilitiesToUnit(entity, ['BloodlustAbility']);
            const abilities = abilitySystem.getEntityAbilities(entity);

            abilitySystem.considerAbilityUsage(entity, abilities);

            // Queue should remain unchanged
            const queue = game.getComponent(entity, 'abilityQueue');
            expect(queue.executeTime).toBe(5.0);
        });
    });

    describe('isAbilityOffCooldown', () => {
        it('should return true when no cooldowns exist', () => {
            const entity = game.createEntity();
            expect(abilitySystem.isAbilityOffCooldown(entity, 'BloodlustAbility')).toBe(true);
        });

        it('should return false when ability is on cooldown', () => {
            const entity = game.createEntityWith({
                deathState: { state: enums.deathState.alive },
                transform: { position: { x: 0, y: 0, z: 0 } }
            });

            abilitySystem.addAbilitiesToUnit(entity, ['BloodlustAbility']);

            game.state.now = 0;
            abilitySystem.useAbility(entity, 'BloodlustAbility');

            expect(abilitySystem.isAbilityOffCooldown(entity, 'BloodlustAbility')).toBe(false);
        });

        it('should return true for unknown ability ID', () => {
            const entity = game.createEntity();
            expect(abilitySystem.isAbilityOffCooldown(entity, 'UnknownAbility')).toBe(true);
        });
    });

    describe('destroy', () => {
        it('should clear all internal state', () => {
            const entity = game.createEntity();
            abilitySystem.addAbilitiesToUnit(entity, ['BloodlustAbility']);
            abilitySystem.scheduleAbilityAction(() => {}, 5.0);

            abilitySystem.destroy();

            expect(abilitySystem.entityAbilities.size).toBe(0);
            expect(abilitySystem.abilityActions.size).toBe(0);
        });
    });

    describe('entityDestroyed', () => {
        it('should clean up abilities when entity is destroyed', () => {
            const entity = game.createEntityWith({
                deathState: { state: enums.deathState.alive },
                transform: { position: { x: 0, y: 0, z: 0 } }
            });

            abilitySystem.addAbilitiesToUnit(entity, ['BloodlustAbility']);
            abilitySystem.useAbility(entity, 'BloodlustAbility');

            abilitySystem.entityDestroyed(entity);

            expect(abilitySystem.getEntityAbilities(entity)).toEqual([]);
        });
    });
});
