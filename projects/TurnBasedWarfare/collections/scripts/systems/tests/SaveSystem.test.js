import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TestGameContext } from '../../../../../../tests/TestGameContext.js';

describe('SaveSystem', () => {
    let game;
    let saveSystem;
    let enums;

    beforeEach(() => {
        game = new TestGameContext();

        // Mock localStorage
        const storage = {};
        vi.stubGlobal('localStorage', {
            getItem: (key) => storage[key] || null,
            setItem: (key, value) => { storage[key] = value; },
            removeItem: (key) => { delete storage[key]; }
        });

        saveSystem = game.createSystem(GUTS.SaveSystem);
        enums = game.getEnums();
    });

    describe('initialization', () => {
        it('should register system on game', () => {
            expect(game.saveSystem).toBe(saveSystem);
        });

        it('should set SAVE_VERSION to 2', () => {
            expect(saveSystem.SAVE_VERSION).toBe(2);
        });

        it('should initialize EXCLUDED_COMPONENTS as empty Set', () => {
            expect(saveSystem.EXCLUDED_COMPONENTS.size).toBe(0);
        });

        it('should initialize EXCLUDED_ENTITY_PREFIXES', () => {
            expect(saveSystem.EXCLUDED_ENTITY_PREFIXES).toContain('camera_');
        });
    });

    describe('static services', () => {
        it('should register saveGame service', () => {
            expect(GUTS.SaveSystem.services).toContain('saveGame');
        });

        it('should register getSaveData service', () => {
            expect(GUTS.SaveSystem.services).toContain('getSaveData');
        });

        it('should register loadSaveData service', () => {
            expect(GUTS.SaveSystem.services).toContain('loadSaveData');
        });

        it('should register listSavedGames service', () => {
            expect(GUTS.SaveSystem.services).toContain('listSavedGames');
        });

        it('should register deleteSavedGame service', () => {
            expect(GUTS.SaveSystem.services).toContain('deleteSavedGame');
        });

        it('should register exportSaveFile service', () => {
            expect(GUTS.SaveSystem.services).toContain('exportSaveFile');
        });

        it('should register importSaveFile service', () => {
            expect(GUTS.SaveSystem.services).toContain('importSaveFile');
        });
    });

    describe('getSaveData', () => {
        it('should return object with saveVersion', () => {
            const saveData = saveSystem.getSaveData();
            expect(saveData.saveVersion).toBe(2);
        });

        it('should return object with timestamp', () => {
            const beforeTime = Date.now();
            const saveData = saveSystem.getSaveData();
            const afterTime = Date.now();

            expect(saveData.timestamp).toBeGreaterThanOrEqual(beforeTime);
            expect(saveData.timestamp).toBeLessThanOrEqual(afterTime);
        });

        it('should return object with state', () => {
            const saveData = saveSystem.getSaveData();
            expect(saveData.state).toBeDefined();
        });

        it('should return object with ecsData', () => {
            const saveData = saveSystem.getSaveData();
            expect(saveData.ecsData).toBeDefined();
        });

        it('should return object with players array', () => {
            const saveData = saveSystem.getSaveData();
            expect(Array.isArray(saveData.players)).toBe(true);
        });

        it('should include level in save data', () => {
            game.state.level = 3;
            const saveData = saveSystem.getSaveData();
            expect(saveData.level).toBe(3);
        });
    });

    describe('serializeGameState', () => {
        it('should include phase', () => {
            game.state.phase = 2;
            const state = saveSystem.serializeGameState();
            expect(state.phase).toBe(2);
        });

        it('should include round', () => {
            game.state.round = 5;
            const state = saveSystem.serializeGameState();
            expect(state.round).toBe(5);
        });

        it('should default round to 1', () => {
            game.state.round = undefined;
            const state = saveSystem.serializeGameState();
            expect(state.round).toBe(1);
        });

        it('should include gameOver status', () => {
            game.state.gameOver = true;
            const state = saveSystem.serializeGameState();
            expect(state.gameOver).toBe(true);
        });

        it('should include victory status', () => {
            game.state.victory = true;
            const state = saveSystem.serializeGameState();
            expect(state.victory).toBe(true);
        });

        it('should include myTeam', () => {
            game.state.myTeam = 'left';
            const state = saveSystem.serializeGameState();
            expect(state.myTeam).toBe('left');
        });
    });

    describe('shouldExcludeEntity', () => {
        it('should return false for numeric entity IDs', () => {
            expect(saveSystem.shouldExcludeEntity(123)).toBe(false);
        });

        it('should return true for camera entities', () => {
            expect(saveSystem.shouldExcludeEntity('camera_main')).toBe(true);
        });

        it('should return false for terrain entities', () => {
            // terrain_ is NOT excluded
            expect(saveSystem.shouldExcludeEntity('terrain_main')).toBe(false);
        });

        it('should return false for regular string IDs', () => {
            expect(saveSystem.shouldExcludeEntity('unit_soldier_1')).toBe(false);
        });
    });

    describe('serializeComponent', () => {
        it('should deep clone component data', () => {
            const original = { x: 1, nested: { y: 2 } };
            const serialized = saveSystem.serializeComponent('test', original);

            expect(serialized).toEqual(original);
            expect(serialized).not.toBe(original);
            expect(serialized.nested).not.toBe(original.nested);
        });

        it('should handle Map serialization', () => {
            const map = new Map([['key1', 'value1'], ['key2', 'value2']]);
            const data = { myMap: map };

            const serialized = saveSystem.serializeComponent('test', data);

            expect(serialized.myMap.__type).toBe('Map');
            expect(serialized.myMap.data).toEqual([['key1', 'value1'], ['key2', 'value2']]);
        });

        it('should handle Set serialization', () => {
            const set = new Set([1, 2, 3]);
            const data = { mySet: set };

            const serialized = saveSystem.serializeComponent('test', data);

            expect(serialized.mySet.__type).toBe('Set');
            expect(serialized.mySet.data).toEqual([1, 2, 3]);
        });

        it('should exclude functions', () => {
            const data = {
                value: 42,
                callback: () => {}
            };

            const serialized = saveSystem.serializeComponent('test', data);

            expect(serialized.value).toBe(42);
            expect(serialized.callback).toBeUndefined();
        });
    });

    describe('deserializeComponent', () => {
        it('should deep clone component data', () => {
            const original = { x: 1, nested: { y: 2 } };
            const deserialized = saveSystem.deserializeComponent('test', original);

            expect(deserialized).toEqual(original);
            expect(deserialized).not.toBe(original);
        });

        it('should handle Map deserialization', () => {
            const serialized = { myMap: { __type: 'Map', data: [['key1', 'value1']] } };
            const deserialized = saveSystem.deserializeComponent('test', serialized);

            expect(deserialized.myMap instanceof Map).toBe(true);
            expect(deserialized.myMap.get('key1')).toBe('value1');
        });

        it('should handle Set deserialization', () => {
            const serialized = { mySet: { __type: 'Set', data: [1, 2, 3] } };
            const deserialized = saveSystem.deserializeComponent('test', serialized);

            expect(deserialized.mySet instanceof Set).toBe(true);
            expect(deserialized.mySet.has(2)).toBe(true);
        });
    });

    describe('listSavedGames', () => {
        it('should return empty array when no saves', () => {
            const saves = saveSystem.listSavedGames();
            expect(saves).toEqual([]);
        });

        it('should return array of save metadata', () => {
            const timestamp = Date.now();
            localStorage.setItem('tbw_save_index', JSON.stringify({
                'save1': timestamp
            }));

            const saves = saveSystem.listSavedGames();

            expect(saves.length).toBe(1);
            expect(saves[0].name).toBe('save1');
            expect(saves[0].timestamp).toBe(timestamp);
        });

        it('should sort saves by timestamp descending', () => {
            const now = Date.now();
            localStorage.setItem('tbw_save_index', JSON.stringify({
                'old_save': now - 10000,
                'new_save': now
            }));

            const saves = saveSystem.listSavedGames();

            expect(saves[0].name).toBe('new_save');
            expect(saves[1].name).toBe('old_save');
        });
    });

    describe('updateSaveIndex', () => {
        it('should create new index when none exists', () => {
            saveSystem.updateSaveIndex('test_save', 12345);

            const index = JSON.parse(localStorage.getItem('tbw_save_index'));
            expect(index['test_save']).toBe(12345);
        });

        it('should update existing index', () => {
            localStorage.setItem('tbw_save_index', JSON.stringify({ 'old_save': 100 }));

            saveSystem.updateSaveIndex('new_save', 200);

            const index = JSON.parse(localStorage.getItem('tbw_save_index'));
            expect(index['old_save']).toBe(100);
            expect(index['new_save']).toBe(200);
        });
    });

    describe('deleteSavedGame', () => {
        it('should remove save from localStorage', () => {
            localStorage.setItem('tbw_save_test', 'data');
            localStorage.setItem('tbw_save_index', JSON.stringify({ 'test': 123 }));

            saveSystem.deleteSavedGame('test');

            expect(localStorage.getItem('tbw_save_test')).toBeNull();
        });

        it('should update save index', () => {
            localStorage.setItem('tbw_save_test', 'data');
            localStorage.setItem('tbw_save_index', JSON.stringify({
                'test': 123,
                'other': 456
            }));

            saveSystem.deleteSavedGame('test');

            const index = JSON.parse(localStorage.getItem('tbw_save_index'));
            expect(index['test']).toBeUndefined();
            expect(index['other']).toBe(456);
        });
    });

    describe('loadSaveData', () => {
        it('should return false for null save data', async () => {
            const result = await saveSystem.loadSaveData(null);
            expect(result).toBe(false);
        });

        it('should return false for invalid version', async () => {
            const result = await saveSystem.loadSaveData({ saveVersion: 99 });
            expect(result).toBe(false);
        });

        it('should return true for valid v1 save', async () => {
            const result = await saveSystem.loadSaveData({ saveVersion: 1, level: 1 });
            expect(result).toBe(true);
        });

        it('should return true for valid v2 save', async () => {
            const result = await saveSystem.loadSaveData({ saveVersion: 2, level: 1 });
            expect(result).toBe(true);
        });

        it('should store save data in game.pendingSaveData', async () => {
            const saveData = { saveVersion: 2, level: 1 };
            await saveSystem.loadSaveData(saveData);
            expect(game.pendingSaveData).toBe(saveData);
        });

        it('should update game.state.level', async () => {
            await saveSystem.loadSaveData({ saveVersion: 2, level: 5 });
            expect(game.state.level).toBe(5);
        });
    });

    describe('loadSavedEntities', () => {
        it('should return false when no pending save data', () => {
            game.pendingSaveData = null;
            const result = saveSystem.loadSavedEntities();
            expect(result).toBe(false);
        });

        it('should clear pending save data after loading', () => {
            game.pendingSaveData = { state: {}, ecsData: {} };
            game.applyECSData = () => {};

            saveSystem.loadSavedEntities();

            expect(game.pendingSaveData).toBeNull();
        });
    });

    describe('importSaveFile', () => {
        it('should parse valid JSON file', async () => {
            const mockFile = {
                text: () => Promise.resolve('{"test": "data"}')
            };

            // Create a mock FileReader
            const mockFileReader = {
                readAsText: function(file) {
                    setTimeout(() => {
                        this.onload({ target: { result: '{"test": "data"}' } });
                    }, 0);
                }
            };
            vi.stubGlobal('FileReader', function() { return mockFileReader; });

            const result = await saveSystem.importSaveFile({});
            expect(result.test).toBe('data');
        });

        it('should reject invalid JSON', async () => {
            const mockFileReader = {
                readAsText: function(file) {
                    setTimeout(() => {
                        this.onload({ target: { result: 'invalid json' } });
                    }, 0);
                }
            };
            vi.stubGlobal('FileReader', function() { return mockFileReader; });

            await expect(saveSystem.importSaveFile({})).rejects.toThrow('Invalid save file format');
        });
    });

    describe('onSceneUnload', () => {
        it('should not throw', () => {
            expect(() => saveSystem.onSceneUnload()).not.toThrow();
        });
    });
});
