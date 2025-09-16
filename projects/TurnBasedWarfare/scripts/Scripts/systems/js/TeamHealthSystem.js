class TeamHealthSystem extends engine.BaseSystem {
    constructor(game) {
        super(game);
        this.game.teamHealthSystem = this;
        
        
        // Team health configuration
        this.MAX_TEAM_HEALTH = 2500;
        this.teamHealth = {
            left: this.MAX_TEAM_HEALTH,
            right: this.MAX_TEAM_HEALTH
        };
        
        // Track if we've already processed this round's result
        this.roundProcessed = false;
        
        if(!this.game.isServer){
            console.log('this.game', this.game);
            this.initializeUI();
        }
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
        
        let myHealth = this.teamHealth[this.game.state.mySide] || this.MAX_TEAM_HEALTH;
        let opponentHealth = this.teamHealth[this.game.state.mySide == 'left' ? 'right' : 'left'] || this.MAX_TEAM_HEALTH;
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
    applyRoundDamage(winningTeam, survivingUnits) {
        
        // Calculate damage based on surviving squads' base values
        const damageResult = this.calculateSquadBasedDamage(survivingUnits);
        const losingTeam = winningTeam === 'left' ? 'right' : 'left';
        
        // Apply damage to losing team
        this.dealDamageToTeam(losingTeam, damageResult.totalDamage);
        
        // Return result object
        return {
            result: winningTeam === this.game.state.mySide ? 'victory' : 'defeat',
            winningTeam: winningTeam,
            losingTeam: losingTeam,
            damage: damageResult.totalDamage,
            survivingSquads: damageResult.survivingSquads,
            gameOver: this.teamHealth[losingTeam] <= 0,
            remainingHealth: {
                left: this.teamHealth.left,
                right: this.teamHealth.right
            }
        };
    }
    
    // Apply no damage for draws
    applyRoundDraw() {
        if (this.roundProcessed) return null;
        this.roundProcessed = true;
        
        if (this.game.battleLogSystem) {
            this.game.battleLogSystem.add(
                `Round ${this.game.state.round} ended in draw! No damage dealt.`, 
                'log-death'
            );
        }
        
        // Return draw result
        return {
            result: 'draw',
            winningTeam: null,
            losingTeam: null,
            damage: 0,
            gameOver: false,
            remainingHealth: {
                left: this.teamHealth.left,
                right: this.teamHealth.right
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
        if (this.game.squadExperienceSystem) {
            const squadData = this.game.squadExperienceSystem.findSquadByUnitId(unitId);
            if (squadData) {
                const unitType = this.getCurrentUnitTypeForSquad(squadData.placementId);
                return {
                    placementId: squadData.placementId,
                    unitType: unitType || { value: squadData.squadValue, title: 'Unknown', id: 'unknown' }
                };
            }
        }
        
        // Fallback: search placement system
        if (this.game.placementSystem) {
            const allPlacements = [
                ...this.game.placementSystem.playerPlacements,
                ...this.game.placementSystem.opponentPlacements
            ];
            
            for (const placement of allPlacements) {
                if (placement.squadUnits) {
                    const unitMatch = placement.squadUnits.find(unit => unit.entityId === unitId);
                    if (unitMatch) {
                        return {
                            placementId: placement.placementId,
                            unitType: placement.unitType
                        };
                    }
                } else if (placement.entityId === unitId) {
                    return {
                        placementId: placement.placementId,
                        unitType: placement.unitType
                    };
                }
            }
        }
        
        // Last resort: use unit type component directly
        const unitTypeComponent = this.game.getComponent(unitId, this.componentTypes.UNIT_TYPE);
        if (unitTypeComponent) {
            return {
                placementId: `unknown_${unitId}`,
                unitType: {
                    value: unitTypeComponent.value || 50,
                    title: unitTypeComponent.type || 'Unknown Unit',
                    id: unitTypeComponent.id || 'unknown'
                }
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
        if (this.game.squadExperienceSystem && this.game.squadExperienceSystem.getCurrentUnitType) {
            return this.game.squadExperienceSystem.getCurrentUnitType(placementId);
        }
        
        // Fallback to placement system
        if (this.game.placementSystem) {
            const placement = this.game.placementSystem.playerPlacements.find(p => p.placementId === placementId) ||
                             this.game.placementSystem.opponentPlacements.find(p => p.placementId === placementId);
            return placement ? placement.unitType : null;
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
        if (this.game.squadExperienceSystem) {
            const squadData = this.game.squadExperienceSystem.squadExperience.get(placementId);
            if (squadData) {
                return squadData.totalUnitsInSquad || squadData.squadSize;
            }
        }
        
        // Fallback to placement system
        if (this.game.placementSystem) {
            const placement = this.game.placementSystem.playerPlacements.find(p => p.placementId === placementId) ||
                             this.game.placementSystem.opponentPlacements.find(p => p.placementId === placementId);
            if (placement) {
                return placement.squadUnits ? placement.squadUnits.length : 1;
            }
        }
        
        return 1; // Default fallback
    }
    
    dealDamageToTeam(team, damage) {
        this.teamHealth[team] = Math.max(0, this.teamHealth[team] - damage);
        if(!this.game.isServer){
            this.updateHealthDisplay();
            this.showDamageEffect(team, damage);
        }
    }
    
    showDamageEffect(team, damage) {
        // Create floating damage text
        const damageText = document.createElement('div');
        damageText.className = `damage-popup ${team}-damage`;
        damageText.textContent = `-${damage}`;
        
        // Position based on team
        const healthBar = document.querySelector(`.${team}-health`);
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
        this.teamHealth.left = this.MAX_TEAM_HEALTH;
        this.teamHealth.right = this.MAX_TEAM_HEALTH;
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
            left: {
                current: this.teamHealth.left,
                max: this.MAX_TEAM_HEALTH,
                percentage: this.getHealthPercentage('left')
            },
            right: {
                current: this.teamHealth.right,
                max: this.MAX_TEAM_HEALTH,
                percentage: this.getHealthPercentage('right')
            }
        };
    }

    getLeftHealth() {
        return this.teamHealth.left || 0;
    }

    // Method for multiplayer compatibility - returns current right health  
    getRightHealth() {
        return this.teamHealth.right || 0;
    }

    // Method to set left health (for multiplayer server updates)
    setLeftHealth(health) {
        this.teamHealth.left = Math.max(0, Math.min(health, this.MAX_TEAM_HEALTH));
        this.updateHealthDisplay();
    }

    // Method to set right health (for multiplayer server updates)
    setRightHealth(health) {
        this.teamHealth.right = Math.max(0, Math.min(health, this.MAX_TEAM_HEALTH));
        this.updateHealthDisplay();
    }

    // Multiplayer-specific method to sync both team healths from server
    syncHealthFromServer(leftHealth, rightHealth) {
        this.teamHealth.left = Math.max(0, Math.min(leftHealth, this.MAX_TEAM_HEALTH));
        this.teamHealth.right = Math.max(0, Math.min(rightHealth, this.MAX_TEAM_HEALTH));
        this.updateHealthDisplay();
    }

    // Check if either team is eliminated (for multiplayer game end conditions)
    isGameOver() {
        return this.teamHealth.left <= 0 || this.teamHealth.right <= 0;
    }

    // Get the winning team (for multiplayer results)
    getWinningTeam() {
        if (this.teamHealth.left <= 0) return 'right';
        if (this.teamHealth.right <= 0) return 'left';
        return null; // No winner yet
    }
}