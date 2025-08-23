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
        
        
        // Calculate damage based on surviving units' value
        const totalDamage = this.calculateSurvivingUnitsValue(survivingUnits);
        const losingTeam = winningTeam === 'player' ? 'enemy' : 'player';
        
        // Apply damage to losing team
        this.dealDamageToTeam(losingTeam, totalDamage);
        
        // Log the round result
        if (this.game.battleLogSystem) {
            this.game.battleLogSystem.add(
                `Round ${this.game.state.round} won by ${winningTeam}! ${totalDamage} damage dealt!`, 
                'log-victory'
            );
        }
        
        // Return result object
        return {
            result: winningTeam === 'player' ? 'victory' : 'defeat',
            winningTeam: winningTeam,
            losingTeam: losingTeam,
            damage: totalDamage,
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
    
    calculateSurvivingUnitsValue(units) {
        let totalValue = 0;
        
        units.forEach(unitId => {
            const unitType = this.game.getComponent(unitId, this.componentTypes.UNIT_TYPE);
            if (unitType && unitType.value) {
                totalValue += unitType.value;
            }
        });
        
        return totalValue;
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