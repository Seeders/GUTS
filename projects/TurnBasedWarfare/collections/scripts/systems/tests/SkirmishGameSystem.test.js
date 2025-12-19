import { describe, it, expect, beforeEach } from 'vitest';
import { TestGameContext } from '../../../../../../tests/TestGameContext.js';

describe('SkirmishGameSystem', () => {
    let game;
    let skirmishGameSystem;
    let enums;

    beforeEach(() => {
        game = new TestGameContext();

        // Register mock services
        game.register('setLocalGame', () => {});
        game.register('showLoadingScreen', () => {});
        game.register('initializeGame', () => {});
        game.register('generateAIPlacement', () => {});
        game.register('createPlayerEntity', () => game.createEntity());

        skirmishGameSystem = game.createSystem(GUTS.SkirmishGameSystem);
        enums = game.getEnums();
    });

    describe('initialization', () => {
        it('should register system on game', () => {
            expect(game.skirmishGameSystem).toBe(skirmishGameSystem);
        });

        it('should initialize playerTeam as null', () => {
            expect(skirmishGameSystem.playerTeam).toBeNull();
        });

        it('should initialize aiTeam as null', () => {
            expect(skirmishGameSystem.aiTeam).toBeNull();
        });
    });

    describe('static services', () => {
        it('should register startSkirmishGame service', () => {
            expect(GUTS.SkirmishGameSystem.services).toContain('startSkirmishGame');
        });
    });

    describe('startSkirmishGame', () => {
        it('should not throw when no config', async () => {
            game.state.skirmishConfig = undefined;
            await expect(skirmishGameSystem.startSkirmishGame()).resolves.not.toThrow();
        });

        it('should call setLocalGame with true', async () => {
            let localGameSet = false;
            game.register('setLocalGame', (enabled, playerId) => {
                if (enabled === true && playerId === 0) {
                    localGameSet = true;
                }
            });

            game.state.skirmishConfig = { selectedTeam: 'left', startingGold: 100 };
            game.switchScene = async () => {};

            await skirmishGameSystem.startSkirmishGame();

            expect(localGameSet).toBe(true);
        });

        it('should generate game seed', async () => {
            game.state.skirmishConfig = { selectedTeam: 'left', startingGold: 100 };
            game.switchScene = async () => {};

            await skirmishGameSystem.startSkirmishGame();

            expect(game.state.gameSeed).toBeDefined();
            expect(typeof game.state.gameSeed).toBe('number');
        });

        it('should set playerTeam to left when selected', async () => {
            game.state.skirmishConfig = { selectedTeam: 'left', startingGold: 100 };
            game.switchScene = async () => {};

            await skirmishGameSystem.startSkirmishGame();

            expect(skirmishGameSystem.playerTeam).toBe(enums.team.left);
            expect(skirmishGameSystem.aiTeam).toBe(enums.team.right);
        });

        it('should set playerTeam to right when selected', async () => {
            game.state.skirmishConfig = { selectedTeam: 'right', startingGold: 100 };
            game.switchScene = async () => {};

            await skirmishGameSystem.startSkirmishGame();

            expect(skirmishGameSystem.playerTeam).toBe(enums.team.right);
            expect(skirmishGameSystem.aiTeam).toBe(enums.team.left);
        });

        it('should default to left team', async () => {
            game.state.skirmishConfig = { startingGold: 100 };
            game.switchScene = async () => {};

            await skirmishGameSystem.startSkirmishGame();

            expect(skirmishGameSystem.playerTeam).toBe(enums.team.left);
        });

        it('should set game.state.myTeam', async () => {
            game.state.skirmishConfig = { selectedTeam: 'left', startingGold: 100 };
            game.switchScene = async () => {};

            await skirmishGameSystem.startSkirmishGame();

            expect(game.state.myTeam).toBe(enums.team.left);
        });

        it('should call showLoadingScreen', async () => {
            let loadingShown = false;
            game.register('showLoadingScreen', () => { loadingShown = true; });

            game.state.skirmishConfig = { selectedTeam: 'left', startingGold: 100 };
            game.switchScene = async () => {};

            await skirmishGameSystem.startSkirmishGame();

            expect(loadingShown).toBe(true);
        });

        it('should switch to skirmish scene', async () => {
            let sceneSwitched = null;
            game.switchScene = async (sceneName) => { sceneSwitched = sceneName; };

            game.state.skirmishConfig = { selectedTeam: 'left', startingGold: 100 };

            await skirmishGameSystem.startSkirmishGame();

            expect(sceneSwitched).toBe('skirmish');
        });

        it('should call initializeGame', async () => {
            let initCalled = false;
            game.register('initializeGame', () => { initCalled = true; });

            game.state.skirmishConfig = { selectedTeam: 'left', startingGold: 100 };
            game.switchScene = async () => {};

            await skirmishGameSystem.startSkirmishGame();

            expect(initCalled).toBe(true);
        });

        it('should set level from config', async () => {
            enums.levels = { 'forest': 2 };
            game.state.skirmishConfig = {
                selectedTeam: 'left',
                selectedLevel: 'forest',
                startingGold: 100
            };
            game.switchScene = async () => {};

            await skirmishGameSystem.startSkirmishGame();

            expect(game.state.level).toBe(2);
        });
    });

    describe('createLocalRoom', () => {
        it('should create player entity for human', () => {
            let humanCreated = false;
            game.register('createPlayerEntity', (id, data) => {
                if (id === 0) {
                    humanCreated = true;
                    expect(data.gold).toBe(200);
                }
                return game.createEntity();
            });

            skirmishGameSystem.playerTeam = enums.team.left;
            skirmishGameSystem.aiTeam = enums.team.right;

            skirmishGameSystem.createLocalRoom({ startingGold: 200 });

            expect(humanCreated).toBe(true);
        });

        it('should create player entity for AI', () => {
            let aiCreated = false;
            game.register('createPlayerEntity', (id, data) => {
                if (id === 1) {
                    aiCreated = true;
                }
                return game.createEntity();
            });

            skirmishGameSystem.playerTeam = enums.team.left;
            skirmishGameSystem.aiTeam = enums.team.right;

            skirmishGameSystem.createLocalRoom({ startingGold: 100 });

            expect(aiCreated).toBe(true);
        });

        it('should use default starting gold of 100', () => {
            let goldAmount = null;
            game.register('createPlayerEntity', (id, data) => {
                if (id === 0) {
                    goldAmount = data.gold;
                }
                return game.createEntity();
            });

            skirmishGameSystem.playerTeam = enums.team.left;
            skirmishGameSystem.aiTeam = enums.team.right;

            skirmishGameSystem.createLocalRoom({});

            expect(goldAmount).toBe(100);
        });

        it('should assign correct teams to players', () => {
            const teamAssignments = {};
            game.register('createPlayerEntity', (id, data) => {
                teamAssignments[id] = data.team;
                return game.createEntity();
            });

            skirmishGameSystem.playerTeam = enums.team.left;
            skirmishGameSystem.aiTeam = enums.team.right;

            skirmishGameSystem.createLocalRoom({ startingGold: 100 });

            expect(teamAssignments[0]).toBe(enums.team.left);
            expect(teamAssignments[1]).toBe(enums.team.right);
        });
    });

    describe('onSceneUnload', () => {
        it('should reset playerTeam when leaving skirmish', () => {
            skirmishGameSystem.playerTeam = enums.team.left;
            game.sceneManager = { currentScene: 'mainMenu' };

            skirmishGameSystem.onSceneUnload();

            expect(skirmishGameSystem.playerTeam).toBeNull();
        });

        it('should reset aiTeam when leaving skirmish', () => {
            skirmishGameSystem.aiTeam = enums.team.right;
            game.sceneManager = { currentScene: 'mainMenu' };

            skirmishGameSystem.onSceneUnload();

            expect(skirmishGameSystem.aiTeam).toBeNull();
        });

        it('should call setLocalGame(false) when leaving skirmish', () => {
            let localGameDisabled = false;
            game.register('setLocalGame', (enabled) => {
                if (enabled === false) {
                    localGameDisabled = true;
                }
            });

            skirmishGameSystem.playerTeam = enums.team.left;
            game.sceneManager = { currentScene: 'mainMenu' };

            skirmishGameSystem.onSceneUnload();

            expect(localGameDisabled).toBe(true);
        });

        it('should not reset when staying in skirmish', () => {
            skirmishGameSystem.playerTeam = enums.team.left;
            game.sceneManager = { currentScene: 'skirmish' };

            skirmishGameSystem.onSceneUnload();

            expect(skirmishGameSystem.playerTeam).toBe(enums.team.left);
        });
    });
});
