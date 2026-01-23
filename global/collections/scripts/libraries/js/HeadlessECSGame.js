/**
 * HeadlessECSGame - ECS game for headless simulation
 *
 * Extends ServerECSGame with:
 * - Mock services for rendering/audio (no-ops)
 * - Instruction processing capability
 * - Simulation control methods
 * - Result tracking
 *
 * This allows running full game simulations without any
 * rendering, audio, or network dependencies.
 */
class HeadlessECSGame extends global.GUTS.ServerECSGame {
    /**
     * Maximum number of events to store in the event log
     * Prevents unbounded memory growth during long simulations
     */
    static MAX_EVENT_LOG_SIZE = 10000;

    constructor(app) {
        super(app);

        // Mark as headless for system detection
        this.isHeadless = true;

        // Instruction processing
        this.instructionResults = [];
        this.eventLog = [];
        this._eventLogOverflowCount = 0;

        // Register mock services for visual/audio operations
        this.registerMockServices();
    }

    /**
     * Register mock services that would normally require rendering/audio
     * These are no-ops that allow game logic to run without visual dependencies
     */
    registerMockServices() {
        // Visual feedback - no-op in headless mode
        if (!this.hasService('showDamageNumber')) {
            this.register('showDamageNumber', (entityId, damage, type) => {
                this.logEvent('damageNumber', { entityId, damage, type });
            });
        }

        if (!this.hasService('playEffect')) {
            this.register('playEffect', (effectName, position, options) => {
                this.logEvent('effect', { effectName, position, options });
            });
        }

        if (!this.hasService('showLoadingScreen')) {
            this.register('showLoadingScreen', () => {
                this.logEvent('loadingScreen', { visible: true });
            });
        }

        if (!this.hasService('hideLoadingScreen')) {
            this.register('hideLoadingScreen', () => {
                this.logEvent('loadingScreen', { visible: false });
            });
        }

        // Audio - no-op in headless mode
        if (!this.hasService('playSound')) {
            this.register('playSound', (soundName, options) => {
                this.logEvent('sound', { soundName, options });
            });
        }

        if (!this.hasService('playMusic')) {
            this.register('playMusic', (musicName, options) => {
                this.logEvent('music', { musicName, options });
            });
        }

        // UI updates - no-op in headless mode
        if (!this.hasService('updateUI')) {
            this.register('updateUI', (uiElement, data) => {
                this.logEvent('uiUpdate', { uiElement, data });
            });
        }

        if (!this.hasService('showModal')) {
            this.register('showModal', (modalId, data) => {
                this.logEvent('modal', { modalId, data, action: 'show' });
            });
        }

        if (!this.hasService('hideModal')) {
            this.register('hideModal', (modalId) => {
                this.logEvent('modal', { modalId, action: 'hide' });
            });
        }

        // Camera - no-op in headless mode
        if (!this.hasService('setCameraPosition')) {
            this.register('setCameraPosition', (x, y, z) => {
                this.logEvent('camera', { action: 'setPosition', x, y, z });
            });
        }

        if (!this.hasService('setCameraTarget')) {
            this.register('setCameraTarget', (x, y, z) => {
                this.logEvent('camera', { action: 'setTarget', x, y, z });
            });
        }

        // Entity rendering - no-op in headless mode
        if (!this.hasService('removeInstance')) {
            this.register('removeInstance', () => {});
        }

        if (!this.hasService('getBillboardAnimationState')) {
            this.register('getBillboardAnimationState', () => null);
        }

        if (!this.hasService('calculateAnimationSpeed')) {
            this.register('calculateAnimationSpeed', () => 1);
        }

        // Networking - no-op in headless mode
        if (!this.hasService('broadcastToRoom')) {
            this.register('broadcastToRoom', () => {});
        }

        // Local game mode (for skirmish)
        if (!this.hasService('setLocalGame')) {
            this.register('setLocalGame', (isLocal, playerId) => {
                this.state.isLocalGame = isLocal;
                this.state.localPlayerId = playerId;
                this.logEvent('localGame', { isLocal, playerId });
            });
        }
    }

