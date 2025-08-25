class MultiplayerPhaseSystem {
    constructor(game, sceneManager) {
        this.game = game;
        this.sceneManager = sceneManager;
        this.game.phaseSystem = this;
        
        this.phaseTimer = null;
        this.lastBattleEndCheck = 0;
        this.BATTLE_END_CHECK_INTERVAL = 1.0;
        
        this.config = {
            placementPhaseTime: 90, // Not used in multiplayer, but kept for compatibility
            enemyPlacementDelay: 0, // No AI enemy in multiplayer
            battleCleanupDelay: 1500,
            roundTransitionDelay: 500,
            notificationDisplayTime: 5000,
            baseGoldPerRound: 25,
            startingGold: 100,
            hintDisplayDelay: 3000,
            maxSquadsPerRound: 2
        };
    }

    // GUTS Manager Interface
    init(params) {
        this.params = params || {};
        console.log('MultiplayerPhaseSystem initialized');
    }
    
    startPlacementPhase() {
        const state = this.game.state;
        state.phase = 'placement';
        state.phaseTimeLeft = null; // No timer in multiplayer
        state.playerReady = false;
        state.enemyPlacementComplete = false; // Actually opponent placement
        state.roundEnding = false;
        
        // Reset squad counters for the new round
        state.playerSquadsPlacedThisRound = 0;
        state.enemySquadsPlacedThisRound = 0;
        
        // Gold is managed by server in multiplayer
        this.updateGoldDisplay();
        
        if (state.round > 1) {
            this.game.placementSystem.startNewPlacementPhase();
        }
        
        this.showPlacementHints();
        this.updateReadyButtonState();
        this.updateSquadCountDisplay();
        
        // Update UI elements
        this.updatePhaseUI();
        
        if (this.game.battleLogSystem) {
            this.game.battleLogSystem.add(`Round ${state.round} - Deploy your army! Waiting for opponent...`);
        }
    }

    toggleReady() {
        const state = this.game.state;
        
        if (state.phase !== 'placement') {
            return;
        }
        
        // In multiplayer, submit placements to server
        if (this.game.multiplayerManager) {
            const submitted = this.game.multiplayerManager.submitPlacements();
            if (submitted) {
                state.playerReady = true;
                this.updateReadyButtonState();
                this.updatePhaseUI();
            }
        }
    }

    startBattlePhase() {
        const state = this.game.state;
        state.phase = 'battle';
        
        if (this.game.teamHealthSystem) {
            this.game.teamHealthSystem.onBattleStart();
        }
        
        if (this.game.battleLogSystem) {
            this.game.battleLogSystem.add(`Round ${state.round} multiplayer battle begins!`);
        }
        
        this.updatePhaseUI();
        
        const readyButton = document.getElementById('multiplayerReadyButton');
        if (readyButton) {
            readyButton.disabled = true;
            readyButton.textContent = 'Battle in Progress...';
        }
    }

    checkForRoundEnd() {
        // In multiplayer mode, server determines battle results
        // This method is called by server events via MultiplayerManager
        return;
    }

    // Gold distribution is handled by server
    distributeRoundGold() {
        // Server handles gold distribution
        this.updateGoldDisplay();
    }

    calculateRoundGold(round) {
        // Server calculates gold in multiplayer
        return 0;
    }
    
    updateGoldDisplay() {
        const goldDisplay = document.getElementById('multiplayerPlayerGold');
        if (goldDisplay) {
            goldDisplay.textContent = this.game.state.playerGold || 0;
        }
    }
    
    updateSquadCountDisplay() {
        const state = this.game.state;
        const squadCountDisplay = document.getElementById('squadCount');
        if (squadCountDisplay) {
            const remaining = this.config.maxSquadsPerRound - state.playerSquadsPlacedThisRound;
            squadCountDisplay.textContent = `${remaining}/${this.config.maxSquadsPerRound} squads left`;
            
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
    
    updateReadyButtonState() {
        const state = this.game.state;
        const button = document.getElementById('multiplayerReadyButton');
        
        if (!button) return;
        
        if (state.phase !== 'placement') {
            button.disabled = true;
            button.textContent = 'Battle in Progress';
            button.style.background = '#333';
            button.style.cursor = 'not-allowed';
            return;
        }
        
        if (state.playerReady) {
            button.disabled = true;
            button.textContent = 'Waiting for opponent...';
            button.style.background = '#444400';
            button.style.cursor = 'not-allowed';
        } else {
            button.disabled = false;
            button.textContent = 'Deploy Army!';
            button.style.background = '#003300';
            button.style.cursor = 'pointer';
        }
    }
    
    updatePhaseUI() {
        const state = this.game.state;
        
        // Update round number
        const roundNumberEl = document.getElementById('multiplayerRoundNumber');
        if (roundNumberEl) {
            roundNumberEl.textContent = state.round || 1;
        }
        
        // Update phase title
        const phaseTitleEl = document.getElementById('multiplayerPhaseTitle');
        if (phaseTitleEl) {
            switch (state.phase) {
                case 'placement':
                    phaseTitleEl.textContent = 'PLACEMENT PHASE';
                    break;
                case 'battle':
                    phaseTitleEl.textContent = 'BATTLE PHASE';
                    break;
                case 'ended':
                    phaseTitleEl.textContent = 'ROUND ENDED';
                    break;
                default:
                    phaseTitleEl.textContent = 'PREPARING...';
            }
        }
        
        // Update phase status
        const phaseStatusEl = document.getElementById('multiplayerPhaseStatus');
        if (phaseStatusEl) {
            if (state.phase === 'placement') {
                if (state.playerReady) {
                    phaseStatusEl.textContent = 'Army deployed! Waiting for opponent...';
                } else {
                    phaseStatusEl.textContent = 'Deploy your units and get ready!';
                }
            } else if (state.phase === 'battle') {
                phaseStatusEl.textContent = 'Battle in progress! Watch your units fight!';
            }
        }
        
        // Update phase timer (always infinity symbol for multiplayer)
        const phaseTimerEl = document.getElementById('multiplayerPhaseTimer');
        if (phaseTimerEl) {
            if (state.phase === 'placement') {
                phaseTimerEl.textContent = '∞';
                phaseTimerEl.style.color = '#00ffff';
            } else {
                phaseTimerEl.textContent = '';
            }
        }
        
        // Update opponent indicator
        if (this.game.multiplayerManager) {
            const opponentIndicator = document.getElementById('opponentIndicator');
            const opponent = Array.from(this.game.multiplayerManager.opponents.values())[0];
            if (opponentIndicator && opponent) {
                opponentIndicator.textContent = opponent.name;
            }
        }
    }
    
    onPlayerSquadPlaced(unitType) {
        const state = this.game.state;
        state.playerSquadsPlacedThisRound++;
        this.updateSquadCountDisplay();
        
        // Log squad info using SquadManager
        if (this.game.squadManager && unitType) {
            const squadInfo = this.game.squadManager.getSquadInfo(unitType);
            if (this.game.battleLogSystem) {
                this.game.battleLogSystem.add(
                    `Deployed ${squadInfo.unitName} (${squadInfo.squadSize} units, ${squadInfo.formationType} formation)`,
                    'log-victory'
                );
            }
        }
        
        if (state.playerSquadsPlacedThisRound >= this.config.maxSquadsPerRound) {
            if (this.game.battleLogSystem) {
                this.game.battleLogSystem.add('Maximum squads placed this round!', 'log-damage');
            }
            
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
            if (this.game.battleLogSystem) {
                this.game.battleLogSystem.add(
                    `Opponent deployed ${squadInfo.unitName} (${squadInfo.squadSize} units, ${squadInfo.formationType} formation)`,
                    'log-damage'
                );
            }
        }
    }
    
    // Handle round results from server
    handleRoundResult(roundResult) {
        const state = this.game.state;
        state.phase = 'ended';
        
        if (this.game.battleLogSystem) {
            if (roundResult.winner === this.game.multiplayerManager.playerId) {
                this.game.battleLogSystem.add(`Round ${state.round} - VICTORY! 🎉`, 'log-victory');
            } else {
                this.game.battleLogSystem.add(`Round ${state.round} - Defeat 💀`, 'log-death');
            }
        }
        
        this.updatePhaseUI();
        
        // Server will handle next round transition
        if (this.game.multiplayerManager) {
            this.game.multiplayerManager.showNotification(
                roundResult.winner === this.game.multiplayerManager.playerId ? 
                'Victory! You won this round!' : 'Defeat! Better luck next round!',
                roundResult.winner === this.game.multiplayerManager.playerId ? 'success' : 'warning'
            );
        }
    }
    
    // Handle game end from server
    handleGameEnd(gameResult) {
        const state = this.game.state;
        state.phase = 'ended';
        state.gameOver = true;
        
        if (this.game.battleLogSystem) {
            if (gameResult.winner === this.game.multiplayerManager.playerId) {
                this.game.battleLogSystem.add('🏆 GAME WON! Congratulations! 🏆', 'log-victory');
            } else {
                this.game.battleLogSystem.add('💀 GAME LOST! Better luck next time! 💀', 'log-death');
            }
        }
        
        this.updatePhaseUI();
    }
    
    setupNextRound(stats) {
        const state = this.game.state;
        state.round++;
        state.roundEnding = false;
        
        // Clear battlefield for next round
        this.clearBattlefield();
        
        setTimeout(() => {
            this.startPlacementPhase();
        }, this.config.roundTransitionDelay);
    }
    
    clearBattlefield() {
        // Save player squad experience BEFORE clearing
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
        
        // Clean up experience data but keep earned experience
        if (this.game.squadExperienceSystem) {
            this.game.squadExperienceSystem.cleanupInvalidSquads();
        }
    }
    
    showPlacementHints() {
        const hints = [
            '💡 Place tanks in front to absorb damage',
            '💡 Position archers behind melee units', 
            '💡 Spread units to avoid area attacks',
            '💡 Consider unit synergies against your opponent',
            '💡 Save gold for critical moments',
            '💡 Watch your opponent\'s strategy and adapt'
        ];
        
        const hint = hints[Math.floor(Math.random() * hints.length)];
        setTimeout(() => {
            if (this.game.battleLogSystem) {
                this.game.battleLogSystem.add(hint);
            }
        }, this.config.hintDisplayDelay);
    }
    
    update(deltaTime) {
        const now = Date.now() / 1000;

        // Check for battle end less frequently since server manages it
        if (now - this.lastBattleEndCheck > this.BATTLE_END_CHECK_INTERVAL) {
            // In multiplayer, we don't check locally - server handles this
            this.lastBattleEndCheck = now;
        }

        // Update UI elements
        this.updatePhaseUI();
        this.updateReadyButtonState();
        this.updateSquadCountDisplay();
        this.updateGoldDisplay();
    }
    
    // Reset for new game
    reset() {
        if (this.phaseTimer) {
            clearInterval(this.phaseTimer);
            this.phaseTimer = null;
        }
        
        const state = this.game.state;
        state.round = 1;
        state.playerGold = this.config.startingGold;
        state.phase = 'placement';
        state.phaseTimeLeft = null;
        state.playerReady = false;
        state.roundEnding = false;
        state.enemyPlacementComplete = false;
        state.isPaused = false;
        state.selectedUnitType = null;
        state.playerSquadsPlacedThisRound = 0;
        state.enemySquadsPlacedThisRound = 0;
        state.gameOver = false;
        
        this.clearBattlefield();
        
        if (this.game.teamHealthSystem) {
            this.game.teamHealthSystem.resetTeamHealth();
        }
        
        if (this.game.placementSystem) {
            this.game.placementSystem.resetAllPlacements();
        }
        
        // Reset experience on full game restart
        if (this.game.squadExperienceSystem) {
            this.game.squadExperienceSystem.reset();
        }
        
        if (this.game.statisticsTrackingSystem) {
            this.game.statisticsTrackingSystem.resetSession();
        }
        
        this.updatePhaseUI();
    }
    
    // Cleanup when scene changes
    dispose() {
        if (this.phaseTimer) {
            clearInterval(this.phaseTimer);
            this.phaseTimer = null;
        }
        
        console.log('MultiplayerPhaseSystem disposed');
    }
}