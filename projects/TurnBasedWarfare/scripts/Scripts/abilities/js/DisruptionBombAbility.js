class DisruptionBombAbility extends engine.app.appClasses['BaseAbility'] {
    constructor(game, params = {}) {
        super(game, {
            id: 'disruption_bomb',
            name: 'Disruption Bomb',
            description: 'Throw a bomb that disables enemy abilities and equipment (effects do not stack)',
            cooldown: 16.0,
            range: 130,
            manaCost: 40,
            targetType: 'area',
            animation: 'cast',
            priority: 6,
            castTime: 1.3,
            ...params
        });
    }
    
    execute(casterEntity) {
        const pos = this.game.getComponent(casterEntity, this.componentTypes.POSITION);
        if (!pos) return;
        
        const enemies = this.getEnemiesInRange(casterEntity);
        const clusterPos = this.findBestClusterPosition(enemies, 2);
        const targetPos = clusterPos || pos;
        
        let disruptedCount = 0;
        
        // Apply disruption effects
        enemies.forEach(enemyId => {
            const enemyPos = this.game.getComponent(enemyId, this.componentTypes.POSITION);
            if (!enemyPos) return;
            
            const distance = Math.sqrt(
                Math.pow(enemyPos.x - targetPos.x, 2) + 
                Math.pow(enemyPos.z - targetPos.z, 2)
            );
            
            if (distance <= 90) {
                // Check if already disrupted - don't stack disruptions
                const existingBuff = this.game.getComponent(enemyId, this.game.componentManager.getComponentTypes().BUFF);
                if (existingBuff && existingBuff.buffType === 'disrupted') {
                    // Just refresh duration
                    existingBuff.endTime = Date.now() / 1000 + 12;
                    return;
                }
                
                const Components = this.game.componentManager.getComponents();
                this.game.addComponent(enemyId, this.game.componentManager.getComponentTypes().BUFF, 
                    Components.Buff('disrupted', { 
                        abilitiesDisabled: true,
                        accuracyReduction: 0.4,
                        movementSlowed: 0.6
                    }, Date.now() / 1000 + 12, false, 1, 0));
                disruptedCount++;
            }
        });
        
        if (this.game.effectsSystem) {
            this.game.effectsSystem.showExplosionEffect(targetPos.x, targetPos.y, targetPos.z);
        }
        
        this.logAbilityUsage(casterEntity, `Saboteur's bomb disrupts ${disruptedCount} enemy systems!`);
    }
}