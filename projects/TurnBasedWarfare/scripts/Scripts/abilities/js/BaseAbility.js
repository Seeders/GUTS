class BaseAbility {
    constructor(game, config = {}) {
        this.game = game;
        this.id = config.id || 'unknown';
        this.name = config.name || 'Unknown Ability';
        this.description = config.description || '';
        this.cooldown = config.cooldown || 10.0;
        this.range = config.range || 100;
        this.manaCost = config.manaCost || 0;
        this.targetType = config.targetType || 'auto'; // auto, passive, aura
        this.animation = config.animation || 'cast';
        this.priority = config.priority || 5;
        this.castTime = config.castTime || 1.5;
        this.autoTrigger = config.autoTrigger || 'combat'; // combat, low_health, enemy_count, etc.
        this.componentTypes = this.game.componentManager.getComponentTypes();
    }
    
    // Override these methods in subclasses
    canExecute(casterEntity) {
        return true;
    }
    
    execute(casterEntity, targetData = null) {
        console.log(`${this.name} executed by entity ${casterEntity}`);
    }
    
    // Helper methods for autobattle mechanics
    getEnemiesInRange(casterEntity, range = null) {
        const effectiveRange = range || this.range;
        const casterPos = this.game.getComponent(casterEntity, this.componentTypes.POSITION);
        const casterTeam = this.game.getComponent(casterEntity, this.componentTypes.TEAM);
        
        if (!casterPos || !casterTeam) return [];
        
        return this.game.getEntitiesWith(
            this.componentTypes.POSITION,
            this.componentTypes.TEAM,
            this.componentTypes.HEALTH
        ).filter(entityId => {
            if (entityId === casterEntity) return false;
            
            const pos = this.game.getComponent(entityId, this.componentTypes.POSITION);
            const team = this.game.getComponent(entityId, this.componentTypes.TEAM);
            const health = this.game.getComponent(entityId, this.componentTypes.HEALTH);
            
            if (!pos || !team || !health || health.current <= 0) return false;
            if (team.team === casterTeam.team) return false;
            
            const distance = Math.sqrt(
                Math.pow(pos.x - casterPos.x, 2) + 
                Math.pow(pos.z - casterPos.z, 2)
            );
            
            return distance <= effectiveRange;
        });
    }
    
    getAlliesInRange(casterEntity, range = null) {
        const effectiveRange = range || this.range;
        const casterPos = this.game.getComponent(casterEntity, this.componentTypes.POSITION);
        const casterTeam = this.game.getComponent(casterEntity, this.componentTypes.TEAM);
        
        if (!casterPos || !casterTeam) return [];
        
        return this.game.getEntitiesWith(
            this.componentTypes.POSITION,
            this.componentTypes.TEAM,
            this.componentTypes.HEALTH
        ).filter(entityId => {
            const pos = this.game.getComponent(entityId, this.componentTypes.POSITION);
            const team = this.game.getComponent(entityId, this.componentTypes.TEAM);
            const health = this.game.getComponent(entityId, this.componentTypes.HEALTH);
            
            if (!pos || !team || !health || health.current <= 0) return false;
            if (team.team !== casterTeam.team) return false;
            
            const distance = Math.sqrt(
                Math.pow(pos.x - casterPos.x, 2) + 
                Math.pow(pos.z - casterPos.z, 2)
            );
            
            return distance <= effectiveRange;
        });
    }
    
    findBestClusterPosition(entities, minCluster = 2) {
        if (entities.length < minCluster) return null;
        
        let bestPos = null;
        let bestScore = 0;
        
        entities.forEach(entityId => {
            const pos = this.game.getComponent(entityId, this.componentTypes.POSITION);
            if (!pos) return;
            
            // Count nearby entities
            let nearbyCount = 0;
            entities.forEach(otherId => {
                if (otherId === entityId) return;
                const otherPos = this.game.getComponent(otherId, this.componentTypes.POSITION);
                if (!otherPos) return;
                
                const distance = Math.sqrt(
                    Math.pow(pos.x - otherPos.x, 2) + 
                    Math.pow(pos.z - otherPos.z, 2)
                );
                
                if (distance <= 80) nearbyCount++;
            });
            
            if (nearbyCount >= minCluster - 1 && nearbyCount > bestScore) {
                bestScore = nearbyCount;
                bestPos = pos;
            }
        });
        
        return bestPos;
    }
    
    createVisualEffect(position, effectType = 'cast') {
        const effectId = this.game.createEntity();
        const components = this.game.componentManager.getComponents();
        
        this.game.addComponent(effectId, this.componentTypes.POSITION, 
            components.Position(position.x, position.y + 10, position.z));
        
        this.game.addComponent(effectId, this.componentTypes.RENDERABLE, 
            components.Renderable("effects", effectType));
        
        this.game.addComponent(effectId, this.componentTypes.LIFETIME, 
            components.Lifetime(2.0, Date.now() / 1000));
        
        this.game.addComponent(effectId, this.componentTypes.ANIMATION, 
            components.Animation(3, 0, 1));
    }
    
    logAbilityUsage(casterEntity, message = null) {
        if (!this.game.battleLogSystem) return;
        
        const unitType = this.game.getComponent(casterEntity, this.componentTypes.UNIT_TYPE);
        const team = this.game.getComponent(casterEntity, this.componentTypes.TEAM);
        
        if (unitType && team) {
            const defaultMessage = `${team.team} ${unitType.type} uses ${this.name}!`;
            this.game.battleLogSystem.add(message || defaultMessage, 'log-ability');
        }
    }
}