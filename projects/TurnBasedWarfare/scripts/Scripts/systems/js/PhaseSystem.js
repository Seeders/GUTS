class PhaseSystem {
    constructor(app) {
        this.game = app;
        this.game.phaseSystem = this;
        this.phaseTimer = null;
    }
    
    startPlacementPhase() {
        const state = this.game.state;
        state.phase = 'placement';
        state.phaseTimeLeft = 30;
        state.playerReady = false;
        state.enemyPlacementComplete = false; // Track enemy placement status
        
        // Clear any round ending flags
        state.roundEnding = false;
        
        // Give gold for the round based on round number
        this.distributeRoundGold();
        
        // Respawn player units from previous rounds (except for round 1)
        if (state.round > 1) {
            this.game.placementSystem.startNewPlacementPhase();
        }
        
        this.showPlacementHints();
        
        // Update UI to show enemy is placing units
        this.updateReadyButtonState();
        
        this.phaseTimer = setInterval(() => {
            state.phaseTimeLeft--;
            
            // Only allow battle to start if both player is ready AND enemy placement is complete
            if (state.phaseTimeLeft <= 0 || (state.playerReady && state.enemyPlacementComplete)) {
                clearInterval(this.phaseTimer);
                this.startBattlePhase();
            }
        }, 1000);
        
        // AI places units (includes respawning previous units + new ones)
        setTimeout(() => {
            console.log('Starting enemy unit placement...');
            this.game.placementSystem.placeEnemyUnits(() => {
                // Callback when enemy placement is complete
                console.log('Enemy unit placement complete');
                state.enemyPlacementComplete = true;
                this.updateReadyButtonState();
            });
        }, 2000);
    }
    
    distributeRoundGold() {
        const state = this.game.state;
        const roundGold = this.calculateRoundGold(state.round);
        
        if (state.round === 1) {
            // First round: set starting gold
            state.playerGold = roundGold;
            console.log(`Round ${state.round}: Starting with ${roundGold} gold`);
        } else {
            // Subsequent rounds: add gold
            state.playerGold += roundGold;
            console.log(`Round ${state.round}: Added ${roundGold} gold (Total: ${state.playerGold})`);
        }
        
        if (this.game.battleLogSystem) {
            if (state.round === 1) {
                this.game.battleLogSystem.add(`Round ${state.round}: You start with ${roundGold} gold!`, 'log-victory');
            } else {
                this.game.battleLogSystem.add(`Round ${state.round}: +${roundGold} gold earned! (Total: ${state.playerGold})`, 'log-victory');
            }
        }
        
        // Update UI
        this.updateGoldDisplay();
    }
    
    calculateRoundGold(round) {
        // Round 1: 100, Round 2: 150, Round 3: 200, etc.
        return 50 + (round * 50);
    }
    
    updateGoldDisplay() {
        const goldDisplay = document.getElementById('playerGold');
        if (goldDisplay) {
            goldDisplay.textContent = this.game.state.playerGold;
        }
    }
    
    startBattlePhase() {
        const state = this.game.state;
        state.phase = 'battle';
        
        // Notify team health system that battle started
        if (this.game.teamHealthSystem) {
            this.game.teamHealthSystem.onBattleStart();
        }
        
        this.game.statisticsTrackingSystem.recordBattleStart();
        this.game.battleLogSystem.add(`Round ${state.round} battle begins!`, 'log-victory');
        
        document.getElementById('readyButton').disabled = true;
        this.game.effectsSystem.playBattleStartAnimation();
    }
    
    // Called from battle system when units are eliminated - check for round end
    checkForRoundEnd() {
        if (this.game.state.phase !== 'battle') {
            console.log('checkForRoundEnd: Not in battle phase, ignoring');
            return;
        }
        
        // Prevent multiple calls for the same round
        if (this.game.state.roundEnding) {
            console.log('checkForRoundEnd: Round already ending, ignoring');
            return;
        }
        
        // Check victory conditions directly in PhaseSystem
        const ComponentTypes = this.game.componentManager.getComponentTypes();
        
        // Get all living units
        const allLivingEntities = this.game.getEntitiesWith(
            ComponentTypes.TEAM, 
            ComponentTypes.HEALTH,
            ComponentTypes.UNIT_TYPE
        );
        
        // Filter for units that are actually alive (health > 0)
        const aliveEntities = allLivingEntities.filter(id => {
            const health = this.game.getComponent(id, ComponentTypes.HEALTH);
            return health && health.current > 0;
        });
        
        const playerUnits = aliveEntities.filter(id => {
            const team = this.game.getComponent(id, ComponentTypes.TEAM);
            return team && team.team === 'player';
        });
        
        const enemyUnits = aliveEntities.filter(id => {
            const team = this.game.getComponent(id, ComponentTypes.TEAM);
            return team && team.team === 'enemy';
        });
        
        console.log(`Round end check: Player units: ${playerUnits.length}, Enemy units: ${enemyUnits.length}`);
        
        // Check if round is over (one team eliminated)
        let roundResult = null;
        
        if (playerUnits.length === 0 && enemyUnits.length > 0) {
            // Enemy victory - apply damage via TeamHealthSystem
            roundResult = this.game.teamHealthSystem?.applyRoundDamage('enemy', enemyUnits);
        } else if (enemyUnits.length === 0 && playerUnits.length > 0) {
            // Player victory - apply damage via TeamHealthSystem
            roundResult = this.game.teamHealthSystem?.applyRoundDamage('player', playerUnits);
        } else if (playerUnits.length === 0 && enemyUnits.length === 0) {
            // Draw - no damage
            roundResult = this.game.teamHealthSystem?.applyRoundDraw();
        }
        
        if (roundResult) {
            // Mark that we're processing this round end
            this.game.state.roundEnding = true;
            console.log('Round end detected, processing result:', roundResult);
            
            // Handle the round result
            this.handleRoundResult(roundResult);
        }
    }
    
    handleRoundResult(roundResult) {
        console.log('Handling round result:', roundResult);
        
        const state = this.game.state;
        state.phase = 'ended';
        
        // Update statistics
        const stats = this.game.statisticsTrackingSystem.collectStats();
        stats.roundResult = roundResult;
        
        if (roundResult.gameOver) {
            // Game over - one team's health reached 0
            console.log(`Game over! Final result: ${roundResult.result}`);
            
            if (roundResult.result === 'victory') {
                // Player's team survived, enemy team eliminated
                this.game.statisticsTrackingSystem.updateSession('victory', stats);
                this.handleCampaignVictory(stats, roundResult);
            } else {
                // Player's team eliminated
                this.game.statisticsTrackingSystem.updateSession('defeat', stats);
                this.handleCampaignDefeat(stats, roundResult);
            }
        } else {
            // Round won but game continues
            if (roundResult.result === 'victory') {
                this.game.statisticsTrackingSystem.updateSession('round_victory', stats);
                this.handleRoundVictory(stats, roundResult);
            } else if (roundResult.result === 'defeat') {
                this.game.statisticsTrackingSystem.updateSession('round_defeat', stats);
                this.handleRoundDefeat(stats, roundResult);
            } else if (roundResult.result === 'draw') {
                this.game.statisticsTrackingSystem.updateSession('round_draw', stats);
                this.handleRoundDraw(stats, roundResult);
            }
        }
    }
    
    handleCampaignVictory(stats, roundResult) {
        console.log('Handling campaign victory');
        
        // Add final victory message
        if (this.game.battleLogSystem) {
            this.game.battleLogSystem.add(
                `CAMPAIGN VICTORIOUS! Enemy army eliminated!`, 
                'log-victory'
            );
        }
        
        // Clean up battlefield after brief delay
        setTimeout(() => {
            this.clearBattlefield();
            
            // Show final victory screen
            const finalStats = {
                ...stats,
                finalResult: 'victory',
                teamHealthRemaining: roundResult.remainingHealth.player,
                enemyHealthRemaining: roundResult.remainingHealth.enemy
            };
            
            console.log('Attempting to show victory screen with stats:', finalStats);
            
            if (window.gameUI && window.gameUI.showVictory) {
                console.log('Calling gameUI.showVictory');
                window.gameUI.showVictory(finalStats);
            } else {
                console.log('gameUI not available, using fallback');
                this.showVictoryScreenFallback(finalStats);
            }
        }, 1500);
    }
    
    showVictoryScreenFallback(stats) {
        console.log('Showing victory screen fallback');
        
        // Hide game screen
        const gameScreen = document.getElementById('gameScreen');
        const victoryScreen = document.getElementById('victoryScreen');
        
        if (gameScreen) {
            gameScreen.classList.remove('active');
            console.log('Game screen hidden');
        }
        
        if (victoryScreen) {
            victoryScreen.classList.add('active');
            console.log('Victory screen shown');
            
            // Update victory stats if element exists
            const victoryStats = document.getElementById('victoryStats');
            if (victoryStats) {
                victoryStats.innerHTML = `
                    <div class="stat-card">
                        <div class="stat-label">Rounds Completed</div>
                        <div class="stat-value">${stats.round || 1}</div>
                    </div>
                    <div class="stat-card">
                        <div class="stat-label">Final Army Health</div>
                        <div class="stat-value">${stats.teamHealthRemaining || 0}/100</div>
                    </div>
                    <div class="stat-card">
                        <div class="stat-label">Campaign Status</div>
                        <div class="stat-value">VICTORIOUS!</div>
                    </div>
                    <div class="stat-card">
                        <div class="stat-label">Enemy Eliminated</div>
                        <div class="stat-value">✓ Complete</div>
                    </div>
                `;
                console.log('Victory stats updated');
            } else {
                console.log('Victory stats element not found');
            }
        } else {
            console.log('Victory screen element not found');
            
            // Create a simple victory overlay if no proper screen exists
            const victoryOverlay = document.createElement('div');
            victoryOverlay.id = 'victoryOverlay';
            victoryOverlay.style.cssText = `
                position: fixed;
                top: 0;
                left: 0;
                width: 100%;
                height: 100%;
                background: rgba(0, 100, 0, 0.9);
                color: white;
                display: flex;
                flex-direction: column;
                justify-content: center;
                align-items: center;
                z-index: 10000;
                font-family: 'Courier New', monospace;
            `;
            victoryOverlay.innerHTML = `
                <h1 style="font-size: 3rem; margin-bottom: 2rem;">🎉 VICTORY! 🎉</h1>
                <p style="font-size: 1.5rem; margin: 1rem;">Campaign Complete!</p>
                <p style="font-size: 1.2rem; margin: 1rem;">Rounds: ${stats.round || 1}</p>
                <p style="font-size: 1.2rem; margin: 1rem;">Army Health: ${stats.teamHealthRemaining || 0}/100</p>
                <button onclick="location.reload()" style="
                    margin-top: 2rem;
                    padding: 1rem 2rem;
                    font-size: 1.2rem;
                    background: #006600;
                    color: white;
                    border: none;
                    border-radius: 5px;
                    cursor: pointer;
                ">Play Again</button>
            `;
            document.body.appendChild(victoryOverlay);
            console.log('Victory overlay created');
        }
    }
    
    handleCampaignDefeat(stats, roundResult) {
        console.log('Handling campaign defeat');
        
        // Add final defeat message
        if (this.game.battleLogSystem) {
            this.game.battleLogSystem.add(
                `CAMPAIGN DEFEATED! Your army has been eliminated!`, 
                'log-death'
            );
        }
        
        // Clean up battlefield after brief delay
        setTimeout(() => {
            this.clearBattlefield();
            
            // Reset game state
            this.resetGameAfterDefeat();
            
            // Show defeat screen
            const finalStats = {
                ...stats,
                finalResult: 'defeat',
                teamHealthRemaining: roundResult.remainingHealth.player,
                enemyHealthRemaining: roundResult.remainingHealth.enemy
            };
            
            console.log('Attempting to show defeat screen with stats:', finalStats);
            
            if (window.gameUI && window.gameUI.showDefeat) {
                console.log('Calling gameUI.showDefeat');
                window.gameUI.showDefeat(finalStats);
            } else {
                console.log('gameUI not available, using fallback');
                this.showDefeatScreenFallback(finalStats);
            }
        }, 1500);
    }
    
    showDefeatScreenFallback(stats) {
        console.log('Showing defeat screen fallback');
        
        // Hide game screen
        const gameScreen = document.getElementById('gameScreen');
        const defeatScreen = document.getElementById('defeatScreen');
        
        if (gameScreen) {
            gameScreen.classList.remove('active');
            console.log('Game screen hidden');
        }
        
        if (defeatScreen) {
            defeatScreen.classList.add('active');
            console.log('Defeat screen shown');
            
            // Update defeat stats if element exists
            const defeatStats = document.getElementById('defeatStats');
            if (defeatStats) {
                defeatStats.innerHTML = `
                    <div class="stat-card">
                        <div class="stat-label">Rounds Survived</div>
                        <div class="stat-value">${stats.round || 1}</div>
                    </div>
                    <div class="stat-card">
                        <div class="stat-label">Final Army Health</div>
                        <div class="stat-value">0/100</div>
                    </div>
                    <div class="stat-card">
                        <div class="stat-label">Campaign Status</div>
                        <div class="stat-value">DEFEATED</div>
                    </div>
                    <div class="stat-card">
                        <div class="stat-label">Cause</div>
                        <div class="stat-value">Army Eliminated</div>
                    </div>
                `;
                console.log('Defeat stats updated');
            } else {
                console.log('Defeat stats element not found');
            }
        } else {
            console.log('Defeat screen element not found');
            
            // Create a simple defeat overlay if no proper screen exists
            const defeatOverlay = document.createElement('div');
            defeatOverlay.id = 'defeatOverlay';
            defeatOverlay.style.cssText = `
                position: fixed;
                top: 0;
                left: 0;
                width: 100%;
                height: 100%;
                background: rgba(100, 0, 0, 0.9);
                color: white;
                display: flex;
                flex-direction: column;
                justify-content: center;
                align-items: center;
                z-index: 10000;
                font-family: 'Courier New', monospace;
            `;
            defeatOverlay.innerHTML = `
                <h1 style="font-size: 3rem; margin-bottom: 2rem;">💀 DEFEAT 💀</h1>
                <p style="font-size: 1.5rem; margin: 1rem;">Campaign Failed!</p>
                <p style="font-size: 1.2rem; margin: 1rem;">Rounds Survived: ${stats.round || 1}</p>
                <p style="font-size: 1.2rem; margin: 1rem;">Your army was eliminated</p>
                <button onclick="location.reload()" style="
                    margin-top: 2rem;
                    padding: 1rem 2rem;
                    font-size: 1.2rem;
                    background: #660000;
                    color: white;
                    border: none;
                    border-radius: 5px;
                    cursor: pointer;
                ">Try Again</button>
            `;
            document.body.appendChild(defeatOverlay);
            console.log('Defeat overlay created');
        }
    }
    
    handleRoundVictory(stats, roundResult) {
        console.log('Handling round victory - proceeding to next round');
        
        this.game.effectsSystem.showVictoryEffect(400, 300);
        
        const notification = document.createElement('div');
        notification.className = 'victory-notification';
        notification.innerHTML = `
            <h2>🎉 ROUND ${stats.round} COMPLETE! 🎉</h2>
            <p>Enemy Health: ${roundResult.remainingHealth.enemy}/100</p>
            <p>Your Health: ${roundResult.remainingHealth.player}/100</p>
            <p style="margin-top: 1rem; color: #888;">Preparing next round...</p>
        `;
        
        document.body.appendChild(notification);
        
        setTimeout(() => {
            document.body.removeChild(notification);
            this.setupNextRound(stats);
        }, 2500);
    }
    
    handleRoundDefeat(stats, roundResult) {
        console.log('Handling round defeat - proceeding to next round');
        
        const notification = document.createElement('div');
        notification.className = 'defeat-notification';
        notification.innerHTML = `
            <h2>💀 ROUND ${stats.round} LOST 💀</h2>
            <p>Your Health: ${roundResult.remainingHealth.player}/100</p>
            <p>Enemy Health: ${roundResult.remainingHealth.enemy}/100</p>
            <p style="margin-top: 1rem; color: #888;">Preparing next round...</p>
        `;
        notification.style.cssText = `
            position: fixed;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            background: rgba(139, 0, 0, 0.95);
            color: white;
            padding: 2rem;
            border-radius: 10px;
            text-align: center;
            z-index: 10000;
            border: 2px solid #ff4444;
        `;
        
        document.body.appendChild(notification);
        
        setTimeout(() => {
            document.body.removeChild(notification);
            this.setupNextRound(stats);
        }, 2500);
    }
    
    handleRoundDraw(stats, roundResult) {
        console.log('Handling round draw - proceeding to next round');
        
        const notification = document.createElement('div');
        notification.className = 'draw-notification';
        notification.innerHTML = `
            <h2>⚖️ ROUND ${stats.round} DRAW ⚖️</h2>
            <p>Both armies eliminated</p>
            <p>No damage dealt to either side</p>
            <p style="margin-top: 1rem; color: #888;">Preparing next round...</p>
        `;
        notification.style.cssText = `
            position: fixed;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            background: rgba(139, 139, 0, 0.95);
            color: white;
            padding: 2rem;
            border-radius: 10px;
            text-align: center;
            z-index: 10000;
            border: 2px solid #ffff44;
        `;
        
        document.body.appendChild(notification);
        
        setTimeout(() => {
            document.body.removeChild(notification);
            this.setupNextRound(stats);
        }, 2500);
    }
    
    setupNextRound(stats) {
        console.log('Setting up next round - cleaning battlefield');
        
        const state = this.game.state;
        state.round++;
        
        // Clear the round ending flag
        state.roundEnding = false;
        
        // Clear battlefield
        this.clearBattlefield();
        
        // Start next round
        setTimeout(() => {
            this.startPlacementPhase();
        }, 500); // Small delay to ensure cleanup completes
    }
    
    // Rest of the methods remain the same...
    endBattle(result) {
        // This method might be called by other systems - redirect to checkForRoundEnd
        console.log('endBattle called with result:', result, 'Current phase:', this.game.state.phase);
        
        // Only process if we're in battle phase and not already ending
        if (this.game.state.phase === 'battle' && !this.game.state.roundEnding) {
            console.log('Processing endBattle - checking for round end via team health system');
            this.checkForRoundEnd();
        } else {
            console.log('Ignoring endBattle call - phase:', this.game.state.phase, 'roundEnding:', this.game.state.roundEnding);
        }
    }
    
    resetGameAfterDefeat() {
        console.log('Resetting game after defeat');
        
        this.reset();
        
        // Start placement phase after a brief delay
        setTimeout(() => {
            this.startPlacementPhase();
        }, 500);
    }
    
    resetUI() {
        console.log('Resetting UI elements');
        
        const state = this.game.state;
        
        // Reset phase display
        const phaseTitle = document.getElementById('phaseTitle');
        if (phaseTitle) {
            phaseTitle.textContent = 'PLACEMENT PHASE';
        }
        
        // Reset round number
        const roundNumber = document.getElementById('roundNumber');
        if (roundNumber) {
            roundNumber.textContent = '1';
        }
        
        // Reset timer
        const phaseTimer = document.getElementById('phaseTimer');
        if (phaseTimer) {
            phaseTimer.textContent = '30s';
        }
        
        // Update gold display if it exists
        const goldDisplay = document.getElementById('playerGold');
        if (goldDisplay) {
            goldDisplay.textContent = this.getStartingGold();
        }
        
        // Reset ready button using the proper state management
        this.updateReadyButtonState();
    }
    
    shouldEndCampaign() {
        const gameMode = this.game.state?.gameMode;
        const round = this.game.state?.round || 1;
        
        switch (gameMode) {
            case 'campaign': return round >= 10;
            case 'arena':
            case 'challenge': return true;
            default: return false;
        }
    }
    
    clearBattlefield() {
        console.log('Clearing battlefield...');
        
        const ComponentTypes = this.game.componentManager.getComponentTypes();
        
        // Get all possible entities that need cleanup
        const entitiesToDestroy = new Set();
        
        // Units with teams
        const teamEntities = this.game.getEntitiesWith(ComponentTypes.TEAM);
        teamEntities.forEach(id => entitiesToDestroy.add(id));
        
        // Units without teams but with unit types
        const unitEntities = this.game.getEntitiesWith(ComponentTypes.UNIT_TYPE);
        unitEntities.forEach(id => entitiesToDestroy.add(id));
        
        // Projectiles
        const projectileEntities = this.game.getEntitiesWith(ComponentTypes.PROJECTILE);
        projectileEntities.forEach(id => entitiesToDestroy.add(id));
        
        // Effects with lifetime
        const effectEntities = this.game.getEntitiesWith(ComponentTypes.LIFETIME);
        effectEntities.forEach(id => entitiesToDestroy.add(id));
        
        // Entities with health (might be units)
        const healthEntities = this.game.getEntitiesWith(ComponentTypes.HEALTH);
        healthEntities.forEach(id => entitiesToDestroy.add(id));
        
        console.log(`Found ${entitiesToDestroy.size} entities to destroy`);
        
        // Destroy all found entities
        entitiesToDestroy.forEach(entityId => {
            try {
                this.game.destroyEntity(entityId);
            } catch (error) {
                console.warn(`Error destroying entity ${entityId}:`, error);
            }
        });
        
        // Force cleanup of render system models
        if (this.game.renderSystem) {
            console.log('Force cleaning render system models');
            // Get all current models and remove them
            const modelEntities = Array.from(this.game.renderSystem.entityModels.keys());
            modelEntities.forEach(entityId => {
                this.game.renderSystem.removeEntityModel(entityId);
            });
        }
        
        // Force cleanup of animation system
        if (this.game.animationSystem) {
            console.log('Force cleaning animation system');
            const animationEntities = Array.from(this.game.animationSystem.entityAnimationStates.keys());
            animationEntities.forEach(entityId => {
                this.game.animationSystem.removeEntityAnimations(entityId);
            });
        }
        
        // Clear projectile system
        if (this.game.projectileSystem && this.game.projectileSystem.clearAllProjectiles) {
            this.game.projectileSystem.clearAllProjectiles();
        }
        
        console.log('Battlefield cleanup complete');
    }
    
    update(deltaTime) {
        const state = this.game.state;
        document.getElementById('roundNumber').textContent = state.round;
        document.getElementById('phaseTitle').textContent = 
            state.phase === 'placement' ? 'PLACEMENT PHASE' :
            state.phase === 'battle' ? 'BATTLE PHASE' : 'ROUND ENDED';
        
        if (state.phase === 'placement') {
            document.getElementById('phaseTimer').textContent = `${state.phaseTimeLeft}s`;
            
            // Update ready button state in case something changed
            this.updateReadyButtonState();
        } else {
            document.getElementById('phaseTimer').textContent = '';
        }
    }
    
    updateReadyButtonState() {
        const state = this.game.state;
        const button = document.getElementById('readyButton');
        
        if (!button) return;
        
        if (state.phase !== 'placement') {
            button.disabled = true;
            return;
        }
        
        if (!state.enemyPlacementComplete) {
            // Enemy still placing units
            button.disabled = true;
            button.textContent = 'Enemy placing units...';
            button.style.background = '#666666';
            button.style.cursor = 'not-allowed';
        } else if (state.playerReady) {
            // Player is ready, waiting for battle
            button.disabled = true;
            button.textContent = 'Waiting for battle...';
            button.style.background = '#444400';
            button.style.cursor = 'not-allowed';
        } else {
            // Ready to accept player input
            button.disabled = false;
            button.textContent = 'Ready for Battle!';
            button.style.background = '#003300';
            button.style.cursor = 'pointer';
        }
    }
    
    canPlayerToggleReady() {
        const state = this.game.state;
        return state.phase === 'placement' && state.enemyPlacementComplete && !state.playerReady;
    }
    
    toggleReady() {
        const state = this.game.state;
        
        // Check if player can toggle ready state
        if (!this.canPlayerToggleReady()) {
            console.log('Cannot toggle ready - conditions not met:', {
                phase: state.phase,
                enemyPlacementComplete: state.enemyPlacementComplete,
                playerReady: state.playerReady
            });
            return;
        }
        
        state.playerReady = !state.playerReady;
        console.log('Player ready state toggled to:', state.playerReady);
        
        this.updateReadyButtonState();
    }
    
    pause() {
        this.game.state.isPaused = true;
        document.getElementById('pauseMenu').style.display = 'flex';
    }
    
    resume() {
        this.game.state.isPaused = false;
        document.getElementById('pauseMenu').style.display = 'none';
    }
    
    restart() {
        if (confirm('Restart the game? Progress will be lost.')) {
            console.log('Restarting game - full cleanup');
            this.reset();
           
        }
        document.getElementById('pauseMenu').style.display = 'none';
    }

    reset() {
         // Clear any running timers
        if (this.phaseTimer) {
            clearInterval(this.phaseTimer);
            this.phaseTimer = null;
        }
        
        const state = this.game.state;
        state.round = 1;
        state.playerGold = this.getStartingGold();
        state.phase = 'placement';
        state.phaseTimeLeft = 30;
        state.playerReady = false;
        state.roundEnding = false;
        state.enemyPlacementComplete = false;
        
        // Comprehensive cleanup
        this.clearBattlefield();
        
        // Reset team health
        if (this.game.teamHealthSystem) {
            this.game.teamHealthSystem.resetTeamHealth();
        }
        
        // Reset all unit placements
        if (this.game.placementSystem) {
            this.game.placementSystem.resetAllPlacements();
        }
        
        // Reset UI
        this.resetUI();
        
    }
    
    getStartingGold() {
        // Always start with 100 gold for round 1
        return 100;
    }
    
    showPlacementHints() {
        const hints = [
            '💡 Place tanks in front to absorb damage',
            '💡 Position archers behind melee units',
            '💡 Spread units to avoid area attacks',
            '💡 Consider unit synergies',
            '💡 Save gold for emergency reinforcements'
        ];
        
        const hint = hints[Math.floor(Math.random() * hints.length)];
        setTimeout(() => {
            this.game.battleLogSystem.add(hint);
        }, 3000);
    }
}