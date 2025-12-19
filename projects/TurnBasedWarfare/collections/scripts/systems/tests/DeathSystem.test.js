import { describe, it, expect, beforeEach } from 'vitest';
import { TestGameContext } from '../../../../../../tests/TestGameContext.js';

describe('DeathSystem', () => {
    let game;
    let deathSystem;
    let enums;

    beforeEach(() => {
        game = new TestGameContext();

        // Register mock services needed by DeathSystem
        game.register('getUnitTypeDef', () => ({ name: 'TestUnit' }));
        game.register('playDeathAnimation', () => {});
        game.register('setCorpseAnimation', () => {});

        deathSystem = game.createSystem(GUTS.DeathSystem);
        enums = game.getEnums();
    });

    describe('startDeathProcess', () => {
        it('should update existing deathState to dying', () => {
            game.state.now = 10.0;
            const entityId = game.createEntityWith({
                deathState: { state: enums.deathState.alive, deathStartTime: 0 },
                health: { current: 0, max: 100 },
                velocity: { vx: 10, vy: 0, vz: 5 }
            });

            deathSystem.startDeathProcess(entityId);

            const deathState = game.getComponent(entityId, 'deathState');
            expect(deathState.state).toBe(enums.deathState.dying);
            expect(deathState.deathStartTime).toBe(10.0);
        });

        it('should remove health component', () => {
            const entityId = game.createEntityWith({
                deathState: { state: enums.deathState.alive },
                health: { current: 0, max: 100 }
            });

            deathSystem.startDeathProcess(entityId);

            expect(game.getComponent(entityId, 'health')).toBeUndefined();
        });

        it('should remove velocity component', () => {
            const entityId = game.createEntityWith({
                deathState: { state: enums.deathState.alive },
                velocity: { vx: 10, vy: 0, vz: 5 }
            });

            deathSystem.startDeathProcess(entityId);

            expect(game.getComponent(entityId, 'velocity')).toBeUndefined();
        });

        it('should call playDeathAnimation if service exists', () => {
            let animationCalled = false;
            game.register('playDeathAnimation', () => { animationCalled = true; });

            const entityId = game.createEntityWith({
                deathState: { state: enums.deathState.alive }
            });

            deathSystem.startDeathProcess(entityId);

            expect(animationCalled).toBe(true);
        });

        it('should create deathState if not present', () => {
            game.state.now = 5.0;
            const entityId = game.createEntity();

            deathSystem.startDeathProcess(entityId);

            const deathState = game.getComponent(entityId, 'deathState');
            expect(deathState).toBeDefined();
            expect(deathState.state).toBe(enums.deathState.dying);
            expect(deathState.deathStartTime).toBe(5.0);
        });
    });

    describe('convertToCorpse', () => {
        it('should update deathState to corpse', () => {
            game.state.now = 15.0;
            const entityId = game.createEntityWith({
                transform: { position: { x: 100, y: 0, z: 100 } },
                unitType: { type: 1, collection: 0 },
                team: { team: enums.team.left },
                deathState: { state: enums.deathState.dying, deathStartTime: 10.0 }
            });

            deathSystem.convertToCorpse(entityId);

            const deathState = game.getComponent(entityId, 'deathState');
            expect(deathState.state).toBe(enums.deathState.corpse);
            expect(deathState.corpseTime).toBe(15.0);
            expect(deathState.teamAtDeath).toBe(enums.team.left);
        });

        it('should call setCorpseAnimation if service exists', () => {
            let animationCalled = false;
            game.register('setCorpseAnimation', () => { animationCalled = true; });

            const entityId = game.createEntityWith({
                transform: { position: { x: 0, y: 0, z: 0 } },
                unitType: { type: 1, collection: 0 },
                team: { team: enums.team.left },
                deathState: { state: enums.deathState.dying }
            });

            deathSystem.convertToCorpse(entityId);

            expect(animationCalled).toBe(true);
        });

        it('should do nothing if entity lacks required components', () => {
            const entityId = game.createEntityWith({
                deathState: { state: enums.deathState.dying }
            });

            // Should not throw
            expect(() => deathSystem.convertToCorpse(entityId)).not.toThrow();
        });
    });

    describe('destroyBuilding', () => {
        it('should destroy entity and trigger event', () => {
            let eventTriggered = false;
            game.triggerEvent = (name, entityId) => {
                if (name === 'onDestroyBuilding') eventTriggered = true;
            };

            const entityId = game.createEntityWith({
                transform: { position: { x: 0, y: 0, z: 0 } },
                unitType: { type: 1, collection: enums.objectTypeDefinitions.buildings }
            });

            const result = deathSystem.destroyBuilding(entityId);

            expect(result.success).toBe(true);
            expect(eventTriggered).toBe(true);
        });
    });

    describe('consumeCorpse', () => {
        it('should return null for non-corpse entity', () => {
            const entityId = game.createEntityWith({
                deathState: { state: enums.deathState.alive }
            });

            const result = deathSystem.consumeCorpse(entityId);

            expect(result).toBeNull();
        });

        it('should return null for dying entity', () => {
            const entityId = game.createEntityWith({
                deathState: { state: enums.deathState.dying }
            });

            const result = deathSystem.consumeCorpse(entityId);

            expect(result).toBeNull();
        });

        it('should return corpse data and destroy entity', () => {
            const entityId = game.createEntityWith({
                unitType: { type: 1, collection: 0 },
                deathState: {
                    state: enums.deathState.corpse,
                    corpseTime: 20.0,
                    teamAtDeath: enums.team.right
                }
            });

            const result = deathSystem.consumeCorpse(entityId);

            expect(result).not.toBeNull();
            expect(result.deathTime).toBe(20.0);
            expect(result.teamAtDeath).toBe(enums.team.right);
            expect(result.originalUnitType).toBeDefined();
        });

        it('should return null if no unitType', () => {
            const entityId = game.createEntityWith({
                deathState: { state: enums.deathState.corpse }
            });

            const result = deathSystem.consumeCorpse(entityId);

            expect(result).toBeNull();
        });
    });

    describe('getAllCorpses', () => {
        it('should return empty array when no corpses', () => {
            const corpses = deathSystem.getAllCorpses();
            expect(corpses).toEqual([]);
        });
    });

    describe('getCorpsesByTeam', () => {
        it('should return empty array when no corpses', () => {
            const corpses = deathSystem.getCorpsesByTeam(enums.team.left);
            expect(corpses).toEqual([]);
        });
    });

    describe('getCorpsesInRange', () => {
        it('should return empty array when no corpses', () => {
            const corpses = deathSystem.getCorpsesInRange({ x: 0, z: 0 }, 100);
            expect(corpses).toEqual([]);
        });
    });

    describe('onBattleEnd', () => {
        it('should not throw when no corpses exist', () => {
            expect(() => deathSystem.onBattleEnd()).not.toThrow();
        });
    });
});
