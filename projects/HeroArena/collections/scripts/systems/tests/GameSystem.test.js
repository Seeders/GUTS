import { describe, it, expect, beforeEach } from 'vitest';
import { TestGameContext } from '../../../../../../tests/TestGameContext.js';

describe('GameSystem', () => {
    let game;
    let gameSystem;
    let enums;

    beforeEach(() => {
        game = new TestGameContext();

        // Register mock services
        game.register('getSelectedMode', () => ({
            id: 'skirmish',
            title: 'Skirmish',
            description: 'Battle against AI'
        }));
        game.register('showLoadingScreen', () => {});
        game.register('showGameScreen', () => {});
        game.register('pauseScreen', () => {});
        game.register('resumeScreen', () => {});
        game.register('showMainMenu', () => {});

        gameSystem = game.createSystem(GUTS.GameSystem);
        enums = game.getEnums();
    });

    describe('initialization', () => {
        it('should register system on game', () => {
            expect(game.gameSystem).toBe(gameSystem);
        });
    });

    describe('static services', () => {
        it('should register initializeGame service', () => {
            expect(GUTS.GameSystem.services).toContain('initializeGame');
        });

        it('should register pauseGame service', () => {
            expect(GUTS.GameSystem.services).toContain('pauseGame');
        });

        it('should register resumeGame service', () => {
            expect(GUTS.GameSystem.services).toContain('resumeGame');
        });

        it('should register restartGame service', () => {
            expect(GUTS.GameSystem.services).toContain('restartGame');
        });

        it('should register exitToMenu service', () => {
            expect(GUTS.GameSystem.services).toContain('exitToMenu');
        });
    });

    describe('initializeGame', () => {
        it('should set isPaused to false', () => {
            game.state.isPaused = true;

            gameSystem.initializeGame();

            expect(game.state.isPaused).toBe(false);
        });

        it('should call showGameScreen', () => {
            let showGameScreenCalled = false;
            game.register('showGameScreen', () => {
                showGameScreenCalled = true;
            });

            gameSystem.initializeGame();

            expect(showGameScreenCalled).toBe(true);
        });

        it('should trigger onGameStarted event', () => {
            let eventTriggered = false;
            game.triggerEvent = (eventName) => {
                if (eventName === 'onGameStarted') {
                    eventTriggered = true;
                }
            };

            gameSystem.initializeGame();

            expect(eventTriggered).toBe(true);
        });

        it('should skip loading screen for multiplayer data', () => {
            let loadingShown = false;
            game.register('showLoadingScreen', () => {
                loadingShown = true;
            });

            // Pass multiplayer data - should skip loading screen
            gameSystem.initializeGame({ playerId: 1 });

            expect(loadingShown).toBe(false);
        });

        it('should show loading screen for single player', () => {
            let loadingShown = false;
            game.register('showLoadingScreen', () => {
                loadingShown = true;
            });

            gameSystem.initializeGame(null);

            expect(loadingShown).toBe(true);
        });
    });

    describe('pauseGame', () => {
        it('should call pauseScreen service', () => {
            let pauseScreenCalled = false;
            game.register('pauseScreen', () => {
                pauseScreenCalled = true;
            });

            gameSystem.pauseGame();

            expect(pauseScreenCalled).toBe(true);
        });

        it('should not throw when no pause menu element exists', () => {
            expect(() => gameSystem.pauseGame()).not.toThrow();
        });
    });

    describe('resumeGame', () => {
        it('should call resumeScreen service', () => {
            let resumeScreenCalled = false;
            game.register('resumeScreen', () => {
                resumeScreenCalled = true;
            });

            gameSystem.resumeGame();

            expect(resumeScreenCalled).toBe(true);
        });

        it('should not throw when no pause menu element exists', () => {
            expect(() => gameSystem.resumeGame()).not.toThrow();
        });
    });

    describe('continueGame', () => {
        it('should increment round', () => {
            game.state.round = 3;

            gameSystem.continueGame();

            expect(game.state.round).toBe(4);
        });

        it('should call initializeGame', () => {
            let initCalled = false;
            const originalInit = gameSystem.initializeGame.bind(gameSystem);
            gameSystem.initializeGame = () => {
                initCalled = true;
            };

            gameSystem.continueGame();

            expect(initCalled).toBe(true);
        });
    });

    describe('onSceneUnload', () => {
        it('should not throw', () => {
            expect(() => gameSystem.onSceneUnload()).not.toThrow();
        });
    });
});
