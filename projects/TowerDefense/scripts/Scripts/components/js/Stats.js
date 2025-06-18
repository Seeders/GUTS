class Stats extends engine.Component {
    
  init( {objectType, spawnType} ) {        
        
        let stats = this.game.getCollections()[objectType][spawnType];
        this.type = spawnType;
        this.stats = {...stats};
        this.defaultStats = {...this.stats};
        this.activeEffects = {};
    }
    update() {
        this.stats = {...this.defaultStats};
        this.applyEffects();
        this.applyUpgrades();
    }
    addStat(statName, statValue) {
        this.stats[statName] = statValue;
        this.defaultStats[statName] = statValue;
    }
    addEffect(effectConfig, effectFn, effectAmt) {        
        this.activeEffects[effectConfig.id] = this.parent.addComponent("effect", { config: effectConfig, applyFn: effectFn, amount: effectAmt });
    }
    applyEffects() {
        let effectArr = [];
        for(let effectId in this.activeEffects) {
            if(this.activeEffects[effectId] && this.activeEffects[effectId].lifeTime > 0){
                effectArr.push(this.activeEffects[effectId]);
            } else {
                this.activeEffects[effectId] = undefined;
            }
        }        
        
        engine.getFunction("calculateStats")(this.stats, effectArr);
    }
    
    applyUpgrades() {
        engine.getFunction("calculateStats")(this.stats, this.game.state.activeUpgrades[this.type]);        
    }
}