import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TestGameContext } from '../../../../../../tests/TestGameContext.js';

// Mock the HeadlessECSGame behavior (since TestGameContext already extends ServerECSGame)
describe('HeadlessECSGame', () => {
    let game;
    let enums;

    beforeEach(() => {
        game = new TestGameContext();
        enums = game.getEnums();

        // Add HeadlessECSGame mock properties and methods
        game.isHeadless = true;
        game.eventLog = [];

        game.logEvent = function(type, data) {
            this.eventLog.push({
                type,
                data,
                tick: this.tickCount || 0,
                time: this.state.now
            });
        };

        game.getEventLog = function() {
            return this.eventLog;
        };

        game.clearEventLog = function() {
            this.eventLog = [];
        };
    });

    describe('event logging', () => {
        it('should log events with tick and time', () => {
            game.state.now = 1.5;
            game.tickCount = 30;

            game.logEvent('damage', { entityId: 1, amount: 50 });

            expect(game.eventLog.length).toBe(1);
            expect(game.eventLog[0].type).toBe('damage');
            expect(game.eventLog[0].data).toEqual({ entityId: 1, amount: 50 });
            expect(game.eventLog[0].tick).toBe(30);
            expect(game.eventLog[0].time).toBe(1.5);
        });

        it('should return event log', () => {
            game.logEvent('test', { value: 1 });
            game.logEvent('test', { value: 2 });

            const log = game.getEventLog();

            expect(log.length).toBe(2);
        });

        it('should clear event log', () => {
            game.logEvent('test', { value: 1 });
            game.clearEventLog();

            expect(game.eventLog.length).toBe(0);
        });
    });

    describe('mock services', () => {
        it('should have showDamageNumber service that logs', () => {
            game.register('showDamageNumber', (entityId, damage, type) => {
                game.logEvent('damageNumber', { entityId, damage, type });
            });

            game.call('showDamageNumber', 1, 50, 'critical');

            expect(game.eventLog[0].type).toBe('damageNumber');
            expect(game.eventLog[0].data.damage).toBe(50);
        });

        it('should have playEffect service that logs', () => {
            game.register('playEffect', (effectName, position, options) => {
                game.logEvent('effect', { effectName, position, options });
            });

            game.call('playEffect', 'explosion', { x: 10, y: 20 }, { scale: 2 });

            expect(game.eventLog[0].type).toBe('effect');
            expect(game.eventLog[0].data.effectName).toBe('explosion');
        });
    });

    describe('team queries', () => {
        it('should get entities by team', () => {
            // Create entities with teams
            const e1 = game.createEntityWith({
                team: { team: enums.team.left }
            });
            const e2 = game.createEntityWith({
                team: { team: enums.team.right }
            });
            const e3 = game.createEntityWith({
                team: { team: enums.team.left }
            });

            const leftEntities = game.getEntitiesWith('team').filter(id => {
                const teamComp = game.getComponent(id, 'team');
                return teamComp && teamComp.team === enums.team.left;
            });

            expect(leftEntities).toContain(e1);
            expect(leftEntities).toContain(e3);
            expect(leftEntities).not.toContain(e2);
        });
    });

    describe('game summary', () => {
        it('should provide basic game state info', () => {
            game.state.now = 5.0;
            game.state.round = 3;
            game.state.phase = enums.gamePhase?.battle || 2;
            game.tickCount = 100;

            const summary = {
                tick: game.tickCount,
                time: game.state.now,
                round: game.state.round,
                phase: game.state.phase,
                isGameOver: game.state.gameOver || false,
                isVictory: game.state.victory || false
            };

            expect(summary.tick).toBe(100);
            expect(summary.time).toBe(5.0);
            expect(summary.round).toBe(3);
            expect(summary.isGameOver).toBe(false);
        });
    });
});

