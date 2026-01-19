/**
 * Deterministic pseudo-random number generator using Mulberry32 algorithm.
 * All randomness must go through named strands:
 * - 'battle': Deterministic strand for client/server sync
 * - 'local': Local-only randomness (AI placement, UI effects, etc.)
 */
class SeededRandom {
    constructor(seed = 1) {
        this.initialSeed = seed;
        this.strands = new Map();
    }

    /**
     * Get or create a named strand
     * @param {string} name - Strand name (e.g., 'battle', 'local')
     * @param {number} [seed] - Optional seed (defaults to derived from initial seed)
     * @returns {object} Strand object with next(), range(), pick(), shuffle() methods
     */
    strand(name, seed = null) {
        if (!this.strands.has(name)) {
            const strandSeed = seed ?? SeededRandom.combineSeed(this.initialSeed, SeededRandom.hashString(name));
            this.strands.set(name, {
                seed: strandSeed,
                initialSeed: strandSeed
            });
        }

        const strand = this.strands.get(name);
        const self = this;

        return {
            next: () => self._next(strand),
            chance: (p) => self._next(strand) < p,
            range: (min, max) => min + self._next(strand) * (max - min),
            rangeInt: (min, max) => Math.floor(self._next(strand) * (max - min + 1)) + min,
            pick: (arr) => arr?.length > 0 ? arr[Math.floor(self._next(strand) * arr.length)] : undefined,
            shuffle: (arr) => self._shuffle(strand, arr),
            weightedSelect: (weights) => self._weightedSelect(strand, weights),
            reseed: (s) => { strand.seed = s; strand.initialSeed = s; },
            reset: () => { strand.seed = strand.initialSeed; }
        };
    }

    _next(strand) {
        let t = strand.seed += 0x6D2B79F5;
        t = Math.imul(t ^ t >>> 15, t | 1);
        t ^= t + Math.imul(t ^ t >>> 7, t | 61);
        return ((t ^ t >>> 14) >>> 0) / 4294967296;
    }

    _shuffle(strand, array) {
        for (let i = array.length - 1; i > 0; i--) {
            const j = Math.floor(this._next(strand) * (i + 1));
            [array[i], array[j]] = [array[j], array[i]];
        }
        return array;
    }

    _weightedSelect(strand, weights) {
        const entries = Object.entries(weights).sort((a, b) => a[0].localeCompare(b[0]));
        const totalWeight = entries.reduce((sum, [, weight]) => sum + weight, 0);
        let random = this._next(strand) * totalWeight;

        for (const [key, weight] of entries) {
            random -= weight;
            if (random <= 0) return key;
        }
        return entries[entries.length - 1][0];
    }

    static hashString(str) {
        let hash = 0;
        for (let i = 0; i < str.length; i++) {
            hash = ((hash << 5) - hash) + str.charCodeAt(i);
            hash = hash & hash;
        }
        return Math.abs(hash) || 1;
    }

    static combineSeed(...values) {
        let seed = 0;
        for (const value of values) {
            seed = ((seed << 5) - seed) + (value | 0);
            seed = seed & seed;
        }
        return Math.abs(seed) || 1;
    }
}
