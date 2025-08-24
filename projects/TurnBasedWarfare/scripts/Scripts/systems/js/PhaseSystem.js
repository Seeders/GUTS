class PhaseSystem {
    constructor(app) {
        this.game = app;
        this.game.phaseSystem = this;
        this.phaseTimer = null;
        this.lastBattleEndCheck = 0;
        this.BATTLE_END_CHECK_INTERVAL = 1.0;
        this.config = {
            placementPhaseTime: 90,
            enemyPlacementDelay: 2000,
            battleCleanupDelay: 1500,
            roundTransitionDelay: 500,
            notificationDisplayTime: 5000,
            baseGoldPerRound: 25,
            startingGold: 100,
            hintDisplayDelay: 3000,
            maxSquadsPerRound: 2  // New limit
        };
    }
    
    startPlacementPhase() {
        const state = this.game.state;
        state.phase = 'placement';
        state.phaseTimeLeft = this.config.placementPhaseTime;
        state.playerReady = false;
        state.enemyPlacementComplete = false;
        state.roundEnding = false;
        
        // Reset squad counters for the new round
        state.playerSquadsPlacedThisRound = 0;
        state.enemySquadsPlacedThisRound = 0;
        
        this.distributeRoundGold();
        
        if (state.round > 1) {
            this.game.placementSystem.startNewPlacementPhase();
        }
        
        this.showPlacementHints();
        this.updateReadyButtonState();
        this.updateSquadCountDisplay();
        
        this.phaseTimer = setInterval(() => {
            state.phaseTimeLeft--;
            
            if (state.phaseTimeLeft <= 0 || (state.playerReady && state.enemyPlacementComplete)) {
                clearInterval(this.phaseTimer);
                this.startBattlePhase();
            }
        }, 1000);
        
        setTimeout(() => {
            this.game.placementSystem.placeEnemyUnits(null, () => {
                state.enemyPlacementComplete = true;
                this.updateReadyButtonState();
            });
        }, this.config.enemyPlacementDelay);
    }
    
    distributeRoundGold() {
        const state = this.game.state;
        
        if (state.round === 1) {
            state.playerGold = this.config.startingGold;
            return;
        } 
        const roundGold = this.calculateRoundGold(state.round);
        state.playerGold += roundGold;
    
        
        if (this.game.battleLogSystem) {
            const message = state.round === 1 
                ? `Round ${state.round}: You start with ${roundGold} gold! (${this.config.maxSquadsPerRound} squads max)`
                : `Round ${state.round}: +${roundGold} gold earned! (Total: ${state.playerGold}) (${this.config.maxSquadsPerRound} squads max)`;
            this.game.battleLogSystem.add(message, 'log-victory');
        }
        
        this.updateGoldDisplay();
    }
    
    calculateRoundGold(round) {
        return this.config.baseGoldPerRound + (round * this.config.baseGoldPerRound);
    }
    
    updateGoldDisplay() {
        const goldDisplay = document.getElementById('playerGold');
        if (goldDisplay) {
            goldDisplay.textContent = this.game.state.playerGold;
        }
    }
    
    updateSquadCountDisplay() {
        const state = this.game.state;
        const squadCountDisplay = document.getElementById('squadCount');
        if (squadCountDisplay) {
            const remaining = this.config.maxSquadsPerRound - state.playerSquadsPlacedThisRound;
            squadCountDisplay.textContent = `${remaining}/${this.config.maxSquadsPerRound} squads left`;
            
            // Change color based on remaining squads
            if (remaining === 0) {
                squadCountDisplay.style.color = '#ff4444';
            } else if (remaining === 1) {
                squadCountDisplay.style.color = '#ffaa44';
            } else {
                squadCountDisplay.style.color = '#44ff44';
            }
        }
    }
    
    canPlayerPlaceSquad() {
        const state = this.game.state;
        return state.phase === 'placement' && 
               state.playerSquadsPlacedThisRound < this.config.maxSquadsPerRound;
    }
    
    canEnemyPlaceSquad() {
        const state = this.game.state;
        return state.enemySquadsPlacedThisRound < this.config.maxSquadsPerRound;
    }
    
    onPlayerSquadPlaced(unitType) {
        const state = this.game.state;
        state.playerSquadsPlacedThisRound++;
        this.updateSquadCountDisplay();
        
        // Log squad info using SquadManager
        if (this.game.squadManager && unitType) {
            const squadInfo = this.game.squadManager.getSquadInfo(unitType);
            this.game.battleLogSystem?.add(
                `Deployed ${squadInfo.unitName} (${squadInfo.squadSize} units, ${squadInfo.formationType} formation)`,
                'log-victory'
            );
        }
        
        if (state.playerSquadsPlacedThisRound >= this.config.maxSquadsPerRound) {
            this.game.battleLogSystem?.add('Maximum squads placed this round!', 'log-damage');
            
            // Clear selected unit type when limit reached
            state.selectedUnitType = null;
            
            // Update UI to reflect no unit selected
            const unitButtons = document.querySelectorAll('.unit-button');
            unitButtons.forEach(btn => btn.classList.remove('selected'));
        }
    }
    
    onEnemySquadPlaced(unitType) {
        const state = this.game.state;
        state.enemySquadsPlacedThisRound++;
        
        // Log enemy squad deployment using SquadManager
        if (this.game.squadManager && unitType) {
            const squadInfo = this.game.squadManager.getSquadInfo(unitType);
            this.game.battleLogSystem?.add(
                `Enemy deployed ${squadInfo.unitName} (${squadInfo.squadSize} units, ${squadInfo.formationType} formation)`,
                'log-damage'
            );
        }
    }
    
    startBattlePhase() {
        const state = this.game.state;
        state.phase = 'battle';
        
        if (this.game.teamHealthSystem) {
            this.game.teamHealthSystem.onBattleStart();
        }
        
        this.game.statisticsTrackingSystem.recordBattleStart();
        this.game.battleLogSystem.add(`Round ${state.round} battle begins!`, 'log-victory');
        
        document.getElementById('readyButton').disabled = true;
       // this.game.effectsSystem.playBattleStartAnimation();
    }
    
    checkForRoundEnd() {
        if (this.game.state.phase !== 'battle' || this.game.state.roundEnding) {
            return;
        }
        
        const ComponentTypes = this.game.componentManager.getComponentTypes();
        const allLivingEntities = this.game.getEntitiesWith(
            ComponentTypes.TEAM, 
            ComponentTypes.HEALTH,
            ComponentTypes.UNIT_TYPE
        );
        
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
        
        let roundResult = null;
        let victoriousUnits = [];
        
        if (playerUnits.length === 0 && enemyUnits.length > 0) {
            roundResult = this.game.teamHealthSystem?.applyRoundDamage('enemy', enemyUnits);
            victoriousUnits = enemyUnits;
        } else if (enemyUnits.length === 0 && playerUnits.length > 0) {
            roundResult = this.game.teamHealthSystem?.applyRoundDamage('player', playerUnits);
            victoriousUnits = playerUnits;
        } else if (playerUnits.length === 0 && enemyUnits.length === 0) {
            roundResult = this.game.teamHealthSystem?.applyRoundDraw();
            victoriousUnits = [];
        }
        
        if (roundResult) {
            this.game.state.roundEnding = true;
            
            if (victoriousUnits.length > 0) {
                this.startVictoryCelebration(victoriousUnits);
            }
            
            this.handleRoundResult(roundResult);
        }
    }
    
    startVictoryCelebration(victoriousUnits) {
        if (!this.game.animationSystem) return;
        
        // Determine which team won
        const firstUnit = victoriousUnits[0];
        const ComponentTypes = this.game.componentManager.getComponentTypes();
        const team = this.game.getComponent(firstUnit, ComponentTypes.TEAM);
        const teamType = team?.team || 'player';
        
        victoriousUnits.forEach(entityId => {
            this.game.animationSystem.startCelebration(entityId, teamType);
        });
    }
    
    handleRoundResult(roundResult) {
        const state = this.game.state;
        state.phase = 'ended';
        
        const stats = this.game.statisticsTrackingSystem.collectStats();
        stats.roundResult = roundResult;
        
        if (roundResult.gameOver) {
            if (roundResult.result === 'victory') {
                this.game.statisticsTrackingSystem.updateSession('victory', stats);
                this.handleCampaignVictory(stats, roundResult);
            } else {
                this.game.statisticsTrackingSystem.updateSession('defeat', stats);
                this.handleCampaignDefeat(stats, roundResult);
            }
        } else {
            const sessionType = `round_${roundResult.result}`;
            this.game.statisticsTrackingSystem.updateSession(sessionType, stats);
            this.handleRoundContinue(stats, roundResult);
        }
    }
    
    handleCampaignVictory(stats, roundResult) {
        if (this.game.battleLogSystem) {
            this.game.battleLogSystem.add(`CAMPAIGN VICTORIOUS! Enemy army eliminated!`, 'log-victory');
        }
        
        setTimeout(() => {
            this.clearBattlefield();
            
            const finalStats = {
                ...stats,
                finalResult: 'victory',
                teamHealthRemaining: roundResult.remainingHealth.player,
                enemyHealthRemaining: roundResult.remainingHealth.enemy
            };
            
            if (window.gameUI && window.gameUI.showVictory) {
                window.gameUI.showVictory(finalStats);
            } else {
                this.showGameEndScreen(finalStats, 'victory');
            }
        }, this.config.battleCleanupDelay);
    }
    
    handleCampaignDefeat(stats, roundResult) {
        if (this.game.battleLogSystem) {
            this.game.battleLogSystem.add(`CAMPAIGN DEFEATED! Your army has been eliminated!`, 'log-death');
        }
        
        setTimeout(() => {
            this.clearBattlefield();
            
            const finalStats = {
                ...stats,
                finalResult: 'defeat',
                teamHealthRemaining: roundResult.remainingHealth.player,
                enemyHealthRemaining: roundResult.remainingHealth.enemy
            };
            
            if (window.gameUI && window.gameUI.showDefeat) {
                window.gameUI.showDefeat(finalStats);
            } else {
                this.showGameEndScreen(finalStats, 'defeat');
            }
        }, this.config.battleCleanupDelay);
    }
    
    handleRoundContinue(stats, roundResult) {
        const resultTypes = {
            victory: { emoji: '🎉', title: 'COMPLETE', className: 'victory-notification' },
            defeat: { emoji: '💀', title: 'LOST', className: 'defeat-notification' },
            draw: { emoji: '⚖️', title: 'DRAW', className: 'draw-notification' }
        };
        
        const resultType = resultTypes[roundResult.result];
        if (!resultType) return;
        
        if (roundResult.result === 'victory') {
            this.game.effectsSystem.showVictoryEffect(400, 300);
        }
        
        const notification = this.createRoundNotification(stats, roundResult, resultType);
        document.body.appendChild(notification);
        
        setTimeout(() => {
            document.body.removeChild(notification);
            this.setupNextRound(stats);
        }, this.config.notificationDisplayTime);
    }
    
    createRoundNotification(stats, roundResult, resultType) {
        const notification = document.createElement('div');
        notification.className = resultType.className;
        
        let content = `<h2>${resultType.emoji} ROUND ${stats.round} ${resultType.title}! ${resultType.emoji}</h2>`;
        
        if (roundResult.result === 'draw') {
            content += `
                <p>Both armies eliminated</p>
                <p>No damage dealt to either side</p>
            `;
        } else {
            content += `
                <p>Your Health: ${roundResult.remainingHealth.player}/100</p>
                <p>Enemy Health: ${roundResult.remainingHealth.enemy}/100</p>
            `;
        }
        
        content += `<p style="margin-top: 1rem; color: #888;">Preparing next round...</p>`;
        notification.innerHTML = content;
        
        if (roundResult.result !== 'victory') {
            const colors = {
                defeat: { bg: 'rgba(139, 0, 0, 0.95)', border: '#ff4444' },
                draw: { bg: 'rgba(139, 139, 0, 0.95)', border: '#ffff44' }
            };
            
            const color = colors[roundResult.result];
            notification.style.cssText = `
                background: ${color.bg}; color: white; padding: 2rem; border-radius: 10px;
                text-align: center; z-index: 10000; border: 2px solid ${color.border};
            `;
        }
        
        return notification;
    }
    
    showGameEndScreen(stats, result) {
        const screenId = result === 'victory' ? 'victoryScreen' : 'defeatScreen';
        const statsId = result === 'victory' ? 'victoryStats' : 'defeatStats';
        
        const gameScreen = document.getElementById('gameScreen');
        const endScreen = document.getElementById(screenId);
        
        if (gameScreen) gameScreen.classList.remove('active');
        
        if (endScreen) {
            endScreen.classList.add('active');
            this.updateEndScreenStats(statsId, stats, result);
            this.clearMatchData();
        } else {
            this.createGameEndOverlay(stats, result);
            this.clearMatchData();
        }
    }
    
    updateEndScreenStats(statsId, stats, result) {
        const statsElement = document.getElementById(statsId);
        if (!statsElement) return;
        
        const isVictory = result === 'victory';
        const healthValue = isVictory ? `${stats.teamHealthRemaining || 0}/100` : '0/100';
        const statusValue = isVictory ? 'VICTORIOUS!' : 'DEFEATED';
        const extraStat = isVictory 
            ? '<div class="stat-card"><div class="stat-label">Enemy Eliminated</div><div class="stat-value">✓ Complete</div></div>'
            : '<div class="stat-card"><div class="stat-label">Cause</div><div class="stat-value">Army Eliminated</div></div>';
        
        statsElement.innerHTML = `
            <div class="stat-card">
                <div class="stat-label">${isVictory ? 'Rounds Completed' : 'Rounds Survived'}</div>
                <div class="stat-value">${stats.round || 1}</div>
            </div>
            <div class="stat-card">
                <div class="stat-label">Final Army Health</div>
                <div class="stat-value">${healthValue}</div>
            </div>
            <div class="stat-card">
                <div class="stat-label">Campaign Status</div>
                <div class="stat-value">${statusValue}</div>
            </div>
            ${extraStat}
        `;
    }
    
    createGameEndOverlay(stats, result) {
        const isVictory = result === 'victory';
        const overlayId = isVictory ? 'victoryOverlay' : 'defeatOverlay';
        const bgColor = isVictory ? 'rgba(0, 100, 0, 0.9)' : 'rgba(100, 0, 0, 0.9)';
        const btnColor = isVictory ? '#006600' : '#660000';
        const emoji = isVictory ? '🎉' : '💀';
        const title = isVictory ? 'VICTORY!' : 'DEFEAT';
        const subtitle = isVictory ? 'Campaign Complete!' : 'Campaign Failed!';
        const roundLabel = isVictory ? 'Rounds' : 'Rounds Survived';
        const healthText = isVictory ? `Army Health: ${stats.teamHealthRemaining || 0}/100` : 'Your army was eliminated';
        
        const overlay = document.createElement('div');
        overlay.id = overlayId;
        overlay.style.cssText = `
            position: fixed; top: 0; left: 0; width: 100%; height: 100%;
            background: ${bgColor}; color: white; display: flex; flex-direction: column;
            justify-content: center; align-items: center; z-index: 10000;
            font-family: 'Courier New', monospace;
        `;
        
        const gameInstance = this.game;
        
        overlay.innerHTML = `
            <h1 style="font-size: 3rem; margin-bottom: 2rem;">${emoji} ${title} ${emoji}</h1>
            <p style="font-size: 1.5rem; margin: 1rem;">${subtitle}</p>
            <p style="font-size: 1.2rem; margin: 1rem;">${roundLabel}: ${stats.round || 1}</p>
            <p style="font-size: 1.2rem; margin: 1rem;">${healthText}</p>
            <button id="${overlayId}Button" style="
                margin-top: 2rem; padding: 1rem 2rem; font-size: 1.2rem;
                background: ${btnColor}; color: white; border: none; border-radius: 5px; cursor: pointer;
            ">Return to Main Menu</button>
        `;
        
        document.body.appendChild(overlay);
        
        const button = document.getElementById(`${overlayId}Button`);
        if (button) {
            button.onclick = () => {
                if (gameInstance && gameInstance.phaseSystem && gameInstance.phaseSystem.returnToMainMenu) {
                    gameInstance.phaseSystem.returnToMainMenu();
                } else {
                    location.reload();
                }
            };
        }
    }
    
    setupNextRound(stats) {
        const state = this.game.state;
        state.round++;
        state.roundEnding = false;
        
        this.clearBattlefield();
        
        setTimeout(() => {
            this.startPlacementPhase();
        }, this.config.roundTransitionDelay);
    }
    
    endBattle(result) {
        if (this.game.state.phase === 'battle' && !this.game.state.roundEnding) {
            this.checkForRoundEnd();
        }
    }

    clearMatchData() {
        if (this.phaseTimer) {
            clearInterval(this.phaseTimer);
            this.phaseTimer = null;
        }
        
        const state = this.game.state;
        state.round = 1;
        state.playerGold = this.getStartingGold();
        state.phase = 'placement';
        state.phaseTimeLeft = this.config.placementPhaseTime;
        state.playerReady = false;
        state.roundEnding = false;
        state.enemyPlacementComplete = false;
        state.isPaused = false;
        state.selectedUnitType = null;
        state.playerSquadsPlacedThisRound = 0;
        state.enemySquadsPlacedThisRound = 0;
        
        this.clearBattlefield();
        
        if (this.game.teamHealthSystem) {
            this.game.teamHealthSystem.resetTeamHealth();
        }
        
        if (this.game.placementSystem) {
            this.game.placementSystem.resetAllPlacements();
        }
        
        this.removeGameOverlays();
        
        // ONLY reset experience on full game restart (not between rounds)
        if (this.game.squadExperienceSystem) {
            this.game.squadExperienceSystem.reset();
        }
        
        if (this.game.statisticsTrackingSystem) {
            this.game.statisticsTrackingSystem.resetSession();
        }
        
        this.resetUI();
    }
    
    removeGameOverlays() {
        const overlayIds = ['victoryOverlay', 'defeatOverlay'];
        overlayIds.forEach(id => {
            const overlay = document.getElementById(id);
            if (overlay) overlay.remove();
        });
        
        const notifications = document.querySelectorAll('.victory-notification, .defeat-notification, .draw-notification');
        notifications.forEach(notification => notification.remove());
    }
    
    returnToMainMenu() {
        this.clearMatchData();
        
        const gameScreen = document.getElementById('gameScreen');
        const mainMenu = document.getElementById('mainMenu');
        const victoryScreen = document.getElementById('victoryScreen');
        const defeatScreen = document.getElementById('defeatScreen');
        
        [gameScreen, victoryScreen, defeatScreen].forEach(screen => {
            if (screen) screen.classList.remove('active');
        });
        
        if (mainMenu) {
            mainMenu.classList.add('active');
        } else {
            location.reload();
        }
    }

    clearBattlefield() {
        // IMPORTANT: Save player squad experience BEFORE clearing
        if (this.game.squadExperienceSystem) {
            this.game.squadExperienceSystem.savePlayerExperience();
        }
        
        const ComponentTypes = this.game.componentManager.getComponentTypes();
        const entitiesToDestroy = new Set();
        
        [
            ComponentTypes.TEAM,
            ComponentTypes.UNIT_TYPE,
            ComponentTypes.PROJECTILE,
            ComponentTypes.LIFETIME,
            ComponentTypes.HEALTH
        ].forEach(componentType => {
            const entities = this.game.getEntitiesWith(componentType);
            entities.forEach(id => entitiesToDestroy.add(id));
        });
        
        entitiesToDestroy.forEach(entityId => {
            try {
                this.game.destroyEntity(entityId);
            } catch (error) {
                console.warn(`Error destroying entity ${entityId}:`, error);
            }
        });
        
        if (this.game.renderSystem) {
            const modelEntities = Array.from(this.game.renderSystem.entityModels.keys());
            modelEntities.forEach(entityId => {
                this.game.renderSystem.removeEntityModel(entityId);
            });
        }
        
        if (this.game.animationSystem) {
            const animationEntities = Array.from(this.game.animationSystem.entityAnimationStates.keys());
            animationEntities.forEach(entityId => {
                this.game.animationSystem.removeEntityAnimations(entityId);
            });
        }
        
        if (this.game.projectileSystem?.clearAllProjectiles) {
            this.game.projectileSystem.clearAllProjectiles();
        }
        
        // MODIFIED: Do NOT clear experience data - it should persist
        // The squadExperience Map should keep all earned experience permanently
        if (this.game.squadExperienceSystem) {
      
            // Only clean up unit references (remove dead unit IDs) but keep experience
            this.game.squadExperienceSystem.cleanupInvalidSquads();
        }
    }

    
    update(deltaTime) {
        const now = Date.now() / 1000;

        if (now - this.lastBattleEndCheck > this.BATTLE_END_CHECK_INTERVAL) {
            this.checkForRoundEnd();
            this.lastBattleEndCheck = now;
        }

        const state = this.game.state;
        document.getElementById('roundNumber').textContent = state.round;
        document.getElementById('phaseTitle').textContent = 
            state.phase === 'placement' ? 'PLACEMENT PHASE' :
            state.phase === 'battle' ? 'BATTLE PHASE' : 'ROUND ENDED';
        
        if (state.phase === 'placement') {
            document.getElementById('phaseTimer').textContent = `${state.phaseTimeLeft}s`;
            this.updateReadyButtonState();
            this.updateSquadCountDisplay();
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
        
        const buttonStates = {
            enemyPlacing: {
                disabled: true,
                text: 'Enemy placing units...',
                background: '#666666',
                cursor: 'not-allowed'
            },
            playerReady: {
                disabled: true,
                text: 'Waiting for battle...',
                background: '#444400',
                cursor: 'not-allowed'
            },
            ready: {
                disabled: false,
                text: 'Ready for Battle!',
                background: '#003300',
                cursor: 'pointer'
            }
        };
        
        const currentState = !state.enemyPlacementComplete ? 'enemyPlacing' :
                           state.playerReady ? 'playerReady' : 'ready';
        
        const buttonState = buttonStates[currentState];
        Object.assign(button, { disabled: buttonState.disabled, textContent: buttonState.text });
        Object.assign(button.style, { 
            background: buttonState.background, 
            cursor: buttonState.cursor 
        });
    }
    
    canPlayerToggleReady() {
        const state = this.game.state;
        return state.phase === 'placement' && state.enemyPlacementComplete && !state.playerReady;
    }
    
    toggleReady() {
        const state = this.game.state;
        
        if (!this.canPlayerToggleReady()) return;
        
        state.playerReady = !state.playerReady;
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
            this.reset();
        }
        document.getElementById('pauseMenu').style.display = 'none';
    }
    
    reset() {
        this.clearMatchData();
    }
    
    resetUI() {
        const uiElements = {
            'phaseTitle': 'PLACEMENT PHASE',
            'roundNumber': '1',
            'phaseTimer': `${this.config.placementPhaseTime}s`,
            'playerGold': this.getStartingGold()
        };
        
        Object.entries(uiElements).forEach(([id, value]) => {
            const element = document.getElementById(id);
            if (element) element.textContent = value;
        });
        
        this.updateReadyButtonState();
        this.updateSquadCountDisplay();
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
    
    getStartingGold() {
        return this.config.startingGold;
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
        }, this.config.hintDisplayDelay);
    }
}