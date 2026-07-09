class BaseAbility {
    // Static property for services this ability depends on (will be cached for fast access)
    // Format: ['serviceName1', 'serviceName2', ...]
    // Child classes can extend this array: static serviceDependencies = [...GUTS.BaseAbility.serviceDependencies, 'additionalService']
    static serviceDependencies = [
        'getVisibleEnemiesInRange',
        'getNearbyUnits',
        'hasLineOfSight',
        'playEffectSystem',
        'playEffect',
        'applyDamage'
    ];

    constructor(game, abilityData = {}) {
        this.game = game;
        this.abilityData = abilityData;

        // Initialize enums
        this.enums = this.game.getEnums();

        // Cached service functions for fast access (e.g., this.call.serviceName)
        this.call = {};

        // Cache service dependencies for fast access
        this.game.getServiceDependencies(this);

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
        // Abilities only target enemies they can SEE (line of sight), matching basic
        // attacks. Abilities that fire blind at a position (AoE on a spot, etc.) opt
        // out by setting "requiresLineOfSight": false in their ability data.
        this.requiresLineOfSight = abilityData.requiresLineOfSight ?? true;

        this.effects = this.defineEffects();

        // Reusable array to avoid allocations in getTargetForFacing
        this._sortedCandidates = [];

        // Source level — set by AbilitySystem.addAbilitiesToUnit when an ability
        // is granted with an explicit level. Used by scaledDamage() to scale the
        // ability's damage with that level. Defaults to 1.
        this.sourceItemLevel = 1;
    }

    // ---- Buff helpers (multi-buff store on BuffEffectsSystem) --------------
    // Buffs live on dedicated buff entities so a unit can carry several at
    // once. NEVER game.addComponent(id, 'buff', ...) directly — that's the
    // legacy single-slot path and clobbers whatever buff the unit had.

    applyBuff(targetId, buffFields) {
        return this.game.buffEffectsSystem?.applyBuff(targetId, buffFields) ?? null;
    }

    // buffType omitted → removes ALL buffs from the target.
    removeBuff(targetId, buffType = null) {
        this.game.buffEffectsSystem?.removeBuff(targetId, buffType);
    }

    hasBuff(targetId, buffType) {
        return this.game.buffEffectsSystem?.hasBuff(targetId, buffType) ?? false;
    }

    getBuff(targetId, buffType) {
        return this.game.buffEffectsSystem?.getBuffOfType(targetId, buffType) ?? null;
    }

    // Scales ability damage with sourceItemLevel. Use this to multiply any base
    // damage value before applying it: scheduleDamage, applyDamage, splash, DoT.
    scaledDamage(baseDamage) {
        const lvl = Math.max(1, this.sourceItemLevel || 1);
        return baseDamage * (1 + (lvl - 1) * 0.15);
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
        const collections = this.game.getCollections();
        effects.forEach(effectName => {
            // Ability data mixes both preset kinds: multi-layer SYSTEMS and
            // single particle EFFECTS. Route each name to the collection that
            // actually defines it — previously every plain-effect name warned
            // and silently no-oped, which left many abilities looking bare.
            if (collections.particleEffectSystems?.[effectName]) {
                this.call.playEffectSystem?.(effectName, pos);
            } else if (collections.particleEffects?.[effectName]) {
                this.call.playEffect?.(effectName, pos);
            } else {
                this.call.playEffectSystem?.(effectName, pos); // keeps the warn
            }
        });
    }
    
    dealDamageWithEffects(sourceId, targetId, damage, element = null, options = {}) {
        // Default to physical element using numeric enum
        if (element === null) {
            element = this.enums.element.physical;
        }
        // Auto-scale by the source item's level so all abilities going through
        // this helper benefit from item leveling without per-ability changes.
        const scaled = this.scaledDamage(damage);
        if (this.game.hasService('applyDamage')) {
            // Use game.call to ensure damage is logged by CallLogger
            const result = this.call.applyDamage( sourceId, targetId, scaled, element, { isSpell: true, ...options });

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
        const enemies = this.call.getVisibleEnemiesInRange( casterEntity, baseRange);
        if (!Array.isArray(enemies)) return [];

        // Gate targeting on line of sight (unless this ability fires blind). Acquisition
        // elsewhere is LOS-free, but to actually CAST at an enemy the caster must see it.
        if (!this.requiresLineOfSight || !this.game.hasService('hasLineOfSight')) return enemies;

        const myPos = this.game.getComponent(casterEntity, 'transform')?.position;
        if (!myPos) return enemies;
        const unitType = this.game.getUnitTypeDef( this.game.getComponent(casterEntity, 'unitType'));

        const visible = [];
        for (const eid of enemies) {
            const pos = this.game.getComponent(eid, 'transform')?.position;
            if (!pos) continue;
            if (this.call.hasLineOfSight( { x: myPos.x, z: myPos.z }, { x: pos.x, z: pos.z }, unitType, casterEntity)) {
                visible.push(eid);
            }
        }
        return visible;
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
        const nearbyEntityIds = this.call.getNearbyUnits( casterPos, searchRange, null);
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

        // OPTIMIZATION: Reuse array to avoid allocations from .slice().sort()
        this._sortedCandidates.length = 0;
        for (let i = 0; i < candidates.length; i++) {
            this._sortedCandidates.push(candidates[i]);
        }
        this._sortedCandidates.sort((a, b) => a - b);

        this._sortedCandidates.forEach(entityId => {
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

    canExecute(casterEntity) { return this._meetsWeaponRequirement(casterEntity); }
    execute(casterEntity, targetData = null) {  }

    // Check declarative weapon requirements on the ability JSON:
    //   requiresWeaponCategory: 'melee' | 'ranged' | 'spell'
    //   requiresWeaponType:     'sword' | 'dagger' | 'axe' | 'mace' | 'bow' | 'wand' | 'staff'
    // Subclasses that override canExecute() should call this and AND-combine the result.
    _meetsWeaponRequirement(casterEntity) {
        // Weapon requirements were a gear-system feature. With per-unit gear
        // removed, weapon identity lives on the unit definition and these
        // declarative checks no longer apply — abilities are always allowed.
        return true;
    }

    // Behavior contribution for UniversalBehaviorTree
    // Abilities can override this to provide behaviors that the unit's behavior tree will execute
    // Should return null or a behavior descriptor: { action: string, target: any, priority: number, data?: object }
    getBehavior(entityId, game) {
        return null;
    }
}
