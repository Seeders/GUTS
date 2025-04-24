class Game extends engine.Component {
    
    constructor(game, parent, params) {
        super(game, parent, params);
    }
    
    
        
    init() {
        this.initEffectsAndUpgrades();
        this.gridSize = this.game.config.configs.game.gridSize;       

    }
    update() {
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
    
            // FPS Counter
            if (!this.fps) {
                this.fps = {
                    frameCount: 0,
                    lastFpsUpdate: this.currentTime,
                    fpsValue: 0
                };
            }
            this.fps.frameCount++;
            if (this.currentTime - this.fps.lastFpsUpdate >= 1000) {
                this.fps.fpsValue = Math.round((this.fps.frameCount * 1000) / (this.currentTime - this.fps.lastFpsUpdate));
                this.fps.frameCount = 0;
                this.fps.lastFpsUpdate = this.currentTime;
            }
    
            // Sort entities by y position for proper drawing order
            this.game.state.entities.sort((a, b) => {
                return (a.position.y * this.game.state.tileMap.length + a.position.x) - (b.position.y * this.game.state.tileMap.length + b.position.x);
            });
    
            this.game.state.stats = {...this.game.state.defaultStats}; // Reset stats to recalculate upgrades from base stats.
            // Single loop through entities for update, draw and postUpdate
            const entitiesToKeep = [];
            for (let i = 0; i < this.game.state.entities.length; i++) {
                let e = this.game.state.entities[i];
                let result = e.update();    
                
                if (result) {
                    entitiesToKeep.push(e);
                    e.draw();
                    e.postUpdate();
                }
            }
            
            // Replace the entities array with only entities that should be kept
            this.game.state.entities = entitiesToKeep;
            
            this.postUpdate();
            // Add any new entities
            this.game.entitiesToAdd.forEach((entity) => this.game.state.addEntity(entity));
            this.game.entitiesToAdd = [];
    
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