import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TestGameContext } from '../../../../../../tests/TestGameContext.js';

describe('SchedulingSystem', () => {
    let game;
    let schedulingSystem;

    beforeEach(() => {
        game = new TestGameContext();
        schedulingSystem = game.createSystem(GUTS.SchedulingSystem);
    });

    describe('initialization', () => {
        it('should initialize empty scheduledActions map', () => {
            expect(schedulingSystem.scheduledActions.size).toBe(0);
        });

        it('should initialize actionIdCounter to 0', () => {
            expect(schedulingSystem.actionIdCounter).toBe(0);
        });

        it('should initialize empty entityActions map', () => {
            expect(schedulingSystem.entityActions.size).toBe(0);
        });
    });

    describe('static services', () => {
        it('should register scheduleAction service', () => {
            expect(GUTS.SchedulingSystem.services).toContain('scheduleAction');
        });

        it('should register cancelScheduledAction service', () => {
            expect(GUTS.SchedulingSystem.services).toContain('cancelScheduledAction');
        });
    });

    describe('scheduleAction', () => {
        it('should return a unique action ID', () => {
            const actionId = schedulingSystem.scheduleAction(() => {}, 1.0);
            expect(actionId).toMatch(/^action_\d+_/);
        });

        it('should increment actionIdCounter', () => {
            schedulingSystem.scheduleAction(() => {}, 1.0);
            expect(schedulingSystem.actionIdCounter).toBe(1);

            schedulingSystem.scheduleAction(() => {}, 1.0);
            expect(schedulingSystem.actionIdCounter).toBe(2);
        });

        it('should store action with correct execute time', () => {
            game.state.now = 10.0;
            const actionId = schedulingSystem.scheduleAction(() => {}, 5.0);

            const action = schedulingSystem.scheduledActions.get(actionId);
            expect(action.executeTime).toBe(15.0);
        });

        it('should track entity association when entityId provided', () => {
            const entityId = 123;
            const actionId = schedulingSystem.scheduleAction(() => {}, 1.0, entityId);

            expect(schedulingSystem.entityActions.has(entityId)).toBe(true);
            expect(schedulingSystem.entityActions.get(entityId).has(actionId)).toBe(true);
        });

        it('should not track entity when entityId is null', () => {
            schedulingSystem.scheduleAction(() => {}, 1.0, null);
            expect(schedulingSystem.entityActions.size).toBe(0);
        });

        it('should allow multiple actions for same entity', () => {
            const entityId = 123;
            schedulingSystem.scheduleAction(() => {}, 1.0, entityId);
            schedulingSystem.scheduleAction(() => {}, 2.0, entityId);

            expect(schedulingSystem.entityActions.get(entityId).size).toBe(2);
        });
    });

    describe('cancelAction', () => {
        it('should return true when action exists', () => {
            const actionId = schedulingSystem.scheduleAction(() => {}, 1.0);
            const result = schedulingSystem.cancelAction(actionId);
            expect(result).toBe(true);
        });

        it('should return false when action does not exist', () => {
            const result = schedulingSystem.cancelAction('nonexistent_action');
            expect(result).toBe(false);
        });

        it('should remove action from scheduledActions', () => {
            const actionId = schedulingSystem.scheduleAction(() => {}, 1.0);
            schedulingSystem.cancelAction(actionId);
            expect(schedulingSystem.scheduledActions.has(actionId)).toBe(false);
        });

        it('should clean up entity tracking', () => {
            const entityId = 123;
            const actionId = schedulingSystem.scheduleAction(() => {}, 1.0, entityId);

            schedulingSystem.cancelAction(actionId);

            expect(schedulingSystem.entityActions.has(entityId)).toBe(false);
        });
    });

    describe('cancelScheduledAction', () => {
        it('should be an alias for cancelAction', () => {
            const actionId = schedulingSystem.scheduleAction(() => {}, 1.0);
            const result = schedulingSystem.cancelScheduledAction(actionId);
            expect(result).toBe(true);
            expect(schedulingSystem.scheduledActions.has(actionId)).toBe(false);
        });
    });

    describe('processScheduledActions', () => {
        it('should not execute actions before their time', () => {
            game.state.now = 0;
            let executed = false;
            schedulingSystem.scheduleAction(() => { executed = true; }, 5.0);

            game.state.now = 3.0;
            schedulingSystem.processScheduledActions();

            expect(executed).toBe(false);
        });

        it('should execute actions when time is reached', () => {
            game.state.now = 0;
            let executed = false;
            schedulingSystem.scheduleAction(() => { executed = true; }, 5.0);

            game.state.now = 5.0;
            schedulingSystem.processScheduledActions();

            expect(executed).toBe(true);
        });

        it('should execute actions when time is past', () => {
            game.state.now = 0;
            let executed = false;
            schedulingSystem.scheduleAction(() => { executed = true; }, 5.0);

            game.state.now = 10.0;
            schedulingSystem.processScheduledActions();

            expect(executed).toBe(true);
        });

        it('should remove executed actions', () => {
            game.state.now = 0;
            const actionId = schedulingSystem.scheduleAction(() => {}, 1.0);

            game.state.now = 1.0;
            schedulingSystem.processScheduledActions();

            expect(schedulingSystem.scheduledActions.has(actionId)).toBe(false);
        });

        it('should execute multiple ready actions in order', () => {
            const executionOrder = [];

            game.state.now = 0;
            schedulingSystem.scheduleAction(() => { executionOrder.push(2); }, 2.0);
            schedulingSystem.scheduleAction(() => { executionOrder.push(1); }, 1.0);
            schedulingSystem.scheduleAction(() => { executionOrder.push(3); }, 3.0);

            game.state.now = 5.0;
            schedulingSystem.processScheduledActions();

            expect(executionOrder).toEqual([1, 2, 3]);
        });

        it('should handle callback errors gracefully', () => {
            game.state.now = 0;
            let secondExecuted = false;

            schedulingSystem.scheduleAction(() => { throw new Error('Test error'); }, 1.0);
            schedulingSystem.scheduleAction(() => { secondExecuted = true; }, 1.0);

            game.state.now = 1.0;

            // Should not throw
            expect(() => schedulingSystem.processScheduledActions()).not.toThrow();
            expect(secondExecuted).toBe(true);
        });
    });

    describe('entityDestroyed', () => {
        it('should return 0 for entity without actions', () => {
            const result = schedulingSystem.entityDestroyed(999);
            expect(result).toBe(0);
        });

        it('should cancel all actions for entity', () => {
            const entityId = 123;
            schedulingSystem.scheduleAction(() => {}, 1.0, entityId);
            schedulingSystem.scheduleAction(() => {}, 2.0, entityId);

            const result = schedulingSystem.entityDestroyed(entityId);

            expect(result).toBe(2);
            expect(schedulingSystem.scheduledActions.size).toBe(0);
        });

        it('should remove entity from tracking', () => {
            const entityId = 123;
            schedulingSystem.scheduleAction(() => {}, 1.0, entityId);

            schedulingSystem.entityDestroyed(entityId);

            expect(schedulingSystem.entityActions.has(entityId)).toBe(false);
        });

        it('should not affect other entity actions', () => {
            schedulingSystem.scheduleAction(() => {}, 1.0, 123);
            schedulingSystem.scheduleAction(() => {}, 1.0, 456);

            schedulingSystem.entityDestroyed(123);

            expect(schedulingSystem.scheduledActions.size).toBe(1);
            expect(schedulingSystem.entityActions.has(456)).toBe(true);
        });
    });

    describe('getSchedulingStats', () => {
        it('should return correct stats for empty scheduler', () => {
            const stats = schedulingSystem.getSchedulingStats();

            expect(stats.totalActions).toBe(0);
            expect(stats.entitiesWithActions).toBe(0);
            expect(stats.nextActionTime).toBeNull();
        });

        it('should return correct stats with actions', () => {
            game.state.now = 10.0;
            schedulingSystem.scheduleAction(() => {}, 5.0, 1);
            schedulingSystem.scheduleAction(() => {}, 3.0, 2);

            const stats = schedulingSystem.getSchedulingStats();

            expect(stats.totalActions).toBe(2);
            expect(stats.entitiesWithActions).toBe(2);
            expect(stats.nextActionTime).toBe(13.0); // 10 + 3
        });
    });

    describe('getNextActionTime', () => {
        it('should return null when no actions', () => {
            expect(schedulingSystem.getNextActionTime()).toBeNull();
        });

        it('should return earliest action time', () => {
            game.state.now = 0;
            schedulingSystem.scheduleAction(() => {}, 5.0);
            schedulingSystem.scheduleAction(() => {}, 2.0);
            schedulingSystem.scheduleAction(() => {}, 8.0);

            expect(schedulingSystem.getNextActionTime()).toBe(2.0);
        });
    });

    describe('hasEntityActions', () => {
        it('should return falsy for entity without actions', () => {
            expect(schedulingSystem.hasEntityActions(999)).toBeFalsy();
        });

        it('should return true for entity with actions', () => {
            schedulingSystem.scheduleAction(() => {}, 1.0, 123);
            expect(schedulingSystem.hasEntityActions(123)).toBe(true);
        });

        it('should return falsy after all entity actions cancelled', () => {
            const actionId = schedulingSystem.scheduleAction(() => {}, 1.0, 123);
            schedulingSystem.cancelAction(actionId);
            expect(schedulingSystem.hasEntityActions(123)).toBeFalsy();
        });
    });

    describe('clearAllActions', () => {
        it('should clear all scheduled actions', () => {
            schedulingSystem.scheduleAction(() => {}, 1.0, 1);
            schedulingSystem.scheduleAction(() => {}, 2.0, 2);

            schedulingSystem.clearAllActions();

            expect(schedulingSystem.scheduledActions.size).toBe(0);
            expect(schedulingSystem.entityActions.size).toBe(0);
        });
    });

    describe('scheduleMethodCall', () => {
        it('should schedule a method call', () => {
            let calledWith = null;
            const obj = {
                testMethod: (arg) => { calledWith = arg; }
            };

            game.state.now = 0;
            schedulingSystem.scheduleMethodCall(obj, 'testMethod', ['hello'], 1.0);

            game.state.now = 1.0;
            schedulingSystem.processScheduledActions();

            expect(calledWith).toBe('hello');
        });

        it('should handle non-existent method gracefully', () => {
            const obj = {};

            game.state.now = 0;
            schedulingSystem.scheduleMethodCall(obj, 'nonExistentMethod', [], 1.0);

            game.state.now = 1.0;
            expect(() => schedulingSystem.processScheduledActions()).not.toThrow();
        });

        it('should handle null object gracefully', () => {
            game.state.now = 0;
            schedulingSystem.scheduleMethodCall(null, 'method', [], 1.0);

            game.state.now = 1.0;
            expect(() => schedulingSystem.processScheduledActions()).not.toThrow();
        });

        it('should pass multiple arguments', () => {
            let args = null;
            const obj = {
                testMethod: (a, b, c) => { args = [a, b, c]; }
            };

            game.state.now = 0;
            schedulingSystem.scheduleMethodCall(obj, 'testMethod', [1, 2, 3], 1.0);

            game.state.now = 1.0;
            schedulingSystem.processScheduledActions();

            expect(args).toEqual([1, 2, 3]);
        });

        it('should track entity association', () => {
            const obj = { method: () => {} };
            schedulingSystem.scheduleMethodCall(obj, 'method', [], 1.0, 123);

            expect(schedulingSystem.hasEntityActions(123)).toBe(true);
        });
    });

    describe('update', () => {
        it('should call processScheduledActions', () => {
            game.state.now = 0;
            let executed = false;
            schedulingSystem.scheduleAction(() => { executed = true; }, 0);

            schedulingSystem.update();

            expect(executed).toBe(true);
        });
    });

    describe('removeAction', () => {
        it('should clean up empty entity tracking sets', () => {
            const entityId = 123;
            const actionId = schedulingSystem.scheduleAction(() => {}, 1.0, entityId);

            schedulingSystem.removeAction(actionId, entityId);

            expect(schedulingSystem.entityActions.has(entityId)).toBe(false);
        });

        it('should not remove entity tracking if other actions remain', () => {
            const entityId = 123;
            const actionId1 = schedulingSystem.scheduleAction(() => {}, 1.0, entityId);
            schedulingSystem.scheduleAction(() => {}, 2.0, entityId);

            schedulingSystem.removeAction(actionId1, entityId);

            expect(schedulingSystem.entityActions.has(entityId)).toBe(true);
            expect(schedulingSystem.entityActions.get(entityId).size).toBe(1);
        });
    });
});
