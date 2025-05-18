class Stats extends engine.Component {
    
    constructor(game, parent, params) {
        super(game, parent, params);
    }
    
    
  init( {objectType, spawnType} ) {        
        
        let stats = this.game.config[objectType][spawnType];
        this.type = spawnType;
        this.stats = {...stats};
        this.defaultStats = {...this.stats};
        this.activeEffects = {};
    }
    update() {
        this.stats = {...this.defaultStats};
        //this.applyEffects();
        //this.applyUpgrades();
    }
    addStat(statName, statValue) {
        this.stats[statName] = statValue;
        this.defaultStats[statName] = statValue;
    }
    addEffect(effectConfig, effectFn, effectAmt) {        
        this.activeEffects[effectConfig.id] = this.parent.addComponent("effect", { config: effectConfig, applyFn: effectFn, amount: effectAmt });
    }  
}