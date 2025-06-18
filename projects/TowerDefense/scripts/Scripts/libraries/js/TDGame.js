class TDGame extends engine.ECGame {

    init() {
        super.init();
        this.initEffectsAndUpgrades();
        this.gridSize = this.getCollections().configs.game.gridSize;
        let endPath = this.state.paths[0][this.state.paths[0].length - 1];
        let endY = endPath.y;
        let endX = endPath.x;
        let keepPosition = new THREE.Vector3(
            endX * this.gridSize + this.gridSize / 2,
            endY * this.gridSize + this.gridSize / 2,
            0
        );
        this.keep = this.spawn("tower",{ spawnType: 'keep', objectType: 'towers', setDirection: 1, position: keepPosition});
        this.keep.placed = true;
        this.keep.transform.position.z = this.getTerrainHeight(this.keep.transform.gridPosition);
    }

    update() {
        this.state.stats = {...this.state.defaultStats};//reset stats to recalculate upgrades from base stats.
        super.update();
    }

    getTerrainHeight(gridPosition) {
        if(this.state.tileMap.length > gridPosition.y && gridPosition.y > 0 && this.state.tileMap[Math.floor(gridPosition.y)] && this.state.tileMap[Math.floor(gridPosition.y)].length > gridPosition.x && gridPosition.x > 0){
            const tile = this.state.tileMap[Math.floor(gridPosition.y)][Math.floor(gridPosition.x)];
            if (!tile) {
                return 0;
            }              
            let heightStep = 1;
            if(this.heightMapConfig){
                heightStep = this.heightMapConfig.heightStep
            }
            const terrainHeight = tile.typeId * heightStep;
            return terrainHeight;
        }
        return 0;
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


        this.effects = {
            slow: (stats, additiveStats, multiplicitiveStats, slowAmount) => {
                if(!multiplicitiveStats[this.getCollections().effects.slow.stat]){
                    multiplicitiveStats[this.getCollections().effects.slow.stat] = [];
                }
                multiplicitiveStats[this.getCollections().effects.slow.stat].push(slowAmount);
            }
        }
        this.upgrades = [
            // Bat Swarm Upgrades
            new Upgrade(
                'sentryFrenzy',
                'Sentry Frenzy',
                'Sentry Swarm: ' + this.getCollections().upgrades.sentryFrenzy.desc,
                '🦇',
                'sentry',
                (state) => true,
                (stats, additiveStats, multiplicitiveStats) => {
                    multiplicitiveStats['attackSpeed'].push(this.getCollections().upgrades.sentryFrenzy.value);
                }
            ),
            new Upgrade(
                'sentryIntelligence',
                'Sentry Intelligence',
                'Sentry Swarm: ' + this.getCollections().upgrades.sentryIntelligence.desc,
                '🦇',
                'sentry',
                (state) => true,
                (stats, additiveStats, multiplicitiveStats) => {            
                    multiplicitiveStats['damage'].push(this.getCollections().upgrades.sentryIntelligence.damage);
                    multiplicitiveStats['range'].push(this.getCollections().upgrades.sentryIntelligence.range);        
                }
            ),

            // Necromancer Upgrades
            new Upgrade(
                'necroSummon',
                'Raise Dead',
                'Necromancer: ' + this.getCollections().upgrades.necroSummon.desc,
                '💀',
                'fabricator',
                (state) => true,
                (stats, additiveStats, multiplicitiveStats) => {
                    stats.summonChance = 1;
                    if(!additiveStats.summonChance) additiveStats.summonChance = [];
                    additiveStats['summonChance'].push(this.getCollections().upgrades.necroSummon.summonChance);
                }
            ),

            // Shadow Turret Upgrades
            new Upgrade(
                'overCharge',
                'Overcharge',
                'Tesla Coil: ' + this.getCollections().upgrades.overCharge.desc,
                '📏',
                'teslaCoil',
                (state) => true,
                (stats, additiveStats, multiplicitiveStats) => {
                    additiveStats['range'].push(this.getCollections().upgrades.overCharge.range);
                }
            ),

            // Soul Pyre Upgrades
            new Upgrade(
                'pyreSoul',
                'Radiant Soul',
                'Soul Pyre: ' + this.getCollections().upgrades.pyreSoul.desc,
                '💉',
                'soulPyre',
                (state) => true,
                (stats, additiveStats, multiplicitiveStats) => {
                    additiveStats['splashRadius'].push(this.getCollections().upgrades.pyreSoul.splashRadius);
                }
            ),

            // Mist Shrine Upgrades
            new Upgrade(
                'mistSlow',
                'Chilling Mist',
                'Mist Shrine: ' + this.getCollections().upgrades.mistSlow.desc,
                '❄️',
                'mistShrine',
                (state) => true,
                (stats, additiveStats, multiplicitiveStats) => {
                    multiplicitiveStats['slowAmount'].push(this.getCollections().upgrades.mistSlow.slowAmount);
                }
            ),
            // Global Upgrades
            new Upgrade(
                'homeReinforcement',
                'Reinforcement',
                this.getCollections().upgrades.bloodCore.desc,
                '🛡️',
                'global',
                (state) => true,
                (stats) => {
                    stats.maxBloodCoreHP *= this.getCollections().upgrades.bloodCore.maxHpMultiplier;
                },
                (state) => {
                    state.bloodCoreHP = Math.min(state.stats.maxBloodCoreHP, state.bloodCoreHP + this.getCollections().upgrades.bloodCore.healAmount);
                }
            ),
            new Upgrade(
                'essenceExtraction',
                'Essence Extraction',
                this.getCollections().upgrades.essenceExtraction.desc,
                '🔮',
                'global',
                (state) => true,
                (stats) => {
                    stats.essenceMultiplier *= this.getCollections().upgrades.essenceExtraction.value;
                }
            ),
            new Upgrade(
                'essenceOverflow',
                'Essence Overflow',
                this.getCollections().upgrades.essenceOverflow.desc,
                '🔮',
                'global',
                (state) => state.bloodCoreHP > state.stats.maxBloodCoreHP / 2,
                (stats) => {
                    stats.essenceMultiplier *= this.getCollections().upgrades.essenceOverflow.value;
                }
            ),

        ];

    }
}