    /**
     * Log an event for debugging/analysis
     * Automatically caps the log size to prevent memory issues
     * @param {string} type - Event type
     * @param {Object} data - Event data
     */
    logEvent(type, data) {
        // Cap event log size to prevent memory issues
        if (this.eventLog.length >= HeadlessECSGame.MAX_EVENT_LOG_SIZE) {
            // Remove oldest 10% of events when limit is reached
            const removeCount = Math.floor(HeadlessECSGame.MAX_EVENT_LOG_SIZE * 0.1);
            this.eventLog.splice(0, removeCount);
            this._eventLogOverflowCount += removeCount;
        }

        this.eventLog.push({
            type,
            data,
            tick: this.tickCount,
            time: this.state.now
        });
    }

    /**
     * Get the event log
     * @returns {Object} { events: Array, overflowCount: number, maxSize: number }
     */
    getEventLog() {
        return {
            events: this.eventLog,
            overflowCount: this._eventLogOverflowCount,
            maxSize: HeadlessECSGame.MAX_EVENT_LOG_SIZE
        };
    }

    /**
     * Get raw event log array (for backward compatibility)
     * @returns {Array}
     */
    getEventLogArray() {
        return this.eventLog;
    }

    /**
     * Clear the event log
     */
    clearEventLog() {
        this.eventLog = [];
        this._eventLogOverflowCount = 0;
    }

    /**
     * Get entities by team
     * @param {number} team - Team enum value
     * @returns {number[]} Array of entity IDs
     */
    getEntitiesByTeam(team) {
        const entities = this.getEntitiesWith('team');
        return entities.filter(entityId => {
            const teamComp = this.getComponent(entityId, 'team');
            return teamComp && teamComp.team === team;
        });
    }

    /**
     * Get units (entities with unitType component) by team
     * @param {number} team - Team enum value
     * @returns {number[]} Array of entity IDs
     */
    getUnitsByTeam(team) {
        const entities = this.getEntitiesWith('team', 'unitType');
        return entities.filter(entityId => {
            const teamComp = this.getComponent(entityId, 'team');
            return teamComp && teamComp.team === team;
        });
    }

    /**
     * Get living units by team (excludes dead/dying units)
     * @param {number} team - Team enum value
     * @returns {number[]} Array of entity IDs
     */
    getLivingUnitsByTeam(team) {
        const enums = this.getEnums();
        const entities = this.getEntitiesWith('team', 'unitType', 'health');
        return entities.filter(entityId => {
            const teamComp = this.getComponent(entityId, 'team');
            const healthComp = this.getComponent(entityId, 'health');
            const deathComp = this.getComponent(entityId, 'deathState');

            if (!teamComp || teamComp.team !== team) return false;
            if (healthComp && healthComp.current <= 0) return false;
            if (deathComp && deathComp.state !== enums.deathState.alive) return false;

            return true;
        });
    }

    /**
     * Get summary of current game state
     * @returns {Object}
     */
    getGameSummary() {
        const enums = this.getEnums();
        const reverseEnums = this.getReverseEnums();

        const leftUnits = this.getLivingUnitsByTeam(enums.team.left);
        const rightUnits = this.getLivingUnitsByTeam(enums.team.right);

        return {
            tick: this.tickCount,
            time: this.state.now,
            round: this.state.round,
            phase: reverseEnums.gamePhase?.[this.state.phase] || this.state.phase,
            isGameOver: this.state.gameOver,
            isVictory: this.state.victory,
            teams: {
                left: {
                    unitCount: leftUnits.length,
                    gold: this.state.gold
                },
                right: {
                    unitCount: rightUnits.length,
                    gold: this.state.opponentGold
                }
            }
        };
    }

    /**
     * Serialize the full game state for external analysis
     * @returns {Object}
     */
    serializeFullState() {
        const entities = this.getAllEntities();
        const serializedEntities = [];

        for (const entityId of entities) {
            const componentTypes = this.getEntityComponentTypes(entityId);
            const components = {};

            for (const compType of componentTypes) {
                components[compType] = this.serializeComponent(entityId, compType);
            }

            serializedEntities.push({
                id: entityId,
                components
            });
        }

        return {
            state: { ...this.state },
            tickCount: this.tickCount,
            entities: serializedEntities
        };
    }
}

// Assign to global.GUTS for server
if (typeof global !== 'undefined' && global.GUTS) {
    global.GUTS.HeadlessECSGame = HeadlessECSGame;
}

// ES6 exports for webpack bundling
export default HeadlessECSGame;
export { HeadlessECSGame };
