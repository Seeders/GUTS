import { describe, it, expect, beforeEach } from 'vitest';
import { TestGameContext } from '../../../../../../tests/TestGameContext.js';

describe('SquadExperienceSystem', () => {
    let game;
    let squadExperienceSystem;
    let enums;

    beforeEach(() => {
        game = new TestGameContext();

        // Register mock services needed by SquadExperienceSystem
        game.register('getPlacementById', () => null);
        game.register('getPlacementsForSide', () => []);
        game.register('getOpponentPlacements', () => []);
        game.register('getUnitTypeDef', () => null);
        game.register('updateSquadExperience', () => {});
        game.register('deductPlayerGold', () => {});
        game.register('createParticleEffect', () => {});
        game.register('getTerrainHeight', () => 0);
        game.register('createPlacement', () => 1);

        squadExperienceSystem = game.createSystem(GUTS.SquadExperienceSystem);
        enums = game.getEnums();
    });

    describe('initialization', () => {
        it('should have default configuration values', () => {
            expect(squadExperienceSystem.config.experiencePerLevel).toBe(10);
            expect(squadExperienceSystem.config.maxLevel).toBe(10);
            expect(squadExperienceSystem.config.levelUpCostRatio).toBe(0.5);
            expect(squadExperienceSystem.config.experienceMultiplier).toBe(1.0);
        });

        it('should have level bonuses for all levels', () => {
            for (let level = 1; level <= 10; level++) {
                expect(squadExperienceSystem.levelBonuses[level]).toBeDefined();
                expect(squadExperienceSystem.levelBonuses[level].hp).toBeDefined();
                expect(squadExperienceSystem.levelBonuses[level].damage).toBeDefined();
                expect(squadExperienceSystem.levelBonuses[level].name).toBeDefined();
            }
        });

        it('should have increasing bonuses per level', () => {
            for (let level = 2; level <= 10; level++) {
                const prevBonus = squadExperienceSystem.levelBonuses[level - 1];
                const currBonus = squadExperienceSystem.levelBonuses[level];
                expect(currBonus.hp).toBeGreaterThanOrEqual(prevBonus.hp);
                expect(currBonus.damage).toBeGreaterThanOrEqual(prevBonus.damage);
            }
        });
    });

    describe('calculateExperienceNeeded', () => {
        it('should calculate experience for level 0 (first level up)', () => {
            const exp = squadExperienceSystem.calculateExperienceNeeded(0);
            expect(exp).toBe(10); // 10 * 1.5^0 = 10
        });

        it('should increase exponentially', () => {
            const level0 = squadExperienceSystem.calculateExperienceNeeded(0);
            const level1 = squadExperienceSystem.calculateExperienceNeeded(1);
            const level2 = squadExperienceSystem.calculateExperienceNeeded(2);

            expect(level1).toBeGreaterThan(level0);
            expect(level2).toBeGreaterThan(level1);
            // Each level is 1.5x the previous
            expect(level1).toBe(Math.floor(10 * 1.5));
            expect(level2).toBe(Math.floor(10 * 1.5 * 1.5));
        });
    });

    describe('calculateSquadValue', () => {
        it('should return unit value', () => {
            const unitType = { value: 100 };
            expect(squadExperienceSystem.calculateSquadValue(unitType)).toBe(100);
        });

        it('should return 0 for missing value', () => {
            const unitType = {};
            expect(squadExperienceSystem.calculateSquadValue(unitType)).toBe(0);
        });
    });

    describe('getLevelUpCostBySquadValue', () => {
        it('should calculate cost based on squad value and ratio', () => {
            const cost = squadExperienceSystem.getLevelUpCostBySquadValue(100);
            expect(cost).toBe(50); // 100 * 0.5
        });

        it('should floor the result', () => {
            const cost = squadExperienceSystem.getLevelUpCostBySquadValue(75);
            expect(cost).toBe(37); // floor(75 * 0.5) = 37
        });
    });

    describe('getLevelUpCost', () => {
        it('should return -1 for non-existent squad', () => {
            expect(squadExperienceSystem.getLevelUpCost('nonexistent')).toBe(-1);
        });
    });

    describe('canAffordLevelUp', () => {
        it('should return false for non-existent squad', () => {
            expect(squadExperienceSystem.canAffordLevelUp('nonexistent', 1000)).toBe(false);
        });
    });

    describe('getLevelBonusName', () => {
        it('should return correct names for each level', () => {
            expect(squadExperienceSystem.getLevelBonusName(1)).toBe('Rookie');
            expect(squadExperienceSystem.getLevelBonusName(2)).toBe('Veteran');
            expect(squadExperienceSystem.getLevelBonusName(3)).toBe('Ascended');
            expect(squadExperienceSystem.getLevelBonusName(5)).toBe('Champion');
            expect(squadExperienceSystem.getLevelBonusName(10)).toBe('Godlike');
        });

        it('should return empty string for invalid level', () => {
            expect(squadExperienceSystem.getLevelBonusName(0)).toBe('');
            expect(squadExperienceSystem.getLevelBonusName(11)).toBe('');
        });
    });

    describe('getSquadUnits', () => {
        it('should return empty array when placement not found', () => {
            expect(squadExperienceSystem.getSquadUnits('unknown')).toEqual([]);
        });

        it('should return squad units from placement', () => {
            const mockUnits = [1, 2, 3];
            game.register('getPlacementById', (id) => {
                if (id === 'squad1') return { squadUnits: mockUnits };
                return null;
            });

            expect(squadExperienceSystem.getSquadUnits('squad1')).toEqual(mockUnits);
        });
    });

    describe('getSquadExperience', () => {
        it('should return null for squad without units', () => {
            expect(squadExperienceSystem.getSquadExperience('unknown')).toBeNull();
        });

        it('should return experience from first unit', () => {
            const unitId = game.createEntityWith({
                experience: { level: 3, experience: 50 }
            });

            game.register('getPlacementById', (id) => {
                if (id === 'squad1') return { squadUnits: [unitId] };
                return null;
            });

            const exp = squadExperienceSystem.getSquadExperience('squad1');
            expect(exp.level).toBe(3);
            expect(exp.experience).toBe(50);
        });
    });

    describe('setSquadExperience', () => {
        it('should return false for squad without units', () => {
            expect(squadExperienceSystem.setSquadExperience('unknown', {})).toBe(false);
        });

        it('should update experience on all units', () => {
            const unitId1 = game.createEntityWith({
                experience: { level: 1, experience: 0 }
            });
            const unitId2 = game.createEntityWith({
                experience: { level: 1, experience: 0 }
            });

            game.register('getPlacementById', (id) => {
                if (id === 'squad1') return { squadUnits: [unitId1, unitId2] };
                return null;
            });

            const result = squadExperienceSystem.setSquadExperience('squad1', { level: 5, experience: 100 });

            expect(result).toBe(true);
            expect(game.getComponent(unitId1, 'experience').level).toBe(5);
            expect(game.getComponent(unitId2, 'experience').level).toBe(5);
        });
    });

    describe('initializeSquad', () => {
        it('should initialize squad experience data', () => {
            const unitId = game.createEntityWith({
                experience: {}
            });

            game.register('getPlacementById', (id) => {
                if (id === 'squad1') return { squadUnits: [unitId] };
                return null;
            });

            const unitType = { value: 100 };
            const result = squadExperienceSystem.initializeSquad('squad1', unitType, [unitId]);

            expect(result.level).toBe(1);
            expect(result.experience).toBe(0);
            expect(result.squadValue).toBe(100);
            expect(result.canLevelUp).toBe(false);
            expect(result.totalUnitsInSquad).toBe(1);
        });

        it('should not reinitialize already initialized squad', () => {
            const unitId = game.createEntityWith({
                experience: { level: 3, squadValue: 200 }
            });

            game.register('getPlacementById', (id) => {
                if (id === 'squad1') return { squadUnits: [unitId] };
                return null;
            });

            const unitType = { value: 100 };
            const result = squadExperienceSystem.initializeSquad('squad1', unitType, [unitId]);

            // Should return existing data, not reinitialize
            expect(result.level).toBe(3);
            expect(result.squadValue).toBe(200);
        });
    });

    describe('addExperience', () => {
        it('should add experience to squad', () => {
            const unitId = game.createEntityWith({
                experience: {
                    level: 1,
                    experience: 0,
                    experienceToNextLevel: 100,
                    canLevelUp: false
                }
            });

            game.register('getPlacementById', (id) => {
                if (id === 'squad1') return { squadUnits: [unitId] };
                return null;
            });

            game.state.now = 1000;
            squadExperienceSystem.addExperience('squad1', 50);

            const exp = game.getComponent(unitId, 'experience');
            expect(exp.experience).toBe(50);
        });

        it('should set canLevelUp when threshold reached', () => {
            const unitId = game.createEntityWith({
                experience: {
                    level: 1,
                    experience: 90,
                    experienceToNextLevel: 100,
                    canLevelUp: false
                }
            });

            game.register('getPlacementById', (id) => {
                if (id === 'squad1') return { squadUnits: [unitId] };
                return null;
            });

            game.state.now = 1000;
            squadExperienceSystem.addExperience('squad1', 20);

            const exp = game.getComponent(unitId, 'experience');
            expect(exp.canLevelUp).toBe(true);
            expect(exp.experience).toBe(100); // Capped at threshold
        });

        it('should not add experience when at max level', () => {
            const unitId = game.createEntityWith({
                experience: {
                    level: 10,
                    experience: 0,
                    experienceToNextLevel: 100,
                    canLevelUp: false
                }
            });

            game.register('getPlacementById', (id) => {
                if (id === 'squad1') return { squadUnits: [unitId] };
                return null;
            });

            game.state.now = 1000;
            squadExperienceSystem.addExperience('squad1', 50);

            const exp = game.getComponent(unitId, 'experience');
            expect(exp.experience).toBe(0);
        });

        it('should not add experience when canLevelUp is true', () => {
            const unitId = game.createEntityWith({
                experience: {
                    level: 2,
                    experience: 100,
                    experienceToNextLevel: 100,
                    canLevelUp: true
                }
            });

            game.register('getPlacementById', (id) => {
                if (id === 'squad1') return { squadUnits: [unitId] };
                return null;
            });

            game.state.now = 1000;
            squadExperienceSystem.addExperience('squad1', 50);

            const exp = game.getComponent(unitId, 'experience');
            expect(exp.experience).toBe(100); // Unchanged
        });
    });

    describe('findSquadByUnitId', () => {
        it('should return null for unit not in any squad', () => {
            expect(squadExperienceSystem.findSquadByUnitId(999)).toBeNull();
        });
    });

    describe('unitsAliveInSquad', () => {
        it('should count units with positive health', () => {
            const unitId1 = game.createEntityWith({ health: { current: 100, max: 100 } });
            const unitId2 = game.createEntityWith({ health: { current: 50, max: 100 } });
            const unitId3 = game.createEntityWith({ health: { current: 0, max: 100 } });

            game.register('getPlacementById', (id) => {
                if (id === 'squad1') return { squadUnits: [unitId1, unitId2, unitId3] };
                return null;
            });

            const alive = squadExperienceSystem.unitsAliveInSquad('squad1');
            expect(alive).toBe(2);
        });

        it('should return 0 for empty squad', () => {
            game.register('getPlacementById', () => ({ squadUnits: [] }));
            expect(squadExperienceSystem.unitsAliveInSquad('squad1')).toBe(0);
        });
    });

    describe('calculateSquadTotalHealth', () => {
        it('should sum health of all units', () => {
            const unitId1 = game.createEntityWith({ health: { max: 100 } });
            const unitId2 = game.createEntityWith({ health: { max: 150 } });

            game.register('getPlacementById', (id) => {
                if (id === 'squad1') return { squadUnits: [unitId1, unitId2] };
                return null;
            });

            const totalHealth = squadExperienceSystem.calculateSquadTotalHealth('squad1');
            expect(totalHealth).toBe(250);
        });

        it('should return 100 for empty squad', () => {
            game.register('getPlacementById', () => ({ squadUnits: [] }));
            expect(squadExperienceSystem.calculateSquadTotalHealth('squad1')).toBe(100);
        });
    });

    describe('getAllSquadsWithExperience', () => {
        it('should return empty array when no squads', () => {
            expect(squadExperienceSystem.getAllSquadsWithExperience()).toEqual([]);
        });
    });

    describe('getSquadsReadyToLevelUp', () => {
        it('should return empty array when no squads ready', () => {
            expect(squadExperienceSystem.getSquadsReadyToLevelUp()).toEqual([]);
        });
    });

    describe('getSquadInfo', () => {
        it('should return squad experience data', () => {
            const unitId = game.createEntityWith({
                experience: { level: 5, experience: 75 }
            });

            game.register('getPlacementById', (id) => {
                if (id === 'squad1') return { squadUnits: [unitId] };
                return null;
            });

            const info = squadExperienceSystem.getSquadInfo('squad1');
            expect(info.level).toBe(5);
            expect(info.experience).toBe(75);
        });
    });

    describe('setSquadInfo', () => {
        it('should set squad experience and apply bonuses', () => {
            const unitId = game.createEntityWith({
                experience: { level: 1 },
                health: { current: 100, max: 100 },
                combat: { damage: 10 },
                unitType: { id: 'soldier' }
            });

            game.register('getPlacementById', (id) => {
                if (id === 'squad1') return { squadUnits: [unitId] };
                return null;
            });
            game.register('getUnitTypeDef', () => ({ hp: 100, damage: 10 }));

            squadExperienceSystem.setSquadInfo('squad1', { level: 3 });

            const exp = game.getComponent(unitId, 'experience');
            expect(exp.level).toBe(3);
        });

        it('should not throw for null experience', () => {
            expect(() => squadExperienceSystem.setSquadInfo('squad1', null)).not.toThrow();
        });
    });

    describe('removeSquad', () => {
        it('should not throw', () => {
            expect(() => squadExperienceSystem.removeSquad('squad1')).not.toThrow();
        });
    });

    describe('reset', () => {
        it('should not throw when no squads exist', () => {
            expect(() => squadExperienceSystem.reset()).not.toThrow();
        });
    });

    describe('resetSquadExperience alias', () => {
        it('should call reset', () => {
            // Just verify the alias works
            expect(() => squadExperienceSystem.resetSquadExperience()).not.toThrow();
        });
    });

    describe('getDebugInfo', () => {
        it('should return debug information', () => {
            const info = squadExperienceSystem.getDebugInfo();

            expect(info.totalSquads).toBe(0);
            expect(info.leftSquads).toBe(0);
            expect(info.rightSquads).toBe(0);
            expect(info.squadsReadyToLevelUp).toBe(0);
            expect(info.averageLevel).toBe(0);
            expect(info.maxLevel).toBe(0);
        });
    });

    describe('static services', () => {
        it('should register all expected services', () => {
            const services = GUTS.SquadExperienceSystem.services;
            expect(services).toContain('canAffordLevelUp');
            expect(services).toContain('applySpecialization');
            expect(services).toContain('getLevelUpCost');
            expect(services).toContain('initializeSquad');
            expect(services).toContain('removeSquad');
            expect(services).toContain('getSquadsReadyToLevelUp');
            expect(services).toContain('findSquadByUnitId');
            expect(services).toContain('getCurrentUnitType');
            expect(services).toContain('getSquadInfo');
            expect(services).toContain('setSquadInfo');
            expect(services).toContain('resetSquadExperience');
        });
    });
});
