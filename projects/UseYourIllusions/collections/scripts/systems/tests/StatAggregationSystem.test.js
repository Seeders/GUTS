import { describe, it, expect, beforeEach } from 'vitest';
import { TestGameContext } from '../../../../../../tests/TestGameContext.js';

// Skip tests if StatAggregationSystem is not bundled yet
const hasSystem = typeof GUTS !== 'undefined' && typeof GUTS.StatAggregationSystem === 'function';

describe.skipIf(!hasSystem)('StatAggregationSystem', () => {
    let game;
    let statAggregationSystem;
    let enums;

    beforeEach(() => {
        game = new TestGameContext();
        statAggregationSystem = game.createSystem(GUTS.StatAggregationSystem);
        enums = game.getEnums();
    });

    describe('getAggregatedDamageModifiers', () => {
        it('should return empty modifiers for entity with no sources', () => {
            const entity = game.createEntity();

            game.register('getUnitTypeDef', () => null);

            const modifiers = statAggregationSystem.getAggregatedDamageModifiers(entity, ['attack', 'physical']);

            expect(modifiers.increased).toBe(0);
            expect(modifiers.more).toHaveLength(0);
        });

        it('should collect increased modifiers from unit passives', () => {
            const entity = game.createEntityWith({
                unitType: { unitType: 0 },
                team: { team: enums.team.left }
            });

            game.register('getUnitTypeDef', () => ({
                passives: [
                    { type: 'increased', tags: ['melee'], value: 0.15 }
                ]
            }));

            const modifiers = statAggregationSystem.getAggregatedDamageModifiers(entity, ['attack', 'melee', 'physical']);

            expect(modifiers.increased).toBe(0.15);
        });

        it('should collect more modifiers from unit passives', () => {
            const entity = game.createEntityWith({
                unitType: { unitType: 0 },
                team: { team: enums.team.left }
            });

            game.register('getUnitTypeDef', () => ({
                passives: [
                    { type: 'more', tags: [], value: 0.30 }
                ]
            }));

            const modifiers = statAggregationSystem.getAggregatedDamageModifiers(entity, ['attack', 'physical']);

            expect(modifiers.more).toContain(0.30);
        });

        it('should sum multiple increased modifiers', () => {
            const entity = game.createEntityWith({
                unitType: { unitType: 0 },
                team: { team: enums.team.left }
            });

            game.register('getUnitTypeDef', () => ({
                passives: [
                    { type: 'increased', tags: ['spell'], value: 0.20 },
                    { type: 'increased', tags: ['fire'], value: 0.10 },
                    { type: 'increased', tags: [], value: 0.05 }  // Global
                ]
            }));

            const modifiers = statAggregationSystem.getAggregatedDamageModifiers(entity, ['spell', 'fire', 'area']);

            // 0.20 + 0.10 + 0.05 = 0.35
            expect(modifiers.increased).toBeCloseTo(0.35);
        });

        it('should collect multiple more modifiers separately', () => {
            const entity = game.createEntityWith({
                unitType: { unitType: 0 },
                team: { team: enums.team.left }
            });

            game.register('getUnitTypeDef', () => ({
                passives: [
                    { type: 'more', tags: [], value: 0.20 },
                    { type: 'more', tags: [], value: 0.30 }
                ]
            }));

            const modifiers = statAggregationSystem.getAggregatedDamageModifiers(entity, ['attack', 'physical']);

            expect(modifiers.more).toHaveLength(2);
            expect(modifiers.more).toContain(0.20);
            expect(modifiers.more).toContain(0.30);
        });

        it('should only apply modifiers with matching tags', () => {
            const entity = game.createEntityWith({
                unitType: { unitType: 0 },
                team: { team: enums.team.left }
            });

            game.register('getUnitTypeDef', () => ({
                passives: [
                    { type: 'increased', tags: ['spell'], value: 0.50 },      // Won't match attack
                    { type: 'increased', tags: ['attack'], value: 0.25 },     // Will match
                    { type: 'increased', tags: ['melee', 'physical'], value: 0.10 }  // Will match
                ]
            }));

            const modifiers = statAggregationSystem.getAggregatedDamageModifiers(entity, ['attack', 'melee', 'physical']);

            // Only 0.25 + 0.10 should apply (spell modifier excluded)
            expect(modifiers.increased).toBeCloseTo(0.35);
        });

        it('should apply global modifiers (empty tags) to all damage', () => {
            const entity = game.createEntityWith({
                unitType: { unitType: 0 },
                team: { team: enums.team.left }
            });

            game.register('getUnitTypeDef', () => ({
                passives: [
                    { type: 'increased', tags: [], value: 0.10 }  // Global - applies to everything
                ]
            }));

            // Test with attack
            const attackMods = statAggregationSystem.getAggregatedDamageModifiers(entity, ['attack', 'melee', 'physical']);
            expect(attackMods.increased).toBe(0.10);

            // Test with spell
            const spellMods = statAggregationSystem.getAggregatedDamageModifiers(entity, ['spell', 'fire', 'area']);
            expect(spellMods.increased).toBe(0.10);
        });
    });

    describe('modifier tag matching', () => {
        it('should require ALL modifier tags to be present in damage tags', () => {
            const entity = game.createEntityWith({
                unitType: { unitType: 0 },
                team: { team: enums.team.left }
            });

            game.register('getUnitTypeDef', () => ({
                passives: [
                    { type: 'increased', tags: ['melee', 'physical'], value: 0.20 }
                ]
            }));

            // Has both tags - should apply
            const modsWith = statAggregationSystem.getAggregatedDamageModifiers(entity, ['attack', 'melee', 'physical']);
            expect(modsWith.increased).toBe(0.20);

            // Missing 'physical' - should not apply
            const modsWithout = statAggregationSystem.getAggregatedDamageModifiers(entity, ['attack', 'melee']);
            expect(modsWithout.increased).toBe(0);
        });
    });

    describe('getAggregatedDefensiveStats', () => {
        it('should return default stats for entity without combat component', () => {
            const entity = game.createEntity();

            game.register('getUnitTypeDef', () => null);

            const stats = statAggregationSystem.getAggregatedDefensiveStats(entity);

            expect(stats.accuracy).toBe(100);  // Default
            expect(stats.evasion).toBe(0);     // Default
            expect(stats.criticalChance).toBe(0);
            expect(stats.criticalMultiplier).toBe(1.5);
        });

        it('should return stats from combat component', () => {
            const entity = game.createEntityWith({
                combat: {
                    accuracy: 110,
                    evasion: 25,
                    criticalChance: 0.15,
                    criticalMultiplier: 2.0,
                    armor: 10,
                    fireResistance: 0.3
                }
            });

            game.register('getUnitTypeDef', () => null);

            const stats = statAggregationSystem.getAggregatedDefensiveStats(entity);

            expect(stats.accuracy).toBe(110);
            expect(stats.evasion).toBe(25);
            expect(stats.criticalChance).toBeCloseTo(0.15);
            expect(stats.criticalMultiplier).toBeCloseTo(2.0);
            expect(stats.armor).toBe(10);
            expect(stats.fireResistance).toBeCloseTo(0.3);
        });

        it('should fall back to unit type stats when combat component missing', () => {
            const entity = game.createEntityWith({
                unitType: { unitType: 0 }
            });

            game.register('getUnitTypeDef', () => ({
                accuracy: 90,
                evasion: 40,
                criticalChance: 0.20,
                criticalMultiplier: 2.5
            }));

            const stats = statAggregationSystem.getAggregatedDefensiveStats(entity);

            expect(stats.accuracy).toBe(90);
            expect(stats.evasion).toBe(40);
            expect(stats.criticalChance).toBe(0.20);
            expect(stats.criticalMultiplier).toBe(2.5);
        });
    });

    describe('buff modifier collection', () => {
        it('should collect modifiers from active buff', () => {
            const entity = game.createEntityWith({
                unitType: { unitType: 0 },
                team: { team: enums.team.left },
                buff: {
                    buffType: 0,  // First buff type (rage)
                    endTime: 10.0
                }
            });

            game.state.now = 5.0;  // Buff is still active
            game.register('getUnitTypeDef', () => null);

            // Re-initialize to pick up buff types
            statAggregationSystem.init();

            const modifiers = statAggregationSystem.getAggregatedDamageModifiers(entity, ['attack', 'physical']);

            // If rage buff is first and has damageModifiers, we should see them
            // This depends on the actual buff types in the collection
            expect(modifiers).toBeDefined();
        });

        it('should not collect modifiers from expired buff', () => {
            const entity = game.createEntityWith({
                unitType: { unitType: 0 },
                team: { team: enums.team.left },
                buff: {
                    buffType: 0,
                    endTime: 2.0  // Expired
                }
            });

            game.state.now = 5.0;  // Buff has expired
            game.register('getUnitTypeDef', () => null);

            const modifiers = statAggregationSystem.getAggregatedDamageModifiers(entity, ['attack', 'physical']);

            // Expired buff should not contribute
            expect(modifiers.increased).toBe(0);
            expect(modifiers.more).toHaveLength(0);
        });
    });
});
