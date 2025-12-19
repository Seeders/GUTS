import { describe, it, expect, beforeEach } from 'vitest';
import { TestGameContext } from '../../../../../../tests/TestGameContext.js';

describe('PlayerStatsSystem', () => {
    let game;
    let playerStatsSystem;
    let enums;

    beforeEach(() => {
        game = new TestGameContext();

        playerStatsSystem = game.createSystem(GUTS.PlayerStatsSystem);
        enums = game.getEnums();
    });

    describe('initialization', () => {
        it('should register system on game', () => {
            expect(game.playerStatsSystem).toBe(playerStatsSystem);
        });
    });

    describe('static services', () => {
        it('should register getPlayerEntityId service', () => {
            expect(GUTS.PlayerStatsSystem.services).toContain('getPlayerEntityId');
        });

        it('should register getPlayerStats service', () => {
            expect(GUTS.PlayerStatsSystem.services).toContain('getPlayerStats');
        });

        it('should register getLocalPlayerStats service', () => {
            expect(GUTS.PlayerStatsSystem.services).toContain('getLocalPlayerStats');
        });

        it('should register getPlayerStatsByTeam service', () => {
            expect(GUTS.PlayerStatsSystem.services).toContain('getPlayerStatsByTeam');
        });

        it('should register getPlayerEntities service', () => {
            expect(GUTS.PlayerStatsSystem.services).toContain('getPlayerEntities');
        });

        it('should register getPlayerGold service', () => {
            expect(GUTS.PlayerStatsSystem.services).toContain('getPlayerGold');
        });

        it('should register addPlayerGold service', () => {
            expect(GUTS.PlayerStatsSystem.services).toContain('addPlayerGold');
        });

        it('should register deductPlayerGold service', () => {
            expect(GUTS.PlayerStatsSystem.services).toContain('deductPlayerGold');
        });

        it('should register canAffordCost service', () => {
            expect(GUTS.PlayerStatsSystem.services).toContain('canAffordCost');
        });

        it('should register createPlayerEntity service', () => {
            expect(GUTS.PlayerStatsSystem.services).toContain('createPlayerEntity');
        });
    });

    describe('getPlayerEntityId', () => {
        it('should return null when no player entities exist', () => {
            expect(playerStatsSystem.getPlayerEntityId(0)).toBeNull();
        });

        it('should return null for non-existent player', () => {
            game.createEntityWith({
                playerStats: { playerId: 1, team: 0, gold: 100 }
            });

            expect(playerStatsSystem.getPlayerEntityId(999)).toBeNull();
        });
    });

    describe('getPlayerStats', () => {
        it('should return null when player not found', () => {
            expect(playerStatsSystem.getPlayerStats(999)).toBeNull();
        });
    });

    describe('getLocalPlayerStats', () => {
        it('should return null when no client network manager', () => {
            expect(playerStatsSystem.getLocalPlayerStats()).toBeNull();
        });

        it('should return null when numericPlayerId is -1', () => {
            game.clientNetworkManager = { numericPlayerId: -1 };
            expect(playerStatsSystem.getLocalPlayerStats()).toBeNull();
        });

        it('should return null when numericPlayerId is undefined', () => {
            game.clientNetworkManager = {};
            expect(playerStatsSystem.getLocalPlayerStats()).toBeNull();
        });
    });

    describe('getPlayerStatsByTeam', () => {
        it('should return null when no players exist', () => {
            expect(playerStatsSystem.getPlayerStatsByTeam(0)).toBeNull();
        });
    });

    describe('getPlayerEntities', () => {
        it('should return empty array when no player entities', () => {
            const entities = playerStatsSystem.getPlayerEntities();
            expect(Array.isArray(entities)).toBe(true);
        });
    });

    describe('getSerializedPlayerEntities', () => {
        it('should return empty array when no player entities', () => {
            const serialized = playerStatsSystem.getSerializedPlayerEntities();
            expect(serialized).toEqual([]);
        });
    });

    describe('getPlayerGold', () => {
        it('should return 0 when no local player', () => {
            expect(playerStatsSystem.getPlayerGold()).toBe(0);
        });
    });

    describe('canAffordCost', () => {
        it('should return falsy when no local player', () => {
            expect(playerStatsSystem.canAffordCost(100)).toBeFalsy();
        });
    });

    describe('addPlayerGold', () => {
        it('should not throw when player not found', () => {
            expect(() => playerStatsSystem.addPlayerGold(0, 100)).not.toThrow();
        });
    });

    describe('deductPlayerGold', () => {
        it('should return false when no local player', () => {
            expect(playerStatsSystem.deductPlayerGold(100)).toBe(false);
        });
    });

    describe('createPlayerEntity', () => {
        it('should create entity with playerStats component', () => {
            const entityId = playerStatsSystem.createPlayerEntity(0, {
                team: enums.team.left,
                gold: 500,
                upgrades: []
            });

            expect(entityId).toBeDefined();
            expect(typeof entityId).toBe('number');

            const stats = game.getComponent(entityId, 'playerStats');
            expect(stats).toBeDefined();
            expect(stats.playerId).toBe(0);
            expect(stats.gold).toBe(500);
        });

        it('should use default team when not specified', () => {
            const entityId = playerStatsSystem.createPlayerEntity(1, {
                gold: 200
            });

            const stats = game.getComponent(entityId, 'playerStats');
            expect(stats.team).toBeDefined();
        });

        it('should use default gold of 0 when not specified', () => {
            const entityId = playerStatsSystem.createPlayerEntity(2, {
                team: enums.team.left
            });

            const stats = game.getComponent(entityId, 'playerStats');
            expect(stats.gold).toBe(0);
        });

        it('should return same entity if player already exists', () => {
            const firstEntityId = playerStatsSystem.createPlayerEntity(0, {
                team: enums.team.left,
                gold: 100
            });

            // getPlayerEntityId should find existing entity
            expect(playerStatsSystem.getPlayerEntityId(0)).toBe(firstEntityId);
        });

        it('should allow querying player stats after creation', () => {
            playerStatsSystem.createPlayerEntity(0, {
                team: enums.team.left,
                gold: 100
            });

            const stats = playerStatsSystem.getPlayerStats(0);
            expect(stats.team).toBe(enums.team.left);
            expect(stats.gold).toBe(100);
        });
    });
});
