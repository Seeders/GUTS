class BaseAbility {
    constructor(game, abilityData = {}) {
        this.game = game;
        this.abilityData = abilityData;

        // Initialize enums
        this.enums = this.game.getEnums();

        this.id = abilityData.id || 'unknown';
        this.name = abilityData.name || 'Unknown Ability';
        this.description = abilityData.description || '';
        this.cooldown = abilityData.cooldown || 10.0;
        this.range = abilityData.range || 100;
        this.manaCost = abilityData.manaCost || 0;
        // Convert string targetType to numeric enum value
        this.targetType = this._resolveTargetType(abilityData.targetType);
        // Convert string animation to numeric enum value
        this.animation = this._resolveAnimationType(abilityData.animation);
        this.priority = abilityData.priority || 5;
        this.castTime = abilityData.castTime ?? 1.5;
        this.autoTrigger = abilityData.autoTrigger || 'combat';

        this.effects = this.defineEffects();
    }

    _resolveTargetType(targetTypeConfig) {
        // If already numeric, return as-is
        if (typeof targetTypeConfig === 'number') {
            return targetTypeConfig;
        }
        // Convert string to numeric enum value
        if (targetTypeConfig && this.enums.targetType[targetTypeConfig] !== undefined) {
            return this.enums.targetType[targetTypeConfig];
        }
        // Default to auto
        return this.enums.targetType.auto;
    }

    _resolveAnimationType(animationConfig) {
        // If already numeric, return as-is
        if (typeof animationConfig === 'number') {
            return animationConfig;
        }
        // Convert string to numeric enum value
        if (animationConfig && this.enums.animationType[animationConfig] !== undefined) {
            return this.enums.animationType[animationConfig];
        }
        // Default to cast
        return this.enums.animationType.cast;
    }
    getBehaviorAction(entityId, game) {
        if(this.abilityData.behaviorAction){
            return game.getCollections().behaviorNodes[this.abilityData.behaviorAction];
        }
        return null;
    }
    getBehaviorActionType(entityId, game) {
        return this.abilityData.behaviorAction;
    }
    defineEffects() {
        return {
            cast: { type: 'magic', options: { count: 15, scaleMultiplier: 0.8, speedMultiplier: 0.6 } },
            impact: { type: 'magic', options: { count: 10, scaleMultiplier: 1.2 } }
        };
    }
    
    createVisualEffect(position, effectName = 'cast', customOptions = {}) {
        // Don't show visual effects on server
        if (this.game.isServer) return;
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

    // Play particle effects configured in the ability JSON
    // effectType is the prefix (e.g., 'cast', 'trail', 'impact')
    // Reads from config[effectType + 'ParticleEffectSystems'] array
    playConfiguredEffects(effectType, position) {
        if (this.game.isServer) return;

        const effectKey = effectType + 'ParticleEffectSystems';
        const effects = this.abilityData[effectKey];
        if (!effects || !Array.isArray(effects) || effects.length === 0) return;

        const pos = new THREE.Vector3(position.x, position.y, position.z);
        effects.forEach(effectName => {
            this.game.call('playEffectSystem', effectName, pos);
        });
    }
    
    dealDamageWithEffects(sourceId, targetId, damage, element = null, options = {}) {
        // Default to physical element using numeric enum
        if (element === null) {
            element = this.enums.element.physical;
        }
        if (this.game.hasService('applyDamage')) {
            // Use game.call to ensure damage is logged by CallLogger
            const result = this.game.call('applyDamage', sourceId, targetId, damage, element, { isSpell: true, ...options });

            const transform = this.game.getComponent(targetId, "transform");
            const targetPos = transform?.position;
            if (targetPos && this.game.effectsSystem) {
                // Show impact effect - DamageSystem already handles damage numbers
                this.createVisualEffect(targetPos, 'impact');
            }

            return result;
        }
        return null;
    }
    
    // Get visible enemies in range using VisionSystem service
    // Handles: spatial lookup, team filtering, health check, stealth/awareness, range checking
    getEnemiesInRange(casterEntity, range = null) {
        const baseRange = range || this.range;
        return this.game.call('getVisibleEnemiesInRange', casterEntity, baseRange);
    }

    // Use spatial grid for efficient lookup - returns array of entityIds
    // Accounts for collision radii when checking if allies are in range
    getAlliesInRange(casterEntity, range = null) {
        const baseRange = range || this.range;
        const transform = this.game.getComponent(casterEntity, "transform");
        const casterPos = transform?.position;
        const casterTeam = this.game.getComponent(casterEntity, "team");
        const casterRadius = GUTS.GameUtils.getCollisionRadius(this.game, casterEntity);

        if (!casterPos || !casterTeam) return [];

        // Search with extended range to account for target collision radii
        const searchRange = baseRange + casterRadius + 50; // +50 as buffer for large units
        const nearbyEntityIds = this.game.call('getNearbyUnits', casterPos, searchRange, null);
        if (!nearbyEntityIds || nearbyEntityIds.length === 0) return [];

        return nearbyEntityIds.filter(entityId => {
            const team = this.game.getComponent(entityId, "team");
            const health = this.game.getComponent(entityId, "health");

            if (!team || !health || health.current <= 0) return false;
            if (team.team !== casterTeam.team) return false;

            // Use shared utility for consistent range checking
            return GUTS.GameUtils.isInRange(this.game, casterEntity, entityId, baseRange);
        });
    }
    
    // FIXED: Entities already sorted, remove redundant sorting
    findBestClusterPosition(entities, minCluster = 2) {
        if (entities.length < minCluster) return null;

        let bestPos = null;
        let bestScore = 0;

        entities.forEach(entityId => {
            const transform = this.game.getComponent(entityId, "transform");
            const pos = transform?.position;
            if (!pos) return;

            let nearbyCount = 0;
            entities.forEach(otherId => {
                if (otherId === entityId) return;
                const transform = this.game.getComponent(otherId, "transform");
                const otherPos = transform?.position;
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

    // Get the target entity for facing purposes
    getTargetForFacing(casterEntity) {
        // Self-targeting abilities don't need facing change
        if (this.targetType === this.enums.targetType.self) return null;

        const transform = this.game.getComponent(casterEntity, "transform");
        const casterPos = transform?.position;
        if (!casterPos) return null;

        let candidates = [];

        if (this.targetType === this.enums.targetType.enemy || this.targetType === this.enums.targetType.auto) {
            candidates = this.getEnemiesInRange(casterEntity, this.range);
        } else if (this.targetType === this.enums.targetType.ally) {
            candidates = this.getAlliesInRange(casterEntity, this.range)
                .filter(id => id !== casterEntity); // Exclude self
        }

        if (candidates.length === 0) return null;

        // Find closest target (same logic as findClosestEnemy)
        let closestTarget = null;
        let closestDistance = Infinity;

        // OPTIMIZATION: Use numeric sort since entity IDs are numbers (still deterministic, much faster)
        const sortedCandidates = candidates.slice().sort((a, b) => a - b);

        sortedCandidates.forEach(entityId => {
            const transform = this.game.getComponent(entityId, "transform");
            const pos = transform?.position;
            if (!pos) return;

            const distance = Math.sqrt(
                Math.pow(pos.x - casterPos.x, 2) +
                Math.pow(pos.z - casterPos.z, 2)
            );

            if (distance < closestDistance) {
                closestDistance = distance;
                closestTarget = entityId;
            }
        });

        return closestTarget;
    }

    canExecute(casterEntity) { return true; }
    execute(casterEntity, targetData = null) {  }

    // Behavior contribution for UniversalBehaviorTree
    // Abilities can override this to provide behaviors that the unit's behavior tree will execute
    // Should return null or a behavior descriptor: { action: string, target: any, priority: number, data?: object }
    getBehavior(entityId, game) {
        return null;
    }
}
