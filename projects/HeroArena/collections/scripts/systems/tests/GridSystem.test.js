import { describe, it, expect, beforeEach } from 'vitest';
import { TestGameContext } from '../../../../../../tests/TestGameContext.js';

describe('GridSystem', () => {
    let game;
    let gridSystem;
    let enums;

    beforeEach(() => {
        game = new TestGameContext();

        // Register mock services needed by GridSystem
        game.register('getTerrainHeightAtPosition', () => 0);
        game.register('getUnitTypeDef', (unitTypeComp) => {
            if (!unitTypeComp) return null;
            return { placementGridWidth: 1, placementGridHeight: 1 };
        });

        gridSystem = game.createSystem(GUTS.GridSystem);
        enums = game.getEnums();
    });

    describe('getGridSize', () => {
        it('should return the terrain grid size', () => {
            const size = gridSystem.getGridSize();
            expect(size).toBeDefined();
            expect(size).toBeGreaterThan(0);
        });
    });

    describe('getPlacementGridSize', () => {
        it('should return half of the terrain grid size', () => {
            const terrainSize = gridSystem.getGridSize();
            const placementSize = gridSystem.getPlacementGridSize();
            expect(placementSize).toBe(terrainSize / 2);
        });
    });

    describe('_cellKey and _keyToCell', () => {
        it('should convert coordinates to numeric key', () => {
            const key1 = gridSystem._cellKey(0, 0);
            const key2 = gridSystem._cellKey(1, 0);
            const key3 = gridSystem._cellKey(0, 1);

            expect(key1).toBe(0);
            expect(key2).toBe(1);
            expect(key3).toBe(gridSystem.dimensions.width);
        });

        it('should convert key back to coordinates', () => {
            const coords = gridSystem._keyToCell(gridSystem.dimensions.width + 5);
            expect(coords.x).toBe(5);
            expect(coords.z).toBe(1);
        });

        it('should round-trip correctly', () => {
            const testCases = [
                { x: 0, z: 0 },
                { x: 10, z: 5 },
                { x: gridSystem.dimensions.width - 1, z: gridSystem.dimensions.height - 1 }
            ];

            for (const tc of testCases) {
                const key = gridSystem._cellKey(tc.x, tc.z);
                const back = gridSystem._keyToCell(key);
                expect(back.x).toBe(tc.x);
                expect(back.z).toBe(tc.z);
            }
        });
    });

    describe('isValidPosition', () => {
        it('should return true for valid positions', () => {
            expect(gridSystem.isValidPosition({ x: 0, z: 0 })).toBe(true);
            expect(gridSystem.isValidPosition({ x: 10, z: 10 })).toBe(true);
        });

        it('should return false for negative positions', () => {
            expect(gridSystem.isValidPosition({ x: -1, z: 0 })).toBe(false);
            expect(gridSystem.isValidPosition({ x: 0, z: -1 })).toBe(false);
        });

        it('should return false for positions outside grid', () => {
            expect(gridSystem.isValidPosition({ x: gridSystem.dimensions.width, z: 0 })).toBe(false);
            expect(gridSystem.isValidPosition({ x: 0, z: gridSystem.dimensions.height })).toBe(false);
        });
    });

    describe('worldToGrid and gridToWorld', () => {
        it('should convert world to grid coordinates', () => {
            const gridPos = gridSystem.worldToGrid(0, 0);
            expect(gridPos).toHaveProperty('x');
            expect(gridPos).toHaveProperty('z');
        });

        it('should convert grid to world coordinates', () => {
            const worldPos = gridSystem.gridToWorld(0, 0);
            expect(worldPos).toHaveProperty('x');
            expect(worldPos).toHaveProperty('z');
        });

        it('should approximately round-trip', () => {
            // Convert grid to world and back - should get same grid cell
            const originalGrid = { x: 10, z: 15 };
            const worldPos = gridSystem.gridToWorld(originalGrid.x, originalGrid.z);
            const backToGrid = gridSystem.worldToGrid(worldPos.x, worldPos.z);

            // Should be in the same or adjacent cell
            expect(Math.abs(backToGrid.x - originalGrid.x)).toBeLessThanOrEqual(1);
            expect(Math.abs(backToGrid.z - originalGrid.z)).toBeLessThanOrEqual(1);
        });
    });

    describe('occupyCells and freeCells', () => {
        it('should occupy cells for an entity', () => {
            const entityId = game.createEntity();
            const cells = [{ x: 5, z: 5 }, { x: 5, z: 6 }];

            gridSystem.occupyCells(cells, entityId);

            const cellState1 = gridSystem.getCellState(5, 5);
            const cellState2 = gridSystem.getCellState(5, 6);

            expect(cellState1).toBeDefined();
            expect(cellState1.entities).toContain(entityId);
            expect(cellState2).toBeDefined();
            expect(cellState2.entities).toContain(entityId);
        });

        it('should not duplicate entity in same cell', () => {
            const entityId = game.createEntity();
            const cells = [{ x: 10, z: 10 }];

            gridSystem.occupyCells(cells, entityId);
            gridSystem.occupyCells(cells, entityId);

            const cellState = gridSystem.getCellState(10, 10);
            const count = cellState.entities.filter(id => id === entityId).length;
            expect(count).toBe(1);
        });

        it('should free cells for an entity', () => {
            const entityId = game.createEntity();
            const cells = [{ x: 20, z: 20 }];

            gridSystem.occupyCells(cells, entityId);
            expect(gridSystem.getCellState(20, 20)).toBeDefined();

            gridSystem.freeCells(entityId);
            // Cell should be deleted when empty
            expect(gridSystem.getCellState(20, 20)).toBeUndefined();
        });

        it('should handle empty cells array', () => {
            expect(() => gridSystem.occupyCells([], 1)).not.toThrow();
            expect(() => gridSystem.occupyCells(null, 1)).not.toThrow();
        });
    });

    describe('isValidGridPlacement', () => {
        it('should return true for empty cells', () => {
            const cells = [{ x: 30, z: 30 }, { x: 30, z: 31 }];
            expect(gridSystem.isValidGridPlacement(cells, enums.team.left)).toBe(true);
        });

        it('should return false for occupied cells', () => {
            const entityId = game.createEntity();
            const cells = [{ x: 40, z: 40 }];

            gridSystem.occupyCells(cells, entityId);

            expect(gridSystem.isValidGridPlacement(cells, enums.team.left)).toBe(false);
        });

        it('should return false for empty cells array', () => {
            expect(gridSystem.isValidGridPlacement([], enums.team.left)).toBe(false);
            expect(gridSystem.isValidGridPlacement(null, enums.team.left)).toBe(false);
        });
    });

    describe('areCellsOccupied', () => {
        it('should return false for empty cells', () => {
            const cells = [{ x: 50, z: 50 }];
            expect(gridSystem.areCellsOccupied(cells)).toBe(false);
        });

        it('should return true if any cell is occupied', () => {
            const entityId = game.createEntity();
            gridSystem.occupyCells([{ x: 60, z: 60 }], entityId);

            const cells = [{ x: 59, z: 60 }, { x: 60, z: 60 }, { x: 61, z: 60 }];
            expect(gridSystem.areCellsOccupied(cells)).toBe(true);
        });
    });

    describe('getBounds', () => {
        it('should return left bounds for left team', () => {
            const bounds = gridSystem.getBounds(enums.team.left);
            expect(bounds).toBe(gridSystem.leftBounds);
        });

        it('should return right bounds for right team', () => {
            const bounds = gridSystem.getBounds(enums.team.right);
            expect(bounds).toBe(gridSystem.rightBounds);
        });

        it('should have non-overlapping bounds', () => {
            expect(gridSystem.leftBounds.maxX).toBeLessThan(gridSystem.rightBounds.minX);
        });
    });

    describe('setTeamBounds', () => {
        it('should assign correct bounds for left team', () => {
            gridSystem.setTeamBounds(enums.team.left);
            expect(gridSystem.playerBounds).toBe(gridSystem.leftBounds);
            expect(gridSystem.enemyBounds).toBe(gridSystem.rightBounds);
        });

        it('should assign correct bounds for right team', () => {
            gridSystem.setTeamBounds(enums.team.right);
            expect(gridSystem.playerBounds).toBe(gridSystem.rightBounds);
            expect(gridSystem.enemyBounds).toBe(gridSystem.leftBounds);
        });
    });

    describe('clear', () => {
        it('should clear all state', () => {
            const entityId = game.createEntity();
            gridSystem.occupyCells([{ x: 5, z: 5 }], entityId);

            expect(gridSystem.state.size).toBeGreaterThan(0);

            gridSystem.clear();

            expect(gridSystem.state.size).toBe(0);
            expect(gridSystem._entityPositions.size).toBe(0);
        });
    });

    describe('getGridInfo', () => {
        it('should return grid information', () => {
            const info = gridSystem.getGridInfo();

            expect(info.dimensions).toBeDefined();
            expect(info.leftBounds).toBeDefined();
            expect(info.rightBounds).toBeDefined();
            expect(info.totalCells).toBe(info.dimensions.width * info.dimensions.height);
        });

        it('should count occupied cells correctly', () => {
            const entityId = game.createEntity();
            gridSystem.occupyCells([{ x: 1, z: 1 }, { x: 1, z: 2 }], entityId);

            const info = gridSystem.getGridInfo();
            expect(info.occupiedCount).toBe(2);
        });
    });

    describe('dimensions', () => {
        it('should have valid dimensions', () => {
            expect(gridSystem.dimensions.width).toBeGreaterThan(0);
            expect(gridSystem.dimensions.height).toBeGreaterThan(0);
            expect(gridSystem.dimensions.cellSize).toBeGreaterThan(0);
        });

        it('should have symmetric width and height', () => {
            // For square maps, width should equal height
            expect(gridSystem.dimensions.width).toBe(gridSystem.dimensions.height);
        });
    });

    describe('getNearbyUnits', () => {
        it('should return empty array when no units nearby', () => {
            const result = gridSystem.getNearbyUnits({ x: 0, z: 0 }, 100);
            expect(result).toEqual([]);
        });

        it('should exclude specified entity', () => {
            const entity = game.createEntityWith({
                unitType: { type: 1, collection: 1 },
                transform: { position: { x: 0, y: 0, z: 0 } },
                health: { current: 100, max: 100 }
            });

            // Manually add to grid for this test
            gridSystem.occupyCells([{ x: 32, z: 32 }], entity);

            const result = gridSystem.getNearbyUnits({ x: 0, z: 0 }, 1000, entity);
            expect(result).not.toContain(entity);
        });
    });

    describe('onSceneUnload', () => {
        it('should clear all state on unload', () => {
            const entityId = game.createEntity();
            gridSystem.occupyCells([{ x: 1, z: 1 }], entityId);
            gridSystem._entityPositions.set(entityId, { gridX: 1, gridZ: 1, cellKeys: new Set([1]) });

            gridSystem.onSceneUnload();

            expect(gridSystem.state.size).toBe(0);
            expect(gridSystem._entityPositions.size).toBe(0);
            expect(gridSystem.debugEnabled).toBe(false);
        });
    });
});
