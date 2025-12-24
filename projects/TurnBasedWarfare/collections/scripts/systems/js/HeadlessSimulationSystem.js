/**
 * HeadlessSimulationSystem - Game system for running headless simulations
 *
 * This system extends BaseSystem so it can:
 * 1. Receive game events through triggerEvent (e.g., onUnitKilled)
 * 2. Track simulation state and completion
 * 3. Monitor AI opponent behavior tree execution
 *
 * AI opponents run via behavior trees during placement phase, using GameInterfaceSystem.
 * The HeadlessEngine just runs the tick loop - AI behavior trees handle game logic.
 */

class HeadlessSimulationSystem extends GUTS.BaseSystem {
    static services = [
        'runSimulation',
        'isSimulationComplete',
        'getSimulationResults'
    ];

    constructor(game) {
        super(game);
        this.game.headlessSimulationSystem = this;

        // Initialize logger
        this._log = global.GUTS?.HeadlessLogger?.createLogger('HeadlessSimulation') || {
            error: (...args) => console.error('[HeadlessSimulation]', ...args),
            warn: (...args) => console.warn('[HeadlessSimulation]', ...args),
            info: (...args) => console.log('[HeadlessSimulation]', ...args),
            debug: (...args) => console.log('[HeadlessSimulation]', ...args),
            trace: () => {}
        };

        // Simulation state
        this._simulationComplete = false;

        // Unit statistics tracking
        this._unitDeaths = [];

        // Combat log for detailed reporting
        this._combatLog = [];
        this._lastAttackState = new Map(); // Track last attack time per entity
        this._projectilesFired = 0;
        this._abilitiesUsed = 0;
        this._damageDealt = { left: 0, right: 0 };
    }

    /**
     * Called when scene loads - reset all state
     */
    onSceneLoad() {
        this._simulationComplete = false;
        this._unitDeaths = [];
        this._combatLog = [];
        this._lastAttackState = new Map();
        this._projectilesFired = 0;
        this._abilitiesUsed = 0;
        this._damageDealt = { left: 0, right: 0 };
        this._log.debug('Scene loaded - simulation state reset');
    }

    /**
     * Set up a simulation
     * Called by HeadlessSkirmishRunner before starting the tick loop
     * AI opponents run via behavior trees - no instructions needed
     */
    setupSimulation() {
        this._simulationComplete = false;
        this._unitDeaths = [];
        this._combatLog = [];
        this._lastAttackState = new Map();
        this._projectilesFired = 0;
        this._abilitiesUsed = 0;
        this._damageDealt = { left: 0, right: 0 };

        this._log.info('Simulation setup complete - AI opponents will run via behavior trees');
    }

    /**
     * Check if simulation is complete
     */
    isSimulationComplete() {
        return this._simulationComplete || this.game.state.gameOver;
    }

    /**
     * Get simulation results
     */
    getSimulationResults() {
        return {
            gameOver: this.game.state.gameOver,
            winner: this.game.state.winner,
            round: this.game.state.round,
            tickCount: this.game.tickCount,
            unitStatistics: this.getUnitStatistics()
        };
    }

    /**
     * Alias for getSimulationResults (for backwards compatibility)
     */
    getResults() {
        return this.getSimulationResults();
    }

    /**
     * Update method - tracks combat activity each tick
     */
    update() {
        // Only track during battle phase
        if (this.game.state.phase !== this.enums.gamePhase.battle) return;

        this._trackCombatActivity();
    }

    /**
     * Track combat activity by monitoring entity combat components
     */
    _trackCombatActivity() {
        const entities = this.game.getEntitiesWith('combat', 'team', 'unitType');
        const reverseEnums = this.game.getReverseEnums();

        for (const entityId of entities) {
            const combat = this.game.getComponent(entityId, 'combat');
            const teamComp = this.game.getComponent(entityId, 'team');
            const deathState = this.game.getComponent(entityId, 'deathState');

            // Skip dead/dying units
            if (deathState && deathState.state !== this.enums.deathState.alive) continue;

            // Track attacks by monitoring lastAttack time changes
            const lastKnownAttack = this._lastAttackState.get(entityId) || 0;
            if (combat.lastAttack && combat.lastAttack > lastKnownAttack) {
                this._lastAttackState.set(entityId, combat.lastAttack);

                // Log the attack
                const unitTypeComp = this.game.getComponent(entityId, 'unitType');
                const unitDef = this.game.call('getUnitTypeDef', unitTypeComp);
                const teamName = reverseEnums.team?.[teamComp.team] || teamComp.team;

                this._combatLog.push({
                    type: 'attack',
                    tick: this.game.tickCount,
                    time: this.game.state.now,
                    entityId,
                    unitType: unitDef?.id || 'unknown',
                    team: teamName,
                    damage: combat.damage
                });
            }
        }

        // Track projectiles
        if (this.game.projectileSystem) {
            const projectileCount = this.game.projectileSystem.projectiles?.size || 0;
            if (projectileCount > this._projectilesFired) {
                this._projectilesFired = projectileCount;
            }
        }
    }

