import { describe, it, expect, beforeEach } from 'vitest';
import { TestGameContext } from '../../../../../../tests/TestGameContext.js';

describe('GameModeSystem', () => {
    let game;
    let gameModeSystem;
    let enums;

    beforeEach(() => {
        game = new TestGameContext();

        gameModeSystem = game.createSystem(GUTS.GameModeSystem);
        enums = game.getEnums();
    });

    describe('initialization', () => {
        it('should register system on game', () => {
            expect(game.gameModeSystem).toBe(gameModeSystem);
        });

        it('should initialize selectedGameMode as null', () => {
            expect(gameModeSystem.selectedGameMode).toBeNull();
        });

        it('should initialize modes as null before onSceneLoad', () => {
            expect(gameModeSystem.modes).toBeNull();
        });
    });

    describe('static services', () => {
        it('should register getSelectedMode service', () => {
            expect(GUTS.GameModeSystem.services).toContain('getSelectedMode');
        });

        it('should register setGameMode service', () => {
            expect(GUTS.GameModeSystem.services).toContain('setGameMode');
        });
    });

    describe('initializeSinglePlayerModes', () => {
        it('should return single player modes object', () => {
            const modes = gameModeSystem.initializeSinglePlayerModes();
            expect(modes).toBeDefined();
            expect(typeof modes).toBe('object');
        });

        it('should include skirmish mode', () => {
            const modes = gameModeSystem.initializeSinglePlayerModes();
            expect(modes.skirmish).toBeDefined();
            expect(modes.skirmish.id).toBe('skirmish');
            expect(modes.skirmish.title).toBe('Skirmish');
        });

        it('should have correct skirmish mode properties', () => {
            const modes = gameModeSystem.initializeSinglePlayerModes();
            const skirmish = modes.skirmish;

            expect(skirmish.isMultiplayer).toBe(false);
            expect(skirmish.maxPlayers).toBe(1);
            expect(skirmish.startingGold).toBe(100);
            expect(typeof skirmish.onStart).toBe('function');
        });
    });

    describe('initializeMultiplayerModes', () => {
        it('should return multiplayer modes object', () => {
            const modes = gameModeSystem.initializeMultiplayerModes();
            expect(modes).toBeDefined();
            expect(typeof modes).toBe('object');
        });

        it('should include arena mode', () => {
            const modes = gameModeSystem.initializeMultiplayerModes();
            expect(modes.arena).toBeDefined();
            expect(modes.arena.id).toBe('arena');
            expect(modes.arena.title).toBe('Arena');
        });

        it('should have correct arena mode properties', () => {
            const modes = gameModeSystem.initializeMultiplayerModes();
            const arena = modes.arena;

            expect(arena.isMultiplayer).toBe(true);
            expect(arena.maxPlayers).toBe(2);
            expect(arena.startingGold).toBe(100);
            expect(typeof arena.onStart).toBe('function');
        });
    });

    describe('setGameMode', () => {
        beforeEach(() => {
            // Initialize modes first (single player modes go in .modes, multiplayer in .multiplayerModes)
            gameModeSystem.modes = gameModeSystem.initializeSinglePlayerModes();
            gameModeSystem.multiplayerModes = gameModeSystem.initializeMultiplayerModes();
        });

        it('should set selectedGameMode', () => {
            gameModeSystem.setGameMode('skirmish');
            expect(gameModeSystem.selectedGameMode).toBe('skirmish');
        });

        it('should store mode config in game.state.gameMode', () => {
            gameModeSystem.setGameMode('skirmish');

            expect(game.state.gameMode).toBeDefined();
            expect(game.state.gameMode.id).toBe('skirmish');
            expect(game.state.gameMode.title).toBe('Skirmish');
        });

        it('should store isMultiplayer in game.state.gameMode', () => {
            gameModeSystem.setGameMode('arena');

            expect(game.state.gameMode.isMultiplayer).toBe(true);
        });

        it('should store maxPlayers in game.state.gameMode', () => {
            gameModeSystem.setGameMode('arena');

            expect(game.state.gameMode.maxPlayers).toBe(2);
        });

        it('should store startingGold in game.state.gameMode', () => {
            gameModeSystem.setGameMode('skirmish');

            expect(game.state.gameMode.startingGold).toBe(100);
        });

        it('should not throw for unknown mode when modes not initialized', () => {
            gameModeSystem.modes = null;
            expect(() => gameModeSystem.setGameMode('unknown')).not.toThrow();
        });
    });

    describe('getSelectedMode', () => {
        it('should return null when no mode selected', () => {
            expect(gameModeSystem.getSelectedMode()).toBeNull();
        });

        it('should return game.state.gameMode when set', () => {
            game.state.gameMode = {
                id: 'testMode',
                title: 'Test Mode'
            };

            const mode = gameModeSystem.getSelectedMode();
            expect(mode.id).toBe('testMode');
            expect(mode.title).toBe('Test Mode');
        });

        it('should work across scene changes (from game.state)', () => {
            // Set mode
            gameModeSystem.modes = gameModeSystem.initializeSinglePlayerModes();
            gameModeSystem.multiplayerModes = gameModeSystem.initializeMultiplayerModes();
            gameModeSystem.setGameMode('arena');

            // Simulate scene unload (clears modes)
            gameModeSystem.modes = null;
            gameModeSystem.multiplayerModes = null;

            // getSelectedMode should still work from game.state
            const mode = gameModeSystem.getSelectedMode();
            expect(mode.id).toBe('arena');
        });
    });

    describe('getModeConfig', () => {
        it('should return null when modes not initialized', () => {
            expect(gameModeSystem.getModeConfig('skirmish')).toBeNull();
        });

        it('should return single player mode config when modes initialized', () => {
            gameModeSystem.modes = gameModeSystem.initializeSinglePlayerModes();
            gameModeSystem.multiplayerModes = gameModeSystem.initializeMultiplayerModes();

            const config = gameModeSystem.getModeConfig('skirmish');
            expect(config).toBeDefined();
            expect(config.id).toBe('skirmish');
        });

        it('should return multiplayer mode config when modes initialized', () => {
            gameModeSystem.modes = gameModeSystem.initializeSinglePlayerModes();
            gameModeSystem.multiplayerModes = gameModeSystem.initializeMultiplayerModes();

            const config = gameModeSystem.getModeConfig('arena');
            expect(config).toBeDefined();
            expect(config.id).toBe('arena');
        });

        it('should return null for unknown mode', () => {
            gameModeSystem.modes = gameModeSystem.initializeSinglePlayerModes();
            gameModeSystem.multiplayerModes = gameModeSystem.initializeMultiplayerModes();

            const config = gameModeSystem.getModeConfig('nonexistent');
            expect(config).toBeNull();
        });
    });

    describe('onSceneLoad', () => {
        it('should initialize modes', () => {
            gameModeSystem.onSceneLoad();
            expect(gameModeSystem.modes).not.toBeNull();
        });

        it('should initialize multiplayerModes', () => {
            gameModeSystem.onSceneLoad();
            expect(gameModeSystem.multiplayerModes).not.toBeNull();
        });

        it('should include skirmish in single player modes', () => {
            gameModeSystem.onSceneLoad();
            expect(gameModeSystem.modes.skirmish).toBeDefined();
        });

        it('should include arena in multiplayer modes', () => {
            gameModeSystem.onSceneLoad();
            expect(gameModeSystem.multiplayerModes.arena).toBeDefined();
        });
    });

    describe('onSceneUnload', () => {
        it('should set modes to null', () => {
            gameModeSystem.modes = gameModeSystem.initializeSinglePlayerModes();
            gameModeSystem.multiplayerModes = gameModeSystem.initializeMultiplayerModes();

            gameModeSystem.onSceneUnload();

            expect(gameModeSystem.modes).toBeNull();
            expect(gameModeSystem.multiplayerModes).toBeNull();
        });
    });
});
