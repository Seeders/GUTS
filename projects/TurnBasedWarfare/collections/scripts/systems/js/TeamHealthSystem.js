class TeamHealthSystem extends GUTS.BaseSystem {
    constructor(game) {
        super(game);
        this.game.teamHealthSystem = this;

        // Team health configuration
        this.MAX_TEAM_HEALTH = 2500;
        // Will be initialized with numeric keys in init()
        this.teamHealth = {};

        // Track if we've already processed this round's result
        this.roundProcessed = false;

        if(!this.game.isServer){
            console.log('this.game', this.game);
            this.initializeUI();
        }
    }

    init() {
        // Initialize enums
        // Initialize team health with numeric enum keys
        this.teamHealth[this.enums.team.left] = this.MAX_TEAM_HEALTH;
        this.teamHealth[this.enums.team.right] = this.MAX_TEAM_HEALTH;
    }

    getOpponentTeam() {
        return this.game.state.myTeam === this.enums.team.left ? this.enums.team.right : this.enums.team.left;
    }

    initializeUI() {
        // Delay creation to ensure DOM is ready
        setTimeout(() => {
            this.updateHealthDisplay();
        }, 100);
    }

    updateHealthDisplay() {
        const playerFill = document.getElementById('playerHealthFill');
        const playerText = document.getElementById('playerHealthText');
        const opponentFill = document.getElementById('opponentHealthFill');
        const opponentText = document.getElementById('opponentHealthText');

        let myHealth = this.teamHealth[this.game.state.myTeam] || this.MAX_TEAM_HEALTH;
        let opponentHealth = this.teamHealth[this.getOpponentTeam()] || this.MAX_TEAM_HEALTH;
        if (playerFill && playerText) {
            const playerPercent = (myHealth / this.MAX_TEAM_HEALTH) * 100;
            playerFill.style.width = `${playerPercent}%`;
            playerText.textContent = `${myHealth}/${this.MAX_TEAM_HEALTH}`;
        }

        if (opponentFill && opponentText) {
            const opponentPercent = (opponentHealth / this.MAX_TEAM_HEALTH) * 100;
            opponentFill.style.width = `${opponentPercent}%`;
            opponentText.textContent = `${opponentHealth}/${this.MAX_TEAM_HEALTH}`;
        }
    }

    onBattleStart() {
        this.roundProcessed = false;
    }

    // Apply damage when PhaseSystem tells us a round ended
    // winningTeam and losingTeam are numeric team enum values
    applyRoundDamage(winningTeam, survivingUnits) {
        // Calculate damage based on surviving squads' base values
        const damageResult = this.calculateSquadBasedDamage(survivingUnits);
        const losingTeam = winningTeam === this.enums.team.left ? this.enums.team.right : this.enums.team.left;

        // Apply damage to losing team
        this.dealDamageToTeam(losingTeam, damageResult.totalDamage);

        // Return result object
        return {
            result: winningTeam === this.game.state.myTeam ? 'victory' : 'defeat',
            winningTeam: winningTeam,
            losingTeam: losingTeam,
            damage: damageResult.totalDamage,
            survivingSquads: damageResult.survivingSquads,
            gameOver: this.teamHealth[losingTeam] <= 0,
            remainingHealth: {
                [this.enums.team.left]: this.teamHealth[this.enums.team.left],
                [this.enums.team.right]: this.teamHealth[this.enums.team.right]
            }
        };
    }

    // Apply no damage for draws
    applyRoundDraw() {
        if (this.roundProcessed) return null;
        this.roundProcessed = true;

        // Return draw result
        return {
            result: 'draw',
            winningTeam: null,
            losingTeam: null,
            damage: 0,
            gameOver: false,
            remainingHealth: {
                [this.enums.team.left]: this.teamHealth[this.enums.team.left],
                [this.enums.team.right]: this.teamHealth[this.enums.team.right]
            }
        };
    }

    /**
     * Calculate damage based on squads, not individual units
     * If ANY units from a squad survive, the entire squad's base value counts as damage
     * @param {Array} survivingUnits - Array of surviving unit entity IDs
     * @returns {Object} Damage calculation results
     */
    calculateSquadBasedDamage(survivingUnits) {
        const squadMap = new Map(); // squadId -> {unitType, survivors, totalUnits}
        let totalDamage = 0;
        let survivingSquadCount = 0;
        const squadDetails = [];
        if(!survivingUnits){
            return {
                totalDamage: 0,
                survivingSquads: 0,
                squadDetails: []
            };
        }
        // Group surviving units by their squad placement ID
        survivingUnits.forEach(unitId => {
            // Find which squad this unit belongs to
            const squadInfo = this.findSquadForUnit(unitId);
            if (squadInfo) {
                const { placementId, unitType } = squadInfo;

                if (!squadMap.has(placementId)) {
                    squadMap.set(placementId, {
                        unitType: unitType,
                        survivors: 0,
                        totalUnits: this.getOriginalSquadSize(placementId),
                        placementId: placementId
                    });
                }

                squadMap.get(placementId).survivors++;
            }
        });

        // Calculate damage for each squad that has survivors
        squadMap.forEach((squadData, placementId) => {
            if (squadData.survivors > 0) {
                // Entire squad's base value counts as damage
                const squadBaseDamage = squadData.unitType.value || 50;
                totalDamage += squadBaseDamage;
                survivingSquadCount++;

                squadDetails.push({
                    name: squadData.unitType.title || squadData.unitType.id || 'Unknown Squad',
                    damage: squadBaseDamage,
                    survivingUnits: squadData.survivors,
                    totalUnits: squadData.totalUnits,
                    placementId: placementId
                });
            }
        });

        return {
            totalDamage: totalDamage,
            survivingSquads: survivingSquadCount,
            squadDetails: squadDetails
        };
    }

    /**
     * Find which squad a unit belongs to
     * @param {number} unitId - Unit entity ID
     * @returns {Object|null} Squad info or null
     */
    findSquadForUnit(unitId) {
        // Check with experience system first (most reliable)
        const squadData = this.game.call('findSquadByUnitId', unitId);
        if (squadData) {
            const unitType = this.getCurrentUnitTypeForSquad(squadData.placementId);
            return {
                placementId: squadData.placementId,
                unitType: unitType || { value: squadData.squadValue, title: 'Unknown', id: 'unknown' }
            };
        }

        // Fallback: search placement system using numeric team values
        const playerPlacements = this.game.call('getPlacementsForSide', this.game.state.myTeam) || [];
        const opponentPlacements = this.game.call('getPlacementsForSide', this.getOpponentTeam()) || [];
        const allPlacements = [...playerPlacements, ...opponentPlacements];

        for (const placement of allPlacements) {
            if (placement.squadUnits) {
                const unitMatch = placement.squadUnits.find(entityId => entityId === unitId);
                if (unitMatch) {
                    // Get unitType from the entity's unitType component
                    const unitTypeComp = this.game.getComponent(unitMatch, 'unitType');
                    const unitType = this.game.call('getUnitTypeDef', unitTypeComp);
                    return {
                        placementId: placement.placementId,
                        unitType: unitType
                    };
                }
            }
        }

        // Last resort: use unit type component directly
        const unitTypeComp = this.game.getComponent(unitId, "unitType");
        const unitType = this.game.call('getUnitTypeDef', unitTypeComp);
        if (unitType) {
            return {
                placementId: null,  // Unknown placement - use null as invalid marker
                unitType: unitType
            };
        }

        return null;
    }

    /**
     * Get the current unit type for a squad (handles specializations)
     * @param {string} placementId - Squad placement ID
     * @returns {Object|null} Current unit type
     */
    getCurrentUnitTypeForSquad(placementId) {
        const unitType = this.game.call('getCurrentUnitTypeForSquad', placementId);
        if (unitType) {
            return unitType;
        }

        // Fallback to placement system - get unitType from entity
        const playerPlacements = this.game.call('getPlacementsForSide', this.game.state.myTeam) || [];
        const opponentPlacements = this.game.call('getPlacementsForSide', this.getOpponentTeam()) || [];
        const placement = playerPlacements.find(p => p.placementId === placementId) ||
                         opponentPlacements.find(p => p.placementId === placementId);
        if (placement && placement.squadUnits && placement.squadUnits.length > 0) {
            return this.game.getComponent(placement.squadUnits[0], 'unitType');
        }
        return null;
    }

    /**
     * Get the original size of a squad when it was placed
     * @param {string} placementId - Squad placement ID
     * @returns {number} Original squad size
     */
    getOriginalSquadSize(placementId) {
        // Check experience system first
        const squadData = this.game.call('getSquadExperienceData', placementId);
        if (squadData) {
            return squadData.totalUnitsInSquad || squadData.squadSize;
        }

        // Fallback to placement system
        const playerPlacements = this.game.call('getPlacementsForSide', this.game.state.myTeam) || [];
        const opponentPlacements = this.game.call('getPlacementsForSide', this.getOpponentTeam()) || [];
        const placement = playerPlacements.find(p => p.placementId === placementId) ||
                         opponentPlacements.find(p => p.placementId === placementId);
        if (placement) {
            return placement.squadUnits ? placement.squadUnits.length : 1;
        }

        return 1; // Default fallback
    }

    dealDamageToTeam(team, damage) {
        const currentHealth = this.teamHealth[team] || 0;
        this.teamHealth[team] = Math.max(0, currentHealth - damage);
        if(!this.game.isServer){
            this.updateHealthDisplay();
            this.showDamageEffect(team, damage);
        }
    }

    showDamageEffect(team, damage) {
        // Create floating damage text
        const damageText = document.createElement('div');
        // Use numeric team for class - could map to string if needed for CSS
        const teamClass = team === this.enums.team.left ? 'left' : 'right';
        damageText.className = `damage-popup ${teamClass}-damage`;
        damageText.textContent = `-${damage}`;

        // Position based on team
        const healthBar = document.querySelector(`.${teamClass}-health`);
        if (healthBar) {
            const rect = healthBar.getBoundingClientRect();
            damageText.style.position = 'fixed';
            damageText.style.left = `${rect.left + rect.width / 2}px`;
            damageText.style.top = `${rect.top}px`;
            damageText.style.zIndex = '1000';

            document.body.appendChild(damageText);

            // Animate and remove
            setTimeout(() => {
                if (damageText.parentNode) {
                    damageText.parentNode.removeChild(damageText);
                }
            }, 2000);
        }
    }

    resetTeamHealth() {
        this.teamHealth[this.enums.team.left] = this.MAX_TEAM_HEALTH;
        this.teamHealth[this.enums.team.right] = this.MAX_TEAM_HEALTH;
        this.roundProcessed = false;
        this.updateHealthDisplay();
    }

    getTeamHealth(team) {
        return this.teamHealth[team] || 0;
    }

    getHealthPercentage(team) {
        return (this.teamHealth[team] / this.MAX_TEAM_HEALTH) * 100;
    }

    // Get health status for UI
    getHealthStatus() {
        return {
            [this.enums.team.left]: {
                current: this.teamHealth[this.enums.team.left],
                max: this.MAX_TEAM_HEALTH,
                percentage: this.getHealthPercentage(this.enums.team.left)
            },
            [this.enums.team.right]: {
                current: this.teamHealth[this.enums.team.right],
                max: this.MAX_TEAM_HEALTH,
                percentage: this.getHealthPercentage(this.enums.team.right)
            }
        };
    }

    getLeftHealth() {
        return this.teamHealth[this.enums.team.left] || 0;
    }

    // Method for multiplayer compatibility - returns current right health
    getRightHealth() {
        return this.teamHealth[this.enums.team.right] || 0;
    }

    // Method to set left health (for multiplayer server updates)
    setLeftHealth(health) {
        this.teamHealth[this.enums.team.left] = Math.max(0, Math.min(health, this.MAX_TEAM_HEALTH));
        this.updateHealthDisplay();
    }

    // Method to set right health (for multiplayer server updates)
    setRightHealth(health) {
        this.teamHealth[this.enums.team.right] = Math.max(0, Math.min(health, this.MAX_TEAM_HEALTH));
        this.updateHealthDisplay();
    }

    // Multiplayer-specific method to sync both team healths from server
    syncHealthFromServer(leftHealth, rightHealth) {
        this.teamHealth[this.enums.team.left] = Math.max(0, Math.min(leftHealth, this.MAX_TEAM_HEALTH));
        this.teamHealth[this.enums.team.right] = Math.max(0, Math.min(rightHealth, this.MAX_TEAM_HEALTH));
        this.updateHealthDisplay();
    }

    // Check if either team is eliminated (for multiplayer game end conditions)
    isGameOver() {
        return this.teamHealth[this.enums.team.left] <= 0 || this.teamHealth[this.enums.team.right] <= 0;
    }

    // Get the winning team (for multiplayer results) - returns numeric team enum
    getWinningTeam() {
        if (this.teamHealth[this.enums.team.left] <= 0) return this.enums.team.right;
        if (this.teamHealth[this.enums.team.right] <= 0) return this.enums.team.left;
        return null; // No winner yet
    }
}
