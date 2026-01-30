/**
 * Perlin Noise implementation for voxel terrain generation
 * Based on improved Perlin noise algorithm
 */
class PerlinNoise {
    constructor(seed = 1337) {
        this.seed = seed;
        this.permutation = this.generatePermutation(seed);
        this.p = new Array(512);
        for (let i = 0; i < 256; i++) {
            this.p[i] = this.permutation[i];
            this.p[256 + i] = this.permutation[i];
        }
    }

    generatePermutation(seed) {
        const perm = [];
        for (let i = 0; i < 256; i++) {
            perm[i] = i;
        }

        // Fisher-Yates shuffle with seeded random
        let s = seed;
        for (let i = 255; i > 0; i--) {
            s = (s * 1103515245 + 12345) & 0x7fffffff;
            const j = s % (i + 1);
            [perm[i], perm[j]] = [perm[j], perm[i]];
        }

        return perm;
    }

    fade(t) {
        return t * t * t * (t * (t * 6 - 15) + 10);
    }

    lerp(a, b, t) {
        return a + t * (b - a);
    }

    grad(hash, x, y) {
        const h = hash & 3;
        const u = h < 2 ? x : y;
        const v = h < 2 ? y : x;
        return ((h & 1) === 0 ? u : -u) + ((h & 2) === 0 ? v : -v);
    }

    noise2D(x, y) {
        const X = Math.floor(x) & 255;
        const Y = Math.floor(y) & 255;

        x -= Math.floor(x);
        y -= Math.floor(y);

        const u = this.fade(x);
        const v = this.fade(y);

        const A = this.p[X] + Y;
        const B = this.p[X + 1] + Y;

        return this.lerp(
            this.lerp(this.grad(this.p[A], x, y), this.grad(this.p[B], x - 1, y), u),
            this.lerp(this.grad(this.p[A + 1], x, y - 1), this.grad(this.p[B + 1], x - 1, y - 1), u),
            v
        );
    }

    grad3D(hash, x, y, z) {
        const h = hash & 15;
        const u = h < 8 ? x : y;
        const v = h < 4 ? y : h === 12 || h === 14 ? x : z;
        return ((h & 1) === 0 ? u : -u) + ((h & 2) === 0 ? v : -v);
    }

    noise3D(x, y, z) {
        const X = Math.floor(x) & 255;
        const Y = Math.floor(y) & 255;
        const Z = Math.floor(z) & 255;

        x -= Math.floor(x);
        y -= Math.floor(y);
        z -= Math.floor(z);

        const u = this.fade(x);
        const v = this.fade(y);
        const w = this.fade(z);

        const A = this.p[X] + Y;
        const AA = this.p[A] + Z;
        const AB = this.p[A + 1] + Z;
        const B = this.p[X + 1] + Y;
        const BA = this.p[B] + Z;
        const BB = this.p[B + 1] + Z;

        return this.lerp(
            this.lerp(
                this.lerp(this.grad3D(this.p[AA], x, y, z), this.grad3D(this.p[BA], x - 1, y, z), u),
                this.lerp(this.grad3D(this.p[AB], x, y - 1, z), this.grad3D(this.p[BB], x - 1, y - 1, z), u),
                v
            ),
            this.lerp(
                this.lerp(this.grad3D(this.p[AA + 1], x, y, z - 1), this.grad3D(this.p[BA + 1], x - 1, y, z - 1), u),
                this.lerp(this.grad3D(this.p[AB + 1], x, y - 1, z - 1), this.grad3D(this.p[BB + 1], x - 1, y - 1, z - 1), u),
                v
            ),
            w
        );
    }
}

GUTS.PerlinNoise = PerlinNoise;
