import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TestGameContext } from '../../../../../../tests/TestGameContext.js';

describe('SelectedUnitSystem', () => {
    let game;
    let system;

    beforeEach(() => {
        game = new TestGameContext();

        // Mock canvas BEFORE creating the system (SelectedUnitSystem accesses this.game.canvas in constructor)
        game.canvas = {
            getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }),
            addEventListener: vi.fn(),
            parentElement: {
                appendChild: vi.fn(),
                style: {}
            }
        };

        system = game.createSystem(GUTS.SelectedUnitSystem);
    });

    describe('services', () => {
        it('should expose selectEntity service', () => {
            expect(game.hasService('selectEntity')).toBe(true);
        });

        it('should expose deselectAllUnits service', () => {
            expect(game.hasService('deselectAllUnits')).toBe(true);
        });

        it('should expose configureSelectionSystem service', () => {
            expect(game.hasService('configureSelectionSystem')).toBe(true);
        });
    });

    describe('configure', () => {
        it('should have default config with team filter enabled', () => {
            expect(system.config).toBeDefined();
            expect(system.config.enableTeamFilter).toBe(true);
        });

        it('should have default config excluding worldObjects', () => {
            expect(system.config.excludeCollections).toContain('worldObjects');
        });

        it('should allow configuring team filter', () => {
            system.configure({ enableTeamFilter: false });
            expect(system.config.enableTeamFilter).toBe(false);
        });

        it('should allow configuring excluded collections', () => {
            system.configure({ excludeCollections: [] });
            expect(system.config.excludeCollections).toEqual([]);
        });

        it('should allow configuring included collections', () => {
            system.configure({ includeCollections: ['units', 'buildings'] });
            expect(system.config.includeCollections).toEqual(['units', 'buildings']);
        });

        it('should merge with existing config', () => {
            system.configure({ enableTeamFilter: false });
            system.configure({ excludeCollections: ['special'] });
            expect(system.config.enableTeamFilter).toBe(false);
            expect(system.config.excludeCollections).toEqual(['special']);
        });

        it('should update circle color when provided', () => {
            system.configure({ circleColor: 0xff0000 });
            expect(system.CIRCLE_COLOR).toBe(0xff0000);
        });
    });

    describe('isEntitySelectableByCollection', () => {
        it('should return true for allowed collections', () => {
            system.configure({ excludeCollections: ['worldObjects'] });
            expect(system.isEntitySelectableByCollection('units')).toBe(true);
            expect(system.isEntitySelectableByCollection('buildings')).toBe(true);
        });

        it('should return false for excluded collections', () => {
            system.configure({ excludeCollections: ['worldObjects'] });
            expect(system.isEntitySelectableByCollection('worldObjects')).toBe(false);
        });

        it('should only allow included collections when specified', () => {
            system.configure({ includeCollections: ['units'], excludeCollections: [] });
            expect(system.isEntitySelectableByCollection('units')).toBe(true);
            expect(system.isEntitySelectableByCollection('buildings')).toBe(false);
        });

        it('should return true for any collection when no filters', () => {
            system.configure({ excludeCollections: [], includeCollections: null });
            expect(system.isEntitySelectableByCollection('anything')).toBe(true);
            expect(system.isEntitySelectableByCollection('worldObjects')).toBe(true);
        });

        it('should handle undefined collection gracefully', () => {
            system.configure({ excludeCollections: ['worldObjects'] });
            expect(system.isEntitySelectableByCollection(undefined)).toBe(true);
        });

        it('should respect both include and exclude lists', () => {
            // Exclude takes precedence - if in exclude, it's excluded even if in include
            system.configure({
                includeCollections: ['units', 'buildings'],
                excludeCollections: ['buildings']
            });
            expect(system.isEntitySelectableByCollection('units')).toBe(true);
            expect(system.isEntitySelectableByCollection('buildings')).toBe(false);
        });
    });

    describe('getEntityAtWorldPosition with team filter', () => {
        beforeEach(() => {
            game.state.myTeam = 1;
        });

        it('should select entities on player team when filter enabled', () => {
            system.configure({ enableTeamFilter: true, excludeCollections: [] });

            const friendly = game.createEntityWith({
                transform: { position: { x: 0, y: 0, z: 0 } },
                team: { team: 1 },
                renderable: { objectType: 0 }
            });

            const entity = system.getEntityAtWorldPosition({ x: 0, z: 0 });
            expect(entity).toBe(friendly);
        });

        it('should not select entities on other team when filter enabled', () => {
            system.configure({ enableTeamFilter: true, excludeCollections: [] });

            game.createEntityWith({
                transform: { position: { x: 0, y: 0, z: 0 } },
                team: { team: 2 },
                renderable: { objectType: 0 }
            });

            const entity = system.getEntityAtWorldPosition({ x: 0, z: 0 });
            expect(entity).toBeNull();
        });

        it('should select any team entity when team filter disabled', () => {
            system.configure({ enableTeamFilter: false, excludeCollections: [] });

            const enemy = game.createEntityWith({
                transform: { position: { x: 0, y: 0, z: 0 } },
                team: { team: 2 },
                renderable: { objectType: 0 }
            });

            const entity = system.getEntityAtWorldPosition({ x: 0, z: 0 });
            expect(entity).toBe(enemy);
        });

        it('should select entity without team component when filter disabled', () => {
            system.configure({ enableTeamFilter: false, excludeCollections: [] });

            const worldObject = game.createEntityWith({
                transform: { position: { x: 0, y: 0, z: 0 } },
                renderable: { objectType: 0 }
            });

            const entity = system.getEntityAtWorldPosition({ x: 0, z: 0 });
            expect(entity).toBe(worldObject);
        });

        it('should select closest entity when multiple in range', () => {
            system.configure({ enableTeamFilter: false, excludeCollections: [] });

            game.createEntityWith({
                transform: { position: { x: 30, y: 0, z: 0 } },
                renderable: { objectType: 0 }
            });

            const closer = game.createEntityWith({
                transform: { position: { x: 10, y: 0, z: 0 } },
                renderable: { objectType: 0 }
            });

            const entity = system.getEntityAtWorldPosition({ x: 0, z: 0 });
            expect(entity).toBe(closer);
        });
    });

    describe('terrain editor configuration', () => {
        it('should allow selecting all entities when configured for editor', () => {
            // Configure like terrain editor would
            system.configure({
                enableTeamFilter: false,
                excludeCollections: [],
                includeCollections: null
            });

            game.state.myTeam = 1;

            // Create enemy unit
            const enemy = game.createEntityWith({
                transform: { position: { x: 0, y: 0, z: 0 } },
                team: { team: 2 },
                renderable: { objectType: 0 }
            });

            const entity = system.getEntityAtWorldPosition({ x: 0, z: 0 });
            expect(entity).toBe(enemy);
        });

        it('should allow selecting worldObjects when configured for editor', () => {
            system.configure({
                enableTeamFilter: false,
                excludeCollections: []
            });

            // In real usage, reverseEnums would map objectType to collection
            // For this test, we verify the config allows worldObjects
            expect(system.isEntitySelectableByCollection('worldObjects')).toBe(true);
        });
    });
});
