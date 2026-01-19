import { describe, it, expect, beforeEach } from 'vitest';
import { TestGameContext } from '../../../../../../tests/TestGameContext.js';

describe('SupplySystem', () => {
    let game;
    let supplySystem;
    let enums;

    beforeEach(() => {
        game = new TestGameContext();
        game.isServer = true;  // Skip DOM updates

        // Register mock services
        game.register('getUnitTypeDef', (unitTypeComp) => {
            // Return mock unit type based on type index
            if (unitTypeComp?.type === 1) {
                return { supplyProvided: 10 };  // Building that provides supply
            }
            if (unitTypeComp?.type === 2) {
                return { supplyCost: 2 };  // Unit that costs supply
            }
            return {};
        });

        supplySystem = game.createSystem(GUTS.SupplySystem);
        enums = game.getEnums();
    });

    describe('initialization', () => {
        it('should register system on game', () => {
            expect(game.supplySystem).toBe(supplySystem);
        });

        it('should initialize cachedSupply as empty Map', () => {
            expect(supplySystem.cachedSupply.size).toBe(0);
        });

        it('should initialize isDirty as true', () => {
            expect(supplySystem.isDirty).toBe(true);
        });
    });

    describe('static services', () => {
        it('should register getCurrentSupply service', () => {
            expect(GUTS.SupplySystem.services).toContain('getCurrentSupply');
        });

        it('should register getCurrentPopulation service', () => {
            expect(GUTS.SupplySystem.services).toContain('getCurrentPopulation');
        });

        it('should register canAffordSupply service', () => {
            expect(GUTS.SupplySystem.services).toContain('canAffordSupply');
        });

        it('should register invalidateSupplyCache service', () => {
            expect(GUTS.SupplySystem.services).toContain('invalidateSupplyCache');
        });
    });

    describe('invalidateSupplyCache', () => {
        it('should set isDirty to true', () => {
            supplySystem.isDirty = false;
            supplySystem.invalidateSupplyCache();
            expect(supplySystem.isDirty).toBe(true);
        });
    });

    describe('onUnitKilled', () => {
        it('should invalidate supply cache', () => {
            supplySystem.isDirty = false;
            supplySystem.onUnitKilled(123);
            expect(supplySystem.isDirty).toBe(true);
        });
    });

    describe('onDestroyBuilding', () => {
        it('should invalidate supply cache', () => {
            supplySystem.isDirty = false;
            supplySystem.onDestroyBuilding(456);
            expect(supplySystem.isDirty).toBe(true);
        });
    });

    describe('getCurrentSupply', () => {
        it('should return 0 for team with no supply buildings', () => {
            expect(supplySystem.getCurrentSupply(enums.team.left)).toBe(0);
        });

        it('should sum supply from buildings', () => {
            // Create supply buildings for left team
            game.createEntityWith({
                unitType: { type: 1, collection: 0 },  // type 1 = supplyProvided: 10
                team: { team: enums.team.left },
                health: { current: 100, max: 100 },
                deathState: { state: enums.deathState.alive }
            });
            game.createEntityWith({
                unitType: { type: 1, collection: 0 },
                team: { team: enums.team.left },
                health: { current: 100, max: 100 },
                deathState: { state: enums.deathState.alive }
            });

            expect(supplySystem.getCurrentSupply(enums.team.left)).toBe(20);
        });

        it('should not count dead buildings', () => {
            game.createEntityWith({
                unitType: { type: 1, collection: 0 },
                team: { team: enums.team.left },
                health: { current: 0, max: 100 },  // Dead
                deathState: { state: enums.deathState.alive }
            });

            expect(supplySystem.getCurrentSupply(enums.team.left)).toBe(0);
        });

        it('should not count dying buildings', () => {
            game.createEntityWith({
                unitType: { type: 1, collection: 0 },
                team: { team: enums.team.left },
                health: { current: 100, max: 100 },
                deathState: { state: enums.deathState.dying }
            });

            expect(supplySystem.getCurrentSupply(enums.team.left)).toBe(0);
        });

        it('should separate supply by team', () => {
            game.createEntityWith({
                unitType: { type: 1, collection: 0 },
                team: { team: enums.team.left },
                health: { current: 100, max: 100 },
                deathState: { state: enums.deathState.alive }
            });
            game.createEntityWith({
                unitType: { type: 1, collection: 0 },
                team: { team: enums.team.right },
                health: { current: 100, max: 100 },
                deathState: { state: enums.deathState.alive }
            });

            expect(supplySystem.getCurrentSupply(enums.team.left)).toBe(10);
            expect(supplySystem.getCurrentSupply(enums.team.right)).toBe(10);
        });
    });

    describe('getCurrentPopulation', () => {
        it('should return 0 for team with no units', () => {
            expect(supplySystem.getCurrentPopulation(enums.team.left)).toBe(0);
        });

        it('should sum supply cost from units', () => {
            // Create units for left team
            game.createEntityWith({
                unitType: { type: 2, collection: 0 },  // type 2 = supplyCost: 2
                team: { team: enums.team.left },
                health: { current: 100, max: 100 },
                deathState: { state: enums.deathState.alive }
            });
            game.createEntityWith({
                unitType: { type: 2, collection: 0 },
                team: { team: enums.team.left },
                health: { current: 100, max: 100 },
                deathState: { state: enums.deathState.alive }
            });

            expect(supplySystem.getCurrentPopulation(enums.team.left)).toBe(4);
        });

        it('should not count dead units', () => {
            game.createEntityWith({
                unitType: { type: 2, collection: 0 },
                team: { team: enums.team.left },
                health: { current: 0, max: 100 },  // Dead
                deathState: { state: enums.deathState.alive }
            });

            expect(supplySystem.getCurrentPopulation(enums.team.left)).toBe(0);
        });
    });

    describe('canAffordSupply', () => {
        it('should return true when supply available', () => {
            // Create building with 10 supply
            game.createEntityWith({
                unitType: { type: 1, collection: 0 },
                team: { team: enums.team.left },
                health: { current: 100, max: 100 },
                deathState: { state: enums.deathState.alive }
            });

            const result = supplySystem.canAffordSupply(enums.team.left, { supplyCost: 5 });

            expect(result).toBe(true);
        });

        it('should return false when supply not available', () => {
            // No supply buildings
            const result = supplySystem.canAffordSupply(enums.team.left, { supplyCost: 5 });

            expect(result).toBe(false);
        });

        it('should account for existing population', () => {
            // Create building with 10 supply
            game.createEntityWith({
                unitType: { type: 1, collection: 0 },
                team: { team: enums.team.left },
                health: { current: 100, max: 100 },
                deathState: { state: enums.deathState.alive }
            });

            // Create units using 8 supply
            for (let i = 0; i < 4; i++) {
                game.createEntityWith({
                    unitType: { type: 2, collection: 0 },  // 2 supply each
                    team: { team: enums.team.left },
                    health: { current: 100, max: 100 },
                    deathState: { state: enums.deathState.alive }
                });
            }

            // Can afford 2 more supply (10 - 8 = 2)
            expect(supplySystem.canAffordSupply(enums.team.left, { supplyCost: 2 })).toBe(true);
            expect(supplySystem.canAffordSupply(enums.team.left, { supplyCost: 3 })).toBe(false);
        });

        it('should handle unit with no supplyCost', () => {
            game.createEntityWith({
                unitType: { type: 1, collection: 0 },
                team: { team: enums.team.left },
                health: { current: 100, max: 100 },
                deathState: { state: enums.deathState.alive }
            });

            const result = supplySystem.canAffordSupply(enums.team.left, {});

            expect(result).toBe(true);
        });
    });

    describe('recalculateSupply', () => {
        it('should skip recalculation when not dirty', () => {
            // Set up some cached data
            supplySystem.cachedSupply.set(enums.team.left, { supply: 100, population: 50 });
            supplySystem.isDirty = false;

            supplySystem.recalculateSupply();

            // Should not clear the cache
            expect(supplySystem.cachedSupply.get(enums.team.left).supply).toBe(100);
        });

        it('should recalculate when dirty', () => {
            supplySystem.cachedSupply.set(enums.team.left, { supply: 100, population: 50 });
            supplySystem.isDirty = true;

            supplySystem.recalculateSupply();

            // Cache should be cleared and recalculated
            expect(supplySystem.cachedSupply.get(enums.team.left)).toBeUndefined();
        });

        it('should set isDirty to false after recalculation', () => {
            supplySystem.isDirty = true;

            supplySystem.recalculateSupply();

            expect(supplySystem.isDirty).toBe(false);
        });
    });

    describe('update', () => {
        it('should not throw on server', () => {
            game.isServer = true;
            expect(() => supplySystem.update()).not.toThrow();
        });
    });
});
