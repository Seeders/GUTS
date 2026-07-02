import { describe, it, expect, beforeEach } from 'vitest';
import { TestGameContext } from '../../../../../../tests/TestGameContext.js';

describe('BehaviorSystem', () => {
    let game;
    let behaviorSystem;
    let enums;

    beforeEach(() => {
        game = new TestGameContext();

        behaviorSystem = game.createSystem(GUTS.BehaviorSystem);
        enums = game.getEnums();
    });

    describe('initialization', () => {
        it('should have a processor', () => {
            expect(behaviorSystem.processor).toBeDefined();
        });

        it('should start with null rootTree', () => {
            expect(behaviorSystem.rootTree).toBeNull();
        });
    });

    describe('getOrCreateBehaviorState', () => {
        it('should create new state (behaviorState component) for an entity', () => {
            const id = game.createEntityWith({ unitType: {} });
            const state = behaviorSystem.getOrCreateBehaviorState(id);

            expect(state).toBeDefined();
            expect(state.meta).toEqual({});
            expect(state.shared).toEqual({});
            expect(game.getComponent(id, 'behaviorState')).toBeTruthy();
        });

        it('should return existing state for known entity', () => {
            const id = game.createEntityWith({ unitType: {} });
            const state1 = behaviorSystem.getOrCreateBehaviorState(id);
            state1.meta = { target: 456 };

            const state2 = behaviorSystem.getOrCreateBehaviorState(id);

            expect(state2.meta.target).toBe(456);
        });

        it('should return a detached scratch state for dead entities (no crash)', () => {
            const state = behaviorSystem.getOrCreateBehaviorState(99999);
            expect(state.meta).toEqual({});
            expect(state.shared).toEqual({});
        });
    });

    describe('getBehaviorMeta', () => {
        it('should return meta for entity', () => {
            const id = game.createEntityWith({ unitType: {} });
            behaviorSystem.setBehaviorMeta(id, { target: 456 });

            const meta = behaviorSystem.getBehaviorMeta(id);

            expect(meta.target).toBe(456);
        });

        it('should create and return empty meta for new entity', () => {
            const id = game.createEntityWith({ unitType: {} });
            const meta = behaviorSystem.getBehaviorMeta(id);

            expect(meta).toEqual({});
            expect(game.getComponent(id, 'behaviorState')).toBeTruthy();
        });
    });

    describe('getBehaviorShared', () => {
        it('should return shared state for entity', () => {
            const id = game.createEntityWith({ unitType: {} });
            behaviorSystem.getOrCreateBehaviorState(id).shared.lastAction = 'attack';

            const shared = behaviorSystem.getBehaviorShared(id);

            expect(shared.lastAction).toBe('attack');
        });

        it('should create and return empty shared for new entity', () => {
            const id = game.createEntityWith({ unitType: {} });
            const shared = behaviorSystem.getBehaviorShared(id);

            expect(shared).toEqual({});
        });
    });

    describe('setBehaviorMeta', () => {
        it('should set meta for entity', () => {
            const id = game.createEntityWith({ unitType: {} });
            behaviorSystem.setBehaviorMeta(id, { target: 789, action: 'move' });

            const state = behaviorSystem.getOrCreateBehaviorState(id);
            expect(state.meta.target).toBe(789);
            expect(state.meta.action).toBe('move');
        });

        it('should replace existing meta', () => {
            const id = game.createEntityWith({ unitType: {} });
            behaviorSystem.setBehaviorMeta(id, { old: 'data' });
            behaviorSystem.setBehaviorMeta(id, { new: 'data' });

            const state = behaviorSystem.getOrCreateBehaviorState(id);
            expect(state.meta.old).toBeUndefined();
            expect(state.meta.new).toBe('data');
        });
    });

    describe('clearBehaviorState', () => {
        it('should clear meta and shared for entity', () => {
            const id = game.createEntityWith({ unitType: {} });
            const state0 = behaviorSystem.getOrCreateBehaviorState(id);
            state0.meta = { target: 456 };
            state0.shared = { lastAction: 'attack' };

            behaviorSystem.clearBehaviorState(id);

            const state = behaviorSystem.getOrCreateBehaviorState(id);
            expect(state.meta).toEqual({});
            expect(state.shared).toEqual({});
        });

        it('should preserve persistent shared keys (patrolWaypoints)', () => {
            const id = game.createEntityWith({ unitType: {} });
            const state0 = behaviorSystem.getOrCreateBehaviorState(id);
            state0.shared = { patrolWaypoints: [{ x: 1, z: 2 }], currentWaypointIndex: 1, other: 'gone' };

            behaviorSystem.clearBehaviorState(id);

            const state = behaviorSystem.getOrCreateBehaviorState(id);
            expect(state.shared.patrolWaypoints).toEqual([{ x: 1, z: 2 }]);
            expect(state.shared.currentWaypointIndex).toBe(1);
            expect(state.shared.other).toBeUndefined();
        });

        it('should not throw for new entity', () => {
            expect(() => behaviorSystem.clearBehaviorState(99999)).not.toThrow();
        });
    });

    describe('removeBehaviorState', () => {
        it('should remove the behaviorState component', () => {
            const id = game.createEntityWith({ unitType: {} });
            behaviorSystem.getOrCreateBehaviorState(id);
            expect(game.getComponent(id, 'behaviorState')).toBeTruthy();

            behaviorSystem.removeBehaviorState(id);

            expect(game.getComponent(id, 'behaviorState')).toBeFalsy();
        });

        it('should not throw for non-existent entity', () => {
            expect(() => behaviorSystem.removeBehaviorState(99999)).not.toThrow();
        });
    });

    describe('getNodeId', () => {
        beforeEach(() => {
            // Initialize the system to set up collection maps
            behaviorSystem.collectionNames = ['behaviorTrees', 'behaviorActions'];
            behaviorSystem.behaviorCollectionMaps = {
                behaviorTrees: { toValue: ['defaultTree'], toIndex: { defaultTree: 0 } },
                behaviorActions: { toValue: ['IdleBehaviorAction', 'AttackAction'], toIndex: { IdleBehaviorAction: 0, AttackAction: 1 } }
            };
        });

        it('should return node ID for valid indices', () => {
            const nodeId = behaviorSystem.getNodeId(0, 0);
            expect(nodeId).toBe('defaultTree');
        });

        it('should return action ID for action collection', () => {
            const nodeId = behaviorSystem.getNodeId(1, 1);
            expect(nodeId).toBe('AttackAction');
        });

        it('should return undefined for invalid collection index', () => {
            const nodeId = behaviorSystem.getNodeId(99, 0);
            expect(nodeId).toBeUndefined();
        });
    });

    describe('getNodeIndices', () => {
        beforeEach(() => {
            behaviorSystem.collectionNames = ['behaviorTrees', 'behaviorActions'];
            behaviorSystem.behaviorCollectionMaps = {
                behaviorTrees: { toValue: ['defaultTree'], toIndex: { defaultTree: 0 } },
                behaviorActions: { toValue: ['IdleBehaviorAction', 'AttackAction'], toIndex: { IdleBehaviorAction: 0, AttackAction: 1 } }
            };
        });

        it('should return indices for valid node ID', () => {
            const indices = behaviorSystem.getNodeIndices('defaultTree');
            expect(indices).toEqual({ collection: 0, index: 0 });
        });

        it('should return indices for action node ID', () => {
            const indices = behaviorSystem.getNodeIndices('AttackAction');
            expect(indices).toEqual({ collection: 1, index: 1 });
        });

        it('should return null for unknown node ID', () => {
            const indices = behaviorSystem.getNodeIndices('unknownNode');
            expect(indices).toBeNull();
        });
    });

    describe('shouldSwitchAction', () => {
        it('should return false for null desired action', () => {
            const aiState = { currentAction: 0 };
            expect(behaviorSystem.shouldSwitchAction(aiState, null)).toBe(false);
        });

        it('should return false for desired action without action property', () => {
            const aiState = { currentAction: 0 };
            expect(behaviorSystem.shouldSwitchAction(aiState, { meta: {} })).toBe(false);
        });

        it('should return false for desired action without meta property', () => {
            const aiState = { currentAction: 0 };
            expect(behaviorSystem.shouldSwitchAction(aiState, { action: 'test' })).toBe(false);
        });

        it('should return true for null current action', () => {
            const aiState = { currentAction: null };
            const desired = { action: 'test', meta: {}, status: 'success' };
            expect(behaviorSystem.shouldSwitchAction(aiState, desired)).toBe(true);
        });

        it('should return true for success status', () => {
            behaviorSystem.collectionNames = ['behaviorActions'];
            behaviorSystem.behaviorCollectionMaps = {
                behaviorActions: { toIndex: { test: 0 } }
            };

            const aiState = { currentAction: 0, currentActionCollection: 0 };
            const desired = { action: 'test', meta: {}, status: 'success' };
            expect(behaviorSystem.shouldSwitchAction(aiState, desired)).toBe(true);
        });
    });

    describe('getBehaviorEntities', () => {
        it('should return empty array when no behavior entities', () => {
            const entities = behaviorSystem.getBehaviorEntities();
            expect(entities).toEqual([]);
        });

        it('should return sorted entity IDs', () => {
            game.createEntityWith({ aiState: {}, unitType: {} });
            game.createEntityWith({ aiState: {}, unitType: {} });
            game.createEntityWith({ aiState: {}, unitType: {} });

            const entities = behaviorSystem.getBehaviorEntities();

            // Should be numerically sorted
            for (let i = 1; i < entities.length; i++) {
                expect(entities[i]).toBeGreaterThan(entities[i - 1]);
            }
        });
    });

    describe('entityDestroyed', () => {
        it('behavior state is cleared when an entity is destroyed', () => {
            const id = game.createEntityWith({ unitType: {} });
            behaviorSystem.setBehaviorMeta(id, { target: 1 });
            expect(game.getComponent(id, 'behaviorState')).toBeTruthy();

            game.destroyEntity(id);

            expect(game.getComponent(id, 'behaviorState')).toBeFalsy();
        });
    });

    describe('update', () => {
        it('should not update when not in battle phase', () => {
            game.state.phase = enums.gamePhase.placement;

            const entityId = game.createEntityWith({
                aiState: { rootBehaviorTree: 0, rootBehaviorTreeCollection: 0 },
                unitType: {}
            });

            // Should not throw and should return early
            expect(() => behaviorSystem.update(0.016)).not.toThrow();
        });
    });

    describe('updateUnit', () => {
        it('should skip dead units', () => {
            const entityId = game.createEntityWith({
                aiState: { rootBehaviorTree: 0, rootBehaviorTreeCollection: 0 },
                unitType: {},
                deathState: { state: enums.deathState.dying }
            });

            // Should not throw - dead units are skipped
            expect(() => behaviorSystem.updateUnit(entityId, 0.016)).not.toThrow();
        });

        it('should skip leaping units', () => {
            const entityId = game.createEntityWith({
                aiState: { rootBehaviorTree: 0, rootBehaviorTreeCollection: 0 },
                unitType: {},
                deathState: { state: enums.deathState.alive },
                leaping: { isLeaping: true }
            });

            // Should not throw - leaping units are skipped
            expect(() => behaviorSystem.updateUnit(entityId, 0.016)).not.toThrow();
        });

        it('should skip units without aiState', () => {
            const entityId = game.createEntityWith({
                unitType: {}
            });

            // Should not throw - missing aiState returns early
            expect(() => behaviorSystem.updateUnit(entityId, 0.016)).not.toThrow();
        });
    });

    describe('getNodeByType', () => {
        it('should delegate to processor', () => {
            // Just verify the method exists and doesn't throw
            expect(() => behaviorSystem.getNodeByType('someNode')).not.toThrow();
        });
    });

    describe('getDebugger', () => {
        it('should delegate to processor', () => {
            const debugger_ = behaviorSystem.getDebugger();
            // Processor creates a debugger
            expect(debugger_).toBeDefined();
        });
    });

    describe('getBehaviorNodeId alias', () => {
        it('should be an alias for getNodeId', () => {
            // getBehaviorNodeId takes an entityId, but internally calls getNodeId
            // Just verify the method exists and doesn't throw
            expect(() => behaviorSystem.getBehaviorNodeId(123)).not.toThrow();
        });
    });

    describe('static services', () => {
        it('should register all expected services', () => {
            const services = GUTS.BehaviorSystem.services;
            expect(services).toContain('getBehaviorMeta');
            expect(services).toContain('getBehaviorShared');
            expect(services).toContain('setBehaviorMeta');
            expect(services).toContain('clearBehaviorState');
            expect(services).toContain('getBehaviorNodeId');
            expect(services).toContain('getNodeByType');
            expect(services).toContain('getDebugger');
        });
    });
});
