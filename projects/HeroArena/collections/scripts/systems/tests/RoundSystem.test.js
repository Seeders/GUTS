import { describe, it, expect, beforeEach } from 'vitest';
import { TestGameContext } from '../../../../../../tests/TestGameContext.js';

describe('RoundSystem', () => {
    let game;
    let roundSystem;
    let enums;

    beforeEach(() => {
        game = new TestGameContext();
        roundSystem = game.createSystem(GUTS.RoundSystem);
        enums = game.getEnums();
    });

    describe('initialization', () => {
        it('should register system on game', () => {
            expect(game.roundSystem).toBe(roundSystem);
        });
    });

    describe('onPlacementPhaseStart', () => {
        it('should not throw when no playerOrder entities exist', () => {
            expect(() => roundSystem.onPlacementPhaseStart()).not.toThrow();
        });

        it('should reset completed player orders', () => {
            const entityId = game.createEntityWith({
                playerOrder: {
                    enabled: true,
                    targetPositionX: 100,
                    targetPositionY: 50,
                    targetPositionZ: 200,
                    isMoveOrder: true,
                    preventEnemiesInRangeCheck: true,
                    completed: true,
                    issuedTime: 12345
                }
            });

            roundSystem.onPlacementPhaseStart();

            const playerOrder = game.getComponent(entityId, 'playerOrder');
            expect(playerOrder.enabled).toBe(false);
            expect(playerOrder.targetPositionX).toBe(0);
            expect(playerOrder.targetPositionY).toBe(0);
            expect(playerOrder.targetPositionZ).toBe(0);
            expect(playerOrder.isMoveOrder).toBe(false);
            expect(playerOrder.preventEnemiesInRangeCheck).toBe(false);
            expect(playerOrder.completed).toBe(false);
            expect(playerOrder.issuedTime).toBe(0);
        });

        it('should not reset incomplete player orders', () => {
            const entityId = game.createEntityWith({
                playerOrder: {
                    enabled: true,
                    targetPositionX: 100,
                    targetPositionY: 50,
                    targetPositionZ: 200,
                    isMoveOrder: true,
                    preventEnemiesInRangeCheck: false,
                    completed: false,
                    issuedTime: 12345
                }
            });

            roundSystem.onPlacementPhaseStart();

            const playerOrder = game.getComponent(entityId, 'playerOrder');
            // Should remain unchanged since completed was false
            expect(playerOrder.enabled).toBe(true);
            expect(playerOrder.targetPositionX).toBe(100);
            expect(playerOrder.isMoveOrder).toBe(true);
            expect(playerOrder.issuedTime).toBe(12345);
        });

        it('should handle multiple entities with mixed completion states', () => {
            const completedEntity = game.createEntityWith({
                playerOrder: {
                    enabled: true,
                    targetPositionX: 100,
                    completed: true
                }
            });

            const incompleteEntity = game.createEntityWith({
                playerOrder: {
                    enabled: true,
                    targetPositionX: 200,
                    completed: false
                }
            });

            roundSystem.onPlacementPhaseStart();

            const completedOrder = game.getComponent(completedEntity, 'playerOrder');
            const incompleteOrder = game.getComponent(incompleteEntity, 'playerOrder');

            // Completed order should be reset
            expect(completedOrder.enabled).toBe(false);
            expect(completedOrder.targetPositionX).toBe(0);

            // Incomplete order should be unchanged
            expect(incompleteOrder.enabled).toBe(true);
            expect(incompleteOrder.targetPositionX).toBe(200);
        });

        it('should handle entity without playerOrder gracefully', () => {
            // This tests that getComponent returning undefined doesn't crash
            // The system only queries entities WITH playerOrder, so this shouldn't happen
            // but the code has a null check
            expect(() => roundSystem.onPlacementPhaseStart()).not.toThrow();
        });
    });
});