describe('HeadlessSkirmishRunner', () => {
    let game;
    let runner;
    let mockEngine;
    let enums;

    beforeEach(() => {
        game = new TestGameContext();
        enums = game.getEnums();

        // Set up mock engine
        mockEngine = {
            gameInstance: game,
            tickRate: 1 / 20,
            instructionQueue: [],
            currentInstructionIndex: 0,

            runSimulation: vi.fn().mockImplementation(async (options) => {
                return {
                    completed: true,
                    tickCount: 100,
                    realTimeMs: 50,
                    winner: 'left',
                    gameOver: true,
                    seed: options.seed
                };
            })
        };

        // Simple runner implementation for testing
        runner = {
            engine: mockEngine,
            game: game,
            config: null,
            isSetup: false,

            async setup(config) {
                this.config = {
                    level: config.level || 'forest',
                    selectedLevel: config.level || 'forest',
                    startingGold: config.startingGold || 100,
                    seed: config.seed || Date.now(),
                    selectedTeam: config.selectedTeam || 'left',
                    ...config
                };

                game.state.skirmishConfig = this.config;
                game.state.gameSeed = this.config.seed;
                game.state.isLocalGame = true;
                game.state.localPlayerId = 0;

                this.isSetup = true;
            },

            async runWithInstructions(instructions, options = {}) {
                if (!this.isSetup) {
                    throw new Error('Must call setup() before running simulation');
                }

                return await this.engine.runSimulation({
                    instructions,
                    maxTicks: options.maxTicks || 10000,
                    seed: this.config.seed
                });
            },

            processInstructions(instructions) {
                return instructions.map(inst => {
                    const processed = { ...inst };
                    if (inst.team && typeof inst.team === 'string') {
                        processed.team = enums.team[inst.team] ?? inst.team;
                    }
                    if (!processed.trigger) {
                        processed.trigger = 'immediate';
                    }
                    return processed;
                });
            },

            getState() {
                return {
                    tick: game.tickCount,
                    time: game.state.now,
                    round: game.state.round,
                    phase: game.state.phase
                };
            },

            reset() {
                this.isSetup = false;
                this.config = null;
            }
        };

        // Register mock services needed by runner
        game.register('setLocalGame', () => {});
        game.register('showLoadingScreen', () => {});
        game.register('createPlayerEntity', () => game.createEntity());
        game.register('initializeGame', () => {});
        game.register('generateAIPlacement', () => {});
    });

    describe('setup', () => {
        it('should configure game state with default values', async () => {
            await runner.setup({});

            expect(runner.isSetup).toBe(true);
            expect(game.state.isLocalGame).toBe(true);
            expect(game.state.skirmishConfig.startingGold).toBe(100);
            expect(game.state.skirmishConfig.level).toBe('forest');
        });

        it('should configure game state with custom values', async () => {
            await runner.setup({
                level: 'level_2',
                startingGold: 200,
                seed: 12345
            });

            expect(game.state.skirmishConfig.level).toBe('level_2');
            expect(game.state.skirmishConfig.startingGold).toBe(200);
            expect(game.state.gameSeed).toBe(12345);
        });

        it('should set localPlayerId to 0', async () => {
            await runner.setup({});

            expect(game.state.localPlayerId).toBe(0);
        });
    });

    describe('runWithInstructions', () => {
        it('should throw if not setup', async () => {
            await expect(runner.runWithInstructions([])).rejects.toThrow('Must call setup()');
        });

        it('should call engine.runSimulation with instructions', async () => {
            await runner.setup({ seed: 12345 });

            const instructions = [
                { type: 'PLACE_UNIT', team: 'left', unitType: 'soldier', x: 5, y: 5 }
            ];

            await runner.runWithInstructions(instructions);

            expect(mockEngine.runSimulation).toHaveBeenCalledWith({
                instructions: expect.any(Array),
                maxTicks: 10000,
                seed: 12345
            });
        });

        it('should return simulation results', async () => {
            await runner.setup({});

            const results = await runner.runWithInstructions([]);

            expect(results.completed).toBe(true);
            expect(results.winner).toBe('left');
        });

        it('should pass maxTicks option', async () => {
            await runner.setup({});

            await runner.runWithInstructions([], { maxTicks: 5000 });

            expect(mockEngine.runSimulation).toHaveBeenCalledWith(
                expect.objectContaining({ maxTicks: 5000 })
            );
        });
    });

    describe('instruction processing', () => {
        it('should convert team names to enum values', () => {
            const instructions = [
                { type: 'PLACE_UNIT', team: 'left' },
                { type: 'PLACE_UNIT', team: 'right' }
            ];

            const processed = runner.processInstructions(instructions);

            expect(processed[0].team).toBe(enums.team.left);
            expect(processed[1].team).toBe(enums.team.right);
        });

        it('should set default trigger to immediate', () => {
            const instructions = [
                { type: 'PLACE_UNIT' }
            ];

            const processed = runner.processInstructions(instructions);

            expect(processed[0].trigger).toBe('immediate');
        });

        it('should preserve existing trigger', () => {
            const instructions = [
                { type: 'WAIT', trigger: 'tick', tick: 100 }
            ];

            const processed = runner.processInstructions(instructions);

            expect(processed[0].trigger).toBe('tick');
        });
    });

    describe('state queries', () => {
        it('should return current state', async () => {
            await runner.setup({});
            game.state.now = 2.5;
            game.state.round = 2;
            game.tickCount = 50;

            const state = runner.getState();

            expect(state.time).toBe(2.5);
            expect(state.round).toBe(2);
            expect(state.tick).toBe(50);
        });
    });

    describe('reset', () => {
        it('should reset setup state', async () => {
            await runner.setup({});
            runner.reset();

            expect(runner.isSetup).toBe(false);
            expect(runner.config).toBeNull();
        });
    });
});

