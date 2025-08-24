class ArenaPresenceAbility extends engine.app.appClasses['BaseAbility'] {
    constructor(game, params = {}) {
        super(game, {
            id: 'arena_presence',
            name: 'Arena Presence',
            description: 'Intimidate nearby enemies, reducing their damage and accuracy (does not stack)',
            cooldown: 10.0,
            range: 120,
            manaCost: 25,
            targetType: 'area',
            animation: 'cast',
            priority: 5,
            castTime: 1.2,
            ...params
        });
    }
    
    execute(casterEntity) {
        const pos = this.game.getComponent(casterEntity, this.componentTypes.POSITION);
        if (!pos) return;
        
        const enemies = this.getEnemiesInRange(casterEntity);
        let intimidatedCount = 0;
        
        enemies.forEach(enemyId => {
            // Check if already intimidated - don't stack multiple intimidations
            const existingBuff = this.game.getComponent(enemyId, this.game.componentManager.getComponentTypes().BUFF);
            if (existingBuff && existingBuff.buffType === 'intimidated') {
                // Refresh duration instead of stacking
                existingBuff.endTime = Date.now() / 1000 + 15;
                return;
            }
            
            const Components = this.game.componentManager.getComponents();
            this.game.addComponent(enemyId, this.game.componentManager.getComponentTypes().BUFF, 
                Components.Buff('intimidated', { 
                    damageReduction: 0.25, 
                    accuracyReduction: 0.2 
                }, Date.now() / 1000 + 15, false, 1, 0));
            intimidatedCount++;
        });
        
        this.logAbilityUsage(casterEntity, `Gladiator intimidates ${intimidatedCount} enemies!`);
    }
}