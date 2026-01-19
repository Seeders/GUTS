import { describe, it, expect, beforeEach } from 'vitest';
import { TestGameContext } from '../../../../../../tests/TestGameContext.js';

describe('SquadSystem', () => {
    let game;
    let squadSystem;
    let enums;

    beforeEach(() => {
        game = new TestGameContext();

        // Register mock services needed by SquadSystem
        game.register('getPlacementGridSize', () => 32);
        game.register('placementGridToWorld', (x, z) => ({
            x: x * 32 - 512,
            z: z * 32 - 512
        }));

        squadSystem = game.createSystem(GUTS.SquadSystem);
        enums = game.getEnums();
    });

    describe('getSquadData', () => {
        it('should return default config for minimal unit type', () => {
            const unitType = {};
            const squadData = squadSystem.getSquadData(unitType);

            expect(squadData.squadWidth).toBe(1);
            expect(squadData.squadHeight).toBe(1);
            expect(squadData.placementGridWidth).toBe(1);
            expect(squadData.placementGridHeight).toBe(1);
        });

        it('should use unit type values when provided', () => {
            const unitType = {
                squadWidth: 3,
                squadHeight: 2,
                placementGridWidth: 4,
                placementGridHeight: 3
            };
            const squadData = squadSystem.getSquadData(unitType);

            expect(squadData.squadWidth).toBe(3);
            expect(squadData.squadHeight).toBe(2);
            expect(squadData.placementGridWidth).toBe(4);
            expect(squadData.placementGridHeight).toBe(3);
        });

        it('should include building-specific properties', () => {
            const unitType = {
                collection: 'buildings',
                footprintWidth: 2,
                footprintHeight: 2
            };
            const squadData = squadSystem.getSquadData(unitType);

            expect(squadData.collection).toBe('buildings');
            expect(squadData.footprintWidth).toBe(2);
            expect(squadData.footprintHeight).toBe(2);
        });
    });

    describe('getSquadCells', () => {
        it('should return single cell for 1x1 squad', () => {
            const gridPos = { x: 10, z: 10 };
            const squadData = { placementGridWidth: 1, placementGridHeight: 1 };

            const cells = squadSystem.getSquadCells(gridPos, squadData);

            expect(cells.length).toBe(1);
            expect(cells[0]).toEqual({ x: 10, z: 10 });
        });

        it('should return centered cells for 2x2 squad', () => {
            const gridPos = { x: 10, z: 10 };
            const squadData = { placementGridWidth: 2, placementGridHeight: 2 };

            const cells = squadSystem.getSquadCells(gridPos, squadData);

            expect(cells.length).toBe(4);
            // Should be centered around 10,10
            const xValues = cells.map(c => c.x);
            const zValues = cells.map(c => c.z);
            expect(Math.min(...xValues)).toBe(9);
            expect(Math.max(...xValues)).toBe(10);
            expect(Math.min(...zValues)).toBe(9);
            expect(Math.max(...zValues)).toBe(10);
        });

        it('should return centered cells for 3x3 squad', () => {
            const gridPos = { x: 10, z: 10 };
            const squadData = { placementGridWidth: 3, placementGridHeight: 3 };

            const cells = squadSystem.getSquadCells(gridPos, squadData);

            expect(cells.length).toBe(9);
            // Center should be 10,10, so cells should span 9-11
            const xValues = cells.map(c => c.x);
            const zValues = cells.map(c => c.z);
            expect(Math.min(...xValues)).toBe(9);
            expect(Math.max(...xValues)).toBe(11);
            expect(Math.min(...zValues)).toBe(9);
            expect(Math.max(...zValues)).toBe(11);
        });

        it('should use calculateFootprintCells for buildings', () => {
            const gridPos = { x: 10, z: 10 };
            const squadData = {
                collection: 'buildings',
                footprintWidth: 2,
                footprintHeight: 2,
                placementGridWidth: 2,
                placementGridHeight: 2
            };

            const cells = squadSystem.getSquadCells(gridPos, squadData);

            // Building footprint is doubled for placement grid
            expect(cells.length).toBe(16); // 4x4 cells
        });
    });

    describe('calculateFootprintCells', () => {
        it('should calculate correct footprint for 1x1 building', () => {
            const gridPos = { x: 10, z: 10 };
            const building = { footprintWidth: 1, footprintHeight: 1 };

            const cells = squadSystem.calculateFootprintCells(gridPos, building);

            // 1x1 footprint = 2x2 placement grid cells
            expect(cells.length).toBe(4);
        });

        it('should calculate correct footprint for 2x2 building', () => {
            const gridPos = { x: 10, z: 10 };
            const building = { footprintWidth: 2, footprintHeight: 2 };

            const cells = squadSystem.calculateFootprintCells(gridPos, building);

            // 2x2 footprint = 4x4 placement grid cells
            expect(cells.length).toBe(16);
        });

        it('should use placementGridWidth if footprint not defined', () => {
            const gridPos = { x: 10, z: 10 };
            const building = { placementGridWidth: 2, placementGridHeight: 2 };

            const cells = squadSystem.calculateFootprintCells(gridPos, building);

            // Falls back to placement size * 2
            expect(cells.length).toBe(16);
        });
    });

    describe('getSquadSize', () => {
        it('should calculate size for 1x1 squad', () => {
            expect(squadSystem.getSquadSize({ squadWidth: 1, squadHeight: 1 })).toBe(1);
        });

        it('should calculate size for 3x3 squad', () => {
            expect(squadSystem.getSquadSize({ squadWidth: 3, squadHeight: 3 })).toBe(9);
        });

        it('should calculate size for 2x4 squad', () => {
            expect(squadSystem.getSquadSize({ squadWidth: 2, squadHeight: 4 })).toBe(8);
        });
    });

    describe('canFitInZone', () => {
        it('should return true when squad fits in zone', () => {
            const squadData = { placementGridWidth: 2, placementGridHeight: 2 };
            const bounds = { minX: 0, maxX: 10, minZ: 0, maxZ: 10 };

            expect(squadSystem.canFitInZone(squadData, bounds)).toBe(true);
        });

        it('should return false when squad is too wide', () => {
            const squadData = { placementGridWidth: 15, placementGridHeight: 2 };
            const bounds = { minX: 0, maxX: 10, minZ: 0, maxZ: 10 };

            expect(squadSystem.canFitInZone(squadData, bounds)).toBe(false);
        });

        it('should return false when squad is too tall', () => {
            const squadData = { placementGridWidth: 2, placementGridHeight: 15 };
            const bounds = { minX: 0, maxX: 10, minZ: 0, maxZ: 10 };

            expect(squadSystem.canFitInZone(squadData, bounds)).toBe(false);
        });

        it('should return true when squad exactly fits zone', () => {
            const squadData = { placementGridWidth: 5, placementGridHeight: 5 };
            const bounds = { minX: 0, maxX: 4, minZ: 0, maxZ: 4 };

            expect(squadSystem.canFitInZone(squadData, bounds)).toBe(true);
        });
    });

    describe('calculateUnitPositions', () => {
        it('should return single position for 1x1 squad', () => {
            const gridPos = { x: 10, z: 10 };
            const unitType = {
                squadWidth: 1,
                squadHeight: 1,
                placementGridWidth: 1,
                placementGridHeight: 1
            };

            const positions = squadSystem.calculateUnitPositions(gridPos, unitType);

            expect(positions.length).toBe(1);
            expect(positions[0]).toHaveProperty('x');
            expect(positions[0]).toHaveProperty('z');
        });

        it('should return correct positions for 2x2 squad matching placement', () => {
            const gridPos = { x: 10, z: 10 };
            const unitType = {
                squadWidth: 2,
                squadHeight: 2,
                placementGridWidth: 2,
                placementGridHeight: 2
            };

            const positions = squadSystem.calculateUnitPositions(gridPos, unitType);

            expect(positions.length).toBe(4);
            // All positions should be unique
            const uniquePositions = new Set(positions.map(p => `${p.x},${p.z}`));
            expect(uniquePositions.size).toBe(4);
        });

        it('should return correct positions for 3x1 squad', () => {
            const gridPos = { x: 10, z: 10 };
            const unitType = {
                squadWidth: 3,
                squadHeight: 1,
                placementGridWidth: 3,
                placementGridHeight: 1
            };

            const positions = squadSystem.calculateUnitPositions(gridPos, unitType);

            expect(positions.length).toBe(3);
            // All should have same z (single row)
            const zValues = new Set(positions.map(p => p.z));
            expect(zValues.size).toBe(1);
        });

        it('should handle smaller squad than placement grid', () => {
            const gridPos = { x: 10, z: 10 };
            const unitType = {
                squadWidth: 2,
                squadHeight: 2,
                placementGridWidth: 4,
                placementGridHeight: 4
            };

            const positions = squadSystem.calculateUnitPositions(gridPos, unitType);

            expect(positions.length).toBe(4);
            // Positions should be spread out in the larger area
        });
    });

    describe('DEFAULT_SQUAD_CONFIG', () => {
        it('should have valid defaults', () => {
            expect(squadSystem.DEFAULT_SQUAD_CONFIG.squadWidth).toBe(1);
            expect(squadSystem.DEFAULT_SQUAD_CONFIG.squadHeight).toBe(1);
            expect(squadSystem.DEFAULT_SQUAD_CONFIG.placementGridWidth).toBe(1);
            expect(squadSystem.DEFAULT_SQUAD_CONFIG.placementGridHeight).toBe(1);
        });
    });

    describe('getSquadInfoFromType', () => {
        it('should be an alias for getSquadInfo', () => {
            // This just verifies the method exists and doesn't throw
            expect(() => squadSystem.getSquadInfoFromType({})).not.toThrow();
        });
    });
});
