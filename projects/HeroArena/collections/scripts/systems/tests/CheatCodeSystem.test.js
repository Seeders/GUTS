import { describe, it, expect, beforeEach } from 'vitest';
import { TestGameContext } from '../../../../../../tests/TestGameContext.js';

describe('CheatCodeSystem', () => {
    let game;
    let cheatCodeSystem;
    let enums;

    beforeEach(() => {
        game = new TestGameContext();

        // Register mock services
        game.register('addPlayerGold', () => {});
        game.register('sendCheatRequest', () => {});
        game.register('getTerrainHeightAtPosition', () => 0);
        game.register('createPlacement', () => game.createEntity());

        // Mock placementSystem for entity creation
        game.placementSystem = {
            _getNextPlacementId: () => `placement_${Date.now()}`
        };

        // Mock gridSystem
        game.gridSystem = {
            dimensions: { cellSize: 32 }
        };

        cheatCodeSystem = game.createSystem(GUTS.CheatCodeSystem);
        enums = game.getEnums();

        // Set up mock collections for unit spawning
        cheatCodeSystem.collections = {
            units: {
                footman: { placementGridWidth: 1, placementGridHeight: 1 }
            }
        };

        // Set up mock enums for spawn validation
        enums.objectTypeDefinitions = { units: 0 };
        enums.units = { footman: 0 };
    });

    describe('initialization', () => {
        it('should register system on game', () => {
            expect(game.cheatCodeSystem).toBe(cheatCodeSystem);
        });

        it('should initialize cheatRegistry as Map', () => {
            expect(cheatCodeSystem.cheatRegistry instanceof Map).toBe(true);
        });

        it('should register cheats on init', () => {
            expect(cheatCodeSystem.cheatRegistry.size).toBeGreaterThan(0);
        });
    });

    describe('static services', () => {
        it('should register executeCheat service', () => {
            expect(GUTS.CheatCodeSystem.services).toContain('executeCheat');
        });

        it('should register validateCheat service', () => {
            expect(GUTS.CheatCodeSystem.services).toContain('validateCheat');
        });

        it('should register listCheats service', () => {
            expect(GUTS.CheatCodeSystem.services).toContain('listCheats');
        });

        it('should register cheat service', () => {
            expect(GUTS.CheatCodeSystem.services).toContain('cheat');
        });

        it('should register cheats service', () => {
            expect(GUTS.CheatCodeSystem.services).toContain('cheats');
        });
    });

    describe('registerCheats', () => {
        it('should register spawnUnits cheat', () => {
            expect(cheatCodeSystem.cheatRegistry.has('spawnUnits')).toBe(true);
        });

        it('should register addGold cheat', () => {
            expect(cheatCodeSystem.cheatRegistry.has('addGold')).toBe(true);
        });

        it('should register killEnemies cheat', () => {
            expect(cheatCodeSystem.cheatRegistry.has('killEnemies')).toBe(true);
        });

        it('should include validate function for each cheat', () => {
            const spawnCheat = cheatCodeSystem.cheatRegistry.get('spawnUnits');
            expect(typeof spawnCheat.validate).toBe('function');
        });

        it('should include execute function for each cheat', () => {
            const spawnCheat = cheatCodeSystem.cheatRegistry.get('spawnUnits');
            expect(typeof spawnCheat.execute).toBe('function');
        });
    });

    describe('listCheats', () => {
        it('should return array of cheat names', () => {
            const cheats = cheatCodeSystem.listCheats();
            expect(Array.isArray(cheats)).toBe(true);
        });

        it('should include spawnUnits in list', () => {
            const cheats = cheatCodeSystem.listCheats();
            expect(cheats).toContain('spawnUnits');
        });

        it('should include addGold in list', () => {
            const cheats = cheatCodeSystem.listCheats();
            expect(cheats).toContain('addGold');
        });

        it('should include killEnemies in list', () => {
            const cheats = cheatCodeSystem.listCheats();
            expect(cheats).toContain('killEnemies');
        });
    });

    describe('cheats', () => {
        it('should be alias for listCheats', () => {
            expect(cheatCodeSystem.cheats()).toEqual(cheatCodeSystem.listCheats());
        });
    });

    describe('cheat', () => {
        it('should execute directly on server', () => {
            game.isServer = true;
            let executed = false;
            cheatCodeSystem.executeCheat = () => { executed = true; return { success: true }; };

            cheatCodeSystem.cheat('addGold', { amount: 100, team: 2 });

            expect(executed).toBe(true);
        });

        it('should request via network on client', () => {
            game.isServer = false;
            let requestSent = false;
            cheatCodeSystem.requestCheat = () => { requestSent = true; return true; };

            cheatCodeSystem.cheat('addGold', { amount: 100, team: 2 });

            expect(requestSent).toBe(true);
        });
    });

    describe('requestCheat', () => {
        it('should return false for unknown cheat', () => {
            const result = cheatCodeSystem.requestCheat('unknownCheat', {});
            expect(result).toBe(false);
        });

        it('should call sendCheatRequest for valid cheat', () => {
            let sentCheat = null;
            game.register('sendCheatRequest', (name, params) => {
                sentCheat = name;
            });

            cheatCodeSystem.requestCheat('addGold', { amount: 100, team: 2 });

            expect(sentCheat).toBe('addGold');
        });

        it('should return true for valid cheat', () => {
            const result = cheatCodeSystem.requestCheat('addGold', { amount: 100, team: 2 });
            expect(result).toBe(true);
        });
    });

    describe('validateCheat', () => {
        it('should return invalid for unknown cheat', () => {
            const result = cheatCodeSystem.validateCheat('unknownCheat', {});
            expect(result.valid).toBe(false);
            expect(result.error).toContain('Unknown cheat');
        });

        it('should call cheat validator for known cheat', () => {
            const result = cheatCodeSystem.validateCheat('addGold', { amount: 100, team: 2 });
            expect(result.valid).toBe(true);
        });
    });

    describe('executeCheat', () => {
        it('should return error for unknown cheat', () => {
            const result = cheatCodeSystem.executeCheat('unknownCheat', {});
            expect(result.error).toContain('Unknown cheat');
        });

        it('should execute known cheat', () => {
            let goldAdded = false;
            game.register('addPlayerGold', () => { goldAdded = true; });

            cheatCodeSystem.executeCheat('addGold', { amount: 100, team: 2 });

            expect(goldAdded).toBe(true);
        });
    });

    describe('validateSpawnUnits', () => {
        it('should require collection parameter', () => {
            const result = cheatCodeSystem.validateSpawnUnits({
                type: 'footman', amount: 1, x: 0, z: 0, team: 2
            });
            expect(result.valid).toBe(false);
            expect(result.error).toContain('collection');
        });

        it('should require type parameter', () => {
            const result = cheatCodeSystem.validateSpawnUnits({
                collection: 'units', amount: 1, x: 0, z: 0, team: 2
            });
            expect(result.valid).toBe(false);
            expect(result.error).toContain('type');
        });

        it('should require amount between 1 and 1000', () => {
            const result = cheatCodeSystem.validateSpawnUnits({
                collection: 'units', type: 'footman', amount: 0, x: 0, z: 0, team: 2
            });
            expect(result.valid).toBe(false);
            expect(result.error).toContain('Amount');
        });

        it('should reject amount over 1000', () => {
            const result = cheatCodeSystem.validateSpawnUnits({
                collection: 'units', type: 'footman', amount: 1001, x: 0, z: 0, team: 2
            });
            expect(result.valid).toBe(false);
        });

        it('should require x coordinate', () => {
            const result = cheatCodeSystem.validateSpawnUnits({
                collection: 'units', type: 'footman', amount: 1, z: 0, team: 2
            });
            expect(result.valid).toBe(false);
            expect(result.error).toContain('x');
        });

        it('should require z coordinate', () => {
            const result = cheatCodeSystem.validateSpawnUnits({
                collection: 'units', type: 'footman', amount: 1, x: 0, team: 2
            });
            expect(result.valid).toBe(false);
            expect(result.error).toContain('z');
        });

        it('should require team parameter', () => {
            const result = cheatCodeSystem.validateSpawnUnits({
                collection: 'units', type: 'footman', amount: 1, x: 0, z: 0
            });
            expect(result.valid).toBe(false);
            expect(result.error).toContain('team');
        });

        it('should validate unit type exists', () => {
            const result = cheatCodeSystem.validateSpawnUnits({
                collection: 'units', type: 'invalidUnit', amount: 1, x: 0, z: 0, team: 2
            });
            expect(result.valid).toBe(false);
            expect(result.error).toContain('not found');
        });

        it('should return valid for correct parameters', () => {
            const result = cheatCodeSystem.validateSpawnUnits({
                collection: 'units', type: 'footman', amount: 5, x: 100, z: 100, team: 2
            });
            expect(result.valid).toBe(true);
        });
    });

    describe('validateAddGold', () => {
        it('should require amount parameter', () => {
            const result = cheatCodeSystem.validateAddGold({ team: 2 });
            expect(result.valid).toBe(false);
            expect(result.error).toContain('amount');
        });

        it('should require team parameter', () => {
            const result = cheatCodeSystem.validateAddGold({ amount: 100 });
            expect(result.valid).toBe(false);
            expect(result.error).toContain('team');
        });

        it('should return valid for correct parameters', () => {
            const result = cheatCodeSystem.validateAddGold({ amount: 100, team: 2 });
            expect(result.valid).toBe(true);
        });
    });

    describe('validateKillEnemies', () => {
        it('should require team parameter', () => {
            const result = cheatCodeSystem.validateKillEnemies({});
            expect(result.valid).toBe(false);
            expect(result.error).toContain('team');
        });

        it('should return valid for correct parameters', () => {
            const result = cheatCodeSystem.validateKillEnemies({ team: 3 });
            expect(result.valid).toBe(true);
        });
    });

    describe('executeAddGold', () => {
        it('should call addPlayerGold service', () => {
            let addedTeam = null;
            let addedAmount = null;
            game.register('addPlayerGold', (team, amount) => {
                addedTeam = team;
                addedAmount = amount;
            });

            cheatCodeSystem.executeAddGold({ amount: 500, team: 2 });

            expect(addedTeam).toBe(2);
            expect(addedAmount).toBe(500);
        });

        it('should return success result', () => {
            const result = cheatCodeSystem.executeAddGold({ amount: 500, team: 2 });
            expect(result.success).toBe(true);
            expect(result.amount).toBe(500);
            expect(result.team).toBe(2);
        });
    });

    describe('executeKillEnemies', () => {
        it('should kill units on specified team', () => {
            // Create entities on team 3
            const entity1 = game.createEntityWith({
                team: { team: 3 },
                health: { current: 100, max: 100 }
            });
            const entity2 = game.createEntityWith({
                team: { team: 3 },
                health: { current: 50, max: 100 }
            });

            cheatCodeSystem.executeKillEnemies({ team: 3 });

            const health1 = game.getComponent(entity1, 'health');
            const health2 = game.getComponent(entity2, 'health');
            expect(health1.current).toBe(0);
            expect(health2.current).toBe(0);
        });

        it('should not kill units on other teams', () => {
            const friendlyEntity = game.createEntityWith({
                team: { team: 2 },
                health: { current: 100, max: 100 }
            });

            cheatCodeSystem.executeKillEnemies({ team: 3 });

            const health = game.getComponent(friendlyEntity, 'health');
            expect(health.current).toBe(100);
        });

        it('should return kill count', () => {
            game.createEntityWith({
                team: { team: 3 },
                health: { current: 100, max: 100 }
            });
            game.createEntityWith({
                team: { team: 3 },
                health: { current: 50, max: 100 }
            });

            const result = cheatCodeSystem.executeKillEnemies({ team: 3 });

            expect(result.killed).toBe(2);
        });

        it('should not count already dead units', () => {
            game.createEntityWith({
                team: { team: 3 },
                health: { current: 0, max: 100 }
            });

            const result = cheatCodeSystem.executeKillEnemies({ team: 3 });

            expect(result.killed).toBe(0);
        });
    });

    describe('calculateGroupPositions', () => {
        it('should return array of positions', () => {
            const unitType = { placementGridWidth: 1, placementGridHeight: 1 };
            const positions = cheatCodeSystem.calculateGroupPositions(100, 100, 5, unitType);

            expect(Array.isArray(positions)).toBe(true);
            expect(positions.length).toBe(5);
        });

        it('should return positions with x and z coordinates', () => {
            const unitType = { placementGridWidth: 1, placementGridHeight: 1 };
            const positions = cheatCodeSystem.calculateGroupPositions(100, 100, 1, unitType);

            expect(positions[0].x).toBeDefined();
            expect(positions[0].z).toBeDefined();
        });

        it('should avoid occupied positions', () => {
            // Create entity at center position
            game.createEntityWith({
                transform: { position: { x: 100, y: 0, z: 100 } }
            });

            const unitType = { placementGridWidth: 1, placementGridHeight: 1 };
            const positions = cheatCodeSystem.calculateGroupPositions(100, 100, 2, unitType);

            // First position should not be at center since it's occupied
            const centerX = Math.floor(100 / 32) * 32 + 16;
            const centerZ = Math.floor(100 / 32) * 32 + 16;

            // At least one position should be different from center
            const hasNonCenterPosition = positions.some(p =>
                Math.abs(p.x - centerX) > 1 || Math.abs(p.z - centerZ) > 1
            );
            expect(hasNonCenterPosition).toBe(true);
        });
    });

    describe('executeSpawnUnits', () => {
        it('should call createPlacement for each unit', () => {
            let createCount = 0;
            game.register('createPlacement', () => {
                createCount++;
                return game.createEntity();
            });

            cheatCodeSystem.executeSpawnUnits({
                collection: 'units',
                type: 'footman',
                amount: 3,
                x: 100,
                z: 100,
                team: 2
            });

            expect(createCount).toBe(3);
        });

        it('should return array of entity IDs', () => {
            const result = cheatCodeSystem.executeSpawnUnits({
                collection: 'units',
                type: 'footman',
                amount: 2,
                x: 100,
                z: 100,
                team: 2
            });

            expect(Array.isArray(result.entityIds)).toBe(true);
            expect(result.entityIds.length).toBe(2);
        });

        it('should return error for invalid collection/type', () => {
            // Remove enum definitions
            enums.objectTypeDefinitions = {};
            enums.units = {};

            const result = cheatCodeSystem.executeSpawnUnits({
                collection: 'units',
                type: 'footman',
                amount: 1,
                x: 100,
                z: 100,
                team: 2
            });

            expect(result.error).toBeDefined();
        });

        it('should use provided entity IDs when given', () => {
            const providedIds = [999, 1000];
            let usedIds = [];

            game.register('createPlacement', (data, transform, team, providedId) => {
                usedIds.push(providedId);
                return providedId || game.createEntity();
            });

            cheatCodeSystem.executeSpawnUnits({
                collection: 'units',
                type: 'footman',
                amount: 2,
                x: 100,
                z: 100,
                team: 2,
                entityIds: providedIds
            });

            expect(usedIds).toEqual(providedIds);
        });
    });

    describe('help', () => {
        it('should not throw when called', () => {
            expect(() => cheatCodeSystem.help()).not.toThrow();
        });
    });
});
