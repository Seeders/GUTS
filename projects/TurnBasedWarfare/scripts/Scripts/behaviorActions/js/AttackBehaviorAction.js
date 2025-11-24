class AttackBehaviorAction extends GUTS.BaseBehaviorAction {
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

        if (!targetPos) return { complete: true }; // Target lost

        // Check if in attack range
        const inRange = this.isInAttackRange(pos, targetPos, combat);

        if (!inRange) {
            // MovementSystem will handle movement to target entity
            return { complete: false };
        }

        // In range - attack
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
        // MovementSystem will stop movement when no target
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
            // Melee attack - schedule damage with proper element
            const damageDelay = (1 / combat.attackSpeed) * 0.5; // 50% through attack
            const element = this.getDamageElement(attackerId, game, combat);

            game.gameManager.call('scheduleDamage',
                attackerId,
                targetId,
                combat.damage,
                element,
                damageDelay,
                {
                    isMelee: true,
                    weaponRange: (combat.range || combat.attackRange || 50) + 10
                }
            );
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
                    // Get projectile data from collections
                    const projectileData = game.getCollections().projectiles[combat.projectile];
                    if (projectileData) {
                        game.gameManager.call('fireProjectile', attackerId, targetId, {
                            id: combat.projectile,
                            ...projectileData
                        });
                    }
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

    getDamageElement(entityId, game, combat) {
        // Check combat component first
        if (combat.element) {
            return combat.element;
        }

        // Check weapon element
        const weaponElement = this.getWeaponElement(entityId, game);
        if (weaponElement) {
            return weaponElement;
        }

        // Default to physical
        return game.damageSystem?.ELEMENT_TYPES?.PHYSICAL || 'physical';
    }

    getWeaponElement(entityId, game) {
        if (!game.equipmentSystem) return null;

        const equipment = game.getComponent(entityId, 'equipment');
        if (!equipment) return null;

        // Check main hand weapon
        const mainHandItem = equipment.slots?.mainHand;
        if (mainHandItem) {
            const itemData = game.gameManager.call('getItemData', mainHandItem);
            if (itemData && itemData.stats && itemData.stats.element) {
                return itemData.stats.element;
            }
        }

        // Check off hand weapon
        const offHandItem = equipment.slots?.offHand;
        if (offHandItem) {
            const itemData = game.gameManager.call('getItemData', offHandItem);
            if (itemData && itemData.stats && itemData.stats.element) {
                return itemData.stats.element;
            }
        }

        return null;
    }
}
