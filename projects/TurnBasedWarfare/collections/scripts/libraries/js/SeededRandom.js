/**
 * Deterministic pseudo-random number generator using Mulberry32 algorithm.
 * Use this instead of Math.random() for any game state calculations
 * to ensure client and server produce identical results.
 */
class SeededRandom {
    constructor(seed = 1) {
        this.seed = seed;
        this.initialSeed = seed;
    }

    /**
     * Set a new seed value
     * @param {number} seed - The seed value
     */
    setSeed(seed) {
        this.seed = seed;
        this.initialSeed = seed;
    }

    /**
     * Reset to initial seed
     */
    reset() {
        this.seed = this.initialSeed;
    }

    /**
     * Get next random number between 0 and 1 (Mulberry32 algorithm)
     * @returns {number} Random number in [0, 1)
     */
    next() {
        let t = this.seed += 0x6D2B79F5;
        t = Math.imul(t ^ t >>> 15, t | 1);
        t ^= t + Math.imul(t ^ t >>> 7, t | 61);
        return ((t ^ t >>> 14) >>> 0) / 4294967296;
    }

    /**
     * Returns true with given probability
     * @param {number} probability - Probability between 0 and 1
     * @returns {boolean}
     */
    chance(probability) {
        return this.next() < probability;
    }

    /**
     * Returns random float in range [min, max)
     * @param {number} min - Minimum value (inclusive)
     * @param {number} max - Maximum value (exclusive)
     * @returns {number}
     */
    range(min, max) {
        return min + this.next() * (max - min);
    }

    /**
     * Returns random integer in range [min, max]
     * @param {number} min - Minimum value (inclusive)
     * @param {number} max - Maximum value (inclusive)
     * @returns {number}
     */
    rangeInt(min, max) {
        return Math.floor(this.next() * (max - min + 1)) + min;
    }

    /**
     * Randomly select an item from an array
     * @param {Array} array - Array to select from
     * @returns {*} Random element
     */
    pick(array) {
        if (!array || array.length === 0) return undefined;
        return array[Math.floor(this.next() * array.length)];
    }

    /**
     * Shuffle array in place using Fisher-Yates algorithm
     * @param {Array} array - Array to shuffle
     * @returns {Array} Same array, shuffled
     */
    shuffle(array) {
        for (let i = array.length - 1; i > 0; i--) {
            const j = Math.floor(this.next() * (i + 1));
            [array[i], array[j]] = [array[j], array[i]];
        }
        return array;
    }

    /**
     * Weighted random selection from object of weights
     * @param {Object} weights - Object with keys and weight values
     * @returns {string} Selected key
     */
    weightedSelect(weights) {
        const entries = Object.entries(weights).sort((a, b) => a[0].localeCompare(b[0])); // Sort for determinism
        const totalWeight = entries.reduce((sum, [, weight]) => sum + weight, 0);
        let random = this.next() * totalWeight;

        for (const [key, weight] of entries) {
            random -= weight;
            if (random <= 0) {
                return key;
            }
        }
        return entries[entries.length - 1][0]; // Fallback to last entry
    }

    /**
     * Create a seed from a string (simple hash)
     * @param {string} str - String to hash
     * @returns {number} Numeric seed
     */
    static hashString(str) {
        let hash = 0;
        for (let i = 0; i < str.length; i++) {
            const char = str.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash; // Convert to 32-bit integer
        }
        return Math.abs(hash) || 1; // Ensure non-zero
    }

    /**
     * Create a combined seed from multiple values
     * @param {...number} values - Values to combine
     * @returns {number} Combined seed
     */
    static combineSeed(...values) {
        let seed = 0;
        for (const value of values) {
            seed = ((seed << 5) - seed) + (value | 0);
            seed = seed & seed;
        }
        return Math.abs(seed) || 1;
    }
}

