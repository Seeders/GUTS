/**
 * AttackEnemyBehaviorAction - Combat action
 * Attacks the target enemy stored in shared state
 *
 * Parameters:
 *   targetKey: string (default: 'target') - Key in shared state for target entity ID
 *
 * Returns RUNNING while attacking (continuous action)
 */
class AttackEnemyBehaviorAction extends GUTS.BaseBehaviorAction {

    execute(entityId, game) {
        const params = this.parameters || {};
        const targetKey = params.targetKey || 'target';

        const shared = this.getShared(entityId, game);
        const targetId = shared[targetKey];

        // targetId is null/undefined when not set, or could be 0 (valid entity ID)
        if (targetId === undefined || targetId === null || targetId < 0) {
            return this.failure();
        }

        const combat = game.getComponent(entityId, 'combat');
        if (!combat) {
            return this.failure();
        }

        // Stop movement while attacking
        const vel = game.getComponent(entityId, 'velocity');
        if (vel) {
            vel.vx = 0;
            vel.vz = 0;
        }

        // Perform attack
        this.performAttack(entityId, targetId, game, combat);

        // Return running - attacking is a continuous action
        return this.running({
            target: targetId,
            attacking: true
        });
    }

    onEnd(entityId, game) {
        // Reset animation to idle when combat ends
        if (!game.isServer && game.hasService('setBillboardAnimation')) {
            const enums = game.call('getEnums');
            game.call('setBillboardAnimation', entityId, enums.animationType.idle, true);
        }
    }

    performAttack(attackerId, targetId, game, combat) {
        // Face the target
        const attackerTransform = game.getComponent(attackerId, 'transform');
        const attackerPos = attackerTransform?.position;
        const targetTransform = game.getComponent(targetId, 'transform');
        const targetPos = targetTransform?.position;

        if (attackerPos && targetPos && attackerTransform) {
            const dx = targetPos.x - attackerPos.x;
            const dz = targetPos.z - attackerPos.z;
            if (!attackerTransform.rotation) attackerTransform.rotation = { x: 0, y: 0, z: 0 };
            attackerTransform.rotation.y = Math.atan2(dz, dx);
        }

        // Note: projectile index 0 is valid (first alphabetically sorted projectile like "arrow")
        // null, undefined, or -1 means "no projectile"
        const hasProjectile = combat.projectile !== null && combat.projectile !== -1 && combat.projectile !== undefined;

        // Ability-only units (damage = 0, no projectile) use abilities for combat
        // Abilities have their own cooldowns managed by AbilitySystem
        if (!hasProjectile && combat.damage <= 0 && game.abilitySystem) {
            this.useOffensiveAbility(attackerId, targetId, game);
            return;
        }

        // Basic attacks (projectile or melee) use attackSpeed cooldown
        if (!combat.lastAttack) combat.lastAttack = 0;
        const effectiveAttackSpeed = this.getEffectiveAttackSpeed(attackerId, game, combat.attackSpeed);

        if (effectiveAttackSpeed > 0) {
            const timeSinceLastAttack = game.state.now - combat.lastAttack;
            if (timeSinceLastAttack < 1 / effectiveAttackSpeed) {
                // Attack on cooldown
                return;
            }
        }

        combat.lastAttack = game.state.now;

        // Trigger attack animation (sprite direction is derived from rotation.y set above)
        if (!game.isServer && game.hasService('triggerSinglePlayAnimation') && effectiveAttackSpeed > 0) {
            const enums = game.call('getEnums');
            const animationSpeed = combat.attackSpeed;
            const minAnimationTime = 1 / combat.attackSpeed * 0.8;
            game.call('triggerSinglePlayAnimation', attackerId, enums.animationType.attack, animationSpeed, minAnimationTime);
        }

        // Handle projectile or melee damage
        // Note: projectile index 0 is valid, only -1 means "no projectile"
        if (hasProjectile) {
            // Schedule projectile to fire at 50% through the attack animation (release point)
            const projectileDelay = effectiveAttackSpeed > 0 ? (1 / combat.attackSpeed) * 0.5 : 0;
            game.schedulingSystem.scheduleAction(() => {
                this.fireProjectile(attackerId, targetId, game, combat);
            }, projectileDelay, attackerId);
        } else if (combat.damage > 0) {
            // Melee attack - schedule damage
            const damageDelay = effectiveAttackSpeed > 0 ? (1 / combat.attackSpeed) * 0.5 : 0;
            const element = this.getDamageElement(attackerId, game, combat);

            game.call('scheduleDamage',
                attackerId,
                targetId,
                combat.damage,
                element,
                damageDelay,
                {
                    isMelee: true,
                    weaponRange: (combat.range || 50) + 10
                }
            );
        }
    }

    useOffensiveAbility(attackerId, targetId, game) {
        const abilities = game.call('getEntityAbilities', attackerId);
        if (!abilities || abilities.length === 0) return;

        // Find available offensive abilities
        const availableAbilities = abilities
            .filter(ability => game.abilitySystem.isAbilityOffCooldown(attackerId, ability.id))
            .filter(ability => !ability.canExecute || ability.canExecute(attackerId))
            .sort((a, b) => (b.priority || 0) - (a.priority || 0) || a.id.localeCompare(b.id));

        if (availableAbilities.length > 0) {
            // Pass targetId directly as a number - ECS components require numeric values
            game.abilitySystem.useAbility(attackerId, availableAbilities[0].id, targetId);
        }
    }

    fireProjectile(attackerId, targetId, game, combat) {
        const targetHealth = game.getComponent(targetId, 'health');
        if (!targetHealth || targetHealth.current <= 0) return;

        // combat.projectile is a numeric index, need to convert to string name
        const reverseEnums = game.getReverseEnums();
        const projectileName = reverseEnums?.projectiles?.[combat.projectile];
        if (!projectileName) return;

        const projectileData = game.getCollections().projectiles?.[projectileName];
        if (projectileData) {
            game.call('fireProjectile', attackerId, targetId, {
                id: projectileName,
                ...projectileData
            });
        }
    }

    getEffectiveAttackSpeed(entityId, game, baseAttackSpeed) {
        if (game.equipmentSystem) {
            const equipment = game.getComponent(entityId, 'equipment');
            if (equipment && equipment.attackSpeed) {
                return baseAttackSpeed * equipment.attackSpeed;
            }
        }
        return baseAttackSpeed;
    }

    getDamageElement(entityId, game, combat) {
        if (combat.element) {
            return combat.element;
        }

        const weaponElement = this.getWeaponElement(entityId, game);
        if (weaponElement) {
            return weaponElement;
        }

        return game.getEnums().element.physical;
    }

    getWeaponElement(entityId, game) {
        if (!game.equipmentSystem) return null;

        const equipment = game.getComponent(entityId, 'equipment');
        if (!equipment) return null;

        const mainHandItem = equipment.slots?.mainHand;
        if (mainHandItem) {
            const itemData = game.call('getItemData', mainHandItem);
            if (itemData && itemData.stats && itemData.stats.element) {
                return itemData.stats.element;
            }
        }

        const offHandItem = equipment.slots?.offHand;
        if (offHandItem) {
            const itemData = game.call('getItemData', offHandItem);
            if (itemData && itemData.stats && itemData.stats.element) {
                return itemData.stats.element;
            }
        }

        return null;
    }
}