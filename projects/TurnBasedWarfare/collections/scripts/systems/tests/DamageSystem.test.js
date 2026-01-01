import { describe, it, expect, beforeEach } from 'vitest';
import { TestGameContext } from '../../../../../../tests/TestGameContext.js';

describe('DamageSystem', () => {
    let game;
    let damageSystem;
    let enums;

    beforeEach(() => {
        game = new TestGameContext();

        // Mock the services that DamageSystem depends on for PoE-style formula
        // Default: no modifiers (attacks always hit, no damage bonuses)
        game.register('getAggregatedDamageModifiers', () => ({
            increased: 0,
            more: []
        }));

        game.register('rollHitChance', (attackerId, defenderId, isSpell) => ({
            hit: true,
            hitChance: 1.0,
            roll: 0,
            accuracy: 100,
            evasion: 0,
            wasSpell: isSpell
        }));

        damageSystem = game.createSystem(GUTS.DamageSystem);
        enums = game.getEnums();
    });

    describe('applyDamage', () => {
        it('should reduce health by damage amount for physical damage', () => {
            const attacker = game.createEntity();
            const target = game.createEntityWith({
                health: { current: 100, max: 100 },
                deathState: { state: enums.deathState.alive }
            });

            const result = damageSystem.applyDamage(attacker, target, 25, enums.element.physical);

            expect(result.damage).toBe(25);
            expect(game.getComponent(target, 'health').current).toBe(75);
        });

        it('should respect armor reduction for physical damage', () => {
            const attacker = game.createEntity();
            const target = game.createEntityWith({
                health: { current: 100, max: 100 },
                combat: { armor: 10 },
                deathState: { state: enums.deathState.alive }
            });

            const result = damageSystem.applyDamage(attacker, target, 25, enums.element.physical);

            expect(result.damage).toBe(15); // 25 - 10 armor
            expect(result.mitigated).toBe(10);
        });

        it('should enforce minimum damage of 1', () => {
            const attacker = game.createEntity();
            const target = game.createEntityWith({
                health: { current: 100, max: 100 },
                combat: { armor: 100 },
                deathState: { state: enums.deathState.alive }
            });

            const result = damageSystem.applyDamage(attacker, target, 5, enums.element.physical);

            expect(result.damage).toBe(1); // MIN_DAMAGE
        });

        it('should return fatal: true when killing target', () => {
            const attacker = game.createEntity();
            const target = game.createEntityWith({
                health: { current: 10, max: 100 },
                deathState: { state: enums.deathState.alive }
            });

            const result = damageSystem.applyDamage(attacker, target, 50, enums.element.physical);

            expect(result.fatal).toBe(true);
            expect(game.getComponent(target, 'health').current).toBeLessThanOrEqual(0);
        });

        it('should apply fire resistance correctly', () => {
            const attacker = game.createEntity();
            const target = game.createEntityWith({
                health: { current: 100, max: 100 },
                combat: { fireResistance: 0.5 }, // 50% fire resistance
                deathState: { state: enums.deathState.alive }
            });

            const result = damageSystem.applyDamage(attacker, target, 20, enums.element.fire);

            // With 50% fire resistance, 20 damage should become 10
            expect(result.damage).toBe(10);
            expect(result.mitigated).toBe(10);
        });

        it('should cap resistance at 90%', () => {
            const attacker = game.createEntity();
            const target = game.createEntityWith({
                health: { current: 100, max: 100 },
                combat: { fireResistance: 0.99 }, // 99% resistance (over cap)
                deathState: { state: enums.deathState.alive }
            });

            const result = damageSystem.applyDamage(attacker, target, 100, enums.element.fire);

            // Should be capped at 90% resistance, so 100 damage -> 10 (or 9 due to floor)
            // The implementation uses Math.floor which can result in 9
            expect(result.damage).toBeGreaterThanOrEqual(9);
            expect(result.damage).toBeLessThanOrEqual(10);
        });

        it('should not apply damage to dead targets', () => {
            const attacker = game.createEntity();
            const target = game.createEntityWith({
                health: { current: 100, max: 100 },
                deathState: { state: enums.deathState.dying }
            });

            const result = damageSystem.applyDamage(attacker, target, 25, enums.element.physical);

            expect(result.damage).toBe(0);
            expect(result.prevented).toBe(true);
            expect(game.getComponent(target, 'health').current).toBe(100);
        });

        it('should track last attacker in combatState', () => {
            const attacker = game.createEntity();
            const target = game.createEntityWith({
                health: { current: 100, max: 100 },
                deathState: { state: enums.deathState.alive },
                combatState: { lastAttacker: null, lastAttackTime: 0 }
            });

            game.state.now = 5.0;
            damageSystem.applyDamage(attacker, target, 10, enums.element.physical);

            const combatState = game.getComponent(target, 'combatState');
            expect(combatState.lastAttacker).toBe(attacker);
            expect(combatState.lastAttackTime).toBe(5.0);
        });
    });

    describe('applySplashDamage', () => {
        it('should damage all enemies within radius', () => {
            const attacker = game.createEntityWith({
                team: { team: enums.team.left }
            });

            const enemy1 = game.createEntityWith({
                transform: { position: { x: 0, y: 0, z: 0 } },
                health: { current: 100, max: 100 },
                team: { team: enums.team.right },
                deathState: { state: enums.deathState.alive }
            });

            const enemy2 = game.createEntityWith({
                transform: { position: { x: 5, y: 0, z: 0 } },
                health: { current: 100, max: 100 },
                team: { team: enums.team.right },
                deathState: { state: enums.deathState.alive }
            });

            const farEnemy = game.createEntityWith({
                transform: { position: { x: 100, y: 0, z: 0 } },
                health: { current: 100, max: 100 },
                team: { team: enums.team.right },
                deathState: { state: enums.deathState.alive }
            });

            const results = damageSystem.applySplashDamage(
                attacker,
                { x: 0, y: 0, z: 0 },
                50,
                enums.element.physical,
                10 // radius
            );

            // Should damage enemy1 and enemy2 (within radius), but not farEnemy
            expect(results.length).toBe(2);

            // enemy1 at center should take full damage
            expect(game.getComponent(enemy1, 'health').current).toBeLessThan(100);

            // enemy2 at distance should take reduced damage
            expect(game.getComponent(enemy2, 'health').current).toBeLessThan(100);

            // farEnemy should be untouched
            expect(game.getComponent(farEnemy, 'health').current).toBe(100);
        });

        it('should not damage allies', () => {
            const attacker = game.createEntityWith({
                team: { team: enums.team.left }
            });

            const ally = game.createEntityWith({
                transform: { position: { x: 0, y: 0, z: 0 } },
                health: { current: 100, max: 100 },
                team: { team: enums.team.left }, // Same team
                deathState: { state: enums.deathState.alive }
            });

            damageSystem.applySplashDamage(
                attacker,
                { x: 0, y: 0, z: 0 },
                50,
                enums.element.physical,
                10
            );

            expect(game.getComponent(ally, 'health').current).toBe(100);
        });
    });

    describe('applyPoisonDoT', () => {
        it('should add poison stacks to target', () => {
            const attacker = game.createEntity();
            const target = game.createEntityWith({
                health: { current: 100, max: 100 },
                deathState: { state: enums.deathState.alive }
            });

            const result = damageSystem.applyDamage(attacker, target, 50, enums.element.poison);

            expect(result.isPoison).toBe(true);
            expect(result.stacks).toBe(1);

            const stacks = damageSystem.getPoisonStacks(target);
            expect(stacks).toBe(1);
        });

        it('should stack multiple poison applications', () => {
            const attacker = game.createEntity();
            const target = game.createEntityWith({
                health: { current: 100, max: 100 },
                deathState: { state: enums.deathState.alive }
            });

            damageSystem.applyDamage(attacker, target, 10, enums.element.poison);
            damageSystem.applyDamage(attacker, target, 10, enums.element.poison);
            damageSystem.applyDamage(attacker, target, 10, enums.element.poison);

            expect(damageSystem.getPoisonStacks(target)).toBe(3);
        });

        it('should respect max stack limit of 10', () => {
            const attacker = game.createEntity();
            const target = game.createEntityWith({
                health: { current: 100, max: 100 },
                deathState: { state: enums.deathState.alive }
            });

            // Apply 12 poison stacks (over the limit of 10)
            for (let i = 0; i < 12; i++) {
                damageSystem.applyDamage(attacker, target, 5, enums.element.poison);
            }

            // Should be capped at 10 (with STACK_REFRESH removing oldest)
            expect(damageSystem.getPoisonStacks(target)).toBe(10);
        });
    });

    describe('scheduleDamage', () => {
        it('should schedule damage for later application', () => {
            const attacker = game.createEntity();
            const target = game.createEntityWith({
                health: { current: 100, max: 100 },
                deathState: { state: enums.deathState.alive }
            });

            game.state.now = 0;
            damageSystem.scheduleDamage(attacker, target, 25, enums.element.physical, 1.0);

            // Health should still be full
            expect(game.getComponent(target, 'health').current).toBe(100);

            // Advance time and process
            game.state.now = 1.5;
            damageSystem.processPendingDamage();

            // Now damage should be applied
            expect(game.getComponent(target, 'health').current).toBe(75);
        });
    });

    describe('curePoison', () => {
        it('should remove all poison stacks', () => {
            const attacker = game.createEntity();
            const target = game.createEntityWith({
                health: { current: 100, max: 100 },
                deathState: { state: enums.deathState.alive }
            });

            // Apply multiple poison stacks
            damageSystem.applyDamage(attacker, target, 10, enums.element.poison);
            damageSystem.applyDamage(attacker, target, 10, enums.element.poison);
            expect(damageSystem.getPoisonStacks(target)).toBe(2);

            // Cure all poison
            const cured = damageSystem.curePoison(target);

            expect(cured).toBe(true);
            expect(damageSystem.getPoisonStacks(target)).toBe(0);
        });

        it('should remove partial stacks when specified', () => {
            const attacker = game.createEntity();
            const target = game.createEntityWith({
                health: { current: 100, max: 100 },
                deathState: { state: enums.deathState.alive }
            });

            // Apply 5 poison stacks
            for (let i = 0; i < 5; i++) {
                damageSystem.applyDamage(attacker, target, 10, enums.element.poison);
            }
            expect(damageSystem.getPoisonStacks(target)).toBe(5);

            // Cure 2 stacks
            damageSystem.curePoison(target, 2);

            expect(damageSystem.getPoisonStacks(target)).toBe(3);
        });
    });

    describe('buildDamageTags', () => {
        it('should build attack tags for melee physical attack', () => {
            const tags = damageSystem.buildDamageTags(enums.element.physical, {
                isMelee: true
            });

            expect(tags).toContain('attack');
            expect(tags).toContain('melee');
            expect(tags).toContain('physical');
            expect(tags).toContain('singleTarget');
            expect(tags).not.toContain('spell');
        });

        it('should build spell tags for fire spell', () => {
            const tags = damageSystem.buildDamageTags(enums.element.fire, {
                isSpell: true
            });

            expect(tags).toContain('spell');
            expect(tags).toContain('fire');
            expect(tags).not.toContain('attack');
        });

        it('should build projectile tags for ranged attack', () => {
            const tags = damageSystem.buildDamageTags(enums.element.physical, {
                isProjectile: true
            });

            expect(tags).toContain('attack');
            expect(tags).toContain('ranged');
            expect(tags).toContain('projectile');
        });

        it('should build area tags for splash damage', () => {
            const tags = damageSystem.buildDamageTags(enums.element.fire, {
                isSpell: true,
                isSplash: true
            });

            expect(tags).toContain('area');
            expect(tags).not.toContain('singleTarget');
        });

        it('should build dot tags for damage over time', () => {
            const tags = damageSystem.buildDamageTags(enums.element.poison, {
                isDot: true
            });

            expect(tags).toContain('dot');
            expect(tags).toContain('poison');
        });
    });

    describe('PoE-style damage modifiers', () => {
        it('should apply increased modifier from unit passives', () => {
            const attacker = game.createEntityWith({
                team: { team: enums.team.left },
                unitType: { unitType: 0 }
            });

            // Mock getAggregatedDamageModifiers to return 15% increased for melee physical
            game.register('getAggregatedDamageModifiers', () => ({
                increased: 0.15,
                more: []
            }));

            const target = game.createEntityWith({
                health: { current: 100, max: 100 },
                deathState: { state: enums.deathState.alive }
            });

            // Apply melee physical damage
            const result = damageSystem.applyDamage(attacker, target, 100, enums.element.physical, {
                isMelee: true
            });

            // 100 * (1 + 0.15) = 115
            expect(result.damage).toBeCloseTo(115);
        });

        it('should sum multiple increased modifiers additively', () => {
            const attacker = game.createEntityWith({
                team: { team: enums.team.left },
                unitType: { unitType: 0 }
            });

            // Mock getAggregatedDamageModifiers to return summed increased modifiers (20% + 10% = 30%)
            game.register('getAggregatedDamageModifiers', () => ({
                increased: 0.30,  // 20% spell + 10% fire = 30% total
                more: []
            }));

            const target = game.createEntityWith({
                health: { current: 100, max: 100 },
                deathState: { state: enums.deathState.alive }
            });

            // Apply fire spell damage
            const result = damageSystem.applyDamage(attacker, target, 100, enums.element.fire, {
                isSpell: true
            });

            // 100 * (1 + 0.30) = 130
            expect(result.damage).toBe(130);
        });

        it('should apply more modifiers multiplicatively', () => {
            const attacker = game.createEntityWith({
                team: { team: enums.team.left },
                unitType: { unitType: 0 }
            });

            // Mock getAggregatedDamageModifiers with multiple more modifiers
            game.register('getAggregatedDamageModifiers', () => ({
                increased: 0,
                more: [0.20, 0.30]  // Each applied multiplicatively
            }));

            const target = game.createEntityWith({
                health: { current: 100, max: 100 },
                deathState: { state: enums.deathState.alive }
            });

            const result = damageSystem.applyDamage(attacker, target, 100, enums.element.physical, {
                isMelee: true
            });

            // 100 * (1 + 0.20) * (1 + 0.30) = 100 * 1.2 * 1.3 = 156
            expect(result.damage).toBe(156);
        });

        it('should combine increased and more modifiers correctly', () => {
            const attacker = game.createEntityWith({
                team: { team: enums.team.left },
                unitType: { unitType: 0 }
            });

            // Mock getAggregatedDamageModifiers with both increased and more
            game.register('getAggregatedDamageModifiers', () => ({
                increased: 0.40,  // 40% increased
                more: [0.50]      // 50% more
            }));

            const target = game.createEntityWith({
                health: { current: 100, max: 100 },
                deathState: { state: enums.deathState.alive }
            });

            const result = damageSystem.applyDamage(attacker, target, 100, enums.element.fire, {
                isSpell: true
            });

            // 100 * (1 + 0.40) * (1 + 0.50) = 100 * 1.4 * 1.5 = 210
            expect(result.damage).toBe(210);
        });

        it('should only apply modifiers with matching tags', () => {
            const attacker = game.createEntityWith({
                team: { team: enums.team.left },
                unitType: { unitType: 0 }
            });

            // Mock with spell modifier that shouldn't apply to attack
            game.register('getUnitTypeDef', () => ({
                id: 'test_unit',
                passives: [
                    { type: 'increased', tags: ['spell'], value: 0.50 }  // Only for spells
                ]
            }));

            const target = game.createEntityWith({
                health: { current: 100, max: 100 },
                deathState: { state: enums.deathState.alive }
            });

            // Apply attack (not spell)
            const result = damageSystem.applyDamage(attacker, target, 100, enums.element.physical, {
                isMelee: true
            });

            // Spell modifier shouldn't apply to attack
            expect(result.damage).toBe(100);
        });

        it('should apply critical hit multiplier', () => {
            const attacker = game.createEntity();
            const target = game.createEntityWith({
                health: { current: 100, max: 100 },
                deathState: { state: enums.deathState.alive }
            });

            game.register('getUnitTypeDef', () => null);

            const result = damageSystem.applyDamage(attacker, target, 100, enums.element.physical, {
                isCritical: true,
                criticalMultiplier: 2.0
            });

            // 100 * 2.0 = 200
            expect(result.damage).toBe(200);
        });
    });

    describe('Accuracy and Evasion', () => {
        it('should allow spells to always hit (bypass accuracy check)', () => {
            const attacker = game.createEntityWith({
                combat: { accuracy: 0 }  // Very low accuracy
            });

            const target = game.createEntityWith({
                health: { current: 100, max: 100 },
                combat: { evasion: 1000 },  // Very high evasion
                deathState: { state: enums.deathState.alive }
            });

            game.register('getUnitTypeDef', () => null);

            // Spell should always hit regardless of accuracy/evasion
            const result = damageSystem.applyDamage(attacker, target, 50, enums.element.fire, {
                isSpell: true
            });

            expect(result.prevented).toBeFalsy();
            expect(result.damage).toBe(50);
        });

        it('should return evaded result when attack misses', () => {
            // Override rollHitChance to always miss
            game.register('rollHitChance', () => ({
                hit: false,
                hitChance: 0.5,
                roll: 0.9,
                accuracy: 100,
                evasion: 50
            }));

            const attacker = game.createEntity();
            const target = game.createEntityWith({
                health: { current: 100, max: 100 },
                deathState: { state: enums.deathState.alive }
            });

            const result = damageSystem.applyDamage(attacker, target, 50, enums.element.physical, {
                isMelee: true
            });

            expect(result.prevented).toBe(true);
            expect(result.reason).toBe('evaded');
            expect(result.damage).toBe(0);
        });

        it('should include damage tags in result', () => {
            const attacker = game.createEntity();
            const target = game.createEntityWith({
                health: { current: 100, max: 100 },
                deathState: { state: enums.deathState.alive }
            });

            game.register('getUnitTypeDef', () => null);

            const result = damageSystem.applyDamage(attacker, target, 50, enums.element.fire, {
                isSpell: true,
                isSplash: true
            });

            expect(result.tags).toContain('spell');
            expect(result.tags).toContain('fire');
            expect(result.tags).toContain('area');
        });
    });
});
