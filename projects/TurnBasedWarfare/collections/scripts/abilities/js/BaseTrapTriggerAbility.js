// Base class for trap trigger abilities (used by trap buildings like bearTrap, explosiveTrap)
// Handles enemy detection, damage dealing, and trap destruction
class BaseTrapTriggerAbility extends GUTS.BaseAbility {
    static serviceDependencies = [
        ...GUTS.BaseAbility.serviceDependencies,
        'scheduleAction',
        'applyBuff',
        'startDeathProcess'
    ];

    constructor(game, abilityData = {}) {
        super(game, {
            cooldown: 9999,
            range: abilityData.range || 48,
            manaCost: 0,
            targetType: 'enemy',
            animation: 'idle',
            priority: 10,
            castTime: 0,
            ...abilityData
        });

        // Configurable trap properties - override in subclasses or via abilityData
        this.trapDamage = abilityData.trapDamage ?? 50;
        this.stunDuration = abilityData.stunDuration ?? 0;
        this.isExplosive = abilityData.isExplosive ?? false;
        this.explosionRadius = abilityData.explosionRadius ?? 100;
        this.element = abilityData.element || 'physical';
        this.trapMessage = abilityData.trapMessage || 'Trap triggered!';

        // Cache for targets found during canExecute
        this._pendingTargets = new Map();
    }

    canExecute(casterEntity, targetData = null) {
        // Only trigger when there's an enemy in range
        const enemy = this.findNearestEnemy(casterEntity);
        if (enemy !== null) {
            // Cache the target for execute() to use
            this._pendingTargets.set(casterEntity, enemy);
            return true;
        }
        this._pendingTargets.delete(casterEntity);
        return false;
    }

    execute(casterEntity, targetData = null) {
        const transform = this.game.getComponent(casterEntity, "transform");
        const trapPos = transform?.position;
        if (!trapPos) return;

        // Visual trigger effect
        this.playConfiguredEffects('impact', trapPos);

        // Screen shake (client only)
        if (!this.game.isServer && this.game.effectsSystem) {
            this.game.effectsSystem.playScreenShake(this.isExplosive ? 0.3 : 0.15, this.isExplosive ? 2 : 1);
        }

        // Find the target - use cached target from canExecute, or find nearest enemy
        let targetId = targetData?.targetId || targetData;
        if (!targetId || typeof targetId !== 'number') {
            targetId = this._pendingTargets.get(casterEntity);
            this._pendingTargets.delete(casterEntity);

            if (!targetId) {
                targetId = this.findNearestEnemy(casterEntity);
            }
        }

        if (targetId) {
            if (this.isExplosive) {
                this.handleExplosion(casterEntity, trapPos);
            } else {
                this.handleSingleTarget(casterEntity, targetId);
            }

            this.logAbilityUsage(casterEntity, this.trapMessage);

            // Destroy the trap after triggering
            this.call.scheduleAction( () => {
                this.destroyTrap(casterEntity);
            }, 0.3, casterEntity);
        }
    }

    // Single target damage + optional stun (for bear traps)
    handleSingleTarget(casterEntity, targetId) {
        const enums = this.game.getEnums();

        this.dealDamageWithEffects(casterEntity, targetId, this.trapDamage, enums.element[this.element] || enums.element.physical, {
            isTrap: true
        });

        // Apply stun if configured
        if (this.stunDuration > 0 && this.game.hasService('applyBuff')) {
            this.call.applyBuff( targetId, enums.buffTypes.stunned, {
                duration: this.stunDuration,
                source: casterEntity
            });
        }
    }

    // AoE damage with falloff (for explosive traps)
    handleExplosion(casterEntity, explosionPos) {
        const enums = this.game.getEnums();
        const casterTeam = this.game.getComponent(casterEntity, "team");

        // Enhanced explosion effects (client only)
        if (!this.game.isServer && this.game.effectsSystem) {
            this.game.effectsSystem.playScreenFlash('#ff4400', 0.3);
        }

        // Find all enemies in explosion radius
        const entities = this.game.getEntitiesWith("transform", "health", "team");
        const sortedEntities = entities.slice().sort((a, b) => a - b);

        for (const entityId of sortedEntities) {
            if (entityId === casterEntity) continue;

            const entityTeam = this.game.getComponent(entityId, "team");
            if (!entityTeam || (casterTeam && entityTeam.team === casterTeam.team)) continue;

            const entityHealth = this.game.getComponent(entityId, "health");
            if (!entityHealth || entityHealth.current <= 0) continue;

            const entityTransform = this.game.getComponent(entityId, "transform");
            const entityPos = entityTransform?.position;
            if (!entityPos) continue;

            const dx = entityPos.x - explosionPos.x;
            const dz = entityPos.z - explosionPos.z;
            const dist = Math.sqrt(dx * dx + dz * dz);

            if (dist <= this.explosionRadius) {
                // Damage falloff: 100% at center, 30% at edge
                const damageMultiplier = Math.max(0.3, 1.0 - (dist / this.explosionRadius) * 0.7);
                const finalDamage = Math.floor(this.trapDamage * damageMultiplier);

                this.dealDamageWithEffects(casterEntity, entityId, finalDamage, enums.element[this.element] || enums.element.fire, {
                    isTrap: true,
                    isExplosion: true
                });
            }
        }
    }

    findNearestEnemy(casterEntity) {
        const casterTransform = this.game.getComponent(casterEntity, "transform");
        const casterTeam = this.game.getComponent(casterEntity, "team");
        const casterPos = casterTransform?.position;

        if (!casterPos || !casterTeam) return null;

        const entities = this.game.getEntitiesWith("transform", "health", "team");
        let nearestEnemy = null;
        let nearestDist = this.range;

        for (const entityId of entities) {
            if (entityId === casterEntity) continue;

            const entityTeam = this.game.getComponent(entityId, "team");
            if (!entityTeam || entityTeam.team === casterTeam.team) continue;

            const entityHealth = this.game.getComponent(entityId, "health");
            if (!entityHealth || entityHealth.current <= 0) continue;

            const entityTransform = this.game.getComponent(entityId, "transform");
            const entityPos = entityTransform?.position;
            if (!entityPos) continue;

            const dx = entityPos.x - casterPos.x;
            const dz = entityPos.z - casterPos.z;
            const dist = Math.sqrt(dx * dx + dz * dz);

            if (dist <= nearestDist) {
                nearestDist = dist;
                nearestEnemy = entityId;
            }
        }

        return nearestEnemy;
    }

    destroyTrap(trapEntity) {
        const transform = this.game.getComponent(trapEntity, "transform");
        const trapPos = transform?.position;

        if (trapPos) {
            this.playConfiguredEffects('expiration', trapPos);
        }

        if (this.game.hasService('startDeathProcess')) {
            this.call.startDeathProcess( trapEntity);
        }
    }
}
