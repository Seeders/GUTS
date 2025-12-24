class DeathSystem extends GUTS.BaseSystem {
    static services = ['startDeathProcess'];

    constructor(game) {
        super(game);
        this.game.deathSystem = this;
    }

    init() {
    }

    update() {
        // Get all entities with death state and filter to only dying entities
        // (deathState is now always present on units, initialized to alive)
        const allEntities = this.game.getEntitiesWith("deathState");
        const dyingEntities = allEntities.filter(entityId => {
            const deathState = this.game.getComponent(entityId, "deathState");
            return deathState && deathState.state === this.enums.deathState.dying;
        });
        // Sort for deterministic processing order (prevents desync)
        // OPTIMIZATION: Use numeric sort since entity IDs are numbers (still deterministic, much faster)
        dyingEntities.sort((a, b) => a - b);
        dyingEntities.forEach(entityId => {
            const deathState = this.game.getComponent(entityId, "deathState");
            const unitTypeComp = this.game.getComponent(entityId, "unitType");
            const unitType = this.game.call('getUnitTypeDef', unitTypeComp);

            if (deathState.state === this.enums.deathState.dying) {
                const timeSinceDeath = this.game.state.now - deathState.deathStartTime;

                const timerExpired = timeSinceDeath >= deathState.deathAnimationDuration * 0.975;

                if (timerExpired) {
                    // Check if entity is a building using numeric unitType.collection index
                    const isBuilding = unitTypeComp && unitTypeComp.collection === this.enums.objectTypeDefinitions.buildings;
                    if (isBuilding) {
                        this.destroyBuilding(entityId);
                    } else {
                        this.convertToCorpse(entityId);
                    }
                }
            }
        });
    }

    startDeathProcess(entityId){
        const log = GUTS.HeadlessLogger;
        const unitTypeComp = this.game.getComponent(entityId, 'unitType');
        const unitType = this.game.call('getUnitTypeDef', unitTypeComp);
        const teamComp = this.game.getComponent(entityId, 'team');
        const unitName = unitType?.id || 'unknown';
        const teamName = this.reverseEnums.team?.[teamComp?.team] || teamComp?.team;

        log.info('Death', `DYING: ${unitName}(${entityId}) [${teamName}] started death process`);

        // Update existing deathState component (always present on units)
        const deathState = this.game.getComponent(entityId, 'deathState');
        if (deathState) {
            deathState.state = this.enums.deathState.dying;
            deathState.deathStartTime = this.game.state.now;
        } else {
            // Fallback for entities without deathState (shouldn't happen for units)
            this.game.addComponent(entityId, 'deathState', {
                state: this.enums.deathState.dying,
                deathStartTime: this.game.state.now
            });
        }

        // Trigger death animation
        if(this.game.hasService('playDeathAnimation')){
            this.game.call('playDeathAnimation', entityId);
        }

        // Trigger onUnitKilled event immediately when unit starts dying
        // This allows simulation to end as soon as a combat unit dies,
        // rather than waiting for the death animation to complete
        this.game.triggerEvent('onUnitKilled', entityId);

        // Remove health (corpses can't be damaged)
        if (this.game.hasComponent(entityId, "health")) {
            this.game.removeComponent(entityId, "health");
        }

        // Remove velocity (corpses don't move)
        if (this.game.hasComponent(entityId, "velocity")) {
            this.game.removeComponent(entityId, "velocity");
        }

    }

    destroyBuilding(entityId) {
        this.game.triggerEvent('onDestroyBuilding', entityId);
        this.game.destroyEntity(entityId);  
        return { success: true };
    }
    
    convertToCorpse(entityId) {
        const log = GUTS.HeadlessLogger;

        // Get current components before conversion
        const transform = this.game.getComponent(entityId, "transform");
        const pos = transform?.position;
        const unitType = this.game.getComponent(entityId, "unitType");
        const unitTypeDef = this.game.call('getUnitTypeDef', unitType);
        const team = this.game.getComponent(entityId, "team");
        const unitName = unitTypeDef?.id || 'unknown';
        const teamName = this.reverseEnums.team?.[team?.team] || team?.team;

        if (!pos || !unitType || !team) {
            log.warn('Death', `CORPSE FAILED: ${entityId} missing components`, { hasPos: !!pos, hasUnitType: !!unitType, hasTeam: !!team });
            return;
        }

        log.info('Death', `CORPSE: ${unitName}(${entityId}) [${teamName}] converted to corpse`);

        // CRITICAL: Notify AnimationSystem FIRST to set corpse state
        if(this.game.hasService('setCorpseAnimation')){
            this.game.call('setCorpseAnimation', entityId);
        }

        // Update death state to corpse - keep the component to prevent revival
        const deathState = this.game.getComponent(entityId, "deathState");
        if (deathState) {
            deathState.state = this.enums.deathState.corpse;
            deathState.corpseTime = this.game.state.now || 0;
            deathState.teamAtDeath = team.team;
        }

    }

    // Rest of your existing methods remain the same...
    getCorpsesInRange(position, range, teamFilter = null) {
        const corpses = this.game.getEntitiesWith("deathState");
        // Sort for deterministic processing order (prevents desync)
        // OPTIMIZATION: Use numeric sort since entity IDs are numbers (still deterministic, much faster)
        corpses.sort((a, b) => a - b);
        const nearbyCorpses = [];

        corpses.forEach(corpseId => {
            const deathState = this.game.getComponent(corpseId, "deathState");

            // Only include actual corpses, not dying entities
            if (!deathState || deathState.state !== this.enums.deathState.corpse) return;

            const transform = this.game.getComponent(corpseId, "transform");
            const corpsePos = transform?.position;
            const unitType = this.game.getComponent(corpseId, "unitType");

            if (!corpsePos || !unitType) return;

            // Check team filter if specified
            if (teamFilter && deathState.teamAtDeath !== teamFilter) return;

            // Check distance
            const dx = corpsePos.x - position.x;
            const dz = corpsePos.z - position.z;
            const distance = Math.sqrt(dx * dx + dz * dz);

            if (distance <= range) {
                nearbyCorpses.push({
                    entityId: corpseId,
                    position: corpsePos,
                    corpse: {
                        originalUnitType: unitType,
                        deathTime: deathState.corpseTime,
                        teamAtDeath: deathState.teamAtDeath
                    },
                    distance: distance
                });
            }
        });

        return nearbyCorpses;
    }

    consumeCorpse(corpseId) {
        // Remove corpse from battlefield (for abilities that consume corpses)
        const deathState = this.game.getComponent(corpseId, "deathState");
        if (!deathState || deathState.state !== this.enums.deathState.corpse) return null;

        const unitType = this.game.getComponent(corpseId, "unitType");
        if (!unitType) return null;

        // Return corpse data for the ability to use
        const corpseData = {
            originalUnitType: unitType,
            deathTime: deathState.corpseTime,
            teamAtDeath: deathState.teamAtDeath
        };

        // Destroy the corpse entity
        this.game.destroyEntity(corpseId);

        return corpseData;
    }

    getAllCorpses() {
        const allDeathStates = this.game.getEntitiesWith("deathState");
        return allDeathStates.filter(entityId => {
            const deathState = this.game.getComponent(entityId, "deathState");
            return deathState && deathState.state === this.enums.deathState.corpse;
        });
    }

    getCorpsesByTeam(team) {
        const allCorpses = this.getAllCorpses();
        return allCorpses.filter(corpseId => {
            const deathState = this.game.getComponent(corpseId, "deathState");
            return deathState && deathState.teamAtDeath === team;
        });
    }

    onBattleEnd() {
        // Clean up all corpses at the end of battle
        const allCorpses = this.getAllCorpses();
        allCorpses.forEach(corpseId => {
            this.game.destroyEntity(corpseId);
        });
    }
}
