class TrackingMarkAbility extends engine.app.appClasses['BaseAbility'] {
    constructor(game, params = {}) {
        super(game, {
            id: 'tracking_mark',
            name: 'Tracking Mark',
            description: 'Mark an enemy for increased damage - multiple Rangers can mark the same target for stacking effect',
            cooldown: 8.0,
            range: 200,
            manaCost: 20,
            targetType: 'enemy',
            animation: 'cast',
            priority: 7,
            castTime: 1.0,
            ...params
        });
        this.markDamageIncrease = 0.25; // 25% per mark
        this.maxMarks = 4; // Cap at 4 marks (100% bonus)
    }
    
    execute(casterEntity) {
        const enemies = this.getEnemiesInRange(casterEntity);
        if (enemies.length === 0) return;
        
        const target = enemies[0];
        const Components = this.game.componentManager.getComponents();
        
        // Check for existing tracking mark
        let existingMark = this.game.getComponent(target, this.game.componentManager.getComponentTypes().BUFF);
        
        if (existingMark && existingMark.buffType === 'marked') {
            // Stack the mark up to the maximum
            if (existingMark.stacks < this.maxMarks) {
                existingMark.stacks++;
                existingMark.damageTakenMultiplier = 1 + (this.markDamageIncrease * existingMark.stacks);
                existingMark.endTime = Date.now() / 1000 + 15; // Refresh duration
                this.logAbilityUsage(casterEntity, `Target marked ${existingMark.stacks} times!`);
            } else {
                // Just refresh duration if at max stacks
                existingMark.endTime = Date.now() / 1000 + 15;
                this.logAbilityUsage(casterEntity, "Mark refreshed (max stacks reached)!");
            }
        } else {
            // Apply new tracking mark
            this.game.addComponent(target, this.game.componentManager.getComponentTypes().BUFF, 
                Components.Buff('marked', { 
                    damageTakenMultiplier: 1 + this.markDamageIncrease,
                    revealed: true,
                    markedBy: casterEntity
                }, Date.now() / 1000 + 15, true, 1, 0));
            
            this.logAbilityUsage(casterEntity, "Ranger marks their prey for the hunt!");
        }
    }
}