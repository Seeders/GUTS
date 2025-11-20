class StatisticsTrackingSystem extends engine.BaseSystem {
    constructor(game) {
        super(game);
        this.game.statisticsTrackingSystem = this;
        this.gameStartTime = null;
        this.battleStartTime = null;
        this.battleEndTime = null;
        this.sessionStats = {
            gamesPlayed: 0, totalWins: 0, totalLosses: 0,
            bestRound: 0, totalGoldEarned: 0, totalPlayTime: 0
        };
        
        this.loadSessionStats();
    }
    
    startSession() {
        this.gameStartTime = Date.now();
    }
    
    recordBattleStart() {
        this.battleStartTime = Date.now();
    }
    
    recordBattleEnd() {
        this.battleEndTime = Date.now();
    }
    
    collectStats() {
        return {
            round: this.game.state?.round || 1,
            goldEarned: this.game.state?.playerGold || 0,
            unitsDeployed: this.getUnitsDeployed(),
            unitsLost: this.getUnitsLost(),
            unitsRemaining: this.getUnitsRemaining(),
            battleDuration: this.getBattleDuration(),
            efficiency: this.calculateEfficiency(),
            armyValue: this.calculateArmyValue()
        };
    }
    
    getUnitsDeployed() {
        try {
            const ComponentTypes = this.game.componentManager.getComponentTypes();
            const playerUnits = this.game.getEntitiesWith(ComponentTypes.TEAM, ComponentTypes.UNIT_TYPE) || [];
            
            return playerUnits.filter(entityId => {
                const team = this.game.getComponent(entityId, ComponentTypes.TEAM);
                return team?.team === 'player';
            }).length;
        } catch (error) {
            return 0;
        }
    }
    
    getUnitsRemaining() {
        try {
            const ComponentTypes = this.game.componentManager.getComponentTypes();
            const alivePlayerUnits = this.game.getEntitiesWith(
                ComponentTypes.TEAM, ComponentTypes.HEALTH, ComponentTypes.UNIT_TYPE
            ) || [];
            
            return alivePlayerUnits.filter(entityId => {
                const team = this.game.getComponent(entityId, ComponentTypes.TEAM);
                const health = this.game.getComponent(entityId, ComponentTypes.HEALTH);
                return team?.team === 'player' && health?.current > 0;
            }).length;
        } catch (error) {
            return 0;
        }
    }
    
    getUnitsLost() {
        return Math.max(0, this.getUnitsDeployed() - this.getUnitsRemaining());
    }
    
    getBattleDuration() {
        if (this.battleStartTime && this.battleEndTime) {
            return this.battleEndTime - this.battleStartTime;
        }
        return 0;
    }
    
    calculateEfficiency() {
        const deployed = this.getUnitsDeployed();
        const remaining = this.getUnitsRemaining();
        return deployed > 0 ? Math.round((remaining / deployed) * 100) : 100;
    }
    
    calculateArmyValue() {
        try {
            const ComponentTypes = this.game.componentManager.getComponentTypes();
            const playerUnits = this.game.getEntitiesWith(ComponentTypes.TEAM, ComponentTypes.UNIT_TYPE) || [];
            
            return playerUnits.reduce((total, entityId) => {
                const team = this.game.getComponent(entityId, ComponentTypes.TEAM);
                const unitType = this.game.getComponent(entityId, ComponentTypes.UNIT_TYPE);
                
                if (team?.team === 'player' && unitType?.value) {
                    return total + unitType.value;
                }
                return total;
            }, 0);
        } catch (error) {
            return 0;
        }
    }
    
    update() {
        // Update enhanced stats display
        const efficiency = this.calculateEfficiency();
        const armyValue = this.calculateArmyValue();
        
        const efficiencyElement = document.getElementById('armyEfficiency');
        if (efficiencyElement) {
            efficiencyElement.textContent = `${efficiency}%`;
            efficiencyElement.className = efficiency > 80 ? 'stat-good' : efficiency > 60 ? 'stat-ok' : 'stat-poor';
        }
        
        const valueElement = document.getElementById('armyValue');
        if (valueElement) {
            valueElement.textContent = `${armyValue}g`;
        }
    }
    
    updateSession(result, stats) {
        this.sessionStats.gamesPlayed++;
        
        if (result === 'victory') {
            this.sessionStats.totalWins++;
            this.sessionStats.bestRound = Math.max(this.sessionStats.bestRound, stats.round);
        } else {
            this.sessionStats.totalLosses++;
        }
        
        this.sessionStats.totalGoldEarned += stats.goldEarned || 0;
        this.sessionStats.totalPlayTime += stats.battleDuration || 0;
        
        this.saveSessionStats();
    }
    
    loadSessionStats() {
        try {
            const saved = localStorage.getItem('autoBattleArena_sessionStats');
            if (saved) {
                Object.assign(this.sessionStats, JSON.parse(saved));
            }
        } catch (error) {
            console.warn('Could not load session stats:', error);
        }
    }
    
    saveSessionStats() {
        try {
            localStorage.setItem('autoBattleArena_sessionStats', JSON.stringify(this.sessionStats));
        } catch (error) {
            console.warn('Could not save session stats:', error);
        }
    }
    
    getSessionStats() {
        return { ...this.sessionStats };
    }

    resetSession() {
        
    }
}
