class CurseAbility extends GUTS.BaseAbility {
    constructor(game, abilityData = {}) {
        super(game, abilityData);

        this.curseRadius           = abilityData.curseRadius           ?? 100;
        this.damageReduction       = abilityData.damageReduction       ?? 0.5;
        this.vulnerabilityIncrease = abilityData.vulnerabilityIncrease ?? 1.3;
        this.duration              = abilityData.duration              ?? 20.0;
    }

    canExecute(casterEntity) {
        const enemies = this.getEnemiesInRange(casterEntity);
        return enemies.length >= 1;
    }
    
    execute(casterEntity) {
        const transform = this.game.getComponent(casterEntity, "transform");
        const casterPos = transform?.position;
        if (!casterPos) return;
        
        // DESYNC SAFE: Get and sort enemies deterministically
        const enemies = this.getEnemiesInRange(casterEntity);
        if (enemies.length === 0) return;
        
        // Immediate cast effect
        this.playConfiguredEffects('cast', casterPos);
        this.logAbilityUsage(casterEntity, `Dark magic weakens the enemy forces!`);
        
        this.game.schedulingSystem.scheduleAction(() => {
            this.applyCurses(casterEntity, enemies);
        }, 0, casterEntity); // payload at execute — queue already waited to the release point
    }
    
    applyCurses(casterEntity, enemies) {
        const transform = this.game.getComponent(casterEntity, "transform");
        const casterPos = transform?.position;
        if (!casterPos) return;
        
        // DESYNC SAFE: Sort enemies for consistent processing order
        const sortedEnemies = enemies.slice().sort((a, b) => a - b);
        
        const cursedEnemies = [];
        
        sortedEnemies.forEach(enemyId => {
            const transform = this.game.getComponent(enemyId, "transform");
            const enemyPos = transform?.position;
            const enemyCombat = this.game.getComponent(enemyId, "combat");
            const enemyHealth = this.game.getComponent(enemyId, "health");

            if (!enemyPos || !enemyCombat || !enemyHealth || enemyHealth.current <= 0) return;
            
            // Check if enemy is in curse radius
            const distance = Math.sqrt(
                Math.pow(enemyPos.x - casterPos.x, 2) + 
                Math.pow(enemyPos.z - casterPos.z, 2)
            );
            
            if (distance <= this.curseRadius) {
                // Apply curse effect visually
                this.playConfiguredEffects('debuff', enemyPos);

                // DESYNC SAFE: Use buff system instead of directly modifying stats
                const enums = this.game.getEnums();
                this.applyBuff(enemyId, {
                    buffType: enums.buffTypes.curse,
                    endTime: this.game.state.now + this.duration,
                    appliedTime: this.game.state.now,
                    stacks: 1,
                    sourceEntity: casterEntity
                });
                
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
        const enums = this.game.getEnums();
        const buff = this.getBuff(enemyId, enums.buffTypes.curse);
        if (!buff) return;
        // Refreshed since this schedule was armed — the later expiry (or the
        // central reaper) owns removal now.
        if (buff.endTime - (this.game.state.now || 0) > 0.1) return;
        this.removeBuff(enemyId, enums.buffTypes.curse);

        // Visual effect when curse expires
        const transform = this.game.getComponent(enemyId, "transform");
        const enemyPos = transform?.position;
        if (enemyPos) {
            this.playConfiguredEffects('expiration', enemyPos);
        }
    }
}
