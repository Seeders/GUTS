class Game extends engine.Component {
       
    init() {
        this.initEffectsAndUpgrades();
        this.gridSize = this.game.getCollections().configs.game.gridSize;
        this.game.setGameEntity(this.parent);
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
    }

    postUpdate() {
        
            if (this.game.state.gameOver || this.game.state.victory || this.game.state.isLevelingUp) return;
                    
            // Game over check
            if (this.game.state.bloodCoreHP <= 0 && !this.game.state.gameOver) {
                this.gameOver();
            }
    }

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
                if(!multiplicitiveStats[this.game.getCollections().effects.slow.stat]){
                    multiplicitiveStats[this.game.getCollections().effects.slow.stat] = [];
                }
                multiplicitiveStats[this.game.getCollections().effects.slow.stat].push(slowAmount);
            }
        }
        this.game.upgrades = [
            // Bat Swarm Upgrades
            new Upgrade(
                'sentryFrenzy',
                'Sentry Frenzy',
                'Sentry Swarm: ' + this.game.getCollections().upgrades.sentryFrenzy.desc,
                '🦇',
                'sentry',
                (state) => true,
                (stats, additiveStats, multiplicitiveStats) => {
                    multiplicitiveStats['attackSpeed'].push(this.game.getCollections().upgrades.sentryFrenzy.value);
                }
            ),
            new Upgrade(
                'sentryIntelligence',
                'Sentry Intelligence',
                'Sentry Swarm: ' + this.game.getCollections().upgrades.sentryIntelligence.desc,
                '🦇',
                'sentry',
                (state) => true,
                (stats, additiveStats, multiplicitiveStats) => {            
                    multiplicitiveStats['damage'].push(this.game.getCollections().upgrades.sentryIntelligence.damage);
                    multiplicitiveStats['range'].push(this.game.getCollections().upgrades.sentryIntelligence.range);        
                }
            ),

            // Necromancer Upgrades
            new Upgrade(
                'necroSummon',
                'Raise Dead',
                'Necromancer: ' + this.game.getCollections().upgrades.necroSummon.desc,
                '💀',
                'fabricator',
                (state) => true,
                (stats, additiveStats, multiplicitiveStats) => {
                    stats.summonChance = 1;
                    if(!additiveStats.summonChance) additiveStats.summonChance = [];
                    additiveStats['summonChance'].push(this.game.getCollections().upgrades.necroSummon.summonChance);
                }
            ),

            // Shadow Turret Upgrades
            new Upgrade(
                'overCharge',
                'Overcharge',
                'Tesla Coil: ' + this.game.getCollections().upgrades.overCharge.desc,
                '📏',
                'teslaCoil',
                (state) => true,
                (stats, additiveStats, multiplicitiveStats) => {
                    additiveStats['range'].push(this.game.getCollections().upgrades.overCharge.range);
                }
            ),

            // Soul Pyre Upgrades
            new Upgrade(
                'pyreSoul',
                'Radiant Soul',
                'Soul Pyre: ' + this.game.getCollections().upgrades.pyreSoul.desc,
                '💉',
                'soulPyre',
                (state) => true,
                (stats, additiveStats, multiplicitiveStats) => {
                    additiveStats['splashRadius'].push(this.game.getCollections().upgrades.pyreSoul.splashRadius);
                }
            ),

            // Mist Shrine Upgrades
            new Upgrade(
                'mistSlow',
                'Chilling Mist',
                'Mist Shrine: ' + this.game.getCollections().upgrades.mistSlow.desc,
                '❄️',
                'mistShrine',
                (state) => true,
                (stats, additiveStats, multiplicitiveStats) => {
                    multiplicitiveStats['slowAmount'].push(this.game.getCollections().upgrades.mistSlow.slowAmount);
                }
            ),
            // Global Upgrades
            new Upgrade(
                'homeReinforcement',
                'Reinforcement',
                this.game.getCollections().upgrades.bloodCore.desc,
                '🛡️',
                'global',
                (state) => true,
                (stats) => {
                    stats.maxBloodCoreHP *= this.game.getCollections().upgrades.bloodCore.maxHpMultiplier;
                },
                (state) => {
                    state.bloodCoreHP = Math.min(state.stats.maxBloodCoreHP, state.bloodCoreHP + this.game.getCollections().upgrades.bloodCore.healAmount);
                }
            ),
            new Upgrade(
                'essenceExtraction',
                'Essence Extraction',
                this.game.getCollections().upgrades.essenceExtraction.desc,
                '🔮',
                'global',
                (state) => true,
                (stats) => {
                    stats.essenceMultiplier *= this.game.getCollections().upgrades.essenceExtraction.value;
                }
            ),
            new Upgrade(
                'essenceOverflow',
                'Essence Overflow',
                this.game.getCollections().upgrades.essenceOverflow.desc,
                '🔮',
                'global',
                (state) => state.bloodCoreHP > state.stats.maxBloodCoreHP / 2,
                (stats) => {
                    stats.essenceMultiplier *= this.game.getCollections().upgrades.essenceOverflow.value;
                }
            ),

        ];

    }
}