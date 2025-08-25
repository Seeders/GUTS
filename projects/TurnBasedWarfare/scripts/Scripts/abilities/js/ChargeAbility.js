class ChargeAbility extends engine.app.appClasses['BaseAbility'] {
    constructor(game, params = {}) {
        super(game, {
            id: 'charge',
            name: 'Charge',
            description: 'Rush forward dealing damage and stunning enemies',
            cooldown: 5.0,
            range: 150,
            manaCost: 0,
            targetType: 'enemy',
            animation: 'attack',
            priority: 8,
            castTime: 0.5,
            ...params
        });
        this.chargeDamage = 55;
    }
    
    execute(casterEntity) {
        const pos = this.game.getComponent(casterEntity, this.componentTypes.POSITION);
        if (!pos) return;
        
        const enemies = this.getEnemiesInRange(casterEntity);
        if (enemies.length === 0) return;
        
        const target = enemies[0]; // Charge at closest enemy
        const targetPos = this.game.getComponent(target, this.componentTypes.POSITION);
        if (!targetPos) return;
        
        // Move knight towards target (simplified)
        const velocity = this.game.getComponent(casterEntity, this.componentTypes.VELOCITY);
        if (velocity) {
            const dx = targetPos.x - pos.x;
            const dz = targetPos.z - pos.z;
            const distance = Math.sqrt(dx * dx + dz * dz);
            
            velocity.vx = (dx / distance) * 300; // Charge speed
            velocity.vz = (dz / distance) * 300;
        }
        
        // Deal damage and stun after charge
        setTimeout(() => {
            this.dealDamageWithEffects(casterEntity, target, this.chargeDamage, 'physical');
            
            const Components = this.game.componentManager.getComponents();
            this.game.addComponent(target, this.game.componentManager.getComponentTypes().BUFF, 
                Components.Buff('stunned', { movementDisabled: true, attackDisabled: true }, 0, false, 1, 0));
        }, 800);
        
        this.logAbilityUsage(casterEntity, "Knight charges into battle!", true);
    }
}