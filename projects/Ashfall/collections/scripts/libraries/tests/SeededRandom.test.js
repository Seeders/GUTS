import { describe, it, expect, beforeEach } from 'vitest';

describe('SeededRandom', () => {
    let rng;

    beforeEach(() => {
        rng = new GUTS.SeededRandom(12345);
    });

    describe('strand creation', () => {
        it('should return same strand for same name', () => {
            const strand1 = rng.strand('test');
            const strand2 = rng.strand('test');

            // Both references point to same strand, so calling next() advances both
            const value1 = strand1.next();
            const value2 = strand2.next();
            // They should be different (consecutive calls)
            expect(value1).not.toBe(value2);

            // But if we reset and call on either, they're the same strand
            strand1.reset();
            const afterReset1 = strand1.next();
            strand2.reset();
            const afterReset2 = strand2.next();
            expect(afterReset1).toBe(afterReset2);
        });

        it('should produce different sequences for different strand names', () => {
            const strand1 = rng.strand('battle');
            const strand2 = rng.strand('local');

            expect(strand1.next()).not.toBe(strand2.next());
        });
    });

    describe('determinism', () => {
        it('should produce same sequence with same seed', () => {
            const rng1 = new GUTS.SeededRandom(42);
            const rng2 = new GUTS.SeededRandom(42);

            const strand1 = rng1.strand('test');
            const strand2 = rng2.strand('test');

            for (let i = 0; i < 10; i++) {
                expect(strand1.next()).toBe(strand2.next());
            }
        });

        it('should produce different sequences with different seeds', () => {
            const rng1 = new GUTS.SeededRandom(42);
            const rng2 = new GUTS.SeededRandom(43);

            const strand1 = rng1.strand('test');
            const strand2 = rng2.strand('test');

            expect(strand1.next()).not.toBe(strand2.next());
        });
    });

    describe('strand methods', () => {
        it('next() should return values between 0 and 1', () => {
            const strand = rng.strand('test');

            for (let i = 0; i < 100; i++) {
                const value = strand.next();
                expect(value).toBeGreaterThanOrEqual(0);
                expect(value).toBeLessThan(1);
            }
        });

        it('range() should return values within specified range', () => {
            const strand = rng.strand('test');

            for (let i = 0; i < 100; i++) {
                const value = strand.range(10, 20);
                expect(value).toBeGreaterThanOrEqual(10);
                expect(value).toBeLessThan(20);
            }
        });

        it('rangeInt() should return integers within specified range', () => {
            const strand = rng.strand('test');

            for (let i = 0; i < 100; i++) {
                const value = strand.rangeInt(1, 6);
                expect(Number.isInteger(value)).toBe(true);
                expect(value).toBeGreaterThanOrEqual(1);
                expect(value).toBeLessThanOrEqual(6);
            }
        });

        it('pick() should return elements from array', () => {
            const strand = rng.strand('test');
            const items = ['a', 'b', 'c', 'd'];

            for (let i = 0; i < 100; i++) {
                const value = strand.pick(items);
                expect(items).toContain(value);
            }
        });

        it('pick() should return undefined for empty array', () => {
            const strand = rng.strand('test');
            expect(strand.pick([])).toBeUndefined();
        });

        it('chance() should work correctly', () => {
            const strand = rng.strand('test');

            // With 100% chance, should always return true
            for (let i = 0; i < 10; i++) {
                // Reset strand each time
                strand.reseed(i);
                const result = strand.chance(1.0);
                expect(result).toBe(true);
            }

            // With 0% chance, should always return false
            for (let i = 0; i < 10; i++) {
                strand.reseed(i);
                const result = strand.chance(0.0);
                expect(result).toBe(false);
            }
        });

        it('shuffle() should shuffle array elements deterministically', () => {
            // Create two separate RNGs with same seed
            const rng1 = new GUTS.SeededRandom(999);
            const rng2 = new GUTS.SeededRandom(999);

            const original = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
            const shuffled1 = rng1.strand('test').shuffle([...original]);
            const shuffled2 = rng2.strand('test').shuffle([...original]);

            // Same seed should produce same shuffle
            expect(shuffled1).toEqual(shuffled2);

            // Shuffled array should contain same elements
            expect([...shuffled1].sort((a, b) => a - b)).toEqual(original);
        });

        it('reset() should reset strand to initial state', () => {
            const strand = rng.strand('test');

            const firstRun = [];
            for (let i = 0; i < 5; i++) {
                firstRun.push(strand.next());
            }

            strand.reset();

            const secondRun = [];
            for (let i = 0; i < 5; i++) {
                secondRun.push(strand.next());
            }

            expect(secondRun).toEqual(firstRun);
        });
    });
});
