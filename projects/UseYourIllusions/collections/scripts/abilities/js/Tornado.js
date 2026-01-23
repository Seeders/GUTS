class Tornado extends GUTS.BaseAbility {
    static serviceDependencies = [
        ...GUTS.BaseAbility.serviceDependencies,
        'playEffectSystem',
        'playEffect'
    ];

    constructor(game, abilityData = {}) {
        super(game, {
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
            ...abilityData
        });
        
        this.curseRadius = 100;
        this.damageReduction = 0.5; // Reduce enemy damage by 50%
        this.vulnerabilityIncrease = 1.3; // 30% more damage taken
        this.duration = 20.0;
    }
    
    canExecute(casterEntity) {
        const enemies = this.getEnemiesInRange(casterEntity);
        return enemies.length >= 2;
    }
    
    execute(casterEntity) {
        const transform = this.game.getComponent(casterEntity, "transform");
        const casterPos = transform?.position;
        if (!casterPos) return;
        
        const enemies = this.getEnemiesInRange(casterEntity);
        if (enemies.length === 0) return;
        
        // Cast effect
        this.playConfiguredEffects('cast', casterPos);
        
        this.game.schedulingSystem.scheduleAction(() => {
            this.applyCurses(casterEntity, enemies);
        }, this.castTime, casterEntity);
    }
    
    applyCurses(casterEntity, enemies) {
        const transform = this.game.getComponent(casterEntity, "transform");
        const casterPos = transform?.position;
        if (!casterPos) return;
        
        enemies.forEach(enemyId => {
            const transform = this.game.getComponent(enemyId, "transform");
            const enemyPos = transform?.position;
            const enemyCombat = this.game.getComponent(enemyId, "combat");
            
            if (!enemyPos || !enemyCombat) return;
            
            // Check if enemy is in curse radius
            const distance = Math.sqrt(
                Math.pow(enemyPos.x - casterPos.x, 2) + 
                Math.pow(enemyPos.z - casterPos.z, 2)
            );
            
            if (distance <= this.curseRadius) {
                // Apply curse effect
                this.playConfiguredEffects('debuff', enemyPos);

                // Enhanced dark curse visual using preset effects
                if (!this.game.isServer) {
                    // Dark energy swirl around target using preset effect
                    this.call.playEffectSystem( 'curse_apply',
                        new THREE.Vector3(enemyPos.x, enemyPos.y + 30, enemyPos.z));

                    // Curse symbols rising using preset effect
                    this.call.playEffect( 'curse_symbols',
                        new THREE.Vector3(enemyPos.x, enemyPos.y + 5, enemyPos.z));
                }

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

                this.game.schedulingSystem.scheduleAction(() => {
                    if (this.game.getComponent(enemyId, "combat")) {
                        enemyCombat.damage = originalDamage;
                    }
                }, this.duration, enemyId);
            }
        });
    }
}
