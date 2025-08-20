class FireballAbility extends engine.app.appClasses['BaseAbility'] {
    constructor(game, params = {}) {
        super(game, {
            id: 'fireBall',
            name: 'Fire Ball',
            description: 'Launch a fiery projectile that explodes on impact',
            cooldown: 5.0,
            range: 150,
            manaCost: 30,
            targetType: 'enemy',
            animation: 'cast',
            priority: 6,
            castTime: 1.5,
            ...params
        });
        
        this.damage = 60;
        this.splashRadius = 80;
        this.element = 'fire';
    }
    
    canExecute(casterEntity) {
        const enemies = this.getValidTargets(casterEntity, 'enemy');
        return enemies.length > 0;
    }
    
    execute(casterEntity, targetData = null) {
        if (!this.game.projectileSystem) return;
        
        const enemies = this.getValidTargets(casterEntity, 'enemy');
        if (enemies.length === 0) return;
        
        // Target the closest enemy
        const casterPos = this.game.getComponent(casterEntity, this.game.componentManager.getComponentTypes().POSITION);
        let closestEnemy = null;
        let closestDistance = Infinity;
        
        enemies.forEach(enemyId => {
            const enemyPos = this.game.getComponent(enemyId, this.game.componentManager.getComponentTypes().POSITION);
            if (!enemyPos) return;
            
            const distance = Math.sqrt(
                Math.pow(enemyPos.x - casterPos.x, 2) + 
                Math.pow(enemyPos.z - casterPos.z, 2)
            );
            
            if (distance < closestDistance) {
                closestDistance = distance;
                closestEnemy = enemyId;
            }
        });
        
        if (!closestEnemy) return;
        
        // Create fireball projectile
        const projectileData = {
            id: 'fireball',
            title: 'Fireball',
            damage: this.damage,
            speed: 80,
            element: this.element,
            ballistic: true,
            splashRadius: this.splashRadius,
            homing: true,
            homingStrength: 0.3
        };
        
        this.game.projectileSystem.fireProjectile(casterEntity, closestEnemy, projectileData);
        
        this.logAbilityUsage(casterEntity, 
            `Fireball launched at enemy target!`);
    }
}