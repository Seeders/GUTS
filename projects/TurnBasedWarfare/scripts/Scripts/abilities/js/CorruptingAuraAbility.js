class CorruptingAuraAbility extends engine.app.appClasses['BaseAbility'] {
    constructor(game, params = {}) {
        super(game, {
            id: 'corrupting_aura',
            name: 'Corrupting Aura',
            description: 'Emanate dark energy that drains enemies and empowers undead (does not stack)',
            cooldown: 18.0,
            range: 100,
            manaCost: 40,
            targetType: 'area',
            animation: 'cast',
            priority: 6,
            castTime: 1.0,
            ...params
        });
        this.drainPerSecond = 8;
        this.duration = 12;
    }
    
    canExecute(casterEntity) {
        // Check if this Oathbreaker already has an active aura
        const existingAuras = this.game.getEntitiesWith(
            this.game.componentManager.getComponentTypes().TEMPORARY_EFFECT,
            this.game.componentManager.getComponentTypes().POSITION
        );
        
        const hasActiveAura = existingAuras.some(auraId => {
            const tempEffect = this.game.getComponent(auraId, this.game.componentManager.getComponentTypes().TEMPORARY_EFFECT);
            return tempEffect && 
                   tempEffect.effectType === 'corrupting_aura' && 
                   tempEffect.data.caster === casterEntity;
        });
        
        return !hasActiveAura;
    }
    
    execute(casterEntity) {
        const pos = this.game.getComponent(casterEntity, this.componentTypes.POSITION);
        if (!pos) return;
        
        this.createVisualEffect(pos, 'cast');
        
        // Create aura effect that persists
        const auraId = this.game.createEntity();
        const Components = this.game.componentManager.getComponents();
        
        this.game.addComponent(auraId, this.game.componentManager.getComponentTypes().POSITION, 
            Components.Position(pos.x, pos.y, pos.z));
        this.game.addComponent(auraId, this.game.componentManager.getComponentTypes().TEMPORARY_EFFECT, 
            Components.TemporaryEffect('corrupting_aura', {
                caster: casterEntity,
                drainRate: this.drainPerSecond,
                range: this.range,
                tickInterval: 1.0
            }, 0));
        
        // Set up periodic damage/healing
        let tickCount = 0;
        const maxTicks = this.duration;
        
        const auraInterval = setInterval(() => {
            tickCount++;
            
            if (tickCount >= maxTicks || !this.game.hasComponent(auraId, this.game.componentManager.getComponentTypes().TEMPORARY_EFFECT)) {
                clearInterval(auraInterval);
                if (this.game.hasComponent(auraId, this.game.componentManager.getComponentTypes().TEMPORARY_EFFECT)) {
                    this.game.destroyEntity(auraId);
                }
                return;
            }
            
            const enemies = this.getEnemiesInRange(casterEntity);
            const allies = this.getAlliesInRange(casterEntity);
            
            enemies.forEach(enemyId => {
                const enemyPos = this.game.getComponent(enemyId, this.componentTypes.POSITION);
                if (!enemyPos) return;
                
                const distance = Math.sqrt(
                    Math.pow(enemyPos.x - pos.x, 2) + 
                    Math.pow(enemyPos.z - pos.z, 2)
                );
                
                if (distance <= this.range) {
                    this.dealDamageWithEffects(casterEntity, enemyId, this.drainPerSecond, 'divine');
                    this.createVisualEffect(enemyPos, 'corruption', { heightOffset: 10 });
                }
            });
            
            // Empower undead allies
            allies.forEach(allyId => {
                const unitType = this.game.getComponent(allyId, this.componentTypes.UNIT_TYPE);
                if (unitType && (unitType.id === 'skeleton' || unitType.type.includes('undead'))) {
                    const existingBuff = this.game.getComponent(allyId, this.game.componentManager.getComponentTypes().BUFF);
                    if (!existingBuff || existingBuff.buffType !== 'dark_empowerment') {
                        const Components = this.game.componentManager.getComponents();
                        this.game.addComponent(allyId, this.game.componentManager.getComponentTypes().BUFF, 
                            Components.Buff('dark_empowerment', { 
                                damageMultiplier: 1.3,
                                attackSpeedMultiplier: 1.2
                            }, Date.now() / 1000 + 3, false, 1, 0));
                    }
                }
            });
        }, 1000);
        
        this.logAbilityUsage(casterEntity, "Oathbreaker spreads corrupting darkness!");
    }
}