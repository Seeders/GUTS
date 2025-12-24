class SnapTrapAbility extends GUTS.BaseAbility {
    constructor(game, abilityData = {}) {
        super(game, {
            id: 'snap_trap',
            name: 'Snap Trap',
            description: 'Snaps shut on nearby enemies, dealing damage and stunning them',
            cooldown: 0,
            range: 48,
            manaCost: 0,
            targetType: 'enemy',
            animation: 'attack',
            priority: 10,
            castTime: 0,
            ...abilityData
        });

        this.trapDamage = 50;
        this.stunDuration = 3.0;
    }

    canExecute(casterEntity, targetData = null) {
        return true;
    }

    execute(casterEntity, targetData = null) {
        const transform = this.game.getComponent(casterEntity, "transform");
        const trapPos = transform?.position;
        if (!trapPos) return;

        // Visual snap effect
        this.playConfiguredEffects('impact', trapPos);

        // Screen shake (client only)
        if (!this.game.isServer && this.game.effectsSystem) {
            this.game.effectsSystem.playScreenShake(0.15, 1);
        }

        // Find the target - either from targetData or find nearest enemy
        let targetId = targetData?.targetId || targetData;
        if (!targetId || typeof targetId !== 'number') {
            targetId = this.findNearestEnemy(casterEntity);
        }

        if (targetId) {
            // Apply instant damage
            const enums = this.game.getEnums();
            this.dealDamageWithEffects(casterEntity, targetId, this.trapDamage, enums.element.physical, {
                isTrap: true
            });

            // Apply stun
            if (this.game.hasService('applyBuff')) {
                this.game.call('applyBuff', targetId, this.enums.buffTypes.stunned, {
                    duration: this.stunDuration,
                    source: casterEntity
                });
            }

            this.logAbilityUsage(casterEntity, "Bear trap snaps shut!");
        }

        // Destroy the trap after triggering
        this.game.schedulingSystem.scheduleAction(() => {
            this.destroyTrap(casterEntity);
        }, 0.3, casterEntity);
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

            if (dist < nearestDist) {
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

        // Kill the trap entity
        const health = this.game.getComponent(trapEntity, "health");
        if (health) {
            health.current = 0;
        }
    }
}
