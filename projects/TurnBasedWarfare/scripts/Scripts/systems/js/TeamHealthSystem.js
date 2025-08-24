class TeamHealthSystem {
    constructor(game) {
        this.game = game;
        this.game.teamHealthSystem = this;
        this.componentTypes = this.game.componentManager.getComponentTypes();
        
        // Team health configuration
        this.MAX_TEAM_HEALTH = 5000;
        this.teamHealth = {
            player: this.MAX_TEAM_HEALTH,
            enemy: this.MAX_TEAM_HEALTH
        };
        
        // Track if we've already processed this round's result
        this.roundProcessed = false;
        
        this.initializeUI();
    }
    
    initializeUI() {
        // Delay creation to ensure DOM is ready
        setTimeout(() => {
            this.createTeamHealthBars();
            this.updateHealthDisplay();
        }, 100);
    }
    
    // Public method to force UI creation (can be called from external systems)
    ensureUIExists() {
        const existingContainer = document.getElementById('teamHealthBars');
        if (!existingContainer) {
            this.createTeamHealthBars();
        }
        this.updateHealthDisplay();
    }
    
    createTeamHealthBars() {
        // Find or create health bar container
        let healthContainer = document.getElementById('teamHealthBars');
        if (!healthContainer) {
            healthContainer = document.createElement('div');
            healthContainer.id = 'teamHealthBars';
            healthContainer.className = 'team-health-container';
            
            // Insert at the top of the game container or body
            const gameContainer = document.getElementById('gameContainer');
            const gameScreen = document.getElementById('gameScreen');
            const targetContainer = gameContainer || gameScreen || document.body;
            
            if (targetContainer) {
                targetContainer.appendChild(healthContainer);
            } else {
                console.error('Could not find container for team health bars');
                return;
            }
        }
        
        healthContainer.innerHTML = `
            <div class="team-health-bar player-health">
                <div class="team-label">🛡️ YOUR ARMY</div>
                <div class="health-bar-container">
                    <div class="health-bar">
                        <div class="health-fill player-fill" id="playerHealthFill"></div>
                    </div>
                    <div class="health-text" id="playerHealthText">${this.teamHealth.player}/${this.MAX_TEAM_HEALTH}</div>
                </div>
            </div>
            <div class="team-health-bar enemy-health">
                <div class="team-label">⚔️ ENEMY ARMY</div>
                <div class="health-bar-container">
                    <div class="health-bar">
                        <div class="health-fill enemy-fill" id="enemyHealthFill"></div>
                    </div>
                    <div class="health-text" id="enemyHealthText">${this.teamHealth.enemy}/${this.MAX_TEAM_HEALTH}</div>
                </div>
            </div>
        `;
        
        // Add inline styles to ensure visibility
        this.addInlineStyles();
        
    }
    
    addInlineStyles() {
        // Create style element if it doesn't exist
        let styleElement = document.getElementById('teamHealthStyles');
        if (!styleElement) {
            styleElement = document.createElement('style');
            styleElement.id = 'teamHealthStyles';
            document.head.appendChild(styleElement);
        }
        
        styleElement.textContent = `
            .team-health-container {
                position: absolute;
                top: 1rem;
                left: 50%;
                transform: translateX(-50%);
                display: flex;
                gap: 2rem;
                z-index: 1000;
                pointer-events: none;
            }

            .team-health-bar {
                background: rgba(0, 0, 0, 0.9);
                border: 2px solid #333;
                border-radius: 10px;
                padding: 0.8rem;
                min-width: 200px;
                text-align: center;
                font-family: 'Courier New', monospace;
            }

            .player-health {
                border-color: #00ff00;
            }

            .enemy-health {
                border-color: #ff4444;
            }

            .team-label {
                font-size: 0.9rem;
                font-weight: bold;
                margin-bottom: 0.5rem;
                text-shadow: 0 0 5px currentColor;
            }

            .player-health .team-label {
                color: #00ff00;
            }

            .enemy-health .team-label {
                color: #ff4444;
            }

            .health-bar-container {
                display: flex;
                flex-direction: column;
                gap: 0.3rem;
            }

            .health-bar {
                width: 100%;
                height: 20px;
                background: #222;
                border: 1px solid #444;
                border-radius: 10px;
                overflow: hidden;
                position: relative;
            }

            .health-fill {
                height: 100%;
                transition: width 0.5s ease;
                border-radius: 10px;
                position: relative;
            }

            .player-fill {
                background: linear-gradient(90deg, #004400 0%, #00aa00 50%, #00ff00 100%);
                box-shadow: 0 0 10px rgba(0, 255, 0, 0.5);
            }

            .enemy-fill {
                background: linear-gradient(90deg, #440000 0%, #aa0000 50%, #ff4444 100%);
                box-shadow: 0 0 10px rgba(255, 68, 68, 0.5);
            }

            .health-text {
                font-size: 0.8rem;
                color: #fff;
                font-weight: bold;
                text-shadow: 1px 1px 2px #000;
            }

            .damage-popup {
                font-size: 1.5rem;
                font-weight: bold;
                text-shadow: 2px 2px 4px #000;
                animation: damageFloat 2s ease-out forwards;
                pointer-events: none;
                z-index: 1001;
                color: #ff6666;
            }

            @keyframes damageFloat {
                0% {
                    opacity: 1;
                    transform: translateY(0);
                    font-size: 1.5rem;
                }
                50% {
                    opacity: 1;
                    transform: translateY(-30px);
                    font-size: 2rem;
                }
                100% {
                    opacity: 0;
                    transform: translateY(-60px);
                    font-size: 1rem;
                }
            }
        `;
        
    }
    
    updateHealthDisplay() {
        const playerFill = document.getElementById('playerHealthFill');
        const playerText = document.getElementById('playerHealthText');
        const enemyFill = document.getElementById('enemyHealthFill');
        const enemyText = document.getElementById('enemyHealthText');
        
        if (playerFill && playerText) {
            const playerPercent = (this.teamHealth.player / this.MAX_TEAM_HEALTH) * 100;
            playerFill.style.width = `${playerPercent}%`;
            playerText.textContent = `${this.teamHealth.player}/${this.MAX_TEAM_HEALTH}`;
        }
        
        if (enemyFill && enemyText) {
            const enemyPercent = (this.teamHealth.enemy / this.MAX_TEAM_HEALTH) * 100;
            enemyFill.style.width = `${enemyPercent}%`;
            enemyText.textContent = `${this.teamHealth.enemy}/${this.MAX_TEAM_HEALTH}`;
        }
    }
    
    onBattleStart() {
        this.roundProcessed = false;
        
        // Ensure health bars are visible
        this.ensureUIExists();
    }
    
    // Apply damage when PhaseSystem tells us a round ended
    applyRoundDamage(winningTeam, survivingUnits) {
        if (this.roundProcessed) return null;
        this.roundProcessed = true;
        
        // Calculate damage based on surviving squads' base values
        const damageResult = this.calculateSquadBasedDamage(survivingUnits);
        const losingTeam = winningTeam === 'player' ? 'enemy' : 'player';
        
        // Apply damage to losing team
        this.dealDamageToTeam(losingTeam, damageResult.totalDamage);
        
        // Log the round result with squad details
        if (this.game.battleLogSystem) {
            this.game.battleLogSystem.add(
                `Round ${this.game.state.round} won by ${winningTeam}! ${damageResult.survivingSquads} surviving squads deal ${damageResult.totalDamage} damage!`, 
                'log-victory'
            );
            
            // Log individual squad contributions
            damageResult.squadDetails.forEach(squad => {
                this.game.battleLogSystem.add(
                    `${squad.name}: ${squad.survivingUnits}/${squad.totalUnits} units alive → ${squad.damage} damage`,
                    'log-victory'
                );
            });
        }
        
        // Return result object
        return {
            result: winningTeam === 'player' ? 'victory' : 'defeat',
            winningTeam: winningTeam,
            losingTeam: losingTeam,
            damage: damageResult.totalDamage,
            survivingSquads: damageResult.survivingSquads,
            gameOver: this.teamHealth[losingTeam] <= 0,
            remainingHealth: {
                player: this.teamHealth.player,
                enemy: this.teamHealth.enemy
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
                player: this.teamHealth.player,
                enemy: this.teamHealth.enemy
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
                ...this.game.placementSystem.enemyPlacements
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
                             this.game.placementSystem.enemyPlacements.find(p => p.placementId === placementId);
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
                             this.game.placementSystem.enemyPlacements.find(p => p.placementId === placementId);
            if (placement) {
                return placement.squadUnits ? placement.squadUnits.length : 1;
            }
        }
        
        return 1; // Default fallback
    }
    
    dealDamageToTeam(team, damage) {
        this.teamHealth[team] = Math.max(0, this.teamHealth[team] - damage);
        
        this.updateHealthDisplay();
        this.showDamageEffect(team, damage);
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
        this.teamHealth.player = this.MAX_TEAM_HEALTH;
        this.teamHealth.enemy = this.MAX_TEAM_HEALTH;
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
            player: {
                current: this.teamHealth.player,
                max: this.MAX_TEAM_HEALTH,
                percentage: this.getHealthPercentage('player')
            },
            enemy: {
                current: this.teamHealth.enemy,
                max: this.MAX_TEAM_HEALTH,
                percentage: this.getHealthPercentage('enemy')
            }
        };
    }
}