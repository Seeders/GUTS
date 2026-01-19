import { describe, it, expect, beforeEach } from 'vitest';
import { TestGameContext } from '../../../../../../tests/TestGameContext.js';

describe('UnitOrderSystem', () => {
    let game;
    let unitOrderSystem;
    let enums;

    beforeEach(() => {
        game = new TestGameContext();
        game.state.now = 1000;

        // Register mock services
        game.register('getPlacementById', (placementId) => {
            // Return mock placement data
            if (placementId === 'left_0') {
                return {
                    placementId: 'left_0',
                    squadUnits: [1, 2, 3]
                };
            }
            if (placementId === 'right_0') {
                return {
                    placementId: 'right_0',
                    squadUnits: [10, 11]
                };
            }
            return null;
        });
        game.register('clearEntityPath', () => {});

        unitOrderSystem = game.createSystem(GUTS.UnitOrderSystem);
        enums = game.getEnums();
    });

    describe('initialization', () => {
        it('should register system on game', () => {
            expect(game.unitOrderSystem).toBe(unitOrderSystem);
        });
    });

    describe('static services', () => {
        it('should register applySquadTargetPosition service', () => {
            expect(GUTS.UnitOrderSystem.services).toContain('applySquadTargetPosition');
        });

        it('should register applySquadsTargetPositions service', () => {
            expect(GUTS.UnitOrderSystem.services).toContain('applySquadsTargetPositions');
        });
    });

    describe('applySquadTargetPosition', () => {
        it('should not throw for non-existent placement', () => {
            expect(() => {
                unitOrderSystem.applySquadTargetPosition(
                    'nonexistent',
                    { x: 100, y: 0, z: 100 },
                    {},
                    1000
                );
            }).not.toThrow();
        });

        it('should create playerOrder component if not exists', () => {
            // Create entities that match the mock placement
            const entity1 = game.createEntity();
            game.register('getPlacementById', () => ({
                placementId: 'test',
                squadUnits: [entity1]
            }));

            unitOrderSystem.applySquadTargetPosition(
                'test',
                { x: 100, y: 0, z: 200 },
                {},
                1500
            );

            const playerOrder = game.getComponent(entity1, 'playerOrder');
            expect(playerOrder).toBeDefined();
        });

        it('should set target position on playerOrder', () => {
            const entity1 = game.createEntity();
            game.register('getPlacementById', () => ({
                placementId: 'test',
                squadUnits: [entity1]
            }));

            unitOrderSystem.applySquadTargetPosition(
                'test',
                { x: 150, y: 10, z: 250 },
                {},
                2000
            );

            const playerOrder = game.getComponent(entity1, 'playerOrder');
            expect(playerOrder.targetPositionX).toBe(150);
            expect(playerOrder.targetPositionY).toBe(10);
            expect(playerOrder.targetPositionZ).toBe(250);
        });

        it('should set isMoveOrder from meta', () => {
            const entity1 = game.createEntity();
            game.register('getPlacementById', () => ({
                placementId: 'test',
                squadUnits: [entity1]
            }));

            unitOrderSystem.applySquadTargetPosition(
                'test',
                { x: 100, y: 0, z: 100 },
                { isMoveOrder: true },
                1000
            );

            const playerOrder = game.getComponent(entity1, 'playerOrder');
            expect(playerOrder.isMoveOrder).toBe(true);
        });

        it('should set preventEnemiesInRangeCheck from meta', () => {
            const entity1 = game.createEntity();
            game.register('getPlacementById', () => ({
                placementId: 'test',
                squadUnits: [entity1]
            }));

            unitOrderSystem.applySquadTargetPosition(
                'test',
                { x: 100, y: 0, z: 100 },
                { preventEnemiesInRangeCheck: true },
                1000
            );

            const playerOrder = game.getComponent(entity1, 'playerOrder');
            expect(playerOrder.preventEnemiesInRangeCheck).toBe(true);
        });

        it('should set completed to false', () => {
            const entity1 = game.createEntity();
            game.addComponent(entity1, 'playerOrder', { completed: true });

            game.register('getPlacementById', () => ({
                placementId: 'test',
                squadUnits: [entity1]
            }));

            unitOrderSystem.applySquadTargetPosition(
                'test',
                { x: 100, y: 0, z: 100 },
                {},
                1000
            );

            const playerOrder = game.getComponent(entity1, 'playerOrder');
            expect(playerOrder.completed).toBe(false);
        });

        it('should set enabled to true', () => {
            const entity1 = game.createEntity();
            game.register('getPlacementById', () => ({
                placementId: 'test',
                squadUnits: [entity1]
            }));

            unitOrderSystem.applySquadTargetPosition(
                'test',
                { x: 100, y: 0, z: 100 },
                {},
                1000
            );

            const playerOrder = game.getComponent(entity1, 'playerOrder');
            expect(playerOrder.enabled).toBe(true);
        });

        it('should set issuedTime from commandCreatedTime', () => {
            const entity1 = game.createEntity();
            game.register('getPlacementById', () => ({
                placementId: 'test',
                squadUnits: [entity1]
            }));

            unitOrderSystem.applySquadTargetPosition(
                'test',
                { x: 100, y: 0, z: 100 },
                {},
                5000
            );

            const playerOrder = game.getComponent(entity1, 'playerOrder');
            expect(playerOrder.issuedTime).toBe(5000);
        });

        it('should use game.state.now when commandCreatedTime not provided', () => {
            const entity1 = game.createEntity();
            game.register('getPlacementById', () => ({
                placementId: 'test',
                squadUnits: [entity1]
            }));

            unitOrderSystem.applySquadTargetPosition(
                'test',
                { x: 100, y: 0, z: 100 },
                {},
                undefined
            );

            const playerOrder = game.getComponent(entity1, 'playerOrder');
            expect(playerOrder.issuedTime).toBe(1000); // game.state.now
        });

        it('should reset pathfinding component state', () => {
            const entity1 = game.createEntity();
            game.addComponent(entity1, 'pathfinding', {
                lastPathRequest: 999,
                pathIndex: 5,
                lastTargetX: 50,
                lastTargetZ: 50
            });

            game.register('getPlacementById', () => ({
                placementId: 'test',
                squadUnits: [entity1]
            }));

            unitOrderSystem.applySquadTargetPosition(
                'test',
                { x: 100, y: 0, z: 100 },
                {},
                1000
            );

            const pathfinding = game.getComponent(entity1, 'pathfinding');
            expect(pathfinding.lastPathRequest).toBe(0);
            expect(pathfinding.pathIndex).toBe(0);
            expect(pathfinding.lastTargetX).toBe(0);
            expect(pathfinding.lastTargetZ).toBe(0);
        });

        it('should apply to all units in squad', () => {
            const entity1 = game.createEntity();
            const entity2 = game.createEntity();
            const entity3 = game.createEntity();

            game.register('getPlacementById', () => ({
                placementId: 'test',
                squadUnits: [entity1, entity2, entity3]
            }));

            unitOrderSystem.applySquadTargetPosition(
                'test',
                { x: 200, y: 0, z: 300 },
                { isMoveOrder: true },
                2000
            );

            [entity1, entity2, entity3].forEach(entityId => {
                const playerOrder = game.getComponent(entityId, 'playerOrder');
                expect(playerOrder.targetPositionX).toBe(200);
                expect(playerOrder.targetPositionZ).toBe(300);
                expect(playerOrder.isMoveOrder).toBe(true);
            });
        });

        it('should call clearEntityPath service', () => {
            const entity1 = game.createEntity();
            let clearPathCalled = false;
            game.register('clearEntityPath', (id) => {
                clearPathCalled = true;
                expect(id).toBe(entity1);
            });

            game.register('getPlacementById', () => ({
                placementId: 'test',
                squadUnits: [entity1]
            }));

            unitOrderSystem.applySquadTargetPosition(
                'test',
                { x: 100, y: 0, z: 100 },
                {},
                1000
            );

            expect(clearPathCalled).toBe(true);
        });

        it('should handle null target position gracefully', () => {
            const entity1 = game.createEntity();
            game.addComponent(entity1, 'playerOrder', {
                targetPositionX: 50,
                enabled: true
            });

            game.register('getPlacementById', () => ({
                placementId: 'test',
                squadUnits: [entity1]
            }));

            unitOrderSystem.applySquadTargetPosition(
                'test',
                null,  // null target
                {},
                1000
            );

            // Should not modify existing playerOrder when target is null
            const playerOrder = game.getComponent(entity1, 'playerOrder');
            expect(playerOrder.targetPositionX).toBe(50);
        });
    });

    describe('applySquadsTargetPositions', () => {
        it('should apply to multiple placements', () => {
            const entity1 = game.createEntity();
            const entity2 = game.createEntity();

            let callCount = 0;
            game.register('getPlacementById', (id) => {
                callCount++;
                if (id === 'placement1') return { placementId: 'placement1', squadUnits: [entity1] };
                if (id === 'placement2') return { placementId: 'placement2', squadUnits: [entity2] };
                return null;
            });

            unitOrderSystem.applySquadsTargetPositions(
                ['placement1', 'placement2'],
                [{ x: 100, y: 0, z: 100 }, { x: 200, y: 0, z: 200 }],
                { isMoveOrder: true },
                3000
            );

            const order1 = game.getComponent(entity1, 'playerOrder');
            const order2 = game.getComponent(entity2, 'playerOrder');

            expect(order1.targetPositionX).toBe(100);
            expect(order2.targetPositionX).toBe(200);
        });

        it('should handle empty arrays', () => {
            expect(() => {
                unitOrderSystem.applySquadsTargetPositions([], [], {}, 1000);
            }).not.toThrow();
        });

        it('should apply same meta to all placements', () => {
            const entity1 = game.createEntity();
            const entity2 = game.createEntity();

            game.register('getPlacementById', (id) => {
                if (id === 'p1') return { placementId: 'p1', squadUnits: [entity1] };
                if (id === 'p2') return { placementId: 'p2', squadUnits: [entity2] };
                return null;
            });

            unitOrderSystem.applySquadsTargetPositions(
                ['p1', 'p2'],
                [{ x: 100, y: 0, z: 100 }, { x: 200, y: 0, z: 200 }],
                { isMoveOrder: true, preventEnemiesInRangeCheck: true },
                4000
            );

            const order1 = game.getComponent(entity1, 'playerOrder');
            const order2 = game.getComponent(entity2, 'playerOrder');

            expect(order1.isMoveOrder).toBe(true);
            expect(order1.preventEnemiesInRangeCheck).toBe(true);
            expect(order2.isMoveOrder).toBe(true);
            expect(order2.preventEnemiesInRangeCheck).toBe(true);
        });
    });
});
