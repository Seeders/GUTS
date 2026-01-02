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

        // Simulation state
        this._simulationComplete = false;

        // Maximum rounds before forced end (0 = unlimited)
        this._maxRounds = 50;

        // If true, simulation ends when first combat unit dies (default behavior)
        // If false, simulation continues until team health reaches 0 or max rounds
        this._endOnFirstDeath = true;

        // Custom termination event - if set, simulation ends when this event fires
        // Examples: 'onUnitKilled', 'onBuildingDestroyed', 'onTownHallDestroyed'
        this._terminationEvent = null;

        // Unit statistics tracking
        this._unitDeaths = [];

        // Combat log for detailed reporting
        this._combatLog = [];
        this._lastAttackState = new Map(); // Track last attack time per entity
        this._lastAbilityState = new Map(); // Track last ability time per entity
        this._projectilesFired = 0;
        this._abilitiesUsed = { left: 0, right: 0 };
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
        this._lastAbilityState = new Map();
        this._projectilesFired = 0;
        this._abilitiesUsed = { left: 0, right: 0 };
        this._damageDealt = { left: 0, right: 0 };
    }

    /**
     * Set up a simulation
     * Called by HeadlessSkirmishRunner before starting the tick loop
     * AI opponents run via behavior trees - no instructions needed
     * @param {Object} options - Optional configuration
     * @param {boolean} options.endOnFirstDeath - If true (default), end when first combat unit dies
     * @param {number} options.maxRounds - Maximum rounds before forced end (default: 50)
     */
    setupSimulation(options = {}) {
        this._simulationComplete = false;
        this._unitDeaths = [];
        this._combatLog = [];
        this._lastAttackState = new Map();
        this._lastAbilityState = new Map();
        this._projectilesFired = 0;
        this._abilitiesUsed = { left: 0, right: 0 };
        this._damageDealt = { left: 0, right: 0 };

        // Configure simulation options
        this._endOnFirstDeath = options.endOnFirstDeath !== false; // Default: true
        this._maxRounds = options.maxRounds ?? 50;
        this._terminationEvent = options.terminationEvent || null;
    }

    /**
     * Check if simulation is complete
     * Ends when: team health reaches 0, or max rounds exceeded
     */
    isSimulationComplete() {
        if (this._simulationComplete) return true;
        if (this.game.state.gameOver) return true;

        // Check TeamHealthSystem for victory condition
        const teamHealthSystem = this.game.teamHealthSystem;
        if (teamHealthSystem && teamHealthSystem.isGameOver()) {
            const winningTeam = teamHealthSystem.getWinningTeam();
            const reverseEnums = this.game.getReverseEnums();
            this.game.state.gameOver = true;
            this.game.state.winner = reverseEnums.team?.[winningTeam] || winningTeam;
            this._simulationComplete = true;
            return true;
        }

        // Check max rounds limit (stop when round reaches maxRounds)
        if (this._maxRounds > 0 && this.game.state.round >= this._maxRounds) {
            // Determine winner by remaining team health
            if (teamHealthSystem) {
                const leftHealth = teamHealthSystem.getLeftHealth();
                const rightHealth = teamHealthSystem.getRightHealth();
                const reverseEnums = this.game.getReverseEnums();

                this.game.state.gameOver = true;
                if (leftHealth > rightHealth) {
                    this.game.state.winner = reverseEnums.team?.[this.enums.team.left] || 'left';
                } else if (rightHealth > leftHealth) {
                    this.game.state.winner = reverseEnums.team?.[this.enums.team.right] || 'right';
                } else {
                    this.game.state.winner = 'draw';
                }
            } else {
                this.game.state.gameOver = true;
                this.game.state.winner = 'timeout';
            }
            this._simulationComplete = true;
            return true;
        }

        return false;
    }

    /**
     * Get simulation results
     */
    getSimulationResults() {
        const teamHealthSystem = this.game.teamHealthSystem;
        return {
            gameOver: this.game.state.gameOver,
            winner: this.game.state.winner,
            round: this.game.state.round,
            tickCount: this.game.tickCount,
            unitStatistics: this.getUnitStatistics(),
            teamHealth: teamHealthSystem ? {
                left: teamHealthSystem.getLeftHealth(),
                right: teamHealthSystem.getRightHealth(),
                maxHealth: teamHealthSystem.MAX_TEAM_HEALTH
            } : null
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

        // Track ability usage by monitoring abilityCooldowns component
        const entitiesWithCooldowns = this.game.getEntitiesWith('abilityCooldowns', 'team', 'unitType');
        for (const entityId of entitiesWithCooldowns) {
            const cooldowns = this.game.getComponent(entityId, 'abilityCooldowns');
            const teamComp = this.game.getComponent(entityId, 'team');
            const deathState = this.game.getComponent(entityId, 'deathState');

            // Skip dead/dying units
            if (deathState && deathState.state !== this.enums.deathState.alive) continue;

            // Track abilities by monitoring lastAbilityTime changes
            const lastKnownAbilityTime = this._lastAbilityState.get(entityId) || 0;
            if (cooldowns.lastAbilityTime && cooldowns.lastAbilityTime > lastKnownAbilityTime) {
                this._lastAbilityState.set(entityId, cooldowns.lastAbilityTime);

                const unitTypeComp = this.game.getComponent(entityId, 'unitType');
                const unitDef = this.game.call('getUnitTypeDef', unitTypeComp);
                const teamName = reverseEnums.team?.[teamComp.team] || teamComp.team;

                // Get ability name from lastAbilityUsed index
                const abilityName = reverseEnums.abilities?.[cooldowns.lastAbilityUsed] || 'unknown';

                this._combatLog.push({
                    type: 'ability',
                    tick: this.game.tickCount,
                    time: this.game.state.now,
                    entityId,
                    unitType: unitDef?.id || 'unknown',
                    team: teamName,
                    abilityName
                });

                if (teamName === 'left' || teamName === 'right') {
                    this._abilitiesUsed[teamName]++;
                }
            }
        }
    }

    // ==================== EVENT HANDLERS ====================
    // These receive events via game.triggerEvent()

    onUnitKilled(entityId) {
        // Track unit death statistics
        this._trackUnitDeath(entityId);

        // Check for custom termination event
        if (this._terminationEvent === 'onTownHallDestroyed') {
            this._checkTownHallDestroyed(entityId);
            return;
        }

        // If endOnFirstDeath is false, let TeamHealthSystem handle victory
        if (!this._endOnFirstDeath) {
            return;
        }

        // Don't process further deaths once simulation is already complete
        if (this._simulationComplete) {
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
    }

    /**
     * Check if a town hall was destroyed - ends simulation with that team losing
     * @private
     */
    _checkTownHallDestroyed(entityId) {
        if (this._simulationComplete) return;

        const unitTypeComp = this.game.getComponent(entityId, 'unitType');
        const teamComp = this.game.getComponent(entityId, 'team');
        if (!unitTypeComp || !teamComp) return;

        const unitDef = this.game.call('getUnitTypeDef', unitTypeComp);
        const unitId = unitDef?.id || 'unknown';

        // Only end if a town hall was destroyed
        if (unitId !== 'townHall') return;

        const losingTeam = teamComp.team;
        const winningTeam = losingTeam === this.enums.team.left ? this.enums.team.right : this.enums.team.left;
        const reverseEnums = this.game.getReverseEnums();

        this.game.state.gameOver = true;
        this.game.state.winner = reverseEnums.team?.[winningTeam] || winningTeam;
        this._simulationComplete = true;
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
        const abilitiesByUnit = {};

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
            } else if (entry.type === 'ability') {
                const key = `${entry.team}_${entry.unitType}`;
                if (!abilitiesByUnit[key]) {
                    abilitiesByUnit[key] = { team: entry.team, unitType: entry.unitType, abilities: 0, abilityNames: {} };
                }
                abilitiesByUnit[key].abilities++;
                abilitiesByUnit[key].abilityNames[entry.abilityName] = (abilitiesByUnit[key].abilityNames[entry.abilityName] || 0) + 1;
            }
        }

        return {
            totalAttacks: this._combatLog.filter(e => e.type === 'attack').length,
            totalAbilities: this._combatLog.filter(e => e.type === 'ability').length,
            attacksByTeam,
            abilitiesByTeam: this._abilitiesUsed,
            attacksByUnit: Object.values(attacksByUnit),
            abilitiesByUnit: Object.values(abilitiesByUnit),
            projectilesFired: this._projectilesFired
        };
    }

    onUnitDeath(data) {
    }

    onBattleStart() {
    }

    onBattleEnd(data) {
    }

    onRoundEnd(data) {
    }

    onPhaseChange(phase) {
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
    }

    onGameOver(data) {
    }
}

// Assign to global.GUTS for server
if (typeof global !== 'undefined' && global.GUTS) {
    global.GUTS.HeadlessSimulationSystem = HeadlessSimulationSystem;
}

// ES6 exports for webpack bundling
export default HeadlessSimulationSystem;
export { HeadlessSimulationSystem };
