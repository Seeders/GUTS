class ShadowStrikeAbility extends engine.app.appClasses['BaseAbility'] {
    constructor(game, params = {}) {
        super(game, {
            id: 'shadow_strike',
            name: 'Shadow Strike',
            description: 'Teleport behind an enemy and deal critical damage',
            cooldown: 9.0,
            range: 120,
            manaCost: 30,
            targetType: 'enemy',
            animation: 'attack',
            priority: 8,
            castTime: 0.5,
            ...params
        });
        this.backstabDamage = 65;
    }
    
    execute(casterEntity) {
        const pos = this.game.getComponent(casterEntity, this.componentTypes.POSITION);
        const enemies = this.getEnemiesInRange(casterEntity);
        if (!pos || enemies.length === 0) return;
        
        const target = enemies[0];
        const targetPos = this.game.getComponent(target, this.componentTypes.POSITION);
        if (!targetPos) return;
        
        // Teleport behind target
        const newPos = {
            x: targetPos.x - 25,
            y: targetPos.y,
            z: targetPos.z - 25
        };
        
        pos.x = newPos.x;
        pos.z = newPos.z;
        
        // Deal critical backstab damage
        this.dealDamageWithEffects(casterEntity, target, this.backstabDamage, 'physical', {
            isCritical: true,
            criticalMultiplier: 2.0
        });
        
        this.logAbilityUsage(casterEntity, "Rogue strikes from the shadows!");
    }
}