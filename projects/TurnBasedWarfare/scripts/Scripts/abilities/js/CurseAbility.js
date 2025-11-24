class CurseAbility extends GUTS.BaseAbility {
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
        
        // DESYNC SAFE: Get and sort enemies deterministically
        const enemies = this.getEnemiesInRange(casterEntity);
        if (enemies.length === 0) return;
        
        // Immediate cast effect
        this.createVisualEffect(casterPos, 'cast');
        this.logAbilityUsage(casterEntity, `Dark magic weakens the enemy forces!`);
        
        this.game.schedulingSystem.scheduleAction(() => {
            this.applyCurses(casterEntity, enemies);
        }, this.castTime, casterEntity);
    }
    
    applyCurses(casterEntity, enemies) {
        const casterPos = this.game.getComponent(casterEntity, this.componentTypes.POSITION);
        if (!casterPos) return;
        
        // DESYNC SAFE: Sort enemies for consistent processing order
        const sortedEnemies = enemies.slice().sort((a, b) => String(a).localeCompare(String(b)));
        
        const cursedEnemies = [];
        
        sortedEnemies.forEach(enemyId => {
            const enemyPos = this.game.getComponent(enemyId, this.componentTypes.POSITION);
            const enemyCombat = this.game.getComponent(enemyId, this.componentTypes.COMBAT);
            const enemyHealth = this.game.getComponent(enemyId, this.componentTypes.HEALTH);
            
            if (!enemyPos || !enemyCombat || !enemyHealth || enemyHealth.current <= 0) return;
            
            // Check if enemy is in curse radius
            const distance = Math.sqrt(
                Math.pow(enemyPos.x - casterPos.x, 2) + 
                Math.pow(enemyPos.z - casterPos.z, 2)
            );
            
            if (distance <= this.curseRadius) {
                // Apply curse effect visually
                this.createVisualEffect(enemyPos, 'curse');
                
                // DESYNC SAFE: Use buff system instead of directly modifying stats
                const Components = this.game.gameManager.call('getComponents');
                this.game.addComponent(enemyId, this.componentTypes.BUFF, 
                    Components.Buff('curse', { 
                        damageMultiplier: this.damageReduction,
                        damageTakenMultiplier: this.vulnerabilityIncrease,
                        isCursed: true
                    }, this.game.state.now + this.duration, false, 1, this.game.state.now));
                
                // Create dark aura effect (client only)
                if (!this.game.isServer && this.game.effectsSystem) {
                    this.game.effectsSystem.createAuraEffect(
                        enemyPos.x, enemyPos.y, enemyPos.z,
                        'magic',
                        this.duration * 1000
                    );
                }
                
                cursedEnemies.push({
                    id: enemyId,
                    originalDamage: enemyCombat.damage,
                    position: enemyPos
                });
                
                // DESYNC SAFE: Schedule curse removal using scheduling system
                this.game.schedulingSystem.scheduleAction(() => {
                    this.removeCurse(enemyId);
                }, this.duration, enemyId);
            }
        });
        
      
    }
    
    // DESYNC SAFE: Remove curse effect
    removeCurse(enemyId) {
        // Check if enemy still exists and has the curse buff
        if (this.game.hasComponent(enemyId, this.componentTypes.BUFF)) {
            const buff = this.game.getComponent(enemyId, this.componentTypes.BUFF);
            if (buff && buff.buffType === 'curse') {
                this.game.removeComponent(enemyId, this.componentTypes.BUFF);
                
                // Visual effect when curse expires
                const enemyPos = this.game.getComponent(enemyId, this.componentTypes.POSITION);
                if (enemyPos) {
                    this.createVisualEffect(enemyPos, 'curse', { 
                        count: 1, 
                        scaleMultiplier: 0.8,
                        color: 0x808080 
                    });
                }
                
            
            }
        }
    }
}