    // ==================== EVENT HANDLERS ====================
    // These receive events via game.triggerEvent()

    onUnitKilled(entityId) {
        console.log('[HeadlessSimulation] onUnitKilled received:', entityId);

        // Track unit death statistics
        this._trackUnitDeath(entityId);

        // Don't process further deaths once simulation is already complete
        // This ensures the FIRST death determines the winner (prevents draw scenarios)
        if (this._simulationComplete) {
            this._log.debug('Simulation already complete, ignoring additional death');
            return;
        }

        // Check if this is a combat unit (not building, peasant, gold mine, dragon)
        const unitTypeComp = this.game.getComponent(entityId, 'unitType');
        const teamComp = this.game.getComponent(entityId, 'team');
        if (!unitTypeComp || !teamComp) return;

        const unitDef = this.game.call('getUnitTypeDef', unitTypeComp);
        const unitId = unitDef?.id || 'unknown';

        // Non-combat units that don't trigger simulation end
        const nonCombatUnits = ['townHall', 'barracks', 'fletchersHall', 'mageTower', 'goldMine', 'peasant', 'dragon_red'];
        if (nonCombatUnits.includes(unitId)) return;

        // A combat unit died - end simulation
        // The winning team is the opposite of the team that lost a unit
        const losingTeam = teamComp.team;
        const winningTeam = losingTeam === this.enums.team.left ? this.enums.team.right : this.enums.team.left;
        const reverseEnums = this.game.getReverseEnums();

        this.game.state.gameOver = true;
        this.game.state.winner = reverseEnums.team?.[winningTeam] || winningTeam;
        this._simulationComplete = true;

        this._log.info(`Combat unit killed: ${unitId} (${reverseEnums.team?.[losingTeam]}) - ${this.game.state.winner} wins!`);
    }

    /**
     * Track a unit death with statistics
     * @private
     */
    _trackUnitDeath(entityId) {
        const unitTypeComp = this.game.getComponent(entityId, 'unitType');
        const teamComp = this.game.getComponent(entityId, 'team');
        const transform = this.game.getComponent(entityId, 'transform');

        if (!unitTypeComp || !teamComp) return;

        const unitDef = this.game.call('getUnitTypeDef', unitTypeComp);
        const reverseEnums = this.game.getReverseEnums();

        this._unitDeaths.push({
            entityId,
            unitType: unitDef?.id || 'unknown',
            unitName: unitDef?.name || unitDef?.id || 'Unknown',
            team: reverseEnums.team?.[teamComp.team] || teamComp.team,
            tick: this.game.tickCount,
            time: this.game.state.now,
            round: this.game.state.round,
            position: transform?.position ? {
                x: Math.round(transform.position.x),
                z: Math.round(transform.position.z)
            } : null
        });
    }

    /**
     * Get statistics about living units
     * @returns {Array} Array of living unit records with stats
     */
    getLivingUnitsWithStats() {
        const reverseEnums = this.game.getReverseEnums();
        const livingUnits = [];

        const entities = this.game.getEntitiesWith('unitType', 'team', 'health');

        for (const entityId of entities) {
            const unitTypeComp = this.game.getComponent(entityId, 'unitType');
            const teamComp = this.game.getComponent(entityId, 'team');
            const health = this.game.getComponent(entityId, 'health');
            const transform = this.game.getComponent(entityId, 'transform');
            const deathState = this.game.getComponent(entityId, 'deathState');

            // Skip dead/dying units
            if (deathState && deathState.state !== this.enums.deathState.alive) continue;
            if (health && health.current <= 0) continue;

            const unitDef = this.game.call('getUnitTypeDef', unitTypeComp);

            livingUnits.push({
                entityId,
                unitType: unitDef?.id || 'unknown',
                unitName: unitDef?.name || unitDef?.id || 'Unknown',
                team: reverseEnums.team?.[teamComp.team] || teamComp.team,
                health: {
                    current: health?.current || 0,
                    max: health?.max || 0
                },
                position: transform?.position ? {
                    x: Math.round(transform.position.x),
                    z: Math.round(transform.position.z)
                } : null
            });
        }

        return livingUnits;
    }

