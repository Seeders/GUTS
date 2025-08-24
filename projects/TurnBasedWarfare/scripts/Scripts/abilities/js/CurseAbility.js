class CurseAbility extends engine.app.appClasses['BaseAbility'] {
    constructor(game, params = {}) {
        super(game, {
            id: 'curse',
            name: 'Curse',
            description: 'Curses enemies, reducing their damage and making them vulnerable',
            cooldown: 7.0,
            range: 180,
            manaCost: 50,
            targetType: 'auto',
            animation: 'cast',
            priority: 5,
            castTime: 1.5,
            autoTrigger: 'strong_enemies',
            ...params
        });
        
        this.curseRadius = 100;
        this.damageReduction = 0.5; // Reduce enemy damage by 50%
        this.vulnerabilityIncrease = 1.3; // 30% more damage taken
        this.duration = 20.0;
    }
    
    defineEffects() {
        return {
            cast: {
                type: 'magic',
                options: {
                    count: 3,
                    color: 0x2F4F4F,
                    colorRange: { start: 0x2F4F4F, end: 0x000000 },
                    scaleMultiplier: 1.5,
                    speedMultiplier: 0.8
                }
            },
            curse: {
                type: 'magic',
                options: {
                    count: 2,
                    color: 0x696969,
                    scaleMultiplier: 2.0,
                    speedMultiplier: 0.5
                }
            }
        };
    }
    
    canExecute(casterEntity) {
        const enemies = this.getEnemiesInRange(casterEntity);
        return enemies.length >= 2;
    }
    
    execute(casterEntity) {
        const casterPos = this.game.getComponent(casterEntity, this.componentTypes.POSITION);
        if (!casterPos) return;
        
        const enemies = this.getEnemiesInRange(casterEntity);
        if (enemies.length === 0) return;
        
        // Cast effect
        this.createVisualEffect(casterPos, 'cast');
        
        // Apply curses
        setTimeout(() => {
            this.applyCurses(casterEntity, enemies);
        }, this.castTime * 1000);
        
        this.logAbilityUsage(casterEntity, `Dark magic weakens the enemy forces!`);
    }
    
    applyCurses(casterEntity, enemies) {
        const casterPos = this.game.getComponent(casterEntity, this.componentTypes.POSITION);
        if (!casterPos) return;
        
        enemies.forEach(enemyId => {
            const enemyPos = this.game.getComponent(enemyId, this.componentTypes.POSITION);
            const enemyCombat = this.game.getComponent(enemyId, this.componentTypes.COMBAT);
            
            if (!enemyPos || !enemyCombat) return;
            
            // Check if enemy is in curse radius
            const distance = Math.sqrt(
                Math.pow(enemyPos.x - casterPos.x, 2) + 
                Math.pow(enemyPos.z - casterPos.z, 2)
            );
            
            if (distance <= this.curseRadius) {
                // Apply curse effect
                this.createVisualEffect(enemyPos, 'curse');
                
                // Reduce enemy damage
                const originalDamage = enemyCombat.damage;
                enemyCombat.damage = Math.floor(enemyCombat.damage * this.damageReduction);
                
                // Create dark aura effect
                if (this.game.effectsSystem) {
                    this.game.effectsSystem.createAuraEffect(
                        enemyPos.x, enemyPos.y, enemyPos.z,
                        'magic',
                        this.duration * 1000
                    );
                }
                
                // Remove curse after duration
                setTimeout(() => {
                    if (this.game.getComponent(enemyId, this.componentTypes.COMBAT)) {
                        enemyCombat.damage = originalDamage;
                    }
                }, this.duration * 1000);
            }
        });
    }
}
