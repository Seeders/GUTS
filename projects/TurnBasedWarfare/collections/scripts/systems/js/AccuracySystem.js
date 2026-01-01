class AccuracySystem extends GUTS.BaseSystem {
    static services = [
        'rollHitChance',
        'calculateHitChance'
    ];

    constructor(game) {
        super(game);
        this.game.accuracySystem = this;

        // Hit chance configuration
        this.MIN_HIT_CHANCE = 0.05;  // 5% minimum hit chance
        this.MAX_HIT_CHANCE = 0.95;  // 95% maximum hit chance

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
        const attackerStats = this.game.call('getAggregatedDefensiveStats', attackerId);
        const defenderStats = this.game.call('getAggregatedDefensiveStats', defenderId);

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
}
