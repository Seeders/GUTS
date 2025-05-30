class SimplexNoise {
    constructor(seed = 0) {
        // Permutation table for randomization
        this.perm = new Uint8Array(256);
        this.seed = seed;
        this.initPermutation();
    }

    // Initialize permutation table with a seed
    initPermutation() {
        for (let i = 0; i < 256; i++) {
            this.perm[i] = i;
        }
        // Shuffle using a simple seeded random
        let rand = this.seededRandom();
        for (let i = 255; i > 0; i--) {
            const j = Math.floor(rand() * (i + 1));
            [this.perm[i], this.perm[j]] = [this.perm[j], this.perm[i]];
        }
    }

    // Simple seeded random number generator
    seededRandom() {
        let x = Math.sin(this.seed++) * 10000;
        return () => {
            x = Math.sin(x + this.seed++) * 10000;
            return x - Math.floor(x);
        };
    }

    // 2D Simplex noise function
    noise2D(x, y) {
        // Skew input coordinates to simplex grid
        const s = (x + y) * 0.366025403784; // F = (sqrt(3) - 1) / 2
        const i = Math.floor(x + s);
        const j = Math.floor(y + s);

        // Unskew back to get simplex cell origin
        const t = (i + j) * 0.211324865405; // G = (3 - sqrt(3)) / 6
        const X0 = i - t;
        const Y0 = j - t;
        const x0 = x - X0;
        const y0 = y - Y0;

        // Determine which simplex we're in
        const i1 = x0 > y0 ? 1 : 0;
        const j1 = x0 > y0 ? 0 : 1;

        // Offsets for second and third corners
        const x1 = x0 - i1 + 0.211324865405;
        const y1 = y0 - j1 + 0.211324865405;
        const x2 = x0 - 1 + 0.42264973081;
        const y2 = y0 - 1 + 0.42264973081;

        // Gradient indices
        const gi0 = this.perm[(i + this.perm[j & 255]) & 255] % 4;
        const gi1 = this.perm[(i + i1 + this.perm[(j + j1) & 255]) & 255] % 4;
        const gi2 = this.perm[(i + 1 + this.perm[(j + 1) & 255]) & 255] % 4;

        // Calculate contributions from each corner
        const n0 = this.contribution(x0, y0, gi0);
        const n1 = this.contribution(x1, y1, gi1);
        const n2 = this.contribution(x2, y2, gi2);

        // Sum contributions and normalize to [-1, 1]
        return (n0 + n1 + n2) * 70; // Scale to approximate [-1, 1]
    }

    // Calculate contribution from a corner
    contribution(x, y, gi) {
        // Distance falloff
        const t = 0.5 - x * x - y * y;
        if (t < 0) return 0;

        // Gradient vectors (simplified 2D)
        const gradients = [
            [1, 1], [-1, 1], [1, -1], [-1, -1]
        ];
        const grad = gradients[gi];
        const t2 = t * t;
        return t2 * t2 * (grad[0] * x + grad[1] * y);
    }
}