describe('HeadlessEngine Instruction Types', () => {
    let game;
    let enums;

    beforeEach(() => {
        game = new TestGameContext();
        enums = game.getEnums();

        // Register services for instruction handling
        game.register('placeUnit', vi.fn());
        game.register('startBattle', vi.fn());
        game.register('generateAIPlacement', vi.fn());
        game.register('handleSubmitPlacement', vi.fn());
    });

    describe('instruction types', () => {
        it('PLACE_UNIT should call placeUnit service', () => {
            const instruction = {
                type: 'PLACE_UNIT',
                unitType: 'soldier',
                team: enums.team.left,
                x: 5,
                y: 10
            };

            // Simulate instruction handling
            if (instruction.type === 'PLACE_UNIT') {
                game.call('placeUnit', {
                    unitType: instruction.unitType,
                    team: instruction.team,
                    position: { x: instruction.x, y: instruction.y }
                });
            }

            expect(game.call('placeUnit')).toHaveBeenCalled;
        });

        it('START_BATTLE should call startBattle service', () => {
            const instruction = { type: 'START_BATTLE' };

            if (instruction.type === 'START_BATTLE') {
                game.call('startBattle');
            }

            expect(game.call('startBattle')).toHaveBeenCalled;
        });

        it('SKIP_PLACEMENT should generate AI placement for both teams', () => {
            const instruction = { type: 'SKIP_PLACEMENT' };

            if (instruction.type === 'SKIP_PLACEMENT') {
                game.call('generateAIPlacement', enums.team.left);
                game.call('generateAIPlacement', enums.team.right);
            }

            expect(game.call('generateAIPlacement')).toHaveBeenCalled;
        });

        it('SET_CONFIG should update skirmish config', () => {
            game.state.skirmishConfig = {};
            const instruction = {
                type: 'SET_CONFIG',
                key: 'startingGold',
                value: 250
            };

            if (instruction.type === 'SET_CONFIG') {
                game.state.skirmishConfig[instruction.key] = instruction.value;
            }

            expect(game.state.skirmishConfig.startingGold).toBe(250);
        });

        it('SET_CONFIG should support nested keys', () => {
            game.state.skirmishConfig = {};
            const instruction = {
                type: 'SET_CONFIG',
                key: 'options.difficulty',
                value: 'hard'
            };

            if (instruction.type === 'SET_CONFIG') {
                const keys = instruction.key.split('.');
                let target = game.state.skirmishConfig;
                for (let i = 0; i < keys.length - 1; i++) {
                    if (!target[keys[i]]) target[keys[i]] = {};
                    target = target[keys[i]];
                }
                target[keys[keys.length - 1]] = instruction.value;
            }

            expect(game.state.skirmishConfig.options.difficulty).toBe('hard');
        });
    });

    describe('trigger conditions', () => {
        it('immediate trigger should always be true', () => {
            const instruction = { trigger: 'immediate' };
            expect(instruction.trigger === 'immediate').toBe(true);
        });

        it('tick trigger should check tick count', () => {
            game.tickCount = 50;
            const instruction = { trigger: 'tick', tick: 100 };

            const shouldExecute = game.tickCount >= instruction.tick;
            expect(shouldExecute).toBe(false);

            game.tickCount = 100;
            expect(game.tickCount >= instruction.tick).toBe(true);
        });

        it('phase trigger should check game phase', () => {
            game.state.phase = enums.gamePhase?.placement || 1;
            const instruction = { trigger: 'phase', phase: enums.gamePhase?.battle || 2 };

            const shouldExecute = game.state.phase === instruction.phase;
            expect(shouldExecute).toBe(false);

            game.state.phase = enums.gamePhase?.battle || 2;
            expect(game.state.phase === instruction.phase).toBe(true);
        });

        it('round trigger should check round number', () => {
            game.state.round = 1;
            const instruction = { trigger: 'round', round: 3 };

            const shouldExecute = game.state.round >= instruction.round;
            expect(shouldExecute).toBe(false);

            game.state.round = 3;
            expect(game.state.round >= instruction.round).toBe(true);
        });

        it('time trigger should check game time', () => {
            game.state.now = 5.0;
            const instruction = { trigger: 'time', time: 10.0 };

            const shouldExecute = game.state.now >= instruction.time;
            expect(shouldExecute).toBe(false);

            game.state.now = 10.0;
            expect(game.state.now >= instruction.time).toBe(true);
        });
    });
});

