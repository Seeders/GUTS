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
    constructor(app) {
        super(app);

        // Mark as headless for system detection
        this.isHeadless = true;

        // Instruction processing
        this.instructionResults = [];
        this.eventLog = [];

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
     * @param {string} type - Event type
     * @param {Object} data - Event data
     */
    logEvent(type, data) {
        this.eventLog.push({
            type,
            data,
            tick: this.tickCount,
            time: this.state.now
        });
    }

    /**
     * Get the event log
     * @returns {Array}
     */
    getEventLog() {
        return this.eventLog;
    }

    /**
     * Clear the event log
     */
    clearEventLog() {
        this.eventLog = [];
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
        const enums = this.call('getEnums');
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
        const enums = this.call('getEnums');
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
