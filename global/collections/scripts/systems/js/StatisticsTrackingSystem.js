class StatisticsTrackingSystem extends GUTS.BaseSystem {
    static serviceDependencies = [
        'getPlayerGold',
        'getActivePlayerTeam',
        'getUnitTypeDef'
    ];

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

        // Track last displayed values to avoid unnecessary DOM updates
        this._lastEfficiency = -1;
        this._lastEfficiencyClass = '';
        this._lastArmyValue = -1;

        // Cache calculated values to avoid recalculating every frame
        this._cachedDeployed = 0;
        this._cachedRemaining = 0;
        this._cachedArmyValue = 0;
        this._statsCacheDirty = true;

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
        const gold = this.game.hasService('getPlayerGold') ? this.call.getPlayerGold() : 0;
        return {
            round: this.game.state?.round || 1,
            goldEarned: gold,
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
            const playerUnits = this.game.getEntitiesWith("team", "unitType") || [];
            const myTeamId = this.call.getActivePlayerTeam();

            return playerUnits.filter(entityId => {
                const team = this.game.getComponent(entityId, "team");
                return team?.team === myTeamId;
            }).length;
        } catch (error) {
            return 0;
        }
    }

    getUnitsRemaining() {
        try {
            const alivePlayerUnits = this.game.getEntitiesWith(
                "team", "health", "unitType"
            ) || [];
            const myTeamId = this.call.getActivePlayerTeam();

            return alivePlayerUnits.filter(entityId => {
                const team = this.game.getComponent(entityId, "team");
                const health = this.game.getComponent(entityId, "health");
                return team?.team === myTeamId && health?.current > 0;
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
            const playerUnits = this.game.getEntitiesWith("team", "unitType") || [];
            const myTeamId = this.call.getActivePlayerTeam();

            return playerUnits.reduce((total, entityId) => {
                const team = this.game.getComponent(entityId, "team");
                const unitTypeComp = this.game.getComponent(entityId, "unitType");
                const unitType = this.call.getUnitTypeDef( unitTypeComp);

                if (team?.team === myTeamId && unitType?.value) {
                    return total + unitType.value;
                }
                return total;
            }, 0);
        } catch (error) {
            return 0;
        }
    }
    
    invalidateStatsCache() {
        this._statsCacheDirty = true;
    }

    _recalculateStats() {
        if (!this._statsCacheDirty) return;

        const playerUnits = this.game.getEntitiesWith("team", "unitType") || [];
        const myTeamId = this.call.getActivePlayerTeam();

        let deployed = 0;
        let remaining = 0;
        let armyValue = 0;

        for (let i = 0; i < playerUnits.length; i++) {
            const entityId = playerUnits[i];
            const team = this.game.getComponent(entityId, "team");
            if (team?.team !== myTeamId) continue;

            deployed++;

            const health = this.game.getComponent(entityId, "health");
            if (health?.current > 0) {
                remaining++;
            }

            const unitTypeComp = this.game.getComponent(entityId, "unitType");
            const unitType = this.call.getUnitTypeDef( unitTypeComp);
            if (unitType?.value) {
                armyValue += unitType.value;
            }
        }

        this._cachedDeployed = deployed;
        this._cachedRemaining = remaining;
        this._cachedArmyValue = armyValue;
        this._statsCacheDirty = false;
    }

    update() {
        // Recalculate stats only when dirty
        this._recalculateStats();

        const efficiency = this._cachedDeployed > 0
            ? Math.round((this._cachedRemaining / this._cachedDeployed) * 100)
            : 100;
        const armyValue = this._cachedArmyValue;

        const efficiencyElement = document.getElementById('armyEfficiency');
        if (efficiencyElement) {
            const newClass = efficiency > 80 ? 'stat-good' : efficiency > 60 ? 'stat-ok' : 'stat-poor';
            if (efficiency !== this._lastEfficiency) {
                this._lastEfficiency = efficiency;
                efficiencyElement.textContent = `${efficiency}%`;
            }
            if (newClass !== this._lastEfficiencyClass) {
                this._lastEfficiencyClass = newClass;
                efficiencyElement.className = newClass;
            }
        }

        const valueElement = document.getElementById('armyValue');
        if (valueElement && armyValue !== this._lastArmyValue) {
            this._lastArmyValue = armyValue;
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