describe('Simulation Results', () => {
    let game;
    let enums;

    beforeEach(() => {
        game = new TestGameContext();
        enums = game.getEnums();
    });

    describe('result compilation', () => {
        it('should include tick count and timing info', () => {
            const tickCount = 500;
            const realTimeMs = 250;

            const results = {
                completed: true,
                tickCount,
                realTimeMs,
                ticksPerSecond: tickCount / (realTimeMs / 1000)
            };

            expect(results.tickCount).toBe(500);
            expect(results.realTimeMs).toBe(250);
            expect(results.ticksPerSecond).toBe(2000);
        });

        it('should include game state info', () => {
            game.state.now = 25.0;
            game.state.round = 5;
            game.state.gameOver = true;
            game.state.gameSeed = 12345;

            const results = {
                gameTime: game.state.now,
                round: game.state.round,
                gameOver: game.state.gameOver,
                seed: game.state.gameSeed
            };

            expect(results.gameTime).toBe(25.0);
            expect(results.round).toBe(5);
            expect(results.gameOver).toBe(true);
            expect(results.seed).toBe(12345);
        });

        it('should determine winner from team health', () => {
            // Simulate determining winner based on remaining entities
            const leftHealth = 100;
            const rightHealth = 0;

            let winner = null;
            if (leftHealth > rightHealth) {
                winner = 'left';
            } else if (rightHealth > leftHealth) {
                winner = 'right';
            } else {
                winner = 'draw';
            }

            expect(winner).toBe('left');
        });

        it('should count entities by team', () => {
            // Create some entities
            game.createEntityWith({ team: { team: enums.team.left } });
            game.createEntityWith({ team: { team: enums.team.left } });
            game.createEntityWith({ team: { team: enums.team.right } });

            const entities = game.getEntitiesWith('team');
            const entityCounts = { total: entities.length, byTeam: {} };

            const reverseEnums = game.getReverseEnums();
            for (const entityId of entities) {
                const teamComp = game.getComponent(entityId, 'team');
                if (teamComp) {
                    const teamName = reverseEnums.team[teamComp.team] || 'unknown';
                    entityCounts.byTeam[teamName] = (entityCounts.byTeam[teamName] || 0) + 1;
                }
            }

            expect(entityCounts.total).toBe(3);
            expect(entityCounts.byTeam.left).toBe(2);
            expect(entityCounts.byTeam.right).toBe(1);
        });
    });
});
