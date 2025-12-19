import { describe, it, expect, beforeEach } from 'vitest';
import { TestGameContext } from '../../../../../../tests/TestGameContext.js';

describe('UnitCreationSystem', () => {
    let game;
    let unitCreationSystem;
    let enums;

    beforeEach(() => {
        game = new TestGameContext();

        // Register mock services
        game.register('invalidateSupplyCache', () => {});
        game.register('releaseGridCells', () => {});
        game.register('removeSquadExperience', () => {});
        game.register('getSquadInfoFromType', () => null);
        game.register('isValidGridPosition', () => true);

        unitCreationSystem = game.createSystem(GUTS.UnitCreationSystem);
        enums = game.getEnums();
    });

    describe('initialization', () => {
        it('should register system on game', () => {
            expect(game.unitCreationSystem).toBe(unitCreationSystem);
        });

        it('should set SPEED_MODIFIER', () => {
            expect(unitCreationSystem.SPEED_MODIFIER).toBe(20);
        });

        it('should initialize team configs', () => {
            expect(unitCreationSystem.teamConfigs).toBeDefined();
            expect(unitCreationSystem.teamConfigs[enums.team.left]).toBeDefined();
            expect(unitCreationSystem.teamConfigs[enums.team.right]).toBeDefined();
        });

        it('should set left team initial facing to 0', () => {
            expect(unitCreationSystem.teamConfigs[enums.team.left].initialFacing).toBe(0);
        });

        it('should set right team initial facing to PI', () => {
            expect(unitCreationSystem.teamConfigs[enums.team.right].initialFacing).toBe(Math.PI);
        });

        it('should initialize defaults', () => {
            expect(unitCreationSystem.defaults).toBeDefined();
            expect(unitCreationSystem.defaults.hp).toBe(100);
            expect(unitCreationSystem.defaults.damage).toBe(10);
            expect(unitCreationSystem.defaults.speed).toBe(40);
        });

        it('should initialize stats', () => {
            expect(unitCreationSystem.stats.totalCreated).toBe(0);
            expect(unitCreationSystem.stats.squadsCreated).toBe(0);
            expect(unitCreationSystem.stats.equipmentFailures).toBe(0);
        });

        it('should initialize equipment priority', () => {
            expect(unitCreationSystem.equipmentPriority).toContain('weapon');
            expect(unitCreationSystem.equipmentPriority).toContain('armor');
        });

        it('should initialize component cache', () => {
            expect(unitCreationSystem.componentCache.size).toBe(0);
        });
    });

    describe('static services', () => {
        it('should register createPlacement service', () => {
            expect(GUTS.UnitCreationSystem.services).toContain('createPlacement');
        });

        it('should register createUnit service', () => {
            expect(GUTS.UnitCreationSystem.services).toContain('createUnit');
        });

        it('should register createEntityFromPrefab service', () => {
            expect(GUTS.UnitCreationSystem.services).toContain('createEntityFromPrefab');
        });

        it('should register getTerrainHeight service', () => {
            expect(GUTS.UnitCreationSystem.services).toContain('getTerrainHeight');
        });

        it('should register incrementSquadsCreated service', () => {
            expect(GUTS.UnitCreationSystem.services).toContain('incrementSquadsCreated');
        });
    });

    describe('incrementSquadsCreated', () => {
        it('should increment squads created counter', () => {
            expect(unitCreationSystem.stats.squadsCreated).toBe(0);

            unitCreationSystem.incrementSquadsCreated();

            expect(unitCreationSystem.stats.squadsCreated).toBe(1);
        });

        it('should increment multiple times', () => {
            unitCreationSystem.incrementSquadsCreated();
            unitCreationSystem.incrementSquadsCreated();
            unitCreationSystem.incrementSquadsCreated();

            expect(unitCreationSystem.stats.squadsCreated).toBe(3);
        });
    });

    describe('getCollectionComponentName', () => {
        it('should return unit for units collection', () => {
            expect(unitCreationSystem.getCollectionComponentName('units')).toBe('unit');
        });

        it('should return building for buildings collection', () => {
            expect(unitCreationSystem.getCollectionComponentName('buildings')).toBe('building');
        });

        it('should return worldObject for worldObjects collection', () => {
            expect(unitCreationSystem.getCollectionComponentName('worldObjects')).toBe('worldObject');
        });

        it('should return null for unknown collection', () => {
            expect(unitCreationSystem.getCollectionComponentName('unknownCollection')).toBeNull();
        });

        it('should return projectile for projectiles collection', () => {
            expect(unitCreationSystem.getCollectionComponentName('projectiles')).toBe('projectile');
        });
    });

    describe('getItemFromCollection', () => {
        it('should return null for non-existent item', () => {
            expect(unitCreationSystem.getItemFromCollection('nonExistentItem')).toBeNull();
        });

        it('should return null for undefined item', () => {
            expect(unitCreationSystem.getItemFromCollection(undefined)).toBeNull();
        });
    });

    describe('getAbilityFromCollection', () => {
        it('should return null for non-existent ability', () => {
            expect(unitCreationSystem.getAbilityFromCollection('nonExistentAbility')).toBeNull();
        });

        it('should return null for undefined ability', () => {
            expect(unitCreationSystem.getAbilityFromCollection(undefined)).toBeNull();
        });
    });

    describe('getTerrainHeight', () => {
        it('should return 0 when no terrain service', () => {
            expect(unitCreationSystem.getTerrainHeight(100, 100)).toBe(0);
        });

        it('should return terrain height from service', () => {
            game.register('getTerrainHeightAtPosition', (x, z) => 50);

            expect(unitCreationSystem.getTerrainHeight(100, 100)).toBe(50);
        });
    });

    describe('validateUnitType', () => {
        it('should return invalid for null unit type', () => {
            const result = unitCreationSystem.validateUnitType(null);

            expect(result.valid).toBe(false);
            expect(result.errors).toContain('Unit type is required');
        });

        it('should return valid for minimal unit type', () => {
            const result = unitCreationSystem.validateUnitType({
                id: 'testUnit',
                hp: 100
            });

            expect(result.valid).toBe(true);
        });

        it('should warn for missing ID', () => {
            const result = unitCreationSystem.validateUnitType({
                hp: 100
            });

            expect(result.warnings.some(w => w.includes('ID missing'))).toBe(true);
        });

        it('should warn for missing title', () => {
            const result = unitCreationSystem.validateUnitType({
                id: 'test'
            });

            expect(result.warnings.some(w => w.includes('title missing'))).toBe(true);
        });

        it('should error for negative HP', () => {
            const result = unitCreationSystem.validateUnitType({
                id: 'test',
                hp: -10
            });

            expect(result.valid).toBe(false);
            expect(result.errors.some(e => e.includes('hp'))).toBe(true);
        });

        it('should error for NaN damage', () => {
            const result = unitCreationSystem.validateUnitType({
                id: 'test',
                damage: NaN
            });

            expect(result.valid).toBe(false);
        });

        it('should error for non-array abilities', () => {
            const result = unitCreationSystem.validateUnitType({
                id: 'test',
                abilities: 'notAnArray'
            });

            expect(result.valid).toBe(false);
            expect(result.errors.some(e => e.includes('Abilities must be an array'))).toBe(true);
        });

        it('should warn for equipment missing item ID', () => {
            const result = unitCreationSystem.validateUnitType({
                id: 'test',
                render: {
                    equipment: [{ slot: 'mainHand' }]
                }
            });

            expect(result.warnings.some(w => w.includes('missing item ID'))).toBe(true);
        });

        it('should warn for equipment missing slot', () => {
            const result = unitCreationSystem.validateUnitType({
                id: 'test',
                render: {
                    equipment: [{ item: 'sword' }]
                }
            });

            expect(result.warnings.some(w => w.includes('missing slot'))).toBe(true);
        });
    });

    describe('resetStats', () => {
        it('should reset all statistics', () => {
            unitCreationSystem.stats.totalCreated = 50;
            unitCreationSystem.stats.squadsCreated = 10;
            unitCreationSystem.stats.equipmentFailures = 5;

            unitCreationSystem.resetStats();

            expect(unitCreationSystem.stats.totalCreated).toBe(0);
            expect(unitCreationSystem.stats.squadsCreated).toBe(0);
            expect(unitCreationSystem.stats.equipmentFailures).toBe(0);
        });

        it('should reset team and type maps', () => {
            unitCreationSystem.stats.createdByTeam.set('left', 10);
            unitCreationSystem.stats.createdByType.set('soldier', 5);

            unitCreationSystem.resetStats();

            expect(unitCreationSystem.stats.createdByTeam.size).toBe(0);
            expect(unitCreationSystem.stats.createdByType.size).toBe(0);
        });
    });

    describe('dispose', () => {
        it('should clear component cache', () => {
            unitCreationSystem.componentCache.set('test', {});

            unitCreationSystem.dispose();

            expect(unitCreationSystem.componentCache.size).toBe(0);
        });

        it('should reset stats', () => {
            unitCreationSystem.stats.totalCreated = 100;

            unitCreationSystem.dispose();

            expect(unitCreationSystem.stats.totalCreated).toBe(0);
        });
    });

    describe('cleanupSquads', () => {
        it('should not throw for empty array', () => {
            expect(() => unitCreationSystem.cleanupSquads([])).not.toThrow();
        });

        it('should not throw for squads without squadUnits', () => {
            expect(() => unitCreationSystem.cleanupSquads([
                { placementId: 1 },
                { placementId: 2 }
            ])).not.toThrow();
        });

        it('should call releaseGridCells for each unit', () => {
            let releaseCalls = [];
            game.register('releaseGridCells', (id) => { releaseCalls.push(id); });

            unitCreationSystem.cleanupSquads([
                { placementId: 1, squadUnits: [10, 11, 12] }
            ]);

            expect(releaseCalls).toContain(10);
            expect(releaseCalls).toContain(11);
            expect(releaseCalls).toContain(12);
        });

        it('should call removeSquadExperience for each squad', () => {
            let removeCalls = [];
            game.register('removeSquadExperience', (id) => { removeCalls.push(id); });

            unitCreationSystem.cleanupSquads([
                { placementId: 'squad1', squadUnits: [] },
                { placementId: 'squad2', squadUnits: [] }
            ]);

            expect(removeCalls).toContain('squad1');
            expect(removeCalls).toContain('squad2');
        });
    });

    describe('getSquadInfo', () => {
        it('should return fallback info when service returns null', () => {
            const unitType = { id: 'testUnit', title: 'Test Unit' };
            const info = unitCreationSystem.getSquadInfo(unitType);

            expect(info.unitName).toBe('Test Unit');
            expect(info.squadSize).toBe(1);
        });

        it('should use ID when title is missing', () => {
            const unitType = { id: 'testUnit' };
            const info = unitCreationSystem.getSquadInfo(unitType);

            expect(info.unitName).toBe('testUnit');
        });

        it('should return Unknown for unit without id or title', () => {
            const unitType = {};
            const info = unitCreationSystem.getSquadInfo(unitType);

            expect(info.unitName).toBe('Unknown');
        });

        it('should return service result when available', () => {
            game.register('getSquadInfoFromType', () => ({
                unitName: 'Custom Unit',
                squadSize: 6,
                formationType: 2,
                spacing: 2
            }));

            const info = unitCreationSystem.getSquadInfo({});

            expect(info.unitName).toBe('Custom Unit');
            expect(info.squadSize).toBe(6);
        });
    });

    describe('canPlaceSquad', () => {
        it('should return true when no squad data service', () => {
            game.register('getSquadData', () => null);

            const result = unitCreationSystem.canPlaceSquad({ x: 0, z: 0 }, {}, 'left');

            expect(result).toBe(true);
        });

        it('should return false when validation fails', () => {
            game.register('getSquadData', () => ({ size: 6 }));
            game.register('validateSquadConfig', () => ({ valid: false }));

            const result = unitCreationSystem.canPlaceSquad({ x: 0, z: 0 }, {}, 'left');

            expect(result).toBe(false);
        });
    });

    describe('createEntityFromPrefab', () => {
        it('should return null for unknown prefab', () => {
            const result = unitCreationSystem.createEntityFromPrefab({
                prefab: 'unknownPrefab',
                type: 'test',
                collection: 'units'
            });

            expect(result).toBeNull();
        });
    });

    describe('setupAbilities', () => {
        it('should not throw for unit without abilities', () => {
            const entityId = game.createEntity();

            expect(() => unitCreationSystem.setupAbilities(entityId, {})).not.toThrow();
        });

        it('should not throw for null unit type', () => {
            const entityId = game.createEntity();

            expect(() => unitCreationSystem.setupAbilities(entityId, null)).not.toThrow();
        });

        it('should increment abilityFailures for missing abilities', () => {
            const entityId = game.createEntity();
            unitCreationSystem.stats.abilityFailures = 0;

            unitCreationSystem.setupAbilities(entityId, {
                abilities: ['nonExistentAbility']
            });

            expect(unitCreationSystem.stats.abilityFailures).toBe(1);
        });
    });

    describe('onSceneUnload', () => {
        it('should call dispose', () => {
            unitCreationSystem.componentCache.set('test', {});
            unitCreationSystem.stats.totalCreated = 100;

            unitCreationSystem.onSceneUnload();

            expect(unitCreationSystem.componentCache.size).toBe(0);
            expect(unitCreationSystem.stats.totalCreated).toBe(0);
        });
    });
});
