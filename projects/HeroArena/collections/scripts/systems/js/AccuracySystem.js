class AccuracySystem extends GUTS.BaseSystem {
    static services = [
        'rollHitChance',
        'calculateHitChance',
        'rollBlock',
        'rollCritical'
    ];

    static serviceDependencies = [
        'getAggregatedDefensiveStats'
    ];

    constructor(game) {
        super(game);
        this.game.accuracySystem = this;

        // Hit chance configuration
        this.MIN_HIT_CHANCE = 0.05;  // 5% minimum hit chance
        this.MAX_HIT_CHANCE = 0.95;  // 95% maximum hit chance

        // Block chance is capped so stacked shields can't reach total immunity.
        this.MAX_BLOCK_CHANCE = 0.75;

        // Crit chance is capped short of guaranteed so stacked crit gear can't turn
        // every hit into a crit.
        this.MAX_CRIT_CHANCE = 0.95;

        // Every weapon has SOME crit rating. Most unit defs never authored a
        // criticalChance, and the combat schema defaults it to 0 — which, because
        // increased crit MULTIPLIES the base, would leave those units unable to crit
        // and would make every crit affix inert on them (0 × anything = 0). Units that
        // want to be crit-flavoured author a higher value; this is just the floor.
        this.DEFAULT_ATTACK_CRIT = 0.05;

        // Deterministic pseudo-random state
        this.hitRollCounter = 0;
    }

    init() {
    }

    /**
     * Calculate hit chance for an attack
     * Uses PoE-style formula: Hit Chance = Accuracy / (Accuracy + (Evasion/4)^0.8)
     * @param {number} accuracy - Attacker's accuracy rating
     * @param {number} evasion - Defender's evasion rating
     * @returns {number} Hit chance between MIN_HIT_CHANCE and MAX_HIT_CHANCE
     */
    calculateHitChance(accuracy, evasion) {
        if (accuracy <= 0) return this.MIN_HIT_CHANCE;
        if (evasion <= 0) return this.MAX_HIT_CHANCE;

        // PoE-inspired formula
        const evasionFactor = Math.pow(evasion / 4, 0.8);
        let hitChance = accuracy / (accuracy + evasionFactor);

        // Clamp to min/max
        return Math.max(this.MIN_HIT_CHANCE, Math.min(this.MAX_HIT_CHANCE, hitChance));
    }

    /**
     * Roll to determine if an attack hits
     * @param {number} attackerId - The attacking entity
     * @param {number} defenderId - The defending entity
     * @param {boolean} isSpell - If true, always hits (spells don't miss)
     * @returns {{ hit: boolean, hitChance: number, roll: number, wasSpell?: boolean }}
     */
    rollHitChance(attackerId, defenderId, isSpell = false) {
        // Spells always hit
        if (isSpell) {
            return { hit: true, hitChance: 1.0, roll: 0, wasSpell: true };
        }

        // Get stats from StatAggregationSystem
        const attackerStats = this.call.getAggregatedDefensiveStats( attackerId);
        const defenderStats = this.call.getAggregatedDefensiveStats( defenderId);

        const accuracy = attackerStats?.accuracy ?? 100;
        const evasion = defenderStats?.evasion ?? 0;

        const hitChance = this.calculateHitChance(accuracy, evasion);

        // DESYNC SAFE: Use deterministic pseudo-random
        const roll = this.deterministicRandom(attackerId, defenderId);

        const hit = roll < hitChance;

        return {
            hit: hit,
            hitChance: hitChance,
            roll: roll,
            accuracy: accuracy,
            evasion: evasion
        };
    }

    /**
     * Deterministic pseudo-random number generator
     * Uses game state and entity IDs for reproducibility across client/server
     * @param {number} attackerId
     * @param {number} defenderId
     * @returns {number} Value between 0 and 1
     */
    deterministicRandom(attackerId, defenderId) {
        // Use game tick and entity IDs for deterministic seed
        const tick = Math.floor((this.game.state.now || 0) * 1000);
        const seed = tick ^ (attackerId * 31) ^ (defenderId * 17) ^ (this.hitRollCounter++);

        // Simple deterministic hash (same as used elsewhere in codebase)
        const x = Math.sin(seed) * 10000;
        return x - Math.floor(x);
    }

    /**
     * Roll to determine if the defender blocks an incoming attack.
     * Attacks only (spells are unblockable, like they are unevadable).
     * @param {number} attackerId
     * @param {number} defenderId
     * @returns {{ blocked: boolean, blockChance: number, roll: number }}
     */
    rollBlock(attackerId, defenderId) {
        const defenderStats = this.call.getAggregatedDefensiveStats(defenderId);
        const blockChance = Math.min(
            this.MAX_BLOCK_CHANCE, Math.max(0, defenderStats?.blockChance ?? 0));
        if (blockChance <= 0) return { blocked: false, blockChance: 0, roll: 1 };
        const roll = this.deterministicRandom(attackerId, defenderId);
        return { blocked: roll < blockChance, blockChance, roll };
    }

    /**
     * Roll a critical strike. Attacks AND spells can crit — unlike evasion and
     * block, crit is not an attack-only mechanic.
     *
     * PoE-style: the BASE chance belongs to the skill, and gear/upgrades grant
     * INCREASED crit chance, which multiplies that base rather than adding to it:
     *
     *     chance = base × (1 + Σ increased) × Π (1 + more)
     *
     * A 10%-base spell on a caster with +200% increased crit chance from gear and
     * upgrades lands at 0.10 × (1 + 2.00) = 30%. Because it's multiplicative, crit
     * gear is worthless on a skill with no base crit — which is the point: utility
     * spells declare a base of 0 and can never crit, however much gear is stacked.
     *
     * Where the BASE comes from depends on whether this is an attack or a spell:
     *
     *   • ATTACK — the base is the WEAPON's crit rating: the unit's own
     *     combat.criticalChance plus any flat `criticalChance: {add}` from gear. That
     *     is the only source. The basic attack and every attack ability swung with
     *     that weapon share it; attack abilities have no base crit of their own.
     *   • SPELL — the base is the SKILL's own criticalChance, and nothing else. The
     *     unit's and the weapon's crit rating never leak into spells.
     *
     * @param {number} attackerId
     * @param {number} defenderId
     * @param {number} spellBaseCrit - a SPELL's own base crit. Ignored for attacks,
     *                                 which always take their base from the weapon.
     * @param {string[]} tags - tags of this hit; picks the base source, and lets
     *                          ['spell']-tagged crit modifiers apply to spells only
     * @param {number} skillIncreasedCrit - increased crit intrinsic to the ability
     *                                      (Backstab, Aimed Shot). Summed with the
     *                                      entity's increased crit from gear/upgrades,
     *                                      so it MULTIPLIES the weapon it is swung with
     *                                      rather than replacing the weapon's rating.
     * @returns {{ critical: boolean, chance: number, base: number, increased: number,
     *             multiplier: number, roll: number }}
     */
    rollCritical(attackerId, defenderId, spellBaseCrit = null, tags = [], skillIncreasedCrit = 0) {
        const attackerStats = this.call.getAggregatedDefensiveStats(attackerId);
        const multiplier = attackerStats?.criticalMultiplier ?? 1.5;

        const isSpell = tags.includes('spell');
        const base = isSpell
            ? (spellBaseCrit || 0)                                        // spells: skill only
            : (attackerStats?.criticalChance || this.DEFAULT_ATTACK_CRIT); // attacks: weapon only

        // No base = cannot crit, no matter how much increased crit is stacked. Only
        // spells can reach here (a 0-base utility spell); attacks always have the
        // default weapon rating to fall back on.
        if (base <= 0) {
            return { critical: false, chance: 0, base: 0, increased: 0, multiplier, roll: 1 };
        }

        // Increased crit from gear/upgrades/buffs, PLUS whatever the skill itself
        // carries. Both are "increased", so they sum before multiplying the base.
        let increased = skillIncreasedCrit || 0;
        const agg = this.game.statAggregationSystem;
        const mods = agg ? agg.getAggregatedCritModifiers(attackerId, tags) : null;
        if (mods) increased += mods.increased;

        let chance = base * (1 + increased);
        if (mods) {
            for (const more of mods.more) chance *= (1 + more);
        }

        chance = Math.min(this.MAX_CRIT_CHANCE, Math.max(0, chance));

        // Salt the defender id so the crit roll doesn't correlate with the hit and
        // block rolls this same swing already drew for the same (attacker, defender).
        const roll = this.deterministicRandom(attackerId, defenderId ^ 0x5bf03635);
        return { critical: roll < chance, chance, base, increased, multiplier, roll };
    }
}
