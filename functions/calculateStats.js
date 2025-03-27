function calculateStats(stats, calcArray) {

    if( calcArray && calcArray.length > 0 ) {
        let additiveStats = {};
        let multiplicitiveStats = {};
        for(let key in stats) {
            additiveStats[key] = [];
            multiplicitiveStats[key] = [];
        }
        for(let effect of calcArray) {
            effect.apply(stats, additiveStats, multiplicitiveStats);
        }
        let addedEffects = {};
        for(let key in additiveStats){
            for(let val of additiveStats[key]){ 
                if(addedEffects[key]){
                    addedEffects[key] += val - 1;
                } else {
                    addedEffects[key] = val - 1;
                }
            }
        }

        for(let key in addedEffects) {
            if( stats[key] ) {
                stats[key] *= ( 1 + addedEffects[key] );
            }
        }

        let multipliedUpgrades = {};        
        for(let key in multiplicitiveStats){
            for(let val of multiplicitiveStats[key]){ 
                if(stats[key]){
                    stats[key] *= val;
                }
            }
        }
    }
}
export { calculateStats };