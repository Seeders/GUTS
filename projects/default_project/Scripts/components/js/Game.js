class Game extends engine.Component {
    
    constructor(game, parent, params) {
        super(game, parent, params);
    }
    
    
        
    init() {
        this.initEffectsAndUpgrades();
        this.gridSize = this.game.config.configs.game.gridSize;
        let endPath = this.game.state.paths[0][this.game.state.paths[0].length - 1];
        let endY = endPath.y;
        let endX = endPath.x;
        let keepPosition = {
            x: endX * this.gridSize + this.gridSize / 2,
            y: endY * this.gridSize + this.gridSize / 2,
            z: 0
        }
        debugger;
        this.keep = this.game.spawn("tower",{ spawnType: 'keep', objectType: 'towers', setDirection: 1}, keepPosition);
        this.keep.placed = true;
        
        this.keep.transform.position.z = this.getTerrainHeight(this.keep.transform.gridPosition);
    }

    update() {
        if(this.game.config.configs.game.is3D){
            this.getComponent("MapRenderer")?.render(this.game.state.tileMapData, this.game.state.paths);
        } else {
            this.getComponent("MapRenderer")?.renderBG(this.game.state.tileMapData, this.game.state.paths);
        }
        if (!this.game.state.isPaused) {
            this.currentTime = Date.now();

            // Only update if a reasonable amount of time has passed
            const timeSinceLastUpdate = this.currentTime - this.lastTime;

            // Skip update if more than 1 second has passed (tab was inactive)
            if (timeSinceLastUpdate > 1000) {
                this.lastTime = this.currentTime; // Reset timer without updating
                return;
            }

            this.game.deltaTime = Math.min(1/30, timeSinceLastUpdate / 1000); // Cap at 1/30th of a second        
            this.lastTime = this.currentTime;

            // Sort entities by y position for proper drawing order
            this.game.state.entities.sort((a, b) => {
                return (a.transform.position.y * this.game.state.tileMap.length + a.transform.position.x) - (b.transform.position.y * this.game.state.tileMap.length + b.transform.position.x)
            });

            this.game.state.stats = {...this.game.state.defaultStats};//reset stats to recalculate upgrades from base stats.

            let entitiesToRemove = [];
            for (let i = 0; i < this.game.state.entities.length; i++) {
                let e = this.game.state.entities[i];
                e.update();
                if(!e.destroyed){
                    e.draw();
                    e.postUpdate();  
                } else {
                    entitiesToRemove.push(i);
                }     
            }
            for(let i = entitiesToRemove.length - 1; i >= 0; i--){
                this.game.state.entities.splice(entitiesToRemove[i], 1);
            }
            
            this.postUpdate();
        }     
        if(!this.game.config.configs.game.is3D){
            this.getComponent("MapRenderer")?.renderFG(this.game.state.tileMapData, this.game.state.paths);
        }   
        
    }

    getTerrainHeight(gridPosition) {
        if(this.game.state.tileMap.length > gridPosition.y && gridPosition.y > 0 && this.game.state.tileMap[Math.floor(gridPosition.y)] && this.game.state.tileMap[Math.floor(gridPosition.y)].length > gridPosition.x && gridPosition.x > 0){
            const tile = this.game.state.tileMap[Math.floor(gridPosition.y)][Math.floor(gridPosition.x)];
            if (!tile) {
                return 0;
            }
            const terrainHeight = tile.typeId * this.game.heightMapConfig.heightStep;
            return terrainHeight;
        }
        return 0;
    }
    postUpdate() {
        
            if (this.game.state.gameOver || this.game.state.victory || this.game.state.isLevelingUp) return;
                    
            // Game over check
            if (this.game.state.bloodCoreHP <= 0 && !this.game.state.gameOver) {
                this.gameOver();
            }
    }


    // Game-over and victory functions
    gameOver() {
        this.game.state.gameOver = true;
        this.game.state.isPaused = true;
        gameOverWave.textContent = this.game.state.round + 1;
        gameOverMenu.style.display = 'block';
        overlay.style.display = 'block';
    }

    gameVictory() {
        this.game.state.victory = true;
        this.game.state.isPaused = true;
        victoryMenu.style.display = 'block';
        overlay.style.display = 'block';
    }


    // Tower placement system
  

    initEffectsAndUpgrades() {

        const Upgrade = class { 
            constructor(id, title, desc, icon, appliesTo, condition, apply, onAcquire) {
                this.id = id;
                this.title = title;
                this.desc = desc;
                this.icon = icon;
                this.appliesTo = appliesTo;
                this.conditionFn = condition;
                this.applyFn = apply;
                this.onAcquire = onAcquire;        
            }

            canApply(gameState) {
                return this.conditionFn(gameState);
            }

            apply(s, add, mul) {
                this.applyFn(s, add, mul);
            }
        }


        this.game.effects = {
            slow: (stats, additiveStats, multiplicitiveStats, slowAmount) => {
                stats[this.game.config.effects.slow.stat] *= slowAmount;
            }
        }
        this.game.upgrades = [
            // Bat Swarm Upgrades
            new Upgrade(
                'sentryFrenzy',
                'Sentry Frenzy',
                'Sentry Swarm: ' + this.game.config.upgrades.sentryFrenzy.desc,
                '🦇',
                'sentry',
                (state) => true,
                (stats, additiveStats, multiplicitiveStats) => {
                    multiplicitiveStats['attackSpeed'].push(this.game.config.upgrades.sentryFrenzy.value);
                }
            ),
            new Upgrade(
                'sentryIntelligence',
                'Sentry Intelligence',
                'Sentry Swarm: ' + this.game.config.upgrades.sentryIntelligence.desc,
                '🦇',
                'sentry',
                (state) => true,
                (stats, additiveStats, multiplicitiveStats) => {            
                    multiplicitiveStats['damage'].push(this.game.config.upgrades.sentryIntelligence.damage);
                    multiplicitiveStats['range'].push(this.game.config.upgrades.sentryIntelligence.range);        
                }
            ),

            // Necromancer Upgrades
            new Upgrade(
                'necroSummon',
                'Raise Dead',
                'Necromancer: ' + this.game.config.upgrades.necroSummon.desc,
                '💀',
                'fabricator',
                (state) => true,
                (stats, additiveStats, multiplicitiveStats) => {
                    stats.summonChance = 1;
                    if(!additiveStats.summonChance) additiveStats.summonChance = [];
                    additiveStats['summonChance'].push(this.game.config.upgrades.necroSummon.summonChance);
                }
            ),

            // Shadow Turret Upgrades
            new Upgrade(
                'overCharge',
                'Overcharge',
                'Tesla Coil: ' + this.game.config.upgrades.overCharge.desc,
                '📏',
                'teslaCoil',
                (state) => true,
                (stats, additiveStats, multiplicitiveStats) => {
                    additiveStats['range'].push(this.game.config.upgrades.overCharge.range);
                }
            ),

            // Soul Pyre Upgrades
            new Upgrade(
                'pyreSoul',
                'Radiant Soul',
                'Soul Pyre: ' + this.game.config.upgrades.pyreSoul.desc,
                '💉',
                'soulPyre',
                (state) => true,
                (stats, additiveStats, multiplicitiveStats) => {
                    additiveStats['splashRadius'].push(this.game.config.upgrades.pyreSoul.splashRadius);
                }
            ),

            // Mist Shrine Upgrades
            new Upgrade(
                'mistSlow',
                'Chilling Mist',
                'Mist Shrine: ' + this.game.config.upgrades.mistSlow.desc,
                '❄️',
                'mistShrine',
                (state) => true,
                (stats, additiveStats, multiplicitiveStats) => {
                    multiplicitiveStats['slowAmount'].push(this.game.config.upgrades.mistSlow.slowAmount);
                }
            ),
            // Global Upgrades
            new Upgrade(
                'homeReinforcement',
                'Reinforcement',
                this.game.config.upgrades.bloodCore.desc,
                '🛡️',
                'global',
                (state) => true,
                (stats) => {
                    stats.maxBloodCoreHP *= this.game.config.upgrades.bloodCore.maxHpMultiplier;
                },
                (state) => {
                    state.bloodCoreHP = Math.min(state.stats.maxBloodCoreHP, state.bloodCoreHP + this.game.config.upgrades.bloodCore.healAmount);
                }
            ),
            new Upgrade(
                'essenceExtraction',
                'Essence Extraction',
                this.game.config.upgrades.essenceExtraction.desc,
                '🔮',
                'global',
                (state) => true,
                (stats) => {
                    stats.essenceMultiplier *= this.game.config.upgrades.essenceExtraction.value;
                }
            ),
            new Upgrade(
                'essenceOverflow',
                'Essence Overflow',
                this.game.config.upgrades.essenceOverflow.desc,
                '🔮',
                'global',
                (state) => state.bloodCoreHP > state.stats.maxBloodCoreHP / 2,
                (stats) => {
                    stats.essenceMultiplier *= this.game.config.upgrades.essenceOverflow.value;
                }
            ),

        ];

    }
}