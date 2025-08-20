class ChainLightningAbility extends engine.app.appClasses['BaseAbility'] {
    constructor(game, params = {}) {
        super(game, {
            id: 'chain_lightning',
            name: 'Chain Lightning',
            description: 'Lightning that jumps between multiple enemies',
            cooldown: 8.0,
            range: 150,
            manaCost: 40,
            targetType: 'auto',
            animation: 'cast',
            priority: 7,
            castTime: 1.5,
            autoTrigger: 'multiple_enemies',
            ...params
        });
        
        this.initialDamage = 60;
        this.maxJumps = 5;
        this.jumpRange = 70;
        this.damageReduction = 0.8;
        this.element = 'lightning';
    }
    
    canExecute(casterEntity) {
        const enemies = this.getEnemiesInRange(casterEntity);
        return enemies.length >= 2;
    }
    
    execute(casterEntity) {
        const enemies = this.getEnemiesInRange(casterEntity);
        if (enemies.length === 0) return;
        
        // Start with closest enemy
        const startTarget = this.findClosestEnemy(casterEntity, enemies);
        if (!startTarget) return;
        
        this.chainLightning(casterEntity, startTarget, enemies, this.maxJumps, this.initialDamage);
        
        this.logAbilityUsage(casterEntity, 
            `Chain lightning crackles through enemy ranks!`);
    }
    
    findClosestEnemy(casterEntity, enemies) {
        const casterPos = this.game.getComponent(casterEntity, this.componentTypes.POSITION);
        if (!casterPos) return null;
        
        let closest = null;
        let closestDistance = Infinity;
        
        enemies.forEach(enemyId => {
            const enemyPos = this.game.getComponent(enemyId, this.componentTypes.POSITION);
            if (!enemyPos) return;
            
            const distance = Math.sqrt(
                Math.pow(enemyPos.x - casterPos.x, 2) + 
                Math.pow(enemyPos.z - casterPos.z, 2)
            );
            
            if (distance < closestDistance) {
                closestDistance = distance;
                closest = enemyId;
            }
        });
        
        return closest;
    }
    
    chainLightning(sourceId, currentTarget, availableTargets, remainingJumps, damage) {
        if (remainingJumps <= 0 || !currentTarget) return;
        
        // Apply damage to current target
        if (this.game.damageSystem) {
            this.game.damageSystem.applyDamage(sourceId, currentTarget, Math.floor(damage), this.element, {
                isSpell: true,
                isChainLightning: true
            });
        }
        
        // Create lightning effect
        const targetPos = this.game.getComponent(currentTarget, this.componentTypes.POSITION);
        if (targetPos) {
            this.createVisualEffect(targetPos, 'lightning_strike');
        }
        
        // Find next target
        const nextTarget = this.findNextChainTarget(currentTarget, availableTargets);
        if (nextTarget) {
            setTimeout(() => {
                this.chainLightning(sourceId, nextTarget, availableTargets, 
                    remainingJumps - 1, damage * this.damageReduction);
            }, 200); // Small delay for visual effect
        }
    }
    
    findNextChainTarget(fromTarget, availableTargets) {
        const fromPos = this.game.getComponent(fromTarget, this.componentTypes.POSITION);
        if (!fromPos) return null;
        
        let closest = null;
        let closestDistance = Infinity;
        
        availableTargets.forEach(targetId => {
            if (targetId === fromTarget) return;
            
            const targetPos = this.game.getComponent(targetId, this.componentTypes.POSITION);
            if (!targetPos) return;
            
            const distance = Math.sqrt(
                Math.pow(targetPos.x - fromPos.x, 2) + 
                Math.pow(targetPos.z - fromPos.z, 2)
            );
            
            if (distance <= this.jumpRange && distance < closestDistance) {
                closestDistance = distance;
                closest = targetId;
            }
        });
        
        return closest;
    }
}