class FirestormAbility extends engine.app.appClasses['BaseAbility'] {
    constructor(game, params = {}) {
        super(game, {
            id: 'fireStorm',
            name: 'Fire Storm',
            description: 'Rain fire on the largest enemy cluster',
            cooldown: 12.0,
            range: 200,
            manaCost: 50,
            targetType: 'auto',
            animation: 'cast',
            priority: 8,
            castTime: 2.5,
            autoTrigger: 'enemy_cluster',
            ...params
        });
        
        this.stormRadius = 90;
        this.damage = 70;
        this.element = 'fire';
        this.minTargets = 3;
    }
    
    canExecute(casterEntity) {
        const enemies = this.getEnemiesInRange(casterEntity);
        const clusterPos = this.findBestClusterPosition(enemies, this.minTargets);
        return clusterPos !== null;
    }
    
    execute(casterEntity) {
        const enemies = this.getEnemiesInRange(casterEntity);
        const clusterPos = this.findBestClusterPosition(enemies, this.minTargets);
        
        if (!clusterPos) return;
        
        // Apply fire damage to all enemies in storm area
        if (this.game.damageSystem) {
            const results = this.game.damageSystem.applySplashDamage(
                casterEntity,
                clusterPos,
                this.damage,
                this.element,
                this.stormRadius,
                { allowFriendlyFire: false, isSpell: true }
            );
            
            this.logAbilityUsage(casterEntity, 
                `Firestorm engulfs ${results.length} enemies in flames!`);
        }
        
        this.createVisualEffect(clusterPos, 'firestorm');
    }
}