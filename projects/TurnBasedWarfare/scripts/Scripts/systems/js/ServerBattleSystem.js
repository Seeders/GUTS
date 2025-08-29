class ServerBattleSystem extends engine.BaseSystem {
    constructor(game, sceneManager) {
        super(game);
        this.sceneManager = sceneManager;
        this.game.battleSystem = this;
        
        console.log('ServerBattleSystem initialized - will coordinate loaded systems');
    }

    init(params) {
        this.params = params || {};
        console.log('ServerBattleSystem ready to coordinate combat systems');
    }

    update(deltaTime) {
        if (this.game.state?.phase !== 'battle') {
            return;
        }

        // The systems are already being updated by ServerECSGame.update()
        // This system just coordinates battle-specific logic and checks for battle end
        this.checkForBattleEnd();
    }

    checkForBattleEnd() {
        if (!this.game.componentManager) return;
        
        const ComponentTypes = this.game.componentManager.getComponentTypes();
        const allBattleEntities = this.game.getEntitiesWith(
            ComponentTypes.TEAM,
            ComponentTypes.HEALTH,
            ComponentTypes.UNIT_TYPE
        );

        const aliveEntities = allBattleEntities.filter(entityId => {
            const health = this.game.getComponent(entityId, ComponentTypes.HEALTH);
            const deathState = this.game.getComponent(entityId, ComponentTypes.DEATH_STATE);
            return health && health.current > 0 && (!deathState || !deathState.isDying);
        });

        // Group by teams
        const teams = new Map();
        for (const entityId of aliveEntities) {
            const team = this.game.getComponent(entityId, ComponentTypes.TEAM);
            if (team) {
                if (!teams.has(team.team)) {
                    teams.set(team.team, []);
                }
                teams.get(team.team).push(entityId);
            }
        }

        // Check for battle end conditions
        const aliveTeams = Array.from(teams.keys());
        let battleResult = null;

        if (aliveTeams.length === 0) {
            // All units dead - draw
            battleResult = { winner: 'draw', survivors: {} };
        } else if (aliveTeams.length === 1) {
            // One team remaining - victory
            const winningTeam = aliveTeams[0];
            const survivors = {};
            
            for (const [team, units] of teams) {
                survivors[team] = units.length;
            }

            battleResult = { 
                winner: this.getPlayerIdByTeam(winningTeam),
                winningTeam: winningTeam,
                survivors: survivors
            };
        }

        if (battleResult) {
            this.endBattle(battleResult);
        }
    }

    getPlayerIdByTeam(team) {
        if (!this.game.componentManager) return null;
        
        const ComponentTypes = this.game.componentManager.getComponentTypes();
        const teamEntities = this.game.getEntitiesWith(ComponentTypes.TEAM);
        
        for (const entityId of teamEntities) {
            const teamComp = this.game.getComponent(entityId, ComponentTypes.TEAM);
            if (teamComp && teamComp.team === team) {
                return teamComp.playerId || this.inferPlayerIdFromTeam(team);
            }
        }
        return null;
    }

    inferPlayerIdFromTeam(team) {
        // Simple inference - left side is typically first player, right side is second
        return this.game.state.mySide ? 'player1' : 'player2';
    }

    endBattle(result) {
        console.log('Battle ended with result:', result);
        
        // Update game state
        this.game.state.phase = 'round_end';
        this.game.state.roundEnding = true;
        this.game.state.battleResult = result;
        
        // The GameRoom will handle the battle end event and notify clients
    }

    // Cleanup method - clears battlefield by destroying battle entities
    clearBattlefield() {
        if (!this.game.componentManager) return;
        
        const ComponentTypes = this.game.componentManager.getComponentTypes();
        const entitiesToDestroy = new Set();
        
        // Collect all battle-related entities
        [
            ComponentTypes.TEAM,
            ComponentTypes.UNIT_TYPE,
            ComponentTypes.PROJECTILE,
            ComponentTypes.LIFETIME,
            ComponentTypes.DEATH_STATE,
            ComponentTypes.CORPSE
        ].forEach(componentType => {
            const entities = this.game.getEntitiesWith(componentType);
            entities.forEach(id => entitiesToDestroy.add(id));
        });
        
        // Destroy all battle entities
        entitiesToDestroy.forEach(entityId => {
            try {
                this.game.destroyEntity(entityId);
            } catch (error) {
                console.warn(`Error destroying entity ${entityId}:`, error);
            }
        });
        
        // Reset simulation state
        if (this.game.state) {
            this.game.state.simTime = 0;
            this.game.state.simTick = 0;
        }
        
        // Clear system-specific data using the loaded systems
        this.clearSystemData();
        
        console.log('ServerBattleSystem battlefield cleared');
    }

    clearSystemData() {
        // Clear data from systems that were loaded by ServerSceneManager
        if (this.game.damageSystem) {
            this.game.damageSystem.activeStatusEffects?.clear();
            this.game.damageSystem.pendingDamageEvents?.clear();
        }
        
        if (this.game.movementSystem) {
            this.game.movementSystem.unitStates?.clear();
            this.game.movementSystem.spatialGrid?.clear();
            this.game.movementSystem.movementHistory?.clear();
            this.game.movementSystem.pathfindingQueue = [];
        }
        
        if (this.game.projectileSystem) {
            this.game.projectileSystem.projectileTrails?.clear();
        }
        
        if (this.game.abilitySystem) {
            this.game.abilitySystem.entityAbilities?.clear();
            this.game.abilitySystem.abilityCooldowns?.clear();
            this.game.abilitySystem.abilityQueue?.clear();
        }        
    }

    // Reset battle system for new round
    reset() {
        this.clearBattlefield();
        console.log('ServerBattleSystem reset for new round');
    }

    /**
     * Spawn a squad of units (replaces the old single unit spawn method)
     * @param {Object} gridPosition - Grid position {x, z}
     * @param {Object} unitType - Unit type definition
     * @param {string} team - Team identifier ('player' or 'enemy')
     * @param {string|null} playerId - Optional player ID
     * @returns {Object} Squad placement data with entity IDs
     */
    spawnSquad(gridPosition, unitType, team, playerId = null) {
        if (!this.game.unitCreationManager) {
            console.error('UnitCreationManager not loaded - cannot spawn squad');
            return null;
        }

        try {
            console.log(`ServerBattleSystem spawning squad: ${unitType.id || unitType.title} for team ${team}`);
            
            // Use the UnitCreationManager's squad creation method
            const squadPlacement = this.game.unitCreationManager.createSquad(
                gridPosition,
                unitType,
                team,
                playerId
            );
            
            if (squadPlacement) {
                const squadInfo = this.game.unitCreationManager.getSquadInfo(unitType);
                console.log(`Successfully spawned ${squadInfo.unitName} squad with ${squadPlacement.squadUnits.length} units for ${team} team at grid ${gridPosition.x}, ${gridPosition.z}`);
            }
            
            return squadPlacement;
            
        } catch (error) {
            console.error(`Failed to spawn squad for team ${team}:`, error);
            return null;
        }
    }

    /**
     * Spawn multiple squads from placement data (used for multiplayer)
     * @param {Array} placements - Array of placement data from clients
     * @param {string} team - Team identifier
     * @param {string|null} playerId - Optional player ID
     * @returns {Array} Array of created squad placements
     */
    spawnSquadsFromPlacements(placements, team, playerId = null) {
        if (!this.game.unitCreationManager) {
            console.error('UnitCreationManager not loaded - cannot spawn squads');
            return [];
        }

        try {
            console.log(`ServerBattleSystem spawning ${placements.length} squads for team ${team}`);
            
            // Use the UnitCreationManager's batch squad creation method
            const createdSquads = this.game.unitCreationManager.createSquadsFromPlacements(
                placements,
                team,
                playerId
            );
            
            console.log(`Successfully spawned ${createdSquads.length} out of ${placements.length} squads for team ${team}`);
            
            return createdSquads;
            
        } catch (error) {
            console.error(`Failed to spawn squads for team ${team}:`, error);
            return [];
        }
    }

    /**
     * Legacy single unit spawn method (backwards compatibility)
     * @param {Object} position - World position {x, y, z}
     * @param {Object} unitType - Unit type definition
     * @param {string} team - Team identifier
     * @param {string|null} playerId - Optional player ID
     * @returns {number|null} Entity ID
     */
    spawnUnit(position, unitType, team, playerId = null) {
        if (!this.game.unitCreationManager) {
            console.error('UnitCreationManager not loaded - cannot spawn unit');
            return null;
        }

        console.warn('ServerBattleSystem.spawnUnit() is deprecated - use spawnSquad() for consistent squad behavior');
        
        try {
            // Convert world position to grid position if possible
            let gridPosition;
            if (this.game.gridSystem) {
                gridPosition = this.game.gridSystem.worldToGrid(position.x, position.z);
            } else {
                // Fallback grid position calculation
                gridPosition = {
                    x: Math.round(position.x / 32),
                    z: Math.round(position.z / 32)
                };
            }
            
            // Use squad creation for consistency
            const squadPlacement = this.spawnSquad(gridPosition, unitType, team, playerId);
            
            // Return first unit's entity ID for backwards compatibility
            return squadPlacement?.squadUnits?.[0]?.entityId || null;
            
        } catch (error) {
            console.error(`Legacy unit spawn failed:`, error);
            return null;
        }
    }

    // Helper methods to check if required systems are loaded
    validateRequiredSystems() {
        const requiredSystems = [
            'componentManager',
            'unitCreationManager', 
            'damageSystem',
            'deathSystem',
            'movementSystem',
            'projectileSystem',
            'abilitySystem',
            'combatAISystems'
        ];
        
        const missingSystems = requiredSystems.filter(system => !this.game[system]);
        
        if (missingSystems.length > 0) {
            console.warn('Missing required systems:', missingSystems);
            return false;
        }
        
        return true;
    }

    // Get status of loaded systems
    getSystemStatus() {
        return {
            componentManager: !!this.game.componentManager,
            unitCreationManager: !!this.game.unitCreationManager,
            damageSystem: !!this.game.damageSystem,
            deathSystem: !!this.game.deathSystem,
            movementSystem: !!this.game.movementSystem,
            projectileSystem: !!this.game.projectileSystem,
            abilitySystem: !!this.game.abilitySystem,
            combatAISystem: !!this.game.combatAISystems,
            allSystemsLoaded: this.validateRequiredSystems()
        };
    }
}