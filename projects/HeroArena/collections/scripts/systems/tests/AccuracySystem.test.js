import { describe, it, expect, beforeEach } from 'vitest';
import { TestGameContext } from '../../../../../../tests/TestGameContext.js';

// Skip tests if AccuracySystem is not bundled yet
const hasSystem = typeof GUTS !== 'undefined' && typeof GUTS.AccuracySystem === 'function';

describe.skipIf(!hasSystem)('AccuracySystem', () => {
    let game;
    let accuracySystem;
    let enums;

    beforeEach(() => {
        game = new TestGameContext();
        // Mock stat aggregation service
        game.register('getAggregatedDefensiveStats', (entityId) => ({
            accuracy: 100,
            evasion: 0,
            criticalChance: 0,
            criticalMultiplier: 1.5
        }));
        accuracySystem = game.createSystem(GUTS.AccuracySystem);
        enums = game.getEnums();
    });

    describe('calculateHitChance', () => {
        it('should return MAX_HIT_CHANCE (95%) when evasion is 0', () => {
            const hitChance = accuracySystem.calculateHitChance(100, 0);

            expect(hitChance).toBe(0.95);
        });

        it('should return MIN_HIT_CHANCE (5%) when accuracy is 0', () => {
            const hitChance = accuracySystem.calculateHitChance(0, 100);

            expect(hitChance).toBe(0.05);
        });

        it('should return high hit chance with high accuracy vs low evasion', () => {
            const hitChance = accuracySystem.calculateHitChance(200, 20);

            // Should be close to max (95%)
            expect(hitChance).toBeGreaterThan(0.90);
            expect(hitChance).toBeLessThanOrEqual(0.95);
        });

        it('should return lower hit chance with low accuracy vs high evasion', () => {
            const hitChance = accuracySystem.calculateHitChance(50, 100);

            // Should be significantly reduced
            expect(hitChance).toBeLessThan(0.80);
            expect(hitChance).toBeGreaterThanOrEqual(0.05);
        });

        it('should clamp hit chance to min/max bounds', () => {
            // Extremely high evasion
            const lowHitChance = accuracySystem.calculateHitChance(10, 10000);
            expect(lowHitChance).toBe(0.05);  // MIN_HIT_CHANCE

            // Extremely low evasion
            const highHitChance = accuracySystem.calculateHitChance(10000, 0);
            expect(highHitChance).toBe(0.95);  // MAX_HIT_CHANCE
        });

        it('should calculate reasonable hit chance for equal accuracy and evasion', () => {
            // PoE formula: Hit = Accuracy / (Accuracy + (Evasion/4)^0.8)
            const hitChance = accuracySystem.calculateHitChance(100, 100);

            // With equal stats, hit chance should be moderate
            expect(hitChance).toBeGreaterThan(0.50);
            expect(hitChance).toBeLessThan(0.95);
        });
    });

    describe('rollHitChance', () => {
        it('should always hit for spells (isSpell = true)', () => {
            const attacker = game.createEntityWith({
                combat: { accuracy: 0 }  // Zero accuracy
            });

            const defender = game.createEntityWith({
                combat: { evasion: 10000 }  // Insane evasion
            });

            game.register('getUnitTypeDef', () => null);

            const result = accuracySystem.rollHitChance(attacker, defender, true);

            expect(result.hit).toBe(true);
            expect(result.hitChance).toBe(1.0);
            expect(result.wasSpell).toBe(true);
        });

        it('should return hit result with all relevant data', () => {
            const attacker = game.createEntityWith({
                combat: { accuracy: 100 }
            });

            const defender = game.createEntityWith({
                combat: { evasion: 50 }
            });

            // Mock getAggregatedDefensiveStats to return proper values for each entity
            game.register('getAggregatedDefensiveStats', (entityId) => {
                if (entityId === attacker) {
                    return { accuracy: 100, evasion: 0 };
                } else if (entityId === defender) {
                    return { accuracy: 100, evasion: 50 };
                }
                return { accuracy: 100, evasion: 0 };
            });

            const result = accuracySystem.rollHitChance(attacker, defender, false);

            expect(result).toHaveProperty('hit');
            expect(result).toHaveProperty('hitChance');
            expect(result).toHaveProperty('roll');
            expect(result).toHaveProperty('accuracy');
            expect(result).toHaveProperty('evasion');
            expect(result.accuracy).toBe(100);
            expect(result.evasion).toBe(50);
        });

        it('should use default accuracy when combat component is missing', () => {
            const attacker = game.createEntity();  // No combat component
            const defender = game.createEntityWith({
                combat: { evasion: 0 }
            });

            game.register('getUnitTypeDef', () => null);

            const result = accuracySystem.rollHitChance(attacker, defender, false);

            // Default accuracy is 100
            expect(result.accuracy).toBe(100);
        });

        it('should use default evasion when combat component is missing', () => {
            const attacker = game.createEntityWith({
                combat: { accuracy: 100 }
            });
            const defender = game.createEntity();  // No combat component

            game.register('getUnitTypeDef', () => null);

            const result = accuracySystem.rollHitChance(attacker, defender, false);

            // Default evasion is 0
            expect(result.evasion).toBe(0);
        });

        it('should produce deterministic rolls for same inputs', () => {
            const attacker = game.createEntityWith({
                combat: { accuracy: 100 }
            });
            const defender = game.createEntityWith({
                combat: { evasion: 50 }
            });

            game.register('getUnitTypeDef', () => null);
            game.state.now = 1.0;

            // Reset counter for deterministic test
            accuracySystem.hitRollCounter = 0;

            const result1 = accuracySystem.rollHitChance(attacker, defender, false);

            // Same time, same entities, reset counter - should get different roll due to counter
            // But with same counter value and time, should be deterministic
            game.state.now = 1.0;
            accuracySystem.hitRollCounter = 0;

            const result2 = accuracySystem.rollHitChance(attacker, defender, false);

            // Rolls should be identical for same inputs
            expect(result1.roll).toBe(result2.roll);
        });
    });

    describe('deterministicRandom', () => {
        it('should return value between 0 and 1', () => {
            for (let i = 0; i < 100; i++) {
                game.state.now = i * 0.1;
                const value = accuracySystem.deterministicRandom(1, 2);
                expect(value).toBeGreaterThanOrEqual(0);
                expect(value).toBeLessThan(1);
            }
        });

        it('should produce different values for different inputs', () => {
            game.state.now = 1.0;
            accuracySystem.hitRollCounter = 0;

            const value1 = accuracySystem.deterministicRandom(1, 2);
            const value2 = accuracySystem.deterministicRandom(3, 4);
            const value3 = accuracySystem.deterministicRandom(1, 2);  // Different due to counter

            expect(value1).not.toBe(value2);
            expect(value1).not.toBe(value3);  // Counter changed
        });
    });

    describe('integration with StatAggregationSystem', () => {
        it('should use stats from getAggregatedDefensiveStats service', () => {
            const attacker = game.createEntityWith({
                unitType: { unitType: 0 }
            });
            const defender = game.createEntityWith({
                unitType: { unitType: 1 }
            });

            // Mock getAggregatedDefensiveStats to return different values per entity
            // (In real usage, StatAggregationSystem would aggregate stats from unit type + buffs + equipment)
            game.register('getAggregatedDefensiveStats', (entityId) => {
                if (entityId === attacker) {
                    return { accuracy: 150, evasion: 10 };
                } else if (entityId === defender) {
                    return { accuracy: 100, evasion: 80 };
                }
                return { accuracy: 100, evasion: 0 };
            });

            const result = accuracySystem.rollHitChance(attacker, defender, false);

            // Should use the aggregated stats
            expect(result.accuracy).toBe(150);
            expect(result.evasion).toBe(80);
        });
    });
});
