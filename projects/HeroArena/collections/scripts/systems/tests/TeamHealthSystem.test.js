import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { TestGameContext } from '../../../../../../tests/TestGameContext.js';

describe('TeamHealthSystem', () => {
    let game;
    let teamHealthSystem;
    let enums;

    beforeEach(() => {
        vi.useFakeTimers();
        game = new TestGameContext();

        // Register mock services needed by TeamHealthSystem
        game.register('findSquadByUnitId', () => null);
        game.register('getPlacementsForSide', () => []);
        game.register('getUnitTypeDef', () => null);
        game.register('getCurrentUnitTypeForSquad', () => null);
        game.register('getSquadExperienceData', () => null);

        teamHealthSystem = game.createSystem(GUTS.TeamHealthSystem);
        enums = game.getEnums();
    });

    afterEach(() => {
        vi.runOnlyPendingTimers();
        vi.useRealTimers();
    });

    describe('initialization', () => {
        it('should initialize team health to max', () => {
            expect(teamHealthSystem.teamHealth[enums.team.left]).toBe(teamHealthSystem.MAX_TEAM_HEALTH);
            expect(teamHealthSystem.teamHealth[enums.team.right]).toBe(teamHealthSystem.MAX_TEAM_HEALTH);
        });

        it('should have MAX_TEAM_HEALTH of 2500', () => {
            expect(teamHealthSystem.MAX_TEAM_HEALTH).toBe(2500);
        });

        it('should start with roundProcessed false', () => {
            expect(teamHealthSystem.roundProcessed).toBe(false);
        });
    });

    describe('getOpponentTeam', () => {
        it('should return right when myTeam is left', () => {
            game.register('getActivePlayerTeam', () => enums.team.left);
            expect(teamHealthSystem.getOpponentTeam()).toBe(enums.team.right);
        });

        it('should return left when myTeam is right', () => {
            game.register('getActivePlayerTeam', () => enums.team.right);
            expect(teamHealthSystem.getOpponentTeam()).toBe(enums.team.left);
        });
    });

    describe('getTeamHealth', () => {
        it('should return current health for left team', () => {
            expect(teamHealthSystem.getTeamHealth(enums.team.left)).toBe(2500);
        });

        it('should return current health for right team', () => {
            expect(teamHealthSystem.getTeamHealth(enums.team.right)).toBe(2500);
        });

        it('should return 0 for uninitialized team', () => {
            expect(teamHealthSystem.getTeamHealth(999)).toBe(0);
        });
    });

    describe('getHealthPercentage', () => {
        it('should return 100 for full health', () => {
            expect(teamHealthSystem.getHealthPercentage(enums.team.left)).toBe(100);
        });

        it('should return 50 for half health', () => {
            teamHealthSystem.teamHealth[enums.team.left] = 1250;
            expect(teamHealthSystem.getHealthPercentage(enums.team.left)).toBe(50);
        });

        it('should return 0 for no health', () => {
            teamHealthSystem.teamHealth[enums.team.left] = 0;
            expect(teamHealthSystem.getHealthPercentage(enums.team.left)).toBe(0);
        });
    });

    describe('dealDamageToTeam', () => {
        it('should reduce team health by damage amount', () => {
            teamHealthSystem.dealDamageToTeam(enums.team.left, 500);
            expect(teamHealthSystem.teamHealth[enums.team.left]).toBe(2000);
        });

        it('should not reduce health below 0', () => {
            teamHealthSystem.dealDamageToTeam(enums.team.left, 5000);
            expect(teamHealthSystem.teamHealth[enums.team.left]).toBe(0);
        });

        it('should handle multiple damage instances', () => {
            teamHealthSystem.dealDamageToTeam(enums.team.left, 500);
            teamHealthSystem.dealDamageToTeam(enums.team.left, 300);
            expect(teamHealthSystem.teamHealth[enums.team.left]).toBe(1700);
        });
    });

    describe('onBattleStart', () => {
        it('should reset roundProcessed to false', () => {
            teamHealthSystem.roundProcessed = true;
            teamHealthSystem.onBattleStart();
            expect(teamHealthSystem.roundProcessed).toBe(false);
        });
    });

    describe('applyRoundDraw', () => {
        it('should return draw result object', () => {
            const result = teamHealthSystem.applyRoundDraw();

            expect(result.result).toBe('draw');
            expect(result.winningTeam).toBeNull();
            expect(result.losingTeam).toBeNull();
            expect(result.damage).toBe(0);
            expect(result.gameOver).toBe(false);
        });

        it('should include remaining health for both teams', () => {
            const result = teamHealthSystem.applyRoundDraw();

            expect(result.remainingHealth[enums.team.left]).toBe(2500);
            expect(result.remainingHealth[enums.team.right]).toBe(2500);
        });

        it('should set roundProcessed to true', () => {
            teamHealthSystem.applyRoundDraw();
            expect(teamHealthSystem.roundProcessed).toBe(true);
        });

        it('should return null if already processed', () => {
            teamHealthSystem.roundProcessed = true;
            const result = teamHealthSystem.applyRoundDraw();
            expect(result).toBeNull();
        });
    });

    describe('calculateSquadBasedDamage', () => {
        it('should return 0 damage for null surviving units', () => {
            const result = teamHealthSystem.calculateSquadBasedDamage(null);

            expect(result.totalDamage).toBe(0);
            expect(result.survivingSquads).toBe(0);
            expect(result.squadDetails).toEqual([]);
        });

        it('should return 0 damage for empty surviving units', () => {
            const result = teamHealthSystem.calculateSquadBasedDamage([]);

            expect(result.totalDamage).toBe(0);
            expect(result.survivingSquads).toBe(0);
        });

        it('should calculate damage for units with squad data', () => {
            // Set up a mock unit that belongs to a squad
            const unitId = game.createEntity();
            game.register('findSquadByUnitId', (id) => {
                if (id === unitId) {
                    return { placementId: 'squad1', squadValue: 100 };
                }
                return null;
            });
            game.register('getCurrentUnitTypeForSquad', (placementId) => {
                if (placementId === 'squad1') {
                    return { value: 100, title: 'Test Squad', id: 'test' };
                }
                return null;
            });
            game.register('getSquadExperienceData', (placementId) => {
                if (placementId === 'squad1') {
                    return { totalUnitsInSquad: 4, squadSize: 4 };
                }
                return null;
            });

            const result = teamHealthSystem.calculateSquadBasedDamage([unitId]);

            expect(result.totalDamage).toBe(100);
            expect(result.survivingSquads).toBe(1);
        });
    });

    describe('applyRoundDamage', () => {
        it('should apply damage to losing team', () => {
            game.register('getActivePlayerTeam', () => enums.team.left);

            // Set up mock for squad-based damage
            const unitId = game.createEntity();
            game.register('findSquadByUnitId', (id) => {
                if (id === unitId) {
                    return { placementId: 'squad1', squadValue: 150 };
                }
                return null;
            });
            game.register('getCurrentUnitTypeForSquad', () => ({ value: 150, title: 'Winner Squad', id: 'winner' }));
            game.register('getSquadExperienceData', () => ({ totalUnitsInSquad: 3 }));

            const result = teamHealthSystem.applyRoundDamage(enums.team.left, [unitId]);

            expect(result.winningTeam).toBe(enums.team.left);
            expect(result.losingTeam).toBe(enums.team.right);
            expect(result.damage).toBe(150);
            expect(teamHealthSystem.teamHealth[enums.team.right]).toBe(2350);
        });

        it('should return victory result for player win', () => {
            game.register('getActivePlayerTeam', () => enums.team.left);
            const result = teamHealthSystem.applyRoundDamage(enums.team.left, []);

            expect(result.result).toBe('victory');
        });

        it('should return defeat result for player loss', () => {
            game.register('getActivePlayerTeam', () => enums.team.left);
            const result = teamHealthSystem.applyRoundDamage(enums.team.right, []);

            expect(result.result).toBe('defeat');
        });

        it('should indicate game over when health reaches 0', () => {
            game.register('getActivePlayerTeam', () => enums.team.left);
            teamHealthSystem.teamHealth[enums.team.right] = 50;

            // Set up high damage
            const unitId = game.createEntity();
            game.register('findSquadByUnitId', (id) => ({ placementId: 'squad1', squadValue: 100 }));
            game.register('getCurrentUnitTypeForSquad', () => ({ value: 100, title: 'Squad', id: 's' }));
            game.register('getSquadExperienceData', () => ({ totalUnitsInSquad: 1 }));

            const result = teamHealthSystem.applyRoundDamage(enums.team.left, [unitId]);

            expect(result.gameOver).toBe(true);
            expect(teamHealthSystem.teamHealth[enums.team.right]).toBe(0);
        });
    });

    describe('resetTeamHealth', () => {
        it('should restore both teams to max health', () => {
            teamHealthSystem.teamHealth[enums.team.left] = 500;
            teamHealthSystem.teamHealth[enums.team.right] = 1000;
            teamHealthSystem.roundProcessed = true;

            // Stub updateHealthDisplay to avoid DOM access
            teamHealthSystem.updateHealthDisplay = () => {};
            teamHealthSystem.resetTeamHealth();

            expect(teamHealthSystem.teamHealth[enums.team.left]).toBe(2500);
            expect(teamHealthSystem.teamHealth[enums.team.right]).toBe(2500);
            expect(teamHealthSystem.roundProcessed).toBe(false);
        });
    });

    describe('getHealthStatus', () => {
        it('should return status for both teams', () => {
            teamHealthSystem.teamHealth[enums.team.left] = 1250;
            teamHealthSystem.teamHealth[enums.team.right] = 2000;

            const status = teamHealthSystem.getHealthStatus();

            expect(status[enums.team.left].current).toBe(1250);
            expect(status[enums.team.left].max).toBe(2500);
            expect(status[enums.team.left].percentage).toBe(50);

            expect(status[enums.team.right].current).toBe(2000);
            expect(status[enums.team.right].max).toBe(2500);
            expect(status[enums.team.right].percentage).toBe(80);
        });
    });

    describe('getLeftHealth/getRightHealth', () => {
        it('should return left team health', () => {
            teamHealthSystem.teamHealth[enums.team.left] = 1500;
            expect(teamHealthSystem.getLeftHealth()).toBe(1500);
        });

        it('should return right team health', () => {
            teamHealthSystem.teamHealth[enums.team.right] = 1800;
            expect(teamHealthSystem.getRightHealth()).toBe(1800);
        });
    });

    describe('setLeftHealth/setRightHealth', () => {
        beforeEach(() => {
            // Stub updateHealthDisplay to avoid DOM access
            teamHealthSystem.updateHealthDisplay = () => {};
        });

        it('should set left health', () => {
            teamHealthSystem.setLeftHealth(1000);
            expect(teamHealthSystem.teamHealth[enums.team.left]).toBe(1000);
        });

        it('should set right health', () => {
            teamHealthSystem.setRightHealth(1200);
            expect(teamHealthSystem.teamHealth[enums.team.right]).toBe(1200);
        });

        it('should clamp health to max', () => {
            teamHealthSystem.setLeftHealth(5000);
            expect(teamHealthSystem.teamHealth[enums.team.left]).toBe(2500);
        });

        it('should clamp health to 0', () => {
            teamHealthSystem.setLeftHealth(-100);
            expect(teamHealthSystem.teamHealth[enums.team.left]).toBe(0);
        });
    });

    describe('syncHealthFromServer', () => {
        beforeEach(() => {
            // Stub updateHealthDisplay to avoid DOM access
            teamHealthSystem.updateHealthDisplay = () => {};
        });

        it('should sync both team healths', () => {
            teamHealthSystem.syncHealthFromServer(1500, 1800);

            expect(teamHealthSystem.teamHealth[enums.team.left]).toBe(1500);
            expect(teamHealthSystem.teamHealth[enums.team.right]).toBe(1800);
        });

        it('should clamp values to valid range', () => {
            teamHealthSystem.syncHealthFromServer(-100, 5000);

            expect(teamHealthSystem.teamHealth[enums.team.left]).toBe(0);
            expect(teamHealthSystem.teamHealth[enums.team.right]).toBe(2500);
        });
    });

    describe('isGameOver', () => {
        it('should return false when both teams have health', () => {
            expect(teamHealthSystem.isGameOver()).toBe(false);
        });

        it('should return true when left team eliminated', () => {
            teamHealthSystem.teamHealth[enums.team.left] = 0;
            expect(teamHealthSystem.isGameOver()).toBe(true);
        });

        it('should return true when right team eliminated', () => {
            teamHealthSystem.teamHealth[enums.team.right] = 0;
            expect(teamHealthSystem.isGameOver()).toBe(true);
        });
    });

    describe('getWinningTeam', () => {
        it('should return null when game not over', () => {
            expect(teamHealthSystem.getWinningTeam()).toBeNull();
        });

        it('should return right when left eliminated', () => {
            teamHealthSystem.teamHealth[enums.team.left] = 0;
            expect(teamHealthSystem.getWinningTeam()).toBe(enums.team.right);
        });

        it('should return left when right eliminated', () => {
            teamHealthSystem.teamHealth[enums.team.right] = 0;
            expect(teamHealthSystem.getWinningTeam()).toBe(enums.team.left);
        });
    });

    describe('findSquadForUnit', () => {
        it('should return null for unit without squad', () => {
            const unitId = game.createEntity();
            const result = teamHealthSystem.findSquadForUnit(unitId);
            expect(result).toBeNull();
        });

        it('should return squad info from experience system', () => {
            const unitId = game.createEntity();
            game.register('findSquadByUnitId', (id) => {
                if (id === unitId) {
                    return { placementId: 'squad123', squadValue: 75 };
                }
                return null;
            });
            game.register('getCurrentUnitTypeForSquad', (placementId) => {
                if (placementId === 'squad123') {
                    return { value: 75, title: 'Archers', id: 'archer' };
                }
                return null;
            });

            const result = teamHealthSystem.findSquadForUnit(unitId);

            expect(result).not.toBeNull();
            expect(result.placementId).toBe('squad123');
            expect(result.unitType.value).toBe(75);
        });
    });

    describe('getOriginalSquadSize', () => {
        it('should return squad size from experience system', () => {
            game.register('getSquadExperienceData', (placementId) => {
                if (placementId === 'squad1') {
                    return { totalUnitsInSquad: 6, squadSize: 6 };
                }
                return null;
            });

            const size = teamHealthSystem.getOriginalSquadSize('squad1');
            expect(size).toBe(6);
        });

        it('should return 1 for unknown squad', () => {
            const size = teamHealthSystem.getOriginalSquadSize('unknown');
            expect(size).toBe(1);
        });
    });
});
