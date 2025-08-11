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
        
        this.showPlacementHints();
        
        this.phaseTimer = setInterval(() => {
            state.phaseTimeLeft--;
            
            if (state.phaseTimeLeft <= 0 || state.playerReady) {
                clearInterval(this.phaseTimer);
                this.startBattlePhase();
            }
        }, 1000);
        
        // AI places units
        setTimeout(() => {
            this.game.placementSystem.placeEnemyUnits();
        }, 2000);
    }
    
    startBattlePhase() {
        const state = this.game.state;
        state.phase = 'battle';
        
        this.game.statisticsTrackingSystem.recordBattleStart();
        this.game.battleLogSystem.add(`Round ${state.round} battle begins!`, 'log-victory');
        
        document.getElementById('readyButton').disabled = true;
        this.game.effectsSystem.playBattleStartAnimation();
    }
    
    endBattle(result) {
        const state = this.game.state;
        state.phase = 'ended';
        
        const stats = this.game.statisticsTrackingSystem.collectStats();
        this.game.statisticsTrackingSystem.updateSession(result, stats);
        
        this.game.battleLogSystem.add(
            `Battle ${result === 'victory' ? 'won' : 'lost'}! Round ${stats.round} ${result === 'victory' ? 'complete' : 'ended'}.`,
            result === 'victory' ? 'log-victory' : 'log-death'
        );
        
        if (result === 'victory') {
            if (this.shouldEndCampaign()) {
                window.gameUI?.showVictory(stats);
            } else {
                this.showRoundVictory(stats);
            }
        } else {
            window.gameUI?.showDefeat(stats);
        }
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
    
    showRoundVictory(stats) {
        this.game.effectsSystem.showVictoryEffect(400, 300);
        
        const notification = document.createElement('div');
        notification.className = 'victory-notification';
        notification.innerHTML = `
            <h2>🎉 ROUND ${stats.round} COMPLETE! 🎉</h2>
            <p>Gold Earned: +${50 + (stats.round * 10)}g</p>
            <p style="margin-top: 1rem; color: #888;">Preparing next round...</p>
        `;
        
        document.body.appendChild(notification);
        
        setTimeout(() => {
            document.body.removeChild(notification);
            this.setupNextRound(stats);
        }, 2000);
    }
    
    setupNextRound(stats) {
        const state = this.game.state;
        state.playerGold += 50 + (stats.round * 10);
        state.round++;
        
        // Clear battlefield
        const ComponentTypes = this.game.componentManager.getComponentTypes();
        const allUnits = this.game.getEntitiesWith(ComponentTypes.TEAM);
        allUnits.forEach(entityId => this.game.destroyEntity(entityId));
        
        this.startPlacementPhase();
    }
    
    update(deltaTime) {
        const state = this.game.state;
        document.getElementById('roundNumber').textContent = state.round;
        document.getElementById('phaseTitle').textContent = 
            state.phase === 'placement' ? 'PLACEMENT PHASE' :
            state.phase === 'battle' ? 'BATTLE PHASE' : 'ROUND ENDED';
        
        if (state.phase === 'placement') {
            document.getElementById('phaseTimer').textContent = `${state.phaseTimeLeft}s`;
        } else {
            document.getElementById('phaseTimer').textContent = '';
        }
    }
    
    toggleReady() {
        const state = this.game.state;
        if (state.phase !== 'placement') return;
        
        state.playerReady = !state.playerReady;
        const button = document.getElementById('readyButton');
        
        if (state.playerReady) {
            button.textContent = 'Waiting for battle...';
            button.style.background = '#444400';
        } else {
            button.textContent = 'Ready for Battle!';
            button.style.background = '#003300';
        }
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
            const state = this.game.state;
            state.round = 1;
            state.playerGold = this.getStartingGold();
            
            // Clear battlefield
            const ComponentTypes = this.game.componentManager.getComponentTypes();
            const allUnits = this.game.getEntitiesWith(ComponentTypes.TEAM);
            allUnits.forEach(entityId => this.game.destroyEntity(entityId));
            
            this.game.uiSystem.start();
        }
        document.getElementById('pauseMenu').style.display = 'none';
    }
    
    getStartingGold() {
        const gameMode = this.game.state?.gameMode;
        const goldConfig = {
            campaign: 100, survival: 150, arena: 200,
            challenge: 100, endless: 100, tournament: 120
        };
        return goldConfig[gameMode] || 100;
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