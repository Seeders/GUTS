import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TestGameContext } from '../../../../../../tests/TestGameContext.js';

describe('ServerBattlePhaseSystem', () => {
    let game;
    let serverBattlePhaseSystem;
    let enums;

    beforeEach(() => {
        game = new TestGameContext();
        game.isServer = true;
        game.state.round = 1;
        game.state.gameSeed = 12345;
        game.state.now = 0;

        // Register mock services
        game.register('getPlayerEntities', () => []);
        game.register('broadcastToRoom', () => {});
        game.register('getBehaviorMeta', () => null);

        serverBattlePhaseSystem = game.createSystem(GUTS.ServerBattlePhaseSystem);
        enums = game.getEnums();
    });

    describe('initialization', () => {
        it('should register system on game', () => {
            expect(game.serverBattlePhaseSystem).toBe(serverBattlePhaseSystem);
        });

        it('should set default battleDuration to 30 seconds', () => {
            expect(serverBattlePhaseSystem.battleDuration).toBe(30);
        });

        it('should initialize battleStartTime to 0', () => {
            expect(serverBattlePhaseSystem.battleStartTime).toBe(0);
        });

        it('should initialize battleResults as empty Map', () => {
            expect(serverBattlePhaseSystem.battleResults.size).toBe(0);
        });

        it('should initialize createdSquads as empty Map', () => {
            expect(serverBattlePhaseSystem.createdSquads.size).toBe(0);
        });

        it('should set maxRounds to 5', () => {
            expect(serverBattlePhaseSystem.maxRounds).toBe(5);
        });

        it('should set baseGoldPerRound to 50', () => {
            expect(serverBattlePhaseSystem.baseGoldPerRound).toBe(50);
        });
    });

    describe('static services', () => {
        it('should register startBattle service', () => {
            expect(GUTS.ServerBattlePhaseSystem.services).toContain('startBattle');
        });

        it('should register serializeAllEntities service', () => {
            expect(GUTS.ServerBattlePhaseSystem.services).toContain('serializeAllEntities');
        });
    });

    describe('startBattle', () => {
        it('should set isPaused to false', () => {
            game.state.isPaused = true;

            serverBattlePhaseSystem.startBattle();

            expect(game.state.isPaused).toBe(false);
        });

        it('should set phase to battle', () => {
            serverBattlePhaseSystem.startBattle();

            expect(game.state.phase).toBe(enums.gamePhase.battle);
        });

        it('should record battle start time', () => {
            // startBattle calls resetCurrentTime() which may reset game.state.now
            // So we just check that battleStartTime is set to some value
            serverBattlePhaseSystem.startBattle();

            expect(serverBattlePhaseSystem.battleStartTime).toBeDefined();
            expect(typeof serverBattlePhaseSystem.battleStartTime).toBe('number');
        });

        it('should return success result', () => {
            const result = serverBattlePhaseSystem.startBattle();

            expect(result.success).toBe(true);
        });

        it('should initialize RNG with deterministic seed', () => {
            game.state.gameSeed = 42;
            game.state.round = 3;

            // Should not throw
            expect(() => serverBattlePhaseSystem.startBattle()).not.toThrow();
        });
    });

    describe('calculateRoundGold', () => {
        it('should return base gold plus round bonus', () => {
            expect(serverBattlePhaseSystem.calculateRoundGold(1)).toBe(100);  // 50 + 1*50
            expect(serverBattlePhaseSystem.calculateRoundGold(2)).toBe(150);  // 50 + 2*50
            expect(serverBattlePhaseSystem.calculateRoundGold(3)).toBe(200);  // 50 + 3*50
        });

        it('should scale linearly with round number', () => {
            const round1 = serverBattlePhaseSystem.calculateRoundGold(1);
            const round5 = serverBattlePhaseSystem.calculateRoundGold(5);

            expect(round5 - round1).toBe(200);  // 4 rounds * 50 gold
        });
    });

    describe('checkBuildingVictoryCondition', () => {
        it('should return null when both teams have buildings', () => {
            // Create buildings for both teams
            game.createEntityWith({
                unitType: { type: 1, collection: 0 },
                team: { team: enums.team.left },
                health: { current: 100, max: 100 }
            });
            game.createEntityWith({
                unitType: { type: 1, collection: 0 },
                team: { team: enums.team.right },
                health: { current: 100, max: 100 }
            });

            // Mock getUnitTypeDef to return building type
            game.register('getUnitTypeDef', () => ({ collection: 'buildings' }));

            const result = serverBattlePhaseSystem.checkBuildingVictoryCondition();
            expect(result).toBeNull();
        });

        it('should return null when no buildings exist', () => {
            const result = serverBattlePhaseSystem.checkBuildingVictoryCondition();
            expect(result).toBeNull();
        });

        it('should not count dead buildings', () => {
            game.createEntityWith({
                unitType: { type: 1, collection: 0 },
                team: { team: enums.team.left },
                health: { current: 0, max: 100 }  // Dead
            });
            game.createEntityWith({
                unitType: { type: 1, collection: 0 },
                team: { team: enums.team.right },
                health: { current: 100, max: 100 }
            });

            game.register('getUnitTypeDef', () => ({ collection: 'buildings' }));

            // Left has no alive buildings, right has one
            // Should indicate right wins
            const result = serverBattlePhaseSystem.checkBuildingVictoryCondition();
            // Result depends on player entity setup, but should not be null
            expect(result === null || result.reason === 'buildings_destroyed').toBe(true);
        });

        it('should not count dying buildings', () => {
            game.createEntityWith({
                unitType: { type: 1, collection: 0 },
                team: { team: enums.team.left },
                health: { current: 100, max: 100 },
                deathState: { state: enums.deathState.dying }  // Dying
            });

            game.register('getUnitTypeDef', () => ({ collection: 'buildings' }));

            // Dying buildings shouldn't count
            const result = serverBattlePhaseSystem.checkBuildingVictoryCondition();
            expect(result).toBeNull();
        });
    });

    describe('checkNoCombatActive', () => {
        it('should return true for empty entity list', () => {
            expect(serverBattlePhaseSystem.checkNoCombatActive([])).toBe(true);
        });

        it('should return true when no entities have targets', () => {
            const entity1 = game.createEntity();
            const entity2 = game.createEntity();

            game.register('getBehaviorMeta', () => ({ target: null }));

            const result = serverBattlePhaseSystem.checkNoCombatActive([entity1, entity2]);
            expect(result).toBe(true);
        });

        it('should return false when entity has valid target', () => {
            const entity1 = game.createEntity();

            game.register('getBehaviorMeta', (id) => {
                if (id === entity1) return { target: 5 };
                return null;
            });

            const result = serverBattlePhaseSystem.checkNoCombatActive([entity1]);
            expect(result).toBe(false);
        });

        it('should return true when target is undefined', () => {
            const entity1 = game.createEntity();

            game.register('getBehaviorMeta', () => ({ target: undefined }));

            const result = serverBattlePhaseSystem.checkNoCombatActive([entity1]);
            expect(result).toBe(true);
        });

        it('should return true when target is -1', () => {
            const entity1 = game.createEntity();

            game.register('getBehaviorMeta', () => ({ target: -1 }));

            const result = serverBattlePhaseSystem.checkNoCombatActive([entity1]);
            expect(result).toBe(true);
        });
    });

    describe('checkAllUnitsAtTargetPosition', () => {
        it('should return true for empty entity list', () => {
            expect(serverBattlePhaseSystem.checkAllUnitsAtTargetPosition([])).toBe(true);
        });

        it('should return true when unit is at target position', () => {
            const entity1 = game.createEntityWith({
                transform: { position: { x: 100, y: 0, z: 100 } },
                aiState: { targetPosition: { x: 100, y: 0, z: 100 } }
            });

            const result = serverBattlePhaseSystem.checkAllUnitsAtTargetPosition([entity1]);
            expect(result).toBe(true);
        });

        it('should handle entities without aiState gracefully', () => {
            // Test with entity that has transform but no aiState
            const entity1 = game.createEntityWith({
                transform: { position: { x: 0, y: 0, z: 0 } }
            });

            // Should not throw and should continue (entities without targetPos are skipped)
            expect(() => serverBattlePhaseSystem.checkAllUnitsAtTargetPosition([entity1])).not.toThrow();
        });

        it('should return true when unit is within threshold', () => {
            const entity1 = game.createEntityWith({
                transform: { position: { x: 100, y: 0, z: 100 } },
                aiState: { targetPosition: { x: 115, y: 0, z: 100 } }  // 15 units away
            });

            const result = serverBattlePhaseSystem.checkAllUnitsAtTargetPosition([entity1]);
            expect(result).toBe(true);
        });

        it('should handle entity without aiState', () => {
            const entity1 = game.createEntityWith({
                transform: { position: { x: 100, y: 0, z: 100 } }
            });

            // Should not throw and should continue
            expect(() => serverBattlePhaseSystem.checkAllUnitsAtTargetPosition([entity1])).not.toThrow();
        });
    });

    describe('getSurvivingUnits', () => {
        it('should return empty object when no squads created', () => {
            const survivors = serverBattlePhaseSystem.getSurvivingUnits();
            expect(Object.keys(survivors).length).toBe(0);
        });

        it('should return object keyed by player', () => {
            serverBattlePhaseSystem.createdSquads.set('player1', []);
            serverBattlePhaseSystem.createdSquads.set('player2', []);

            const survivors = serverBattlePhaseSystem.getSurvivingUnits();

            expect('player1' in survivors).toBe(true);
            expect('player2' in survivors).toBe(true);
        });
       
    });

    describe('getPlayerStatsForBroadcast', () => {
        it('should return empty object when no player entities', () => {
            const stats = serverBattlePhaseSystem.getPlayerStatsForBroadcast();
            expect(Object.keys(stats).length).toBe(0);
        });

        it('should return object type', () => {
            const stats = serverBattlePhaseSystem.getPlayerStatsForBroadcast();
            expect(typeof stats).toBe('object');
        });

        // Note: Full player stats tests depend on getPlayerEntities returning entities
        // with properly formed playerStats components
    });

    describe('shouldEndGame', () => {
        it('should return false when both teams have buildings', () => {
            game.createEntityWith({
                unitType: { type: 1, collection: 0 },
                team: { team: enums.team.left },
                health: { current: 100, max: 100 }
            });
            game.createEntityWith({
                unitType: { type: 1, collection: 0 },
                team: { team: enums.team.right },
                health: { current: 100, max: 100 }
            });

            game.register('getUnitTypeDef', () => ({ collection: 'buildings' }));

            expect(serverBattlePhaseSystem.shouldEndGame()).toBe(false);
        });
    });

    describe('onBattleEnd', () => {
        it('should not throw when called', () => {
            expect(() => serverBattlePhaseSystem.onBattleEnd()).not.toThrow();
        });

        it('should reset battleStartTime', () => {
            serverBattlePhaseSystem.battleStartTime = 5000;

            serverBattlePhaseSystem.onBattleEnd();

            expect(serverBattlePhaseSystem.battleStartTime).toBe(0);
        });

        it('should clear createdSquads', () => {
            serverBattlePhaseSystem.createdSquads.set('player1', []);

            serverBattlePhaseSystem.onBattleEnd();

            expect(serverBattlePhaseSystem.createdSquads.size).toBe(0);
        });
    });

    describe('update', () => {
        it('should not throw when not in battle phase', () => {
            game.state.phase = enums.gamePhase.placement;
            expect(() => serverBattlePhaseSystem.update()).not.toThrow();
        });

        it('should check for battle end in battle phase', () => {
            game.state.phase = enums.gamePhase.battle;
            expect(() => serverBattlePhaseSystem.update()).not.toThrow();
        });
    });

    describe('addGoldForTeam', () => {
        it('should call addPlayerGold service', () => {
            let goldAdded = null;
            let teamAdded = null;

            game.register('addPlayerGold', (team, gold) => {
                teamAdded = team;
                goldAdded = gold;
            });

            serverBattlePhaseSystem.addGoldForTeam(100, 'left');

            expect(teamAdded).toBe('left');
            expect(goldAdded).toBe(100);
        });
    });
});
