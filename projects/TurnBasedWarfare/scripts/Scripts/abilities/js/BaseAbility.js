class BaseAbility {
    constructor(game, config = {}) {
        this.game = game;
        this.id = config.id || 'unknown';
        this.name = config.name || 'Unknown Ability';
        this.description = config.description || '';
        this.cooldown = config.cooldown || 10.0;
        this.range = config.range || 100;
        this.manaCost = config.manaCost || 0;
        this.targetType = config.targetType || 'auto';
        this.animation = config.animation || 'cast';
        this.priority = config.priority || 5;
        this.castTime = config.castTime || 1.5;
        this.autoTrigger = config.autoTrigger || 'combat';
        this.componentTypes = this.game.componentManager.getComponentTypes();
        
        this.effects = this.defineEffects();
    }
    
    defineEffects() {
        return {
            cast: { type: 'magic', options: { count: 15, scaleMultiplier: 0.8, speedMultiplier: 0.6 } },
            impact: { type: 'magic', options: { count: 10, scaleMultiplier: 1.2 } }
        };
    }
    
    createVisualEffect(position, effectName = 'cast', customOptions = {}) {
        if (!this.game.effectsSystem) return;
        
        const effectDef = this.effects[effectName];
        if (effectDef) {
            const mergedOptions = { ...effectDef.options, ...customOptions, heightOffset: customOptions.heightOffset || 0 };
            this.game.effectsSystem.createParticleEffect(position.x, position.y + mergedOptions.heightOffset, position.z, effectDef.type, mergedOptions);
        } else {
            this.game.effectsSystem.createParticleEffect(position.x, position.y + customOptions.heightOffset || 0, position.z, 'magic', customOptions);
        }
    }
    
    logAbilityUsage(casterEntity, message = null, showScreenEffect = false) {
      
    }
    
    dealDamageWithEffects(sourceId, targetId, damage, element = 'physical', options = {}) {
        if (this.game.damageSystem) {
            const result = this.game.damageSystem.applyDamage(sourceId, targetId, damage, element, { isSpell: true, ...options });
            
            const targetPos = this.game.getComponent(targetId, this.componentTypes.POSITION);
            if (targetPos && this.game.effectsSystem) {
                const effectType = result.isCritical ? 'critical' : 'damage';
                if (this.game.effectsSystem.showDamageNumber) {
                    this.game.effectsSystem.showDamageNumber(targetPos.x, targetPos.y + 15, targetPos.z, result.damage, effectType);
                }
                this.createVisualEffect(targetPos, 'impact');
            }
            
            return result;
        }
        return null;
    }
    
    // FIXED: Entities already sorted from getEntitiesWith()
    getEnemiesInRange(casterEntity, range = null) {
        const effectiveRange = range || this.range;
        const casterPos = this.game.getComponent(casterEntity, this.componentTypes.POSITION);
        const casterTeam = this.game.getComponent(casterEntity, this.componentTypes.TEAM);
        
        if (!casterPos || !casterTeam) return [];
        
        return this.game.getEntitiesWith(this.componentTypes.POSITION, this.componentTypes.TEAM, this.componentTypes.HEALTH)
            .filter(entityId => {
                if (entityId === casterEntity) return false;
                
                const pos = this.game.getComponent(entityId, this.componentTypes.POSITION);
                const team = this.game.getComponent(entityId, this.componentTypes.TEAM);
                const health = this.game.getComponent(entityId, this.componentTypes.HEALTH);
                
                if (!pos || !team || !health || health.current <= 0) return false;
                if (team.team === casterTeam.team) return false;
                
                const distance = Math.sqrt(Math.pow(pos.x - casterPos.x, 2) + Math.pow(pos.z - casterPos.z, 2));
                return distance <= effectiveRange;
            });
    }
    
    // FIXED: Entities already sorted from getEntitiesWith()
    getAlliesInRange(casterEntity, range = null) {
        const effectiveRange = range || this.range;
        const casterPos = this.game.getComponent(casterEntity, this.componentTypes.POSITION);
        const casterTeam = this.game.getComponent(casterEntity, this.componentTypes.TEAM);
        
        if (!casterPos || !casterTeam) return [];
        
        return this.game.getEntitiesWith(this.componentTypes.POSITION, this.componentTypes.TEAM, this.componentTypes.HEALTH)
            .filter(entityId => {
                const pos = this.game.getComponent(entityId, this.componentTypes.POSITION);
                const team = this.game.getComponent(entityId, this.componentTypes.TEAM);
                const health = this.game.getComponent(entityId, this.componentTypes.HEALTH);
                
                if (!pos || !team || !health || health.current <= 0) return false;
                if (team.team !== casterTeam.team) return false;
                
                const distance = Math.sqrt(Math.pow(pos.x - casterPos.x, 2) + Math.pow(pos.z - casterPos.z, 2));
                return distance <= effectiveRange;
            });
    }
    
    // FIXED: Entities already sorted, remove redundant sorting
    findBestClusterPosition(entities, minCluster = 2) {
        if (entities.length < minCluster) return null;
        
        let bestPos = null;
        let bestScore = 0;
        
        entities.forEach(entityId => {
            const pos = this.game.getComponent(entityId, this.componentTypes.POSITION);
            if (!pos) return;
            
            let nearbyCount = 0;
            entities.forEach(otherId => {
                if (otherId === entityId) return;
                const otherPos = this.game.getComponent(otherId, this.componentTypes.POSITION);
                if (!otherPos) return;
                
                const distance = Math.sqrt(Math.pow(pos.x - otherPos.x, 2) + Math.pow(pos.z - otherPos.z, 2));
                if (distance <= 80) nearbyCount++;
            });
            
            // Use >= for consistent tie-breaking (first in sorted order wins)
            if (nearbyCount >= minCluster - 1 && nearbyCount >= bestScore) {
                bestScore = nearbyCount;
                bestPos = { x: pos.x, y: pos.y, z: pos.z };
            }
        });
        
        return bestPos;
    }
    onBattleEnd() {
    }
    canExecute(casterEntity) { return true; }
    execute(casterEntity, targetData = null) { console.log(`${this.name} executed by entity ${casterEntity}`); }
}