class AttackAction extends GUTS.BaseAction {
    static TYPE = "ATTACK";
    static PRIORITY = 30;

    canExecute(entityId, controller, game) {
        const targetId = controller.actionTarget;
        if (!targetId) return false;

        const targetHealth = game.getComponent(targetId, 'health');
        const targetDeathState = game.getComponent(targetId, 'deathState');

        if (!targetHealth || targetHealth.current <= 0) return false;
        if (targetDeathState && targetDeathState.isDying) return false;

        return true;
    }

    execute(entityId, controller, game, dt) {
        const combat = game.getComponent(entityId, 'combat');
        const pos = game.getComponent(entityId, 'position');
        const targetId = controller.actionTarget;
        const targetPos = game.getComponent(targetId, 'position');
        const vel = game.getComponent(entityId, 'velocity');

        if (!targetPos) return { complete: true }; // Target lost

        // Check if in attack range
        const inRange = this.isInAttackRange(pos, targetPos, combat);

        if (!inRange) {
            // Move closer to target
            vel.targetX = targetPos.x;
            vel.targetZ = targetPos.z;
            return { complete: false };
        }

        // In range - stop moving and attack
        vel.targetX = null;
        vel.targetZ = null;

        // Handle attack timing
        if (!combat.lastAttack) combat.lastAttack = 0;

        const effectiveAttackSpeed = this.getEffectiveAttackSpeed(entityId, game, combat.attackSpeed);
        const timeSinceLastAttack = game.state.now - combat.lastAttack;

        if (timeSinceLastAttack >= 1 / effectiveAttackSpeed) {
            this.initiateAttack(entityId, targetId, game, combat);
            combat.lastAttack = game.state.now;
        }

        return { complete: false }; // Never complete - keep attacking until target dies or leaves
    }

    onEnd(entityId, controller, game) {
        const vel = game.getComponent(entityId, 'velocity');
        if (vel) {
            vel.targetX = null;
            vel.targetZ = null;
        }
    }

    isInAttackRange(pos, targetPos, combat) {
        const dx = targetPos.x - pos.x;
        const dz = targetPos.z - pos.z;
        const distance = Math.sqrt(dx * dx + dz * dz);
        return distance <= (combat.range || combat.attackRange || 50);
    }

    getEffectiveAttackSpeed(entityId, game, baseAttackSpeed) {
        // Check for equipment bonuses
        if (game.equipmentSystem) {
            const equipment = game.getComponent(entityId, 'equipment');
            if (equipment && equipment.attackSpeed) {
                return baseAttackSpeed * equipment.attackSpeed;
            }
        }
        return baseAttackSpeed;
    }

    initiateAttack(attackerId, targetId, game, combat) {
        // Make attacker face the target
        const attackerPos = game.getComponent(attackerId, 'position');
        const targetPos = game.getComponent(targetId, 'position');
        const facing = game.getComponent(attackerId, 'facing');

        if (attackerPos && targetPos && facing) {
            const dx = targetPos.x - attackerPos.x;
            const dz = targetPos.z - attackerPos.z;
            const angleToTarget = Math.atan2(dz, dx);
            facing.angle = angleToTarget;
        }

        // Trigger attack animation
        if (game.gameManager && game.gameManager.has('triggerSinglePlayAnimation')) {
            const animationSpeed = this.calculateAnimationSpeed(attackerId, game, combat.attackSpeed);
            const minAnimationTime = 1 / combat.attackSpeed * 0.8;
            game.gameManager.call('triggerSinglePlayAnimation', attackerId, 'attack', animationSpeed, minAnimationTime);
        }

        // Handle projectile or melee damage
        if (combat.projectile) {
            this.scheduleProjectileLaunch(attackerId, targetId, game, combat);
        } else if (combat.damage > 0) {
            // Melee attack - apply damage with slight delay for animation
            if (game.schedulingSystem) {
                const damageDelay = (1 / combat.attackSpeed) * 0.5; // 50% through attack
                game.schedulingSystem.scheduleEvent({
                    time: game.state.now + damageDelay,
                    callback: () => {
                        const targetHealth = game.getComponent(targetId, 'health');
                        if (targetHealth && targetHealth.current > 0) {
                            game.gameManager.call('applyDamage', attackerId, targetId, combat.damage);
                        }
                    }
                });
            }
        } else if (game.abilitySystem) {
            // Ability-only units (damage = 0) - rely on abilities for combat
            // This matches old CombatAISystem.handleCombat() lines 479-492
            const abilities = game.gameManager.call('getEntityAbilities', attackerId);
            if (abilities && abilities.length > 0) {
                // Find available offensive abilities
                const availableAbilities = abilities
                    .filter(ability => game.abilitySystem.isAbilityOffCooldown(attackerId, ability.id))
                    .filter(ability => ability.canExecute && ability.canExecute(attackerId))
                    .sort((a, b) => (b.priority || 0) - (a.priority || 0) || a.id.localeCompare(b.id));

                if (availableAbilities.length > 0) {
                    game.abilitySystem.useAbility(attackerId, availableAbilities[0].id);
                }
            }
        }
    }

    scheduleProjectileLaunch(attackerId, targetId, game, combat) {
        if (!game.schedulingSystem) return;

        const launchDelay = (1 / combat.attackSpeed) * 0.5;
        game.schedulingSystem.scheduleEvent({
            time: game.state.now + launchDelay,
            callback: () => {
                const targetHealth = game.getComponent(targetId, 'health');
                if (targetHealth && targetHealth.current > 0) {
                    game.gameManager.call('spawnProjectile', attackerId, targetId, combat);
                }
            }
        });
    }

    calculateAnimationSpeed(attackerId, game, baseAttackSpeed) {
        let animSpeed = baseAttackSpeed;
        if (game.equipmentSystem) {
            const equipment = game.getComponent(attackerId, 'equipment');
            if (equipment && equipment.attackSpeed) {
                animSpeed *= equipment.attackSpeed;
            }
        }
        return animSpeed;
    }
}
