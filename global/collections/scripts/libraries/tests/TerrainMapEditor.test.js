import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * TerrainMapEditor Tests
 *
 * Tests core terrain editing logic by creating a minimal editor instance
 * that doesn't run the full constructor initialization.
 */

describe('TerrainMapEditor', () => {
    let editor;
    let mockCollections;

    // Create a minimal mock editor for testing pure logic methods
    function createTestEditor(config = {}) {
        mockCollections = {
            configs: { game: { isIsometric: true } },
            objectTypeDefinitions: {
                worldObjects: { singular: 'worldObject' },
                units: { singular: 'unit' },
                buildings: { singular: 'building' }
            },
            terrainTypes: {}
        };

        // Create a minimal object that has the methods we want to test
        // We'll bind the actual class methods to this object
        const size = config.mapSize || 16;

        const testEditor = {
            gameEditor: {
                getCollections: () => mockCollections,
                getCurrentProject: () => 'TestProject'
            },
            collections: mockCollections,
            defaultMapSize: 16,
            mapSize: size,
            currentTerrainId: 3,
            currentHeightLevel: 0,
            brushSize: 1,
            placementMode: 'terrain',
            terrainTool: 'brush',
            undoStack: [],
            redoStack: [],
            maxUndoSteps: 50,
            lastPaintedTile: null,
            tileMap: {
                size: size,
                terrainTypes: ['void', 'dirt', 'stone', 'grass', 'water'],
                terrainMap: [],
                heightMap: [],
                terrainBGColor: '#7aad7b'
            },
            worldRenderer: null
        };

        // Initialize maps
        for (let y = 0; y < size; y++) {
            testEditor.tileMap.terrainMap.push(new Array(size).fill(3)); // grass
            testEditor.tileMap.heightMap.push(new Array(size).fill(0));
        }

        // Bind the pure logic methods from the prototype
        const proto = GUTS.TerrainMapEditor.prototype;

        testEditor.getCollectionFromPrefab = proto.getCollectionFromPrefab.bind(testEditor);
        testEditor.isLiquidTerrainType = proto.isLiquidTerrainType.bind(testEditor);
        testEditor.getAffectedTiles = proto.getAffectedTiles.bind(testEditor);
        testEditor.paintBrushTerrain = proto.paintBrushTerrain.bind(testEditor);
        testEditor.paintBrushHeight = proto.paintBrushHeight.bind(testEditor);
        testEditor.floodFillTerrain = proto.floodFillTerrain.bind(testEditor);
        testEditor.floodFillHeight = proto.floodFillHeight.bind(testEditor);
        testEditor.isValidRampPlacement = proto.isValidRampPlacement.bind(testEditor);
        testEditor.wouldModifyTiles = proto.wouldModifyTiles.bind(testEditor);
        testEditor.saveUndoState = proto.saveUndoState.bind(testEditor);
        testEditor.adjustWaterTileHeights = proto.adjustWaterTileHeights.bind(testEditor);

        // Stub methods that interact with 3D rendering
        testEditor.update3DHeightRegion = () => {};
        testEditor.update3DTerrainRegion = () => {};

        return testEditor;
    }

    beforeEach(() => {
        editor = createTestEditor();
    });

    describe('initialization', () => {
        it('should create editor instance', () => {
            expect(editor).toBeDefined();
        });

        it('should initialize with default map size of 16', () => {
            expect(editor.defaultMapSize).toBe(16);
        });

        it('should initialize with default terrain ID of 3 (grass)', () => {
            expect(editor.currentTerrainId).toBe(3);
        });

        it('should initialize with default height level of 0', () => {
            expect(editor.currentHeightLevel).toBe(0);
        });

        it('should initialize with default brush size of 1', () => {
            expect(editor.brushSize).toBe(1);
        });

        it('should initialize placement mode as terrain', () => {
            expect(editor.placementMode).toBe('terrain');
        });

        it('should initialize terrain tool as brush', () => {
            expect(editor.terrainTool).toBe('brush');
        });

        it('should initialize undo stack as empty array', () => {
            expect(editor.undoStack).toEqual([]);
        });

        it('should initialize redo stack as empty array', () => {
            expect(editor.redoStack).toEqual([]);
        });

        it('should set max undo steps to 50', () => {
            expect(editor.maxUndoSteps).toBe(50);
        });
    });

    describe('getCollectionFromPrefab', () => {
        it('should return collection ID for valid prefab', () => {
            expect(editor.getCollectionFromPrefab('worldObject')).toBe('worldObjects');
        });

        it('should return collection ID for unit prefab', () => {
            expect(editor.getCollectionFromPrefab('unit')).toBe('units');
        });

        it('should return collection ID for building prefab', () => {
            expect(editor.getCollectionFromPrefab('building')).toBe('buildings');
        });

        it('should return null for unknown prefab', () => {
            expect(editor.getCollectionFromPrefab('unknownPrefab')).toBeNull();
        });

        it('should return null for null input', () => {
            expect(editor.getCollectionFromPrefab(null)).toBeNull();
        });

        it('should return null for undefined input', () => {
            expect(editor.getCollectionFromPrefab(undefined)).toBeNull();
        });
    });

    describe('isLiquidTerrainType', () => {
        it('should return true for water terrain', () => {
            editor.tileMap.terrainTypes[4] = 'water';
            expect(editor.isLiquidTerrainType(4)).toBe(true);
        });

        it('should return true for lava terrain', () => {
            editor.tileMap.terrainTypes[5] = 'lava';
            expect(editor.isLiquidTerrainType(5)).toBe(true);
        });

        it('should return true for liquid terrain', () => {
            editor.tileMap.terrainTypes[6] = 'liquid_acid';
            expect(editor.isLiquidTerrainType(6)).toBe(true);
        });

        it('should return true for case-insensitive water', () => {
            editor.tileMap.terrainTypes[7] = 'WATER';
            expect(editor.isLiquidTerrainType(7)).toBe(true);
        });

        it('should return false for grass terrain', () => {
            editor.tileMap.terrainTypes[3] = 'grass';
            expect(editor.isLiquidTerrainType(3)).toBe(false);
        });

        it('should return false for dirt terrain', () => {
            editor.tileMap.terrainTypes[1] = 'dirt';
            expect(editor.isLiquidTerrainType(1)).toBe(false);
        });

        it('should return false for invalid terrain ID', () => {
            expect(editor.isLiquidTerrainType(999)).toBe(false);
        });
    });

    describe('getAffectedTiles', () => {
        it('should return single tile for brush size 1', () => {
            editor.brushSize = 1;
            const tiles = editor.getAffectedTiles(5, 5);
            expect(tiles.length).toBe(1);
            expect(tiles[0]).toEqual({ x: 5, y: 5 });
        });

        it('should return multiple tiles for brush size 3', () => {
            editor.brushSize = 3;
            const tiles = editor.getAffectedTiles(5, 5);
            expect(tiles.length).toBeGreaterThan(1);
        });

        it('should not include tiles outside map bounds', () => {
            editor.brushSize = 5;
            const tiles = editor.getAffectedTiles(0, 0);
            tiles.forEach(tile => {
                expect(tile.x).toBeGreaterThanOrEqual(0);
                expect(tile.y).toBeGreaterThanOrEqual(0);
                expect(tile.x).toBeLessThan(editor.mapSize);
                expect(tile.y).toBeLessThan(editor.mapSize);
            });
        });

        it('should handle edge of map correctly', () => {
            editor.brushSize = 3;
            const tiles = editor.getAffectedTiles(15, 15);
            tiles.forEach(tile => {
                expect(tile.x).toBeLessThan(editor.mapSize);
                expect(tile.y).toBeLessThan(editor.mapSize);
            });
        });
    });

    describe('paintBrushTerrain', () => {
        it('should modify terrain at specified position', () => {
            editor.brushSize = 1;
            editor.paintBrushTerrain(5, 5, 1); // dirt

            expect(editor.tileMap.terrainMap[5][5]).toBe(1);
        });

        it('should return array of modified tiles', () => {
            editor.brushSize = 1;
            const modified = editor.paintBrushTerrain(5, 5, 1);

            expect(Array.isArray(modified)).toBe(true);
            expect(modified.length).toBe(1);
            expect(modified[0]).toEqual({ x: 5, y: 5 });
        });

        it('should not modify if terrain is same', () => {
            editor.brushSize = 1;
            editor.tileMap.terrainMap[5][5] = 1;
            const modified = editor.paintBrushTerrain(5, 5, 1);

            expect(modified.length).toBe(0);
        });

        it('should paint in circular pattern for larger brush', () => {
            editor.brushSize = 3;
            const modified = editor.paintBrushTerrain(8, 8, 2);

            expect(modified.length).toBeGreaterThan(1);
            modified.forEach(tile => {
                expect(editor.tileMap.terrainMap[tile.y][tile.x]).toBe(2);
            });
        });

        it('should add to undo stack', () => {
            editor.undoStack = [];
            editor.brushSize = 1;
            editor.paintBrushTerrain(5, 5, 1);

            expect(editor.undoStack.length).toBe(1);
        });
    });

    describe('paintBrushHeight', () => {
        it('should modify height at specified position', () => {
            editor.brushSize = 1;
            editor.paintBrushHeight(5, 5, 2);

            expect(editor.tileMap.heightMap[5][5]).toBe(2);
        });

        it('should return array of modified tiles', () => {
            editor.brushSize = 1;
            const modified = editor.paintBrushHeight(5, 5, 1);

            expect(Array.isArray(modified)).toBe(true);
            expect(modified.length).toBe(1);
        });

        it('should not modify if height is same', () => {
            editor.brushSize = 1;
            editor.tileMap.heightMap[5][5] = 2;
            const modified = editor.paintBrushHeight(5, 5, 2);

            expect(modified.length).toBe(0);
        });
    });

    describe('floodFillTerrain', () => {
        it('should fill connected tiles of same terrain', () => {
            // Set up a 3x3 area of dirt
            for (let y = 3; y <= 5; y++) {
                for (let x = 3; x <= 5; x++) {
                    editor.tileMap.terrainMap[y][x] = 1; // dirt
                }
            }

            const modified = editor.floodFillTerrain(4, 4, 2); // stone

            expect(modified.length).toBe(9);
            for (let y = 3; y <= 5; y++) {
                for (let x = 3; x <= 5; x++) {
                    expect(editor.tileMap.terrainMap[y][x]).toBe(2);
                }
            }
        });

        it('should not fill if starting terrain matches target', () => {
            editor.tileMap.terrainMap[5][5] = 2;
            const result = editor.floodFillTerrain(5, 5, 2);

            expect(result).toBe(false);
        });

        it('should return false for out of bounds', () => {
            expect(editor.floodFillTerrain(-1, 0, 1)).toBe(false);
            expect(editor.floodFillTerrain(0, -1, 1)).toBe(false);
            expect(editor.floodFillTerrain(100, 0, 1)).toBe(false);
            expect(editor.floodFillTerrain(0, 100, 1)).toBe(false);
        });

        it('should stop at different terrain boundaries', () => {
            // Create a bordered area
            for (let y = 3; y <= 5; y++) {
                for (let x = 3; x <= 5; x++) {
                    editor.tileMap.terrainMap[y][x] = 1; // dirt inside
                }
            }
            // Border with stone
            editor.tileMap.terrainMap[2][4] = 2;
            editor.tileMap.terrainMap[6][4] = 2;

            const modified = editor.floodFillTerrain(4, 4, 0); // void

            // Should only fill the 3x3 area, not cross the boundaries
            expect(editor.tileMap.terrainMap[2][4]).toBe(2); // unchanged
            expect(editor.tileMap.terrainMap[6][4]).toBe(2); // unchanged
        });
    });

    describe('floodFillHeight', () => {
        it('should fill connected tiles of same height', () => {
            // Set up a 3x3 area at height 1
            for (let y = 3; y <= 5; y++) {
                for (let x = 3; x <= 5; x++) {
                    editor.tileMap.heightMap[y][x] = 1;
                }
            }

            const modified = editor.floodFillHeight(4, 4, 2);

            expect(modified.length).toBe(9);
            for (let y = 3; y <= 5; y++) {
                for (let x = 3; x <= 5; x++) {
                    expect(editor.tileMap.heightMap[y][x]).toBe(2);
                }
            }
        });

        it('should not fill if starting height matches target', () => {
            editor.tileMap.heightMap[5][5] = 2;
            const result = editor.floodFillHeight(5, 5, 2);

            expect(result).toBe(false);
        });

        it('should return false for out of bounds', () => {
            expect(editor.floodFillHeight(-1, 0, 1)).toBe(false);
            expect(editor.floodFillHeight(0, -1, 1)).toBe(false);
        });
    });

    describe('isValidRampPlacement', () => {
        beforeEach(() => {
            // Set all tiles to height 0
            for (let y = 0; y < editor.mapSize; y++) {
                for (let x = 0; x < editor.mapSize; x++) {
                    editor.tileMap.heightMap[y][x] = 0;
                }
            }
        });

        it('should return false when no height map exists', () => {
            editor.tileMap.heightMap = null;
            expect(editor.isValidRampPlacement(5, 5)).toBe(false);
        });

        it('should return false when height map is empty', () => {
            editor.tileMap.heightMap = [];
            expect(editor.isValidRampPlacement(5, 5)).toBe(false);
        });

        it('should return true for valid ramp with one lower north neighbor', () => {
            editor.tileMap.heightMap[5][5] = 1; // Higher tile
            editor.tileMap.heightMap[4][5] = 0; // Lower neighbor to north
            editor.tileMap.heightMap[6][5] = 1; // Same height south
            editor.tileMap.heightMap[5][4] = 1; // Same height west
            editor.tileMap.heightMap[5][6] = 1; // Same height east

            expect(editor.isValidRampPlacement(5, 5)).toBe(true);
        });

        it('should return false for no lower neighbors', () => {
            editor.tileMap.heightMap[5][5] = 1;
            editor.tileMap.heightMap[4][5] = 1;
            editor.tileMap.heightMap[6][5] = 1;
            editor.tileMap.heightMap[5][4] = 1;
            editor.tileMap.heightMap[5][6] = 1;

            expect(editor.isValidRampPlacement(5, 5)).toBe(false);
        });

        it('should return false for two lower neighbors', () => {
            editor.tileMap.heightMap[5][5] = 1;
            editor.tileMap.heightMap[4][5] = 0; // Lower north
            editor.tileMap.heightMap[6][5] = 0; // Lower south
            editor.tileMap.heightMap[5][4] = 1;
            editor.tileMap.heightMap[5][6] = 1;

            expect(editor.isValidRampPlacement(5, 5)).toBe(false);
        });

        it('should return false for undefined position', () => {
            expect(editor.isValidRampPlacement(100, 100)).toBe(false);
        });
    });

    describe('wouldModifyTiles', () => {
        it('should return true when terrain would change', () => {
            editor.placementMode = 'terrain';
            editor.currentTerrainId = 2; // stone
            editor.tileMap.terrainMap[5][5] = 1; // dirt

            const tiles = [{ x: 5, y: 5 }];
            expect(editor.wouldModifyTiles(tiles)).toBe(true);
        });

        it('should return false when terrain is same', () => {
            editor.placementMode = 'terrain';
            editor.currentTerrainId = 1;
            editor.tileMap.terrainMap[5][5] = 1;

            const tiles = [{ x: 5, y: 5 }];
            expect(editor.wouldModifyTiles(tiles)).toBe(false);
        });

        it('should return true when height would change', () => {
            editor.placementMode = 'height';
            editor.currentHeightLevel = 2;
            editor.tileMap.heightMap[5][5] = 1;

            const tiles = [{ x: 5, y: 5 }];
            expect(editor.wouldModifyTiles(tiles)).toBe(true);
        });

        it('should return false when height is same', () => {
            editor.placementMode = 'height';
            editor.currentHeightLevel = 1;
            editor.tileMap.heightMap[5][5] = 1;

            const tiles = [{ x: 5, y: 5 }];
            expect(editor.wouldModifyTiles(tiles)).toBe(false);
        });

        it('should return true for other placement modes', () => {
            editor.placementMode = 'placements';
            const tiles = [{ x: 5, y: 5 }];
            expect(editor.wouldModifyTiles(tiles)).toBe(true);
        });
    });

    describe('undo/redo', () => {
        it('should save undo state when painting', () => {
            editor.undoStack = [];
            editor.brushSize = 1;
            editor.paintBrushTerrain(5, 5, 1);

            expect(editor.undoStack.length).toBe(1);
            expect(editor.undoStack[0].type).toBe('terrain');
        });

        it('should clear redo stack when new action is taken', () => {
            editor.redoStack = [{ type: 'terrain', tiles: [] }];
            editor.paintBrushTerrain(5, 5, 1);

            expect(editor.redoStack.length).toBe(0);
        });

        it('should limit undo stack to maxUndoSteps', () => {
            editor.undoStack = [];
            editor.maxUndoSteps = 5;

            for (let i = 0; i < 10; i++) {
                editor.paintBrushTerrain(i, i, 1);
            }

            expect(editor.undoStack.length).toBeLessThanOrEqual(5);
        });
    });

    describe('adjustWaterTileHeights', () => {
        beforeEach(() => {
            // Set up terrain types
            editor.tileMap.terrainTypes = ['void', 'dirt', 'stone', 'grass', 'water'];

            // Initialize height map
            for (let y = 0; y < editor.mapSize; y++) {
                for (let x = 0; x < editor.mapSize; x++) {
                    editor.tileMap.heightMap[y][x] = 1;
                    editor.tileMap.terrainMap[y][x] = 3; // grass
                }
            }
        });

        it('should return empty array when no height map', () => {
            editor.tileMap.heightMap = null;
            const result = editor.adjustWaterTileHeights([{ x: 5, y: 5 }]);
            expect(result).toEqual([]);
        });

        it('should lower water height when higher than neighbors', () => {
            // Set water tile at height 2
            editor.tileMap.terrainMap[5][5] = 4; // water
            editor.tileMap.heightMap[5][5] = 2;

            // Neighbors at height 1
            editor.tileMap.heightMap[4][5] = 1;
            editor.tileMap.heightMap[6][5] = 1;
            editor.tileMap.heightMap[5][4] = 1;
            editor.tileMap.heightMap[5][6] = 1;

            const adjusted = editor.adjustWaterTileHeights([{ x: 5, y: 5 }]);

            expect(adjusted.length).toBe(1);
            expect(editor.tileMap.heightMap[5][5]).toBe(0); // Should be min neighbor - 1
        });

        it('should not adjust water lower than neighbors', () => {
            editor.tileMap.terrainMap[5][5] = 4; // water
            editor.tileMap.heightMap[5][5] = 0;

            // Neighbors at height 2
            editor.tileMap.heightMap[4][5] = 2;
            editor.tileMap.heightMap[6][5] = 2;

            const adjusted = editor.adjustWaterTileHeights([{ x: 5, y: 5 }]);

            expect(adjusted.length).toBe(0);
            expect(editor.tileMap.heightMap[5][5]).toBe(0);
        });
    });
});