    /**
     * Get unit statistics summary
     * @returns {Object} { livingUnits: Array, deadUnits: Array, combatLog: Array, combatSummary: Object }
     */
    getUnitStatistics() {
        return {
            livingUnits: this.getLivingUnitsWithStats(),
            deadUnits: this._unitDeaths,
            combatLog: this._combatLog,
            combatSummary: this._getCombatSummary()
        };
    }

    /**
     * Get combat summary statistics
     */
    _getCombatSummary() {
        const attacksByTeam = { left: 0, right: 0 };
        const attacksByUnit = {};

        for (const entry of this._combatLog) {
            if (entry.type === 'attack') {
                const team = entry.team;
                if (team === 'left' || team === 'right') {
                    attacksByTeam[team]++;
                }

                const key = `${entry.team}_${entry.unitType}`;
                if (!attacksByUnit[key]) {
                    attacksByUnit[key] = { team: entry.team, unitType: entry.unitType, attacks: 0, totalDamage: 0 };
                }
                attacksByUnit[key].attacks++;
                attacksByUnit[key].totalDamage += entry.damage || 0;
            }
        }

        return {
            totalAttacks: this._combatLog.filter(e => e.type === 'attack').length,
            attacksByTeam,
            attacksByUnit: Object.values(attacksByUnit),
            projectilesFired: this._projectilesFired
        };
    }

    onUnitDeath(data) {
        this._log.debug('onUnitDeath received:', data);
    }

    onBattleStart() {
        this._log.debug('Battle started', {
            phase: this.game.state.phase,
            round: this.game.state.round
        });

        // Debug: List all units at battle start (only on round 4 when units should exist)
        if (this.game.state.round >= 3) {
            const entities = this.game.getEntitiesWith('unitType', 'team');
            const reverseEnums = this.game.getReverseEnums();
            const skipTypes = ['townHall', 'barracks', 'fletchersHall', 'mageTower', 'goldMine'];

            console.log(`[HeadlessSimulation] Battle ${this.game.state.round} starting - All units:`);
            for (const entityId of entities) {
                const unitTypeComp = this.game.getComponent(entityId, 'unitType');
                const unitDef = this.game.call('getUnitTypeDef', unitTypeComp);
                if (skipTypes.includes(unitDef?.id)) continue;

                const teamComp = this.game.getComponent(entityId, 'team');
                const health = this.game.getComponent(entityId, 'health');
                const deathState = this.game.getComponent(entityId, 'deathState');
                const placement = this.game.getComponent(entityId, 'placement');
                const teamName = reverseEnums.team?.[teamComp.team] || teamComp.team;

                console.log(`  [${teamName}] ${unitDef?.id} (entity ${entityId}): HP ${health?.current}/${health?.max}, deathState: ${deathState?.state}, placementId: ${placement?.placementId}`);
            }
        }
    }

    onBattleEnd(data) {
        this._log.debug('Battle ended', data);
    }

    onRoundEnd(data) {
        this._log.debug('Round ended', data);
    }

    onPhaseChange(phase) {
        const phaseName = this.game.call('getReverseEnums')?.gamePhase?.[phase] || phase;
        this._log.debug(`Phase change: ${phaseName}`);
    }

    /**
     * Reset production progress for ALL buildings at placement phase start.
     * In headless mode we need to handle all teams, not just "myTeam" like ShopSystem.
     */
    onPlacementPhaseStart() {
        const entities = this.game.getEntitiesWith('placement', 'unitType');

        for (const entityId of entities) {
            const unitTypeComp = this.game.getComponent(entityId, 'unitType');
            const unitDef = this.game.call('getUnitTypeDef', unitTypeComp);

            // Only reset buildings (not units)
            if (!unitDef?.isBuilding) continue;

            const placement = this.game.getComponent(entityId, 'placement');
            if (placement && placement.productionProgress !== undefined) {
                placement.productionProgress = 0;
            }
        }

        this._log.debug('Reset production progress for all buildings');
    }

    onGameOver(data) {
        this._log.debug('Game over', data);
    }
}

// Assign to global.GUTS for server
if (typeof global !== 'undefined' && global.GUTS) {
    global.GUTS.HeadlessSimulationSystem = HeadlessSimulationSystem;
}

// ES6 exports for webpack bundling
export default HeadlessSimulationSystem;
export { HeadlessSimulationSystem };
