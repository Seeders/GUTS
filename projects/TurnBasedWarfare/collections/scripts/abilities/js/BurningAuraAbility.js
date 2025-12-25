class BurningAuraAbility extends GUTS.BaseAbility {
    constructor(game, abilityData = {}) {
        super(game, {
            name: 'Burning Aura',
            description: 'Emanate heat that burns nearby enemies',
            cooldown: 0,
            range: 100,
            manaCost: 0,
            targetType: 'area',
            animation: 'cast',
            priority: 6,
            castTime: 0,
            passive: true,
            ...abilityData
        });
        this.drainPerSecond = 8;
        this.cycleDuration = 12.0; // Duration of each cycle
        this.tickInterval = 1.0; // 1 second between ticks
        this.hasActiveAura = false;
        this.assignedCaster = null;
    }

    // Called when ability is assigned to a unit - auto-start the passive aura
    onAssign(casterEntity) {
        this.assignedCaster = casterEntity;
        this.startAuraCycle(casterEntity);
    }

    // Start or restart the perpetual aura cycle
    startAuraCycle(casterEntity) {
        if (this.hasActiveAura) return;

        const casterHealth = this.game.getComponent(casterEntity, "health");
        if (!casterHealth || casterHealth.current <= 0) return;

        this.hasActiveAura = true;

        const totalTicks = Math.floor(this.cycleDuration / this.tickInterval);

        for (let tickIndex = 0; tickIndex < totalTicks; tickIndex++) {
            const tickDelay = this.tickInterval * tickIndex;

            this.game.schedulingSystem.scheduleAction(() => {
                this.executeAuraTick(casterEntity, tickIndex, totalTicks);
            }, tickDelay, casterEntity);
        }

        // Schedule cycle restart for perpetual effect
        this.game.schedulingSystem.scheduleAction(() => {
            this.hasActiveAura = false;
            this.startAuraCycle(casterEntity);
        }, this.cycleDuration, casterEntity);
    }

    canExecute(casterEntity) {
        // Passive ability - cannot be manually executed
        return false;
    }

    execute(casterEntity) {
        // Passive ability - starts automatically via onAssign
        // This method kept for compatibility but redirects to cycle start
        this.startAuraCycle(casterEntity);
    }
    
    // DESYNC SAFE: Execute a single aura tick deterministically
    executeAuraTick(casterEntity, tickIndex, totalTicks) {
        // Check if caster is still alive
        const casterHealth = this.game.getComponent(casterEntity, "health");
        const transform = this.game.getComponent(casterEntity, "transform");
        const casterPos = transform?.position;

        if (!casterHealth || casterHealth.current <= 0 || !casterPos) {
            // Caster is dead, end the aura early
            this.hasActiveAura = false;
            return;
        }
        
        // DESYNC SAFE: Get enemies and allies deterministically
        const enemies = this.getEnemiesInRange(casterEntity);
        
        // Sort for consistent processing order
        const sortedEnemies = enemies.slice().sort((a, b) => a - b);
        
        // Process enemies - burn their health
        sortedEnemies.forEach(enemyId => {
            const transform = this.game.getComponent(enemyId, "transform");
            const enemyPos = transform?.position;
            const enemyHealth = this.game.getComponent(enemyId, "health");
            
            if (!enemyPos || !enemyHealth || enemyHealth.current <= 0) return;
            
            const distance = Math.sqrt(
                Math.pow(enemyPos.x - casterPos.x, 2) + 
                Math.pow(enemyPos.z - casterPos.z, 2)
            );
            
            if (distance <= this.range) {
                // Apply burn damage
                this.dealDamageWithEffects(casterEntity, enemyId, this.drainPerSecond, this.enums.element.fire, {
                    tickIndex: tickIndex
                });

                // Visual tick effect on enemy
                this.playConfiguredEffects('tick', enemyPos);
            }
        });

        // Aura pulse effect every few ticks
        if (tickIndex % 3 === 0) {
            this.playConfiguredEffects('aura', casterPos);
        }
    }
}
