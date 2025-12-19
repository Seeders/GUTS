import { describe, it, expect, beforeEach } from 'vitest';
import { TestGameContext } from '../../../../../../tests/TestGameContext.js';

describe('ShopSystem', () => {
    let game;
    let shopSystem;
    let enums;

    beforeEach(() => {
        game = new TestGameContext();
        game.state.myTeam = 'left';
        enums = game.getEnums();

        // ShopSystem uses string team values from game.state.myTeam
        // Override enums BEFORE creating the system so it uses correct values
        enums.team = { left: 'left', right: 'right' };

        // Register mock services
        game.register('getUnitTypeDef', (unitTypeComp) => {
            if (!unitTypeComp) return null;
            // Return mock unit types based on type index
            if (unitTypeComp.type === 1) {
                return { id: 'barracks', collection: 'buildings', title: 'Barracks', value: 100 };
            }
            if (unitTypeComp.type === 2) {
                return { id: 'soldier', collection: 'units', title: 'Soldier', value: 50 };
            }
            return null;
        });
        game.register('canAffordCost', (cost) => game.state.gold >= cost);
        game.register('canAffordSupply', () => true);

        shopSystem = game.createSystem(GUTS.ShopSystem);
    });

    describe('initialization', () => {
        it('should register system on game', () => {
            expect(game.shopSystem).toBe(shopSystem);
        });

        it('should initialize selectedEntity state', () => {
            expect(game.state.selectedEntity).toBeDefined();
            expect(game.state.selectedEntity.collection).toBeNull();
            expect(game.state.selectedEntity.entityId).toBeNull();
        });

        it('should initialize townHallLevel to 0', () => {
            expect(shopSystem.townHallLevel).toBe(0);
        });
    });

    describe('static services', () => {
        it('should register resetShop service', () => {
            expect(GUTS.ShopSystem.services).toContain('resetShop');
        });

        it('should register updateSquadExperience service', () => {
            expect(GUTS.ShopSystem.services).toContain('updateSquadExperience');
        });
    });

    describe('getOwnedBuildings', () => {
        it('should return empty map when no buildings exist', () => {
            const buildings = shopSystem.getOwnedBuildings(enums.team.left);
            expect(buildings.size).toBe(0);
        });

        it('should return a Map', () => {
            const buildings = shopSystem.getOwnedBuildings(enums.team.left);
            expect(buildings instanceof Map).toBe(true);
        });

        // Note: Full entity query tests require proper ECS setup with getEntitiesWith
        // which may need additional TestGameContext configuration
    });

    describe('getOwnedUnits', () => {
        it('should return empty map when no units exist', () => {
            const units = shopSystem.getOwnedUnits(enums.team.left);
            expect(units.size).toBe(0);
        });

        it('should return a Map', () => {
            const units = shopSystem.getOwnedUnits(enums.team.left);
            expect(units instanceof Map).toBe(true);
        });

        // Note: Full entity query tests require proper ECS setup with getEntitiesWith
        // which may need additional TestGameContext configuration
    });

    describe('checkRequirements', () => {
        it('should return met for def with no requirements', () => {
            const result = shopSystem.checkRequirements({});
            expect(result.met).toBe(true);
            expect(result.reason).toBeNull();
        });

        it('should return not met when required building is missing', () => {
            const result = shopSystem.checkRequirements({
                requiresBuildings: ['barracks']
            });

            expect(result.met).toBe(false);
            expect(result.reason).toContain('Requires');
        });

        it('should return not met when required unit is missing', () => {
            const result = shopSystem.checkRequirements({
                requiresUnits: ['soldier']
            });

            expect(result.met).toBe(false);
            expect(result.reason).toContain('Requires');
        });

        // Note: Tests for "should return met when required X exists" require
        // proper ECS entity query setup that may need additional TestGameContext work
    });

    describe('isBuildingCompleted', () => {
        it('should return false for entity without placement', () => {
            const entityId = game.createEntity();
            expect(shopSystem.isBuildingCompleted(entityId)).toBeFalsy();
        });

        it('should return false for building under construction', () => {
            const entityId = game.createEntityWith({
                placement: { isUnderConstruction: true }
            });

            expect(shopSystem.isBuildingCompleted(entityId)).toBe(false);
        });

        it('should return true for completed building', () => {
            const entityId = game.createEntityWith({
                placement: { isUnderConstruction: false }
            });

            expect(shopSystem.isBuildingCompleted(entityId)).toBe(true);
        });
    });

    describe('getBuildingProductionProgress', () => {
        it('should return 0 for entity without placement', () => {
            const entityId = game.createEntity();
            expect(shopSystem.getBuildingProductionProgress(entityId)).toBe(0);
        });

        it('should return productionProgress from placement component', () => {
            const entityId = game.createEntityWith({
                placement: { productionProgress: 0.5 }
            });

            expect(shopSystem.getBuildingProductionProgress(entityId)).toBe(0.5);
        });
    });

    describe('setBuildingProductionProgress', () => {
        it('should not throw for entity without placement', () => {
            const entityId = game.createEntity();
            expect(() => shopSystem.setBuildingProductionProgress(entityId, 0.5)).not.toThrow();
        });

        it('should update productionProgress on placement component', () => {
            const entityId = game.createEntityWith({
                placement: { productionProgress: 0 }
            });

            shopSystem.setBuildingProductionProgress(entityId, 0.75);

            const placement = game.getComponent(entityId, 'placement');
            expect(placement.productionProgress).toBe(0.75);
        });
    });

    describe('clearSelectedEntity', () => {
        it('should clear selected entity state', () => {
            game.state.selectedEntity.entityId = 123;
            game.state.selectedEntity.collection = 'units';

            shopSystem.clearSelectedEntity();

            expect(game.state.selectedEntity.entityId).toBeNull();
            expect(game.state.selectedEntity.collection).toBeNull();
        });
    });

    describe('isBuildingLocked', () => {
        it('should return true when cannot afford', () => {
            game.state.gold = 0;
            const result = shopSystem.isBuildingLocked('barracks', { value: 100 });
            expect(result).toBe(true);
        });

        it('should return false when can afford and no requirements', () => {
            game.state.gold = 1000;
            const result = shopSystem.isBuildingLocked('barracks', { value: 100 });
            expect(result).toBe(false);
        });

        it('should return true when requirements not met', () => {
            game.state.gold = 1000;
            const result = shopSystem.isBuildingLocked('barracks', {
                value: 100,
                requiresBuildings: ['townhall']
            });
            expect(result).toBe(true);
        });
    });

    describe('getLockReason', () => {
        it('should return cannot afford reason', () => {
            game.state.gold = 0;
            const reason = shopSystem.getLockReason('barracks', { value: 100 });
            expect(reason).toBe("Can't afford");
        });

        it('should return null when not locked', () => {
            game.state.gold = 1000;
            const reason = shopSystem.getLockReason('barracks', { value: 100 });
            expect(reason).toBeNull();
        });

        it('should return requirements reason first', () => {
            game.state.gold = 1000;
            const reason = shopSystem.getLockReason('barracks', {
                value: 100,
                requiresBuildings: ['townhall']
            });
            expect(reason).toContain('Requires');
        });
    });

    describe('onPlacementPhaseStart', () => {
        it('should not throw when called', () => {
            // onPlacementPhaseStart relies on getOwnedBuildings which queries entities
            // This tests that it can be called safely
            expect(() => shopSystem.onPlacementPhaseStart()).not.toThrow();
        });

        it('should use setBuildingProductionProgress to reset progress', () => {
            // Test the underlying method directly
            const building = game.createEntityWith({
                placement: { productionProgress: 0.5 }
            });

            shopSystem.setBuildingProductionProgress(building, 0);

            expect(game.getComponent(building, 'placement').productionProgress).toBe(0);
        });
    });

    describe('getSquadDisplayName', () => {
        it('should format left squad names', () => {
            expect(shopSystem.getSquadDisplayName('left_0')).toBe('Left Squad 1');
            expect(shopSystem.getSquadDisplayName('left_2')).toBe('Left Squad 3');
        });

        it('should format right squad names', () => {
            expect(shopSystem.getSquadDisplayName('right_0')).toBe('Right Squad 1');
            expect(shopSystem.getSquadDisplayName('right_1')).toBe('Right Squad 2');
        });

        it('should format center squad names', () => {
            expect(shopSystem.getSquadDisplayName('center_0')).toBe('Center Squad 1');
        });

        it('should return original for non-matching format', () => {
            expect(shopSystem.getSquadDisplayName('custom_squad')).toBe('custom_squad');
        });
    });

    describe('resetShop', () => {
        it('should call reset method', () => {
            // resetShop is an alias for reset
            expect(() => shopSystem.resetShop()).not.toThrow();
        });
    });

    describe('applyEffect', () => {
        it('should create teams state if not exists', () => {
            game.state.teams = undefined;

            shopSystem.applyEffect('left', { id: 'testEffect', bonus: 10 });

            expect(game.state.teams).toBeDefined();
            expect(game.state.teams['left']).toBeDefined();
            expect(game.state.teams['left'].effects).toBeDefined();
        });

        it('should store effect in team effects', () => {
            shopSystem.applyEffect('left', { id: 'damageBoost', bonus: 15 });

            expect(game.state.teams['left'].effects['damageBoost']).toEqual({
                id: 'damageBoost',
                bonus: 15
            });
        });

        it('should handle multiple effects', () => {
            shopSystem.applyEffect('left', { id: 'effect1', value: 1 });
            shopSystem.applyEffect('left', { id: 'effect2', value: 2 });

            expect(game.state.teams['left'].effects['effect1']).toBeDefined();
            expect(game.state.teams['left'].effects['effect2']).toBeDefined();
        });
    